"""Template mappings and the job's current version (FR-TEMPLATE-006, FR-OCR-019/020/023).
Rules from main's `doc_templates/service.py`, `repository.py` and `routes/templates.py`
(ADR-009 class B):

- versions of a job form one sequence (max + 1); `result_versions.mapping_id` says which
  mapping a version belongs to (None = the generic result);
- `ocr_jobs.current_mapping_id` points at the mapping of the current version,
  `pending_mapping_id` at the mapping the person asked for and is still running;
- creating, switching and applying run under the job row lock; this module never commits.

Added here: a conversion that misses a primary field fails (PRIMARY_MISSING), a confirmed
job never changes its current version, and at most MAX_MAPPINGS attempts per job.
"""

import uuid

from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.errors import AppError
from app.models import (
    DocumentTemplate,
    DocumentTemplateVersion,
    OcrJob,
    OcrRawResult,
    ResultVersion,
    TemplateMapping,
)
from app.ocr import states
from app.services.ocr_settings_service import OcrSettings
from app.services.tenant_access import not_found

MAX_MAPPINGS = 5  # A7
AUTO, MANUAL = "AUTO", "MANUAL"
MATCH_THRESHOLD = 0.70  # auto match converts at or above; below, free-form (FR-OCR-019)
NO_TEMPLATE_FIT = "NO_TEMPLATE_FIT"


def quiet(mapping: TemplateMapping) -> bool:
    """A failed automatic mapping is not an error to the person: free-form stays."""
    return mapping.source == AUTO and mapping.status == states.FAILED


async def auto_scores(db: AsyncSession, job_id: str) -> dict[int, float]:
    """Scores per template version from the latest automatic match (FR-OCR-024)."""
    ranking = (
        await db.execute(
            select(TemplateMapping.candidates)
            .where(TemplateMapping.job_id == job_id, TemplateMapping.source == AUTO)
            .order_by(TemplateMapping.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    scores: dict[int, float] = {}
    for entry in ranking or []:
        if isinstance(entry, dict) and isinstance(entry.get("template_version_id"), int):
            score = entry.get("score")
            if isinstance(score, (int, float)):
                scores[entry["template_version_id"]] = float(score)
    return scores


def llm_config(ocr: OcrSettings, settings: Settings) -> dict:
    """The mapping the moved LLM code reads (DEEPSEEK_* keys, ADR-009 class A)."""
    key: SecretStr | None = settings.llm_api_key
    return {
        "DEEPSEEK_API_KEY": key.get_secret_value() if key else "",
        "DEEPSEEK_BASE_URL": ocr.llm_base_url,
        "DEEPSEEK_MODEL": ocr.llm_model,
    }


async def available_versions(
    db: AsyncSession, tenant_id: int
) -> list[tuple[DocumentTemplate, DocumentTemplateVersion]]:
    """System templates plus this tenant's, enabled and not deleted, at their current version."""
    rows = await db.execute(
        select(DocumentTemplate, DocumentTemplateVersion)
        .join(
            DocumentTemplateVersion,
            DocumentTemplateVersion.id == DocumentTemplate.current_version_id,
        )
        .where(
            (DocumentTemplate.tenant_id.is_(None)) | (DocumentTemplate.tenant_id == tenant_id),
            DocumentTemplate.status == "ENABLED",
            DocumentTemplate.deleted_at.is_(None),
        )
        .order_by(DocumentTemplate.id)
    )
    return [(t, v) for t, v in rows.all()]


async def current_version(db: AsyncSession, job_id: str) -> ResultVersion | None:
    return (
        await db.execute(
            select(ResultVersion).where(ResultVersion.job_id == job_id, ResultVersion.is_current)
        )
    ).scalar_one_or_none()


async def next_version_no(db: AsyncSession, job_id: str) -> int:
    top = (
        await db.execute(
            select(func.max(ResultVersion.version)).where(ResultVersion.job_id == job_id)
        )
    ).scalar()
    return (top or 0) + 1


async def latest_version_of(
    db: AsyncSession, job_id: str, mapping_id: str | None
) -> ResultVersion | None:
    q = select(ResultVersion).where(ResultVersion.job_id == job_id)
    q = q.where(
        ResultVersion.mapping_id.is_(None)
        if mapping_id is None
        else ResultVersion.mapping_id == mapping_id
    )
    return (
        await db.execute(q.order_by(ResultVersion.version.desc()).limit(1))
    ).scalar_one_or_none()


async def raw_of(db: AsyncSession, job_id: str) -> OcrRawResult | None:
    return (
        await db.execute(
            select(OcrRawResult)
            .where(OcrRawResult.job_id == job_id)
            .order_by(OcrRawResult.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def mapping_count(db: AsyncSession, job_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(TemplateMapping)
            .where(TemplateMapping.job_id == job_id)
        )
    ).scalar_one()


async def create_mapping(
    db: AsyncSession,
    job: OcrJob,
    raw_id: str,
    *,
    source: str,
    base_version_id: str | None,
    template_id: int | None = None,
    template_version_id: int | None = None,
    user_id: int | None = None,
) -> TemplateMapping:
    mapping = TemplateMapping(
        id=str(uuid.uuid4()),
        job_id=job.id,
        raw_result_id=raw_id,
        source=source,
        status=states.PENDING,
        template_id=template_id,
        template_version_id=template_version_id,
        created_by_user_id=user_id,
        base_version_id=base_version_id,
    )
    db.add(mapping)
    await db.flush()
    job.pending_mapping_id = mapping.id
    return mapping


async def start_auto_mapping(
    db: AsyncSession, job: OcrJob, raw: OcrRawResult, version: ResultVersion
) -> None:
    """After recognition: an AUTO mapping when any template is available (FR-OCR-019)."""
    if await available_versions(db, job.tenant_id):
        await create_mapping(db, job, raw.id, source=AUTO, base_version_id=version.id)


async def template_name(db: AsyncSession, version: ResultVersion | None) -> str | None:
    """The template a version was converted to; None for the generic result."""
    if version is None or version.mapping_id is None:
        return None
    mapping = await db.get(TemplateMapping, version.mapping_id)
    if mapping is None or mapping.template_version_id is None:
        return None
    tpl = await db.get(DocumentTemplateVersion, mapping.template_version_id)
    return tpl.name if tpl else None


async def switch_to(
    db: AsyncSession,
    job: OcrJob,
    target: ResultVersion,
    mapping_id: str | None,
    *,
    by_person: bool = False,
    user_id: int | None = None,
) -> ResultVersion:
    """Make `target` the current version (no copy). The old current one is cleared first:
    one current version per job (ADR-009 §3.4). A switch a person asked for is written to
    the change log when the template changes (FR-VERIFY-007); automatic ones are not."""
    from app.ocr.textin.adapter import _count_structure
    from app.services import change_log

    current = await current_version(db, job.id)
    if by_person and (current is None or current.id != target.id):
        before, after = await template_name(db, current), await template_name(db, target)
        if before != after:
            await change_log.record_switch(db, job.id, target.id, before, after, user_id)
    if current is not None and current.id != target.id:
        current.is_current = False
        await db.flush()
    target.is_current = True
    job.current_mapping_id = mapping_id
    job.pending_mapping_id = None
    job.mapping_switched_at = utcnow()  # failures from before this are settled
    job.table_count, job.field_count = (
        _count_structure(target.structured) if target.structured is not None else (0, 0)
    )
    job.updated_at = utcnow()
    await db.flush()
    return target


async def finalize_ready(
    db: AsyncSession,
    mapping: TemplateMapping,
    job: OcrJob,
    structured: dict,
    *,
    warnings: list,
    dropped: int,
) -> bool:
    """A READY mapping always gets its own version; it becomes current only if the person
    still waits for it, nothing changed meanwhile, and the job is not confirmed."""
    version = ResultVersion(
        id=str(uuid.uuid4()),
        job_id=job.id,
        version=await next_version_no(db, job.id),
        is_current=False,
        structured=structured,
        mapping_id=mapping.id,
    )
    db.add(version)
    await db.flush()
    now = utcnow()
    mapping.status, mapping.result_version_id = states.READY, version.id
    mapping.warnings, mapping.dropped_keys = warnings, dropped
    mapping.error_code = mapping.error_message = None
    mapping.finished_at = mapping.updated_at = now
    current = await current_version(db, job.id)
    apply = (
        job.pending_mapping_id == mapping.id
        and current is not None
        and current.id == mapping.base_version_id
        and job.review_status != "CONFIRMED"
    )
    if apply:
        manual = mapping.source == MANUAL
        await switch_to(
            db, job, version, mapping.id, by_person=manual, user_id=mapping.created_by_user_id
        )
    elif job.pending_mapping_id == mapping.id:
        job.pending_mapping_id = None  # kept as "ready, can be switched to"
    return apply


def fail(mapping: TemplateMapping, job: OcrJob | None, code: str, message: str) -> None:
    now = utcnow()
    mapping.status, mapping.error_code = states.FAILED, code
    mapping.error_message = (message or None) and message[:512]
    mapping.finished_at = mapping.updated_at = now
    if job is not None and job.pending_mapping_id == mapping.id:
        job.pending_mapping_id = None


def _conflict(code: str) -> AppError:
    return AppError(409, code, f"error.{code}")


async def template_options(db: AsyncSession, job: OcrJob) -> dict:
    scores = await auto_scores(db, job.id)
    templates = [
        {
            "template_id": t.id,
            "template_version_id": v.id,
            "code": t.code,
            "name": v.name,
            "score": scores.get(v.id),
            "recommended": False,
        }
        for t, v in await available_versions(db, job.tenant_id)
    ]
    # By score, unscored last; the best scored one is "recommended" (FR-OCR-024).
    templates.sort(key=lambda o: (o["score"] is None, -(o["score"] or 0.0)))
    if templates and templates[0]["score"] is not None:
        templates[0]["recommended"] = True
    last = (
        await db.execute(
            select(TemplateMapping.error_code)
            .where(
                TemplateMapping.job_id == job.id,
                TemplateMapping.status == states.FAILED,
                TemplateMapping.source != AUTO,  # automatic failures are quiet
                *(
                    [TemplateMapping.finished_at > job.mapping_switched_at]
                    if job.mapping_switched_at
                    else []
                ),
            )
            .order_by(TemplateMapping.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    current = None
    if job.current_mapping_id:
        current = (
            await db.execute(
                select(TemplateMapping.template_version_id).where(
                    TemplateMapping.id == job.current_mapping_id
                )
            )
        ).scalar_one_or_none()
    return {
        "templates": templates,
        "generic": True,
        "current_template_version_id": current,
        "attempts": await mapping_count(db, job.id),
        "limit": MAX_MAPPINGS,
        "last_failure": last,
    }


def _check_open(job: OcrJob) -> None:
    if job.status not in states.SUCCESS:
        raise _conflict("job_not_terminal")
    if job.review_status == "CONFIRMED":
        raise _conflict("result_confirmed")


async def apply_template(
    db: AsyncSession, job: OcrJob, template_version_id: int, user_id: int | None
) -> tuple[str, TemplateMapping | None]:
    """("switched", mapping) when a READY conversion exists (no LLM call), else
    ("started", mapping) for a new attempt. The job row is locked by the caller."""
    _check_open(job)
    available = {v.id: (t, v) for t, v in await available_versions(db, job.tenant_id)}
    if template_version_id not in available:
        raise not_found()
    tpl, ver = available[template_version_id]
    ready = (
        await db.execute(
            select(TemplateMapping)
            .where(
                TemplateMapping.job_id == job.id,
                TemplateMapping.template_version_id == ver.id,
                TemplateMapping.status == states.READY,
            )
            .order_by(TemplateMapping.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if ready is not None:
        target = await latest_version_of(db, job.id, ready.id)
        if target is not None:
            await switch_to(db, job, target, ready.id, by_person=True, user_id=user_id)
            return "switched", ready
    running = (
        await db.execute(
            select(TemplateMapping.id).where(
                TemplateMapping.job_id == job.id,
                TemplateMapping.status.in_(states.MAPPING_IN_PROGRESS),
            )
        )
    ).first()
    if running is not None:
        raise _conflict("mapping_in_progress")
    if await mapping_count(db, job.id) >= MAX_MAPPINGS:
        raise _conflict("mapping_limit")
    raw = await raw_of(db, job.id)
    current = await current_version(db, job.id)
    if raw is None or current is None:
        raise not_found()
    mapping = await create_mapping(
        db,
        job,
        raw.id,
        source=MANUAL,
        base_version_id=current.id,
        template_id=tpl.id,
        template_version_id=ver.id,
        user_id=user_id,
    )
    return "started", mapping


async def use_generic(db: AsyncSession, job: OcrJob, user_id: int | None = None) -> ResultVersion:
    _check_open(job)
    target = await latest_version_of(db, job.id, None)
    if target is None:
        raise not_found()
    return await switch_to(db, job, target, None, by_person=True, user_id=user_id)
