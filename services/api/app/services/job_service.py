"""OCR jobs (FR-OCR-017): creation with a scan reservation, visibility, stages, cancel,
rerun and deleting results. Rules from main's `routes/ocr.py` (ADR-009 class B).

Locking: job creation locks the file row (shared with deleting a pending record); every
change to a job locks the job row. Reservations are made and released in the caller's
transaction before the audit entry (B-2c locking order).
"""

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing_time import BANGKOK
from app.clock import utcnow
from app.errors import AppError
from app.integrations.storage import ObjectStore
from app.models import (
    DocumentTemplateVersion,
    Export,
    File,
    OcrJob,
    QuotaReservation,
    ResultChange,
    ResultVersion,
    ReviewRecord,
    ReviewRound,
    TemplateMapping,
)
from app.ocr import states
from app.permissions import Permission
from app.services import audit_service, metering_service
from app.services.admin_query_service import like_literal
from app.services.audit_service import AuditEvent
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext, not_found, require, submitter_scope

KEY_MAX = 128
PAGE_SIZE_MAX = 100


def _bad(field: str) -> AppError:
    return AppError(400, "validation_error", "error.validation", [field])


async def audit(db: AsyncSession, principal: Principal, action: str, job_id: str) -> None:
    kind, actor = (
        ("guest", str(principal.session_id))
        if principal.kind == "guest"
        else ("user", str(principal.user_id))
    )
    await audit_service.record(db, AuditEvent(kind, actor, action, "ocr_job", job_id, "success"))  # type: ignore[arg-type]


def stage(job: OcrJob) -> str:
    """The task's stage (FR-VERIFY-017); the SQL twin is `_stage_condition`."""
    if job.status in (states.FAILED, states.CANCELLED):
        return "OCR_FAILED"
    if job.status not in states.SUCCESS:
        return "OCR_PROCESSING"
    if job.review_status == states.CONFIRMED:
        return "CONFIRMED"
    if job.review_status in states.PENDING_REVIEW:
        return "PENDING_REVIEW"
    return "TEMPLATE_MATCHING" if job.pending_mapping_id else "VERIFYING"


def _stage_condition(value: str):
    if value == "OCR_FAILED":
        return OcrJob.status.in_((states.FAILED, states.CANCELLED))
    if value == "OCR_PROCESSING":
        return OcrJob.status.notin_(states.TERMINAL)
    succeeded = OcrJob.status.in_(states.SUCCESS)
    if value == "CONFIRMED":
        return and_(succeeded, OcrJob.review_status == states.CONFIRMED)
    if value == "PENDING_REVIEW":
        return and_(succeeded, OcrJob.review_status.in_(states.PENDING_REVIEW))
    open_ = and_(succeeded, OcrJob.review_status.notin_(states.LOCKED))
    if value == "TEMPLATE_MATCHING":
        return and_(open_, OcrJob.pending_mapping_id.isnot(None))
    return and_(open_, OcrJob.pending_mapping_id.is_(None))


def _visible(ctx: TenantContext):
    """Jobs the caller may see in this tenant (FR-SYS-017 submitter scope)."""
    cond = [OcrJob.tenant_id == ctx.tenant_id]
    owner = submitter_scope(ctx)
    if owner is not None:
        cond.append(OcrJob.created_by_user_id == owner)
    return and_(*cond)


async def job_access(
    db: AsyncSession,
    ctx: TenantContext,
    job_id: str,
    *,
    for_update: bool = False,
    review: bool = False,
) -> OcrJob:
    """A job the caller can see (FR-OCR-017). With review=True, also a job the caller
    reviews at its current level (FR-VERIFY-019): for reading and for review decisions
    only, never for changing the result."""
    from app.services import review_service

    seen = or_(_visible(ctx), review_service.reviewable(ctx)) if review else _visible(ctx)
    q = select(OcrJob).where(OcrJob.id == job_id, seen)
    if for_update:
        q = q.with_for_update()
    job = (await db.execute(q)).scalar_one_or_none()
    if job is None:
        raise not_found()
    return job


async def release_once(db: AsyncSession, job: OcrJob) -> None:
    """Give the scans back for a failed or cancelled job, at most once. The reservation is
    released in its own tenant: a guest's job may since have moved to a personal tenant."""
    if job.reservation_id is None:
        return
    row = await db.get(QuotaReservation, job.reservation_id)
    if row is not None and row.released_at is None:
        await metering_service.release(db, row.tenant_id, row.id)


async def _template_names(db: AsyncSession, jobs: list[OcrJob]) -> dict[str, str]:
    ids = [j.current_mapping_id for j in jobs if j.current_mapping_id]
    if not ids:
        return {}
    rows = await db.execute(
        select(TemplateMapping.id, DocumentTemplateVersion.name)
        .join(
            DocumentTemplateVersion,
            DocumentTemplateVersion.id == TemplateMapping.template_version_id,
        )
        .where(TemplateMapping.id.in_(ids))
    )
    by_mapping = dict(rows.all())
    return {
        j.id: by_mapping[j.current_mapping_id] for j in jobs if j.current_mapping_id in by_mapping
    }


async def _returned(db: AsyncSession, jobs: list[OcrJob]) -> set[str]:
    """Jobs whose latest review round was returned and that wait for a new confirm."""
    open_ids = [j.id for j in jobs if j.review_status not in states.LOCKED]
    if not open_ids:
        return set()
    latest: dict[str, tuple[int, str]] = {}
    for job_id, round_no, status in await db.execute(
        select(ReviewRound.job_id, ReviewRound.round_no, ReviewRound.status).where(
            ReviewRound.job_id.in_(open_ids)
        )
    ):
        if job_id not in latest or round_no > latest[job_id][0]:
            latest[job_id] = (round_no, status)
    return {job_id for job_id, (_, status) in latest.items() if status == "RETURNED"}


async def summaries(db: AsyncSession, jobs: list[OcrJob]) -> list[dict]:
    if not jobs:
        return []
    files = {
        f.id: f
        for f in (
            await db.execute(select(File).where(File.id.in_({j.file_id for j in jobs})))
        ).scalars()
    }
    names = await _template_names(db, jobs)
    returned = await _returned(db, jobs)
    out = []
    for j in jobs:
        f = files.get(j.file_id)
        out.append(
            {
                "id": j.id,
                "file_id": j.file_id,
                "file_name": f.original_name if f else "",
                "page_count": j.page_count or (f.page_count if f else 0) or 0,
                "status": j.status,
                "stage": stage(j),
                "error_code": j.error_code,
                "engine": j.engine,
                "template_name": names.get(j.id),
                "created_at": j.created_at,
                "confirmed_at": j.confirmed_at,
                "review_level": {states.PENDING_L1: 1, states.PENDING_L2: 2}.get(j.review_status),
                "returned": j.id in returned,
            }
        )
    return out


async def _replay(db: AsyncSession, ctx: TenantContext, key: str) -> OcrJob | None:
    job = (
        await db.execute(
            select(OcrJob).where(OcrJob.tenant_id == ctx.tenant_id, OcrJob.idempotency_key == key)
        )
    ).scalar_one_or_none()
    if job is None:
        return None
    if (await db.execute(select(OcrJob.id).where(OcrJob.id == job.id, _visible(ctx)))).scalar():
        return job
    raise not_found()


async def _new_job(
    db: AsyncSession, ctx: TenantContext, file: File, *, key: str | None, parent: str | None
) -> OcrJob:
    job_id = str(uuid.uuid4())
    reservation = await metering_service.reserve(db, ctx.tenant_id, file.page_count or 1, job_id)
    job = OcrJob(
        id=job_id,
        tenant_id=ctx.tenant_id,
        created_by_user_id=ctx.user_id,
        file_id=file.id,
        status=states.QUEUED,
        idempotency_key=key,
        parent_job_id=parent,
        page_count=file.page_count or 1,
        reservation_id=reservation.id,
    )
    db.add(job)
    await db.flush()
    return job


async def create_job(
    db: AsyncSession,
    ctx: TenantContext,
    principal: Principal,
    file_id: str | None,
    key: str | None,
) -> tuple[OcrJob, bool]:
    """(job, created). A repeated idempotency key in this tenant returns its job."""
    require(ctx, Permission.UPLOAD_OCR)
    if not file_id or not isinstance(file_id, str) or len(file_id) > 64:
        raise _bad("file_id")
    if key is not None:
        key = key.strip()
        if not key or len(key) > KEY_MAX:
            raise _bad("idempotency_key")
        existing = await _replay(db, ctx, key)
        if existing is not None:
            return existing, False
    mine = (
        File.created_by_user_id == ctx.user_id if ctx.user_id else File.created_by_user_id.is_(None)
    )
    file = (
        await db.execute(
            select(File)
            .where(File.id == file_id, File.tenant_id == ctx.tenant_id, mine)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if file is None or file.status not in ("READY",):
        raise not_found()
    if (await db.execute(select(OcrJob.id).where(OcrJob.file_id == file.id).limit(1))).scalar():
        raise AppError(409, "file_in_use", "error.file_in_use")
    try:
        job = await _new_job(db, ctx, file, key=key, parent=None)
    except IntegrityError:
        # the same key raced in from a retry: answer with the job that won
        await db.rollback()
        if key is not None and (existing := await _replay(db, ctx, key)) is not None:
            return existing, False
        raise
    await audit(db, principal, "job.create", job.id)
    return job, True


async def list_jobs(
    db: AsyncSession,
    ctx: TenantContext,
    *,
    stage_filter: str | None,
    q: str | None,
    page: str | None,
    page_size: str | None,
    template: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
) -> dict:
    number = _int(page, "page", 1, 100_000) or 1
    size = _int(page_size, "page_size", 1, PAGE_SIZE_MAX) or 20
    cond = [_visible(ctx)]
    cond.extend(_template_condition(template))
    cond.extend(_date_conditions(created_from, created_to))
    if stage_filter:
        if stage_filter not in states.STAGES:
            raise _bad("stage")
        cond.append(_stage_condition(stage_filter))
    keyword = (q or "").strip()
    if len(keyword) > 200:
        raise _bad("q")
    if keyword:
        pattern = f"%{like_literal(keyword)}%"
        cond.append(
            OcrJob.file_id.in_(
                select(File.id).where(File.original_name.ilike(pattern, escape="\\"))
            )
        )
    total = (await db.execute(select(func.count()).select_from(OcrJob).where(*cond))).scalar_one()
    rows = list(
        (
            await db.execute(
                select(OcrJob)
                .where(*cond)
                .order_by(OcrJob.created_at.desc(), OcrJob.id.desc())
                .offset((number - 1) * size)
                .limit(size)
            )
        ).scalars()
    )
    return {"items": await summaries(db, rows), "total": total, "page": number, "page_size": size}


def _template_condition(raw: str | None) -> list:
    """A template id (the current mapping's template, any version) or "generic" (no
    current mapping) (FR-VERIFY-017, web-pc-ocr)."""
    if raw is None or raw == "":
        return []
    if raw == "generic":
        return [OcrJob.current_mapping_id.is_(None)]
    if not raw.isascii() or not raw.isdigit() or len(raw) > 18:
        raise _bad("template")
    return [
        OcrJob.current_mapping_id.in_(
            select(TemplateMapping.id).where(TemplateMapping.template_id == int(raw))
        )
    ]


def _thai_day(raw: str | None, field: str) -> date | None:
    if raw is None or raw == "":
        return None
    try:
        if len(raw) != 10:
            raise ValueError(raw)
        return date.fromisoformat(raw)
    except ValueError:
        raise _bad(field) from None


def _date_conditions(created_from: str | None, created_to: str | None) -> list:
    """Thai dates (UTC+7), both ends inclusive."""
    start, end = _thai_day(created_from, "created_from"), _thai_day(created_to, "created_to")
    if start and end and start > end:
        raise _bad("created_from")
    cond = []
    if start:
        cond.append(OcrJob.created_at >= datetime.combine(start, time.min, BANGKOK))
    if end:
        cond.append(
            OcrJob.created_at < datetime.combine(end + timedelta(days=1), time.min, BANGKOK)
        )
    return cond


def _int(raw: str | None, field: str, low: int, high: int) -> int | None:
    if raw is None or raw == "":
        return None
    if not raw.isascii() or not raw.isdigit() or not low <= int(raw) <= high:
        raise _bad(field)
    return int(raw)


def require_edit(ctx: TenantContext, job: OcrJob, own: Permission = Permission.VERIFY_OWN) -> None:
    """Changing a job: `own` for the submitter's own job, verify_others for anyone else's.
    Seeing a colleague's job (data_browse) is not enough (final review 3)."""
    mine = job.created_by_user_id == ctx.user_id
    require(ctx, own if mine else Permission.VERIFY_OTHERS)


async def cancel(db: AsyncSession, ctx: TenantContext, principal: Principal, job_id: str) -> OcrJob:
    job = await job_access(db, ctx, job_id, for_update=True)
    require_edit(ctx, job, Permission.UPLOAD_OCR)
    if job.status in states.TERMINAL:
        raise AppError(409, "job_terminal", "error.job_terminal")
    if job.status == states.CANCEL_REQUESTED:
        return job
    if job.status == states.QUEUED:
        job.status, job.finished_at = states.CANCELLED, utcnow()
        await release_once(db, job)
    else:
        job.status = states.CANCEL_REQUESTED  # the worker finishes its step, then cancels
    job.updated_at = utcnow()
    await db.flush()
    await audit(db, principal, "job.cancel", job.id)
    return job


async def rerun(db: AsyncSession, ctx: TenantContext, principal: Principal, job_id: str) -> OcrJob:
    require(ctx, Permission.UPLOAD_OCR)
    old = await job_access(db, ctx, job_id, for_update=True)
    require_edit(ctx, old, Permission.UPLOAD_OCR)
    if old.status not in states.TERMINAL:
        raise AppError(409, "job_not_terminal", "error.job_not_terminal")
    file = await db.get(File, old.file_id)
    if file is None or file.status != "READY":
        raise AppError(409, "upload_not_ready", "error.upload_not_ready")
    job = await _new_job(db, ctx, file, key=None, parent=old.id)
    await audit(db, principal, "job.rerun", job.id)
    return job


async def delete_results(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, principal: Principal, job_id: str
) -> None:
    """Versions, template mappings and exports go; the raw result stays (T7)."""
    job = await job_access(db, ctx, job_id, for_update=True)
    require_edit(ctx, job)
    if job.status not in states.TERMINAL:
        raise AppError(409, "job_not_terminal", "error.job_not_terminal")
    job.current_mapping_id = job.pending_mapping_id = job.confirmed_version_id = None
    job.confirmed_at = job.confirmed_by_user_id = job.official_at = None
    job.review_status, job.updated_at = "UNREVIEWED", utcnow()
    await db.flush()
    for exp in (await db.execute(select(Export).where(Export.job_id == job.id))).scalars():
        if exp.storage_path:
            await store.delete(exp.storage_path)
    await db.execute(delete(Export).where(Export.job_id == job.id))
    await db.execute(
        update(TemplateMapping)
        .where(TemplateMapping.job_id == job.id)
        .values(base_version_id=None, result_version_id=None)
    )
    # the change log and review history go with the results (FR-VERIFY-007, 013)
    await db.execute(delete(ResultChange).where(ResultChange.job_id == job.id))
    await db.execute(delete(ReviewRecord).where(ReviewRecord.job_id == job.id))
    await db.execute(delete(ReviewRound).where(ReviewRound.job_id == job.id))
    await db.execute(delete(ResultVersion).where(ResultVersion.job_id == job.id))
    await db.execute(delete(TemplateMapping).where(TemplateMapping.job_id == job.id))
    await audit(db, principal, "job.delete_results", job.id)
