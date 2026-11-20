"""Template samples (FR-TEMPLATE-008, FR-TEMPLATE-014; D8; contract §4).

A sample is the primary way to start a template: an uploaded PDF/image (OCR, then the LLM
proposes a candidate) or an existing OCR result the caller can see (LLM only). It is never
a business document: no OcrJob, OcrRawResult, ResultVersion or template is created here.

Rules:
- every route needs template management (`template_access.require_manage`); creating and
  re-running OCR also need upload_ocr and scan quota, reserved by pages exactly like an
  OCR job (`metering_service.reserve`); the reservation is kept once OCR succeeded and
  released once otherwise (failure, cancel, delete or expiry before OCR finished);
- only the creating user in the same tenant sees a sample; anything else is 404, and so is
  a sample that was deleted, purged or is past its seven days;
- objects live under `samples/<tenant>/<id>/` and are deleted on delete/expiry; audit rows
  carry IDs only, never content.
"""

import asyncio
import json
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.integrations.storage import ObjectMissing, ObjectStore
from app.models import File, OcrRawResult, QuotaReservation, TemplateSample
from app.models.template_sample import SAMPLE_RETENTION_DAYS
from app.ocr import files as inspect
from app.ocr import states
from app.permissions import Permission
from app.services import audit_service, job_service, metering_service, template_access
from app.services.audit_service import AuditEvent
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext, not_found, require

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 50
ENVELOPE = 64 * 1024  # multipart headers and boundaries on top of the file itself
RETENTION = timedelta(days=SAMPLE_RETENTION_DAYS)
TERMINAL = ("READY", "FAILED", "CANCELED")
RUNNING = ("QUEUED", "OCR_RUNNING", "GENERATING")
PREFIX = "samples"


def object_name(tenant_id: int | None, sample_id: str, part: str) -> str:
    """`original.<kind>`, `ocr` (raw OCR payload) or `candidate` (structure + values); an
    admin's sample (no tenant) lives under `samples/admin/<id>/`."""
    leaf = {"ocr": "ocr.json", "candidate": "candidate.json"}.get(part, part)
    owner = "admin" if tenant_id is None else str(tenant_id)
    return f"{PREFIX}/{owner}/{sample_id}/{leaf}"


def all_object_names(sample: TemplateSample) -> set[str]:
    """Every name a sample's objects can have, so a purge never depends on a stored key."""
    names = {k for k in (sample.original_key, sample.ocr_key, sample.candidate_key) if k}
    for part in ("ocr", "candidate", *(f"original.{k}" for k in inspect.MIME)):
        names.add(object_name(sample.tenant_id, sample.id, part))
    return names


def invalid(code: str) -> AppError:
    return AppError(422, code, f"error.{code}", ["file"])


# ---------------------------------------------------------------------------------------
# request body


def extract_file(content_type: str | None, body: bytes) -> bytes:
    """The `file` part of a multipart/form-data body, or the raw body for any other type
    (the same raw upload `PUT /uploads/{id}/content` takes)."""
    ctype = (content_type or "").strip()
    if not ctype.lower().startswith("multipart/form-data"):
        return body
    boundary = None
    for param in ctype.split(";")[1:]:
        name, _, value = param.strip().partition("=")
        if name.strip().lower() == "boundary":
            boundary = value.strip().strip('"')
    if not boundary:
        raise AppError(422, "validation_error", "error.validation", ["file"])
    marker = b"--" + boundary.encode("latin-1")
    for part in body.split(marker)[1:]:
        if part.startswith(b"--"):
            break
        head, sep, content = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        disposition = ""
        for line in head.decode("latin-1").split("\r\n"):
            key, _, value = line.partition(":")
            if key.strip().lower() == "content-disposition":
                disposition = value
        params = {
            k.strip().lower(): v.strip().strip('"')
            for k, _, v in (p.partition("=") for p in disposition.split(";")[1:])
        }
        if params.get("name") == "file":
            return content[:-2] if content.endswith(b"\r\n") else content
    raise AppError(422, "validation_error", "error.validation", ["file"])


# ---------------------------------------------------------------------------------------
# audit and access


def _actor(principal: Principal) -> tuple[str, str | None]:
    if principal.kind == "guest":
        return "guest", str(principal.session_id)
    return "user", str(principal.user_id)


async def audit(
    db: AsyncSession,
    principal: Principal,
    action: str,
    target_id: str | None,
    *,
    ok: bool = True,
    target_type: str = "template_sample",
) -> None:
    kind, actor = _actor(principal)
    await audit_service.record(
        db,
        AuditEvent(kind, actor, action, target_type, target_id, "success" if ok else "failure"),  # type: ignore[arg-type]
    )


async def audit_system(db: AsyncSession, action: str, sample_id: str) -> None:
    await audit_service.record(
        db, AuditEvent("system", None, action, "template_sample", sample_id, "success")
    )


def require_create(ctx: TenantContext) -> None:
    """Template management AND upload/recognition (AC-FR-TEMPLATE-014-01)."""
    template_access.require_manage(ctx)
    require(ctx, Permission.UPLOAD_OCR)


def _visible(sample: TemplateSample | None, ctx: TenantContext) -> bool:
    return (
        sample is not None
        and sample.tenant_id == ctx.tenant_id
        and ctx.user_id is not None
        and sample.created_by_user_id == ctx.user_id
        and sample.deleted_at is None
        and sample.purged_at is None
        and sample.expires_at > utcnow()
    )


async def own_sample(
    db: AsyncSession, ctx: TenantContext, sample_id: str, *, for_update: bool = False
) -> TemplateSample:
    template_access.require_manage(ctx)
    if not isinstance(sample_id, str) or len(sample_id) > 64:
        raise not_found()
    q = select(TemplateSample).where(
        TemplateSample.id == sample_id, TemplateSample.tenant_id == ctx.tenant_id
    )
    if for_update:
        q = q.with_for_update().execution_options(populate_existing=True)
    sample = (await db.execute(q)).scalar_one_or_none()
    if not _visible(sample, ctx):
        raise not_found()
    return sample  # type: ignore[return-value]


# ---------------------------------------------------------------------------------------
# metering


async def release_once(db: AsyncSession, sample: TemplateSample) -> None:
    """Give the scans back, at most once, unless OCR already succeeded (then they are
    charged; generating again never changes that)."""
    if sample.reservation_id is None or sample.ocr_done_at is not None:
        return
    row = await db.get(QuotaReservation, sample.reservation_id)
    if row is not None and row.released_at is None:
        await metering_service.release(db, row.tenant_id, row.id)


async def _reserve(db: AsyncSession, sample: TemplateSample) -> None:
    reference = f"template_sample:{sample.id}:{uuid.uuid4().hex[:12]}"
    reservation = await metering_service.reserve(db, sample.tenant_id, sample.pages or 1, reference)
    sample.reservation_id = reservation.id


async def charged(db: AsyncSession, samples: list[TemplateSample]) -> dict[str, int]:
    """Pages charged per sample: the kept reservation of a successful OCR."""
    ids = [s.reservation_id for s in samples if s.reservation_id and s.ocr_done_at]
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(QuotaReservation.id, QuotaReservation.pages).where(
                QuotaReservation.id.in_(ids), QuotaReservation.released_at.is_(None)
            )
        )
    ).all()
    pages = dict(rows)
    return {
        s.id: pages.get(s.reservation_id, 0)  # type: ignore[arg-type]
        for s in samples
        if s.ocr_done_at
    }


# ---------------------------------------------------------------------------------------
# creating


def _check_size(data: bytes) -> None:
    if len(data) > MAX_BYTES:
        raise invalid("sample_file_too_large")
    if not data:
        raise invalid("sample_file_type")


async def inspect_file(data: bytes) -> tuple[str, int]:
    """(kind, pages) from the bytes, never the name; 422 with the exact reason."""
    _check_size(data)
    kind = inspect.sniff(data)
    if kind is None:
        raise invalid("sample_file_type")
    try:
        pages = await asyncio.to_thread(inspect.page_count, kind, data)
    except inspect.FileCorrupt:
        raise invalid("sample_file_corrupt") from None
    if not 1 <= pages <= MAX_PAGES:
        raise invalid("sample_pdf_pages")
    return kind, pages


async def create_upload(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, principal: Principal, data: bytes
) -> TemplateSample:
    require_create(ctx)
    kind, pages = await inspect_file(data)
    now = utcnow()
    sample = TemplateSample(
        id=str(uuid.uuid4()),
        tenant_id=ctx.tenant_id,
        created_by_user_id=ctx.user_id,
        source="UPLOAD",
        status="QUEUED",
        file_kind=kind,
        size_bytes=len(data),
        pages=pages,
        expires_at=now + RETENTION,
        created_at=now,
        updated_at=now,
    )
    await _reserve(db, sample)  # quota first: nothing is stored when it is short
    name = object_name(ctx.tenant_id, sample.id, f"original.{kind}")
    await store.put(name, data, inspect.MIME[kind])
    sample.original_key = name
    try:
        db.add(sample)
        await db.flush()
        await audit(db, principal, "template_sample.create", sample.id)
    except Exception:
        await store.delete(name)
        raise
    return sample


async def create_from_job(
    db: AsyncSession,
    store: ObjectStore,
    ctx: TenantContext,
    principal: Principal,
    job_id: str | None,
) -> TemplateSample:
    """A copy of a visible job's raw OCR payload, then generation only: no scans are
    charged and the job, its results and its raw payload are not changed. Reusing an OCR
    result uploads nothing, so template_manage is enough; the job itself must be visible in
    the user's business scope (AC-FR-SYS-140-02)."""
    template_access.require_manage(ctx)
    if not job_id or not isinstance(job_id, str) or len(job_id) > 64:
        raise not_found()
    job = await job_service.job_access(db, ctx, job_id)
    if job.status not in states.SUCCESS:
        raise AppError(409, "sample_source_not_ready", "error.sample_source_not_ready")
    raw = (
        await db.execute(
            select(OcrRawResult)
            .where(OcrRawResult.job_id == job.id)
            .order_by(OcrRawResult.created_at.desc(), OcrRawResult.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if raw is None:
        raise AppError(409, "sample_source_not_ready", "error.sample_source_not_ready")
    file = await db.get(File, job.file_id)
    kind = next((k for k, m in inspect.MIME.items() if file and m == file.mime_type), None)
    now = utcnow()
    sample = TemplateSample(
        id=str(uuid.uuid4()),
        tenant_id=ctx.tenant_id,
        created_by_user_id=ctx.user_id,
        source="OCR_RESULT",
        source_job_id=job.id,
        status="GENERATING",
        file_kind=kind,
        pages=job.page_count,
        engine=raw.engine,
        ocr_done_at=now,
        expires_at=now + RETENTION,
        created_at=now,
        updated_at=now,
    )
    name = object_name(ctx.tenant_id, sample.id, "ocr")
    body = json.dumps({"engine": raw.engine, "raw": raw.payload}, default=str).encode()
    await store.put(name, body, "application/json")
    sample.ocr_key = name
    try:
        db.add(sample)
        await db.flush()
        await audit(db, principal, "template_sample.create_from_job", sample.id)
    except Exception:
        await store.delete(name)
        raise
    return sample


# ---------------------------------------------------------------------------------------
# reading


async def list_samples(db: AsyncSession, ctx: TenantContext) -> list[TemplateSample]:
    template_access.require_manage(ctx)
    if ctx.user_id is None:
        return []
    return list(
        (
            await db.execute(
                select(TemplateSample)
                .where(
                    TemplateSample.tenant_id == ctx.tenant_id,
                    TemplateSample.created_by_user_id == ctx.user_id,
                    TemplateSample.deleted_at.is_(None),
                    TemplateSample.purged_at.is_(None),
                    TemplateSample.expires_at > utcnow(),
                )
                .order_by(TemplateSample.created_at.desc(), TemplateSample.id.desc())
            )
        ).scalars()
    )


async def candidate(store: ObjectStore, sample: TemplateSample) -> dict | None:
    if sample.status != "READY" or not sample.candidate_key:
        return None
    try:
        return json.loads(await store.get(sample.candidate_key))
    except (ObjectMissing, ValueError):
        return None


async def outputs(
    db: AsyncSession, store: ObjectStore | None, rows: list[TemplateSample], *, with_candidate: bool
) -> list[dict]:
    """The rows as returned; the store is read only for a candidate (a list needs none)."""
    pages = await charged(db, rows)
    out = []
    for s in rows:
        item = {
            "id": s.id,
            "source": s.source,
            "source_job_id": s.source_job_id,
            "status": s.status,
            "failed_stage": s.failed_stage,
            "error_code": s.error_code,
            "file_kind": s.file_kind,
            "pages": s.pages,
            "created_at": s.created_at,
            "expires_at": s.expires_at,
            "ready_at": s.ready_at,
            "charged_pages": pages.get(s.id, 0),
            "candidate": await candidate(store, s) if with_candidate and store else None,
        }
        out.append(item)
    return out


async def _job_file(db: AsyncSession, ctx: TenantContext, sample: TemplateSample) -> File:
    """The original of an OCR_RESULT sample is the job's own file, still only while the
    caller can see that job (it is never copied)."""
    job = await job_service.job_access(db, ctx, sample.source_job_id or "")
    file = await db.get(File, job.file_id)
    if file is None or file.status != "READY":
        raise not_found()
    return file


async def _uploaded(store: ObjectStore, sample: TemplateSample) -> tuple[bytes, str]:
    try:
        data = await store.get(sample.original_key or "")
    except ObjectMissing:
        raise not_found() from None
    return data, inspect.MIME.get(sample.file_kind or "", "application/octet-stream")


async def _uploaded_page(
    store: ObjectStore, sample: TemplateSample, page: int
) -> tuple[bytes, str]:
    if page < 1 or page > (sample.pages or 1):
        raise not_found()
    data, mime = await _uploaded(store, sample)
    if sample.file_kind != "pdf":
        return data, mime
    try:
        png = await asyncio.to_thread(inspect.render_page_png, data, page)
    except (inspect.PageOutOfRange, inspect.FileCorrupt):
        raise not_found() from None
    return png, "image/png"


async def original(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, sample_id: str
) -> tuple[bytes, str]:
    sample = await own_sample(db, ctx, sample_id)
    if sample.source == "OCR_RESULT":
        from app.services import upload_service

        file = await _job_file(db, ctx, sample)
        return (
            await upload_service.read_original(store, file),
            file.mime_type or "application/octet-stream",
        )
    return await _uploaded(store, sample)


async def page_image(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, sample_id: str, page: int
) -> tuple[bytes, str]:
    """A page as an image; rendered on request and never cached, so no derived copy of a
    sample exists to clean up."""
    sample = await own_sample(db, ctx, sample_id)
    if sample.source == "OCR_RESULT":
        from app.services import upload_service

        return await upload_service.page_preview(store, await _job_file(db, ctx, sample), page)
    return await _uploaded_page(store, sample, page)


# ---------------------------------------------------------------------------------------
# changing


def _retry_kind(sample: TemplateSample) -> bool:
    """True = generate again with the stored OCR; False = OCR again; else 409."""
    ocr_done = sample.ocr_key is not None and sample.ocr_done_at is not None
    if sample.status == "FAILED" and sample.failed_stage == "GENERATE" and ocr_done:
        return True
    if sample.status == "CANCELED" and ocr_done:
        return True
    if sample.status in ("FAILED", "CANCELED") and sample.source == "UPLOAD" and not ocr_done:
        if not sample.original_key:
            raise AppError(409, "sample_not_retryable", "error.sample_not_retryable")
        return False
    raise AppError(409, "sample_not_retryable", "error.sample_not_retryable")


def _requeue(sample: TemplateSample, regenerate: bool) -> None:
    sample.status = "GENERATING" if regenerate else "QUEUED"
    sample.failed_stage = sample.error_code = None
    sample.claimed_at = sample.cancel_requested_at = None
    sample.updated_at = utcnow()


async def retry(
    db: AsyncSession, ctx: TenantContext, principal: Principal, sample_id: str
) -> TemplateSample:
    """FAILED at GENERATE (or cancelled after OCR): generate again with the stored OCR, no
    new charge. FAILED at OCR (or cancelled before it): OCR again with a new reservation."""
    sample = await own_sample(db, ctx, sample_id, for_update=True)
    regenerate = _retry_kind(sample)
    if not regenerate:
        require(ctx, Permission.UPLOAD_OCR)
        await _reserve(db, sample)  # a new OCR task: a new reservation (quota checked)
    _requeue(sample, regenerate)
    await db.flush()
    await audit(db, principal, "template_sample.retry", sample.id)
    return sample


async def _cancel(db: AsyncSession, sample: TemplateSample) -> bool:
    """False when it was already CANCELED (nothing to do)."""
    if sample.status == "CANCELED":
        return False
    if sample.status in ("READY", "FAILED"):
        raise AppError(409, "sample_not_cancelable", "error.sample_not_cancelable")
    await release_once(db, sample)
    now = utcnow()
    sample.status, sample.cancel_requested_at = "CANCELED", now
    sample.claimed_at, sample.updated_at = None, now
    await db.flush()
    return True


async def cancel(
    db: AsyncSession, ctx: TenantContext, principal: Principal, sample_id: str
) -> TemplateSample:
    """Cancel wins: the sample is CANCELED at once and a worker that returns later finds
    it ended; the reservation of an unfinished OCR is released once."""
    sample = await own_sample(db, ctx, sample_id, for_update=True)
    if await _cancel(db, sample):
        await audit(db, principal, "template_sample.cancel", sample.id)
    return sample


async def purge(db: AsyncSession, store: ObjectStore, sample: TemplateSample, now) -> None:
    """Delete every object now and forget the keys; an unfinished sample ends CANCELED
    (with its scans back when OCR had not finished). The caller holds the row lock."""
    if sample.status in RUNNING:
        await release_once(db, sample)
        sample.status, sample.cancel_requested_at, sample.claimed_at = "CANCELED", now, None
    for name in sorted(all_object_names(sample)):
        await store.delete(name)
    sample.original_key = sample.ocr_key = sample.candidate_key = None
    sample.purged_at, sample.updated_at = now, now
    await db.flush()


async def delete(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, principal: Principal, sample_id: str
) -> None:
    sample = await own_sample(db, ctx, sample_id, for_update=True)
    now = utcnow()
    sample.deleted_at = now
    await purge(db, store, sample, now)
    await audit(db, principal, "template_sample.delete", sample.id)


# ---------------------------------------------------------------------------------------
# platform admin samples (FR-SYS-142): an upload only, no tenant, nothing reserved or
# charged; visible to the creating admin account alone, with the same limits, seven days,
# purge and ID-only audit as a tenant sample.


async def audit_admin(
    db: AsyncSession, admin_id: int, action: str, target_id: str | None, *, ok: bool = True
) -> None:
    await audit_service.record(
        db,
        AuditEvent(
            "admin",
            str(admin_id),
            action,
            "template_sample",
            target_id,
            "success" if ok else "failure",
        ),
    )


def _admin_visible(sample: TemplateSample | None, admin_id: int) -> bool:
    return (
        sample is not None
        and sample.tenant_id is None
        and sample.created_by_admin_id == admin_id
        and sample.deleted_at is None
        and sample.purged_at is None
        and sample.expires_at > utcnow()
    )


async def admin_sample(
    db: AsyncSession, admin_id: int, sample_id: str, *, for_update: bool = False
) -> TemplateSample:
    if not isinstance(sample_id, str) or len(sample_id) > 64:
        raise not_found()
    q = select(TemplateSample).where(
        TemplateSample.id == sample_id, TemplateSample.tenant_id.is_(None)
    )
    if for_update:
        q = q.with_for_update().execution_options(populate_existing=True)
    sample = (await db.execute(q)).scalar_one_or_none()
    if not _admin_visible(sample, admin_id):
        raise not_found()
    return sample  # type: ignore[return-value]


async def admin_ready_sample(db: AsyncSession, admin_id: int, sample_id: object) -> TemplateSample:
    """The admin's own READY sample a template is saved from; anything else is 404."""
    if not isinstance(sample_id, str) or not sample_id:
        raise AppError(422, "validation_error", "error.validation", ["sample_id"])
    sample = await admin_sample(db, admin_id, sample_id)
    if sample.status != "READY":
        raise not_found()
    return sample


async def admin_create_upload(
    db: AsyncSession, store: ObjectStore, admin_id: int, data: bytes
) -> TemplateSample:
    kind, pages = await inspect_file(data)
    now = utcnow()
    sample = TemplateSample(
        id=str(uuid.uuid4()),
        tenant_id=None,
        created_by_admin_id=admin_id,
        source="UPLOAD",
        status="QUEUED",
        file_kind=kind,
        size_bytes=len(data),
        pages=pages,
        expires_at=now + RETENTION,
        created_at=now,
        updated_at=now,
    )
    name = object_name(None, sample.id, f"original.{kind}")
    await store.put(name, data, inspect.MIME[kind])
    sample.original_key = name
    try:
        db.add(sample)
        await db.flush()
        await audit_admin(db, admin_id, "template_sample.create", sample.id)
    except Exception:
        await store.delete(name)
        raise
    return sample


async def admin_list(db: AsyncSession, admin_id: int) -> list[TemplateSample]:
    return list(
        (
            await db.execute(
                select(TemplateSample)
                .where(
                    TemplateSample.tenant_id.is_(None),
                    TemplateSample.created_by_admin_id == admin_id,
                    TemplateSample.deleted_at.is_(None),
                    TemplateSample.purged_at.is_(None),
                    TemplateSample.expires_at > utcnow(),
                )
                .order_by(TemplateSample.created_at.desc(), TemplateSample.id.desc())
            )
        ).scalars()
    )


async def admin_page(
    db: AsyncSession, store: ObjectStore, admin_id: int, sample_id: str, page: int
) -> tuple[bytes, str]:
    return await _uploaded_page(store, await admin_sample(db, admin_id, sample_id), page)


async def admin_original(
    db: AsyncSession, store: ObjectStore, admin_id: int, sample_id: str
) -> tuple[bytes, str]:
    return await _uploaded(store, await admin_sample(db, admin_id, sample_id))


async def admin_retry(db: AsyncSession, admin_id: int, sample_id: str) -> TemplateSample:
    """As a tenant retry, but a new OCR reserves nothing (no tenant quota is involved)."""
    sample = await admin_sample(db, admin_id, sample_id, for_update=True)
    _requeue(sample, _retry_kind(sample))
    await db.flush()
    await audit_admin(db, admin_id, "template_sample.retry", sample.id)
    return sample


async def admin_cancel(db: AsyncSession, admin_id: int, sample_id: str) -> TemplateSample:
    sample = await admin_sample(db, admin_id, sample_id, for_update=True)
    if await _cancel(db, sample):
        await audit_admin(db, admin_id, "template_sample.cancel", sample.id)
    return sample


async def admin_delete(db: AsyncSession, store: ObjectStore, admin_id: int, sample_id: str) -> None:
    sample = await admin_sample(db, admin_id, sample_id, for_update=True)
    now = utcnow()
    sample.deleted_at = now
    await purge(db, store, sample, now)
    await audit_admin(db, admin_id, "template_sample.delete", sample.id)
