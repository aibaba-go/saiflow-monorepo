"""Results: the current version, saving drafts, the confirm gate and the lock
(FR-VERIFY-015, 009, 006). Rules from main's `routes/results.py` without the old per-page
path (T9): a save with different content makes a new version, the old one stays; a save is
based on a version number and a stale one is a conflict; template results are completed to
the template's structure before saving; confirming checks registration, the plan and the
required fields, in that order, before anything is written. All under the job row lock.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import DocumentTemplateVersion, OcrJob, ResultVersion, TemplateMapping, User
from app.ocr import amounts, states
from app.ocr.templates import normalize
from app.services import change_log, job_service, mapping_service, metering_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

MAX_STRUCTURE_BYTES = 2_000_000


def _conflict(code: str) -> AppError:
    return AppError(409, code, f"error.{code}")


async def _template(db: AsyncSession, version: ResultVersion) -> DocumentTemplateVersion | None:
    if version.mapping_id is None:
        return None
    mapping = await db.get(TemplateMapping, version.mapping_id)
    if mapping is None or mapping.template_version_id is None:
        return None
    return await db.get(DocumentTemplateVersion, mapping.template_version_id)


async def _mapping_state(db: AsyncSession, job: OcrJob) -> dict | None:
    """The conversion the person waits for, or else the latest failed one; a failed
    automatic mapping is quiet (free-form stays, FR-OCR-019)."""
    if job.pending_mapping_id:
        m = await db.get(TemplateMapping, job.pending_mapping_id)
        if m is not None:
            return {"status": m.status, "error": m.error_code}
    latest = (
        await db.execute(
            select(TemplateMapping)
            .where(TemplateMapping.job_id == job.id)
            .order_by(TemplateMapping.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    settled = (
        job.mapping_switched_at is not None
        and latest is not None
        and latest.finished_at is not None
        and latest.finished_at <= job.mapping_switched_at
    )
    if (
        latest is not None
        and latest.status == states.FAILED
        and not mapping_service.quiet(latest)
        and not settled
    ):
        return {"status": latest.status, "error": latest.error_code}
    return None


async def _match(db: AsyncSession, job: OcrJob) -> dict | None:
    """The current template's score from the automatic match (FR-OCR-024)."""
    if not job.current_mapping_id:
        return None
    mapping = await db.get(TemplateMapping, job.current_mapping_id)
    if mapping is None or mapping.template_version_id is None:
        return None
    score = (await mapping_service.auto_scores(db, job.id)).get(mapping.template_version_id)
    return {
        "template_version_id": mapping.template_version_id,
        "score": score,
        "low_score": score is not None and score < mapping_service.MATCH_THRESHOLD,
    }


async def payload(db: AsyncSession, job: OcrJob, version: ResultVersion) -> dict:
    tpl = await _template(db, version)
    groups = tpl.groups if tpl else None
    return {
        "version": version.version,
        "structured": version.structured,
        "template": (
            {"template_version_id": tpl.id, "name": tpl.name, "groups": groups} if tpl else None
        ),
        "missing_required": normalize.required_missing(groups, version.structured)
        if groups
        else [],
        "mapping": await _mapping_state(db, job),
        "match": await _match(db, job),
        # Values that do not fit the field type, on the current content (FR-OCR-016).
        "warnings": normalize.type_warnings(groups, version.structured) if groups else [],
        # Amounts that do not add up, on the current content; never corrected (FR-OCR-013).
        "amount_issues": amounts.check(groups, version.structured) if groups else [],
        "confirmed": job.review_status == "CONFIRMED",
    }


async def _current(db: AsyncSession, job: OcrJob) -> ResultVersion:
    if job.status not in states.TERMINAL:
        raise _conflict("job_not_terminal")
    version = await mapping_service.current_version(db, job.id)
    if version is None:
        raise AppError(404, "not_found", "error.not_found")
    return version


async def read(db: AsyncSession, job: OcrJob) -> dict:
    return await payload(db, job, await _current(db, job))


def _may_edit(ctx: TenantContext, job: OcrJob) -> None:
    job_service.require_edit(ctx, job)


async def _gate(
    db: AsyncSession, ctx: TenantContext, principal: Principal, groups, content
) -> None:
    """Registered, then a valid plan, then the required fields (FR-VERIFY-009, 016)."""
    if principal.kind != "user":
        raise AppError(401, "unauthenticated", "auth.required")
    user = await db.get(User, principal.user_id)
    if user is None or user.registered_at is None:
        raise AppError(403, "registration_required", "auth.registration_required")
    if not await metering_service.may_confirm(db, ctx.tenant_id, utcnow()):
        raise AppError(402, "plan_expired", "billing.plan_expired")
    if groups:
        missing = normalize.required_missing(groups, content)
        if missing:
            raise AppError(
                422,
                "required_missing",
                "error.required_missing",
                [f"structured.{path}" for path in missing],
            )


def _check_structure(structured) -> dict:
    import json

    if not isinstance(structured, dict):
        raise AppError(400, "validation_error", "error.validation", ["structured"])
    if len(json.dumps(structured, ensure_ascii=False)) > MAX_STRUCTURE_BYTES:
        raise AppError(400, "validation_error", "error.validation", ["structured"])
    return structured


async def save(
    db: AsyncSession,
    ctx: TenantContext,
    principal: Principal,
    job: OcrJob,
    *,
    expected_version,
    structured,
    confirm,
) -> tuple[dict, list[str]]:
    """(result payload, audit actions). `job` is locked by the caller."""
    _may_edit(ctx, job)
    if job.status not in states.SUCCESS:
        raise _conflict("job_not_terminal")
    if job.review_status == "CONFIRMED":
        raise _conflict("result_confirmed")
    if not isinstance(expected_version, int) or isinstance(expected_version, bool):
        raise AppError(400, "validation_error", "error.validation", ["expected_version"])
    if not isinstance(confirm, bool):
        raise AppError(400, "validation_error", "error.validation", ["confirm"])
    current = await _current(db, job)
    if expected_version != current.version:
        raise _conflict("version_conflict")
    tpl = await _template(db, current)
    groups = tpl.groups if tpl else None
    content = current.structured
    changed = False
    if structured is not None:
        content = _check_structure(structured)
        if groups:
            content = normalize.fill_structure(groups, content)
        changed = content != current.structured
    if confirm:
        await _gate(db, ctx, principal, groups, content)
    actions: list[str] = []
    target = current
    if changed:
        target = ResultVersion(
            id=str(uuid.uuid4()),
            job_id=job.id,
            version=await mapping_service.next_version_no(db, job.id),
            is_current=True,
            created_by_user_id=ctx.user_id,
            structured=content,
            mapping_id=current.mapping_id,
        )
        current.is_current = False
        await db.flush()  # the old current one first: one current version per job
        db.add(target)
        await db.flush()
        await change_log.record_save(
            db, job.id, target.id, current.structured, content, ctx.user_id
        )
        job.review_status = "EDITED"
        actions.append("result.save")
    if confirm:
        now = utcnow()
        job.review_status = "CONFIRMED"
        job.confirmed_at, job.confirmed_by_user_id = now, ctx.user_id
        job.confirmed_version_id = target.id
        job.pending_mapping_id = None  # a late conversion must not replace what was confirmed
        actions.append("result.confirm")
    job.updated_at = utcnow()
    await db.flush()
    return await payload(db, job, target), actions
