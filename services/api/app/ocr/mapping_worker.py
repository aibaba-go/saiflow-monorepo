"""Template mapping work (FR-OCR-019/020), run in the OCR worker loop after recognition.
Rules from main's `mapping_worker.py`: claim one PENDING mapping, match (LLM) when no
template was chosen, convert (LLM), then apply under the job lock. LLM calls happen with no
transaction open; the job and mapping are re-read before writing, so a deleted result, a
confirmed job or a superseded mapping is never overwritten (Review Focus 2).

Added here: a conversion missing a primary field fails as PRIMARY_MISSING (the chosen
template does not fit the document, FR-OCR-020). When the match reaches 70% the template is
locked after the job and checked again before converting; one revoked or disabled
meanwhile is not used (quiet free-form, TEMPLATE_UNAVAILABLE), one still usable is marked
applied (FR-TEMPLATE-010; scoring alone never is).
"""

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clock import utcnow
from app.config import Settings
from app.models import DocumentTemplateVersion, OcrJob, OcrRawResult, TemplateMapping
from app.ocr import page_text, states
from app.ocr.templates import converter, matcher, normalize
from app.ocr.templates.llm import (
    MAPPING_INTERRUPTED,
    RAW_RESULT_MISSING,
    LlmClient,
    MappingError,
)
from app.services import mapping_service, ocr_settings_service, template_access

log = logging.getLogger("app.ocr.mapping")
PRIMARY_MISSING = "PRIMARY_MISSING"
TEMPLATE_UNAVAILABLE = "TEMPLATE_UNAVAILABLE"
STALE_AFTER = timedelta(minutes=15)


def _no_fit(result) -> bool:
    return result.score is None or result.score < mapping_service.MATCH_THRESHOLD


async def _claim(sm: async_sessionmaker[AsyncSession]) -> tuple[str, str] | None:
    async with sm() as db:
        row = (
            await db.execute(
                select(TemplateMapping)
                .where(TemplateMapping.status == states.PENDING)
                .order_by(TemplateMapping.created_at, TemplateMapping.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if row is None:
            return None
        stage = states.MATCHING if row.template_version_id is None else states.CONVERTING
        row.status, row.started_at, row.updated_at = stage, utcnow(), utcnow()
        await db.commit()
        return row.id, stage


async def _fail(sm, mapping_id: str, code: str, message: str, client: LlmClient | None) -> None:
    async with sm() as db:
        mapping = await db.get(TemplateMapping, mapping_id)
        if mapping is None:
            return
        job = (
            await db.execute(select(OcrJob).where(OcrJob.id == mapping.job_id).with_for_update())
        ).scalar_one_or_none()
        mapping = (
            await db.execute(
                select(TemplateMapping).where(TemplateMapping.id == mapping_id).with_for_update()
            )
        ).scalar_one_or_none()
        if mapping is None or mapping.status in (states.READY, states.FAILED):
            return
        mapping_service.fail(mapping, job, code, message)
        if client is not None:
            _stats(mapping, client)
        await db.commit()
    log.warning("template mapping failed mapping=%s code=%s", mapping_id, code)


def _stats(mapping: TemplateMapping, client: LlmClient) -> None:
    mapping.llm_calls = client.usage.calls
    mapping.prompt_tokens = client.usage.prompt_tokens
    mapping.completion_tokens = client.usage.completion_tokens
    mapping.model = client.model[:64] if client.usage.calls else None


async def _alive(db: AsyncSession, job_id: str, mapping_id: str, expected: str) -> bool:
    job = await db.get(OcrJob, job_id, populate_existing=True)
    mapping = await db.get(TemplateMapping, mapping_id, populate_existing=True)
    return job is not None and mapping is not None and mapping.status == expected


async def run_once(
    sm: async_sessionmaker[AsyncSession],
    settings: Settings,
    *,
    transport=None,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Process one pending mapping; False when there was none."""
    claimed = await _claim(sm)
    if claimed is None:
        return False
    mapping_id, stage = claimed
    client: LlmClient | None = None
    try:
        async with sm() as db:
            mapping = await db.get(TemplateMapping, mapping_id)
            job_id = mapping.job_id
            raw = await db.get(OcrRawResult, mapping.raw_result_id)
            if raw is None:
                raise MappingError(RAW_RESULT_MISSING, "raw result missing")
            payload = page_text.model_input(raw.engine, raw.payload)  # FR-OCR-028
            job = await db.get(OcrJob, job_id)
            tenant_id = job.tenant_id
            ocr = await ocr_settings_service.get(db)
            candidates = [
                matcher.Candidate(t.id, v.id, v.name, v.description, v.groups)
                for t, v in await mapping_service.available_versions(db, tenant_id)
            ]
        client = LlmClient(
            mapping_service.llm_config(ocr, settings), transport=transport, sleep=sleep
        )
        if stage == states.MATCHING:
            result = await asyncio.to_thread(matcher.match, client, payload, candidates)
            fits = not _no_fit(result)
            async with sm() as db:
                if fits:  # conversion starts: lock job → template, re-check, mark applied
                    await db.execute(select(OcrJob).where(OcrJob.id == job_id).with_for_update())
                if not await _alive(db, job_id, mapping_id, states.MATCHING):
                    return True
                usable = fits and (
                    await template_access.claim_for_use(
                        db, tenant_id, result.template_id, result.template_version_id
                    )
                    is not None
                )
                chosen = fits and not usable
                await db.execute(
                    update(TemplateMapping)
                    .where(
                        TemplateMapping.id == mapping_id, TemplateMapping.status == states.MATCHING
                    )
                    .values(
                        # a template revoked while scoring is not recorded as applied
                        template_id=None if chosen else result.template_id,
                        template_version_id=None if chosen else result.template_version_id,
                        match_score=result.score,
                        match_reason=(result.reason or None) and result.reason[:255],
                        candidates=result.ranking,
                        status=states.CONVERTING if usable else states.MATCHING,
                        updated_at=utcnow(),
                    )
                )
                await db.commit()
            if chosen:  # revoked/disabled meanwhile: free-form stays, quietly (AC-006-04)
                raise MappingError(TEMPLATE_UNAVAILABLE, "template no longer usable")
            if _no_fit(result):  # below 70%: free-form stays, quietly (FR-OCR-019)
                raise MappingError(
                    mapping_service.NO_TEMPLATE_FIT, f"best score {result.score} below threshold"
                )
        async with sm() as db:
            mapping = await db.get(TemplateMapping, mapping_id, populate_existing=True)
            version = await db.get(DocumentTemplateVersion, mapping.template_version_id)
            if version is None:
                raise MappingError(TEMPLATE_UNAVAILABLE, "template version missing")
            groups, name = version.groups, version.name
        raw_text = matcher.compact_raw(payload)
        structured, warnings, dropped = await asyncio.to_thread(
            converter.convert, client, raw_text, name, groups
        )
        missing = normalize.primary_missing(groups, structured)
        if missing:
            await _fail(
                sm, mapping_id, PRIMARY_MISSING, "missing: " + ", ".join(missing)[:400], client
            )
            return True
        async with sm() as db:
            job = (
                await db.execute(select(OcrJob).where(OcrJob.id == job_id).with_for_update())
            ).scalar_one_or_none()
            mapping = (
                await db.execute(
                    select(TemplateMapping)
                    .where(TemplateMapping.id == mapping_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if job is None or mapping is None or mapping.status != states.CONVERTING:
                return True
            await mapping_service.finalize_ready(
                db, mapping, job, structured, warnings=warnings, dropped=dropped
            )
            _stats(mapping, client)
            await db.commit()
        return True
    except MappingError as exc:
        await _fail(sm, mapping_id, exc.code, exc.message, client)
        return True
    except Exception:
        log.exception("template mapping crashed mapping=%s", mapping_id)
        await _fail(sm, mapping_id, MAPPING_INTERRUPTED, "internal error", client)
        return True


async def recover(sm: async_sessionmaker[AsyncSession], *, startup: bool = False) -> int:
    """Mappings stuck in MATCHING or CONVERTING fail as interrupted: all of them at startup
    (nothing can still be running), else those untouched for 15 minutes."""
    cutoff = utcnow() if startup else utcnow() - STALE_AFTER
    async with sm() as db:
        ids = list(
            (
                await db.execute(
                    select(TemplateMapping.id).where(
                        TemplateMapping.status.in_((states.MATCHING, states.CONVERTING)),
                        TemplateMapping.updated_at < cutoff,
                    )
                )
            ).scalars()
        )
    for mapping_id in ids:
        await _fail(sm, mapping_id, MAPPING_INTERRUPTED, "interrupted (worker restart)", None)
    return len(ids)
