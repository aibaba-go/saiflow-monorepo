"""Uploads in three steps, pending records and originals (documents spec).

Rules from main's `routes/files.py` (ADR-009 class B): the format comes from the bytes,
limits are checked before the file becomes READY, and a rejected upload keeps no object.
Every lookup is inside the current tenant; anything the caller may not see is 404.
"""

import asyncio
import hashlib
import re
import uuid
from datetime import timedelta
from urllib.parse import unquote, urlsplit

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.integrations.storage import ObjectMissing, ObjectStore
from app.models import File, OcrJob
from app.ocr import files as inspect
from app.permissions import Permission
from app.services import audit_service
from app.services.audit_service import AuditEvent
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext, not_found, require, submitter_scope

MAX_BYTES = 20 * 1024 * 1024  # A1
MAX_PAGES = 50
SESSION_TTL = timedelta(hours=24)
NAME_MAX = 255


def rejected(code: str) -> AppError:
    return AppError(400, code, f"error.{code}", ["file"])


def _actor(principal: Principal) -> tuple[str, str | None]:
    if principal.kind == "guest":
        return "guest", str(principal.session_id)
    return "user", str(principal.user_id)


async def _audit(db: AsyncSession, principal: Principal, action: str, file_id: str) -> None:
    kind, actor_id = _actor(principal)
    await audit_service.record(
        db,
        AuditEvent(kind, actor_id, action, "file", file_id, "success"),  # type: ignore[arg-type]
    )


def _mine(ctx: TenantContext):
    """Files the caller created in this tenant (guests have no user row: their tenant is theirs)."""
    if ctx.user_id is None:
        return File.created_by_user_id.is_(None)
    return File.created_by_user_id == ctx.user_id


async def _own_upload(db: AsyncSession, ctx: TenantContext, upload_id: str) -> File:
    row = (
        await db.execute(
            select(File)
            .where(File.id == upload_id, File.tenant_id == ctx.tenant_id, _mine(ctx))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.status == "DELETED":
        raise not_found()
    return row


async def create_upload(
    db: AsyncSession, ctx: TenantContext, principal: Principal, file_name: str | None
) -> File:
    require(ctx, Permission.UPLOAD_OCR)
    name = (file_name or "").strip()
    if not name or len(name) > NAME_MAX:
        raise AppError(400, "validation_error", "error.validation", ["file_name"])
    row = File(
        id=str(uuid.uuid4()),
        tenant_id=ctx.tenant_id,
        created_by_user_id=ctx.user_id,
        original_name=name,
        status="UPLOADING",
        expires_at=utcnow() + SESSION_TTL,
    )
    db.add(row)
    await db.flush()
    return row


async def _reject(db: AsyncSession, store: ObjectStore, row: File, code: str) -> AppError:
    if row.storage_path:
        await store.delete(row.storage_path)
    row.status, row.reject_reason, row.storage_path = "REJECTED", code, None
    row.updated_at = utcnow()
    await db.flush()
    return rejected(code)


def _expired(row: File) -> bool:
    return row.expires_at is not None and row.expires_at <= utcnow()


async def put_content(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, upload_id: str, data: bytes
) -> File:
    require(ctx, Permission.UPLOAD_OCR)
    row = await _own_upload(db, ctx, upload_id)
    if row.status != "UPLOADING" or _expired(row):
        raise AppError(409, "upload_not_ready", "error.upload_not_ready")
    if len(data) > MAX_BYTES:
        raise await _reject(db, store, row, "file_too_large")
    kind = inspect.sniff(data)
    if kind is None:
        raise await _reject(db, store, row, "unsupported_format")
    name = f"originals/{row.tenant_id}/{row.id}.{kind}"
    await store.put(name, data, inspect.MIME[kind])
    row.storage_path, row.mime_type, row.size_bytes = name, inspect.MIME[kind], len(data)
    row.status, row.updated_at = "UPLOADED", utcnow()
    await db.flush()
    return row


async def complete(
    db: AsyncSession,
    store: ObjectStore,
    ctx: TenantContext,
    principal: Principal,
    upload_id: str,
) -> File:
    require(ctx, Permission.UPLOAD_OCR)
    row = await _own_upload(db, ctx, upload_id)
    if row.status in ("READY", "REJECTED"):
        return row  # repeating a step answers the current state (FR-UPLOAD-010)
    if row.status != "UPLOADED" or _expired(row):
        if _expired(row):
            await _reject(db, store, row, "expired")
        raise AppError(409, "upload_not_ready", "error.upload_not_ready")
    try:
        data = await store.get(row.storage_path or "")
    except ObjectMissing:
        raise await _reject(db, store, row, "file_corrupt") from None
    kind = inspect.sniff(data)
    if kind is None:
        raise await _reject(db, store, row, "unsupported_format")
    try:  # PyMuPDF work runs in a thread so a big PDF does not stall other requests
        pages = await asyncio.to_thread(inspect.page_count, kind, data)
    except inspect.FileCorrupt:
        raise await _reject(db, store, row, "file_corrupt") from None
    if pages > MAX_PAGES:
        raise await _reject(db, store, row, "too_many_pages")
    digest = await asyncio.to_thread(lambda: hashlib.sha256(data).hexdigest())
    row.page_count, row.sha256 = pages, digest
    row.status, row.expires_at, row.updated_at = "READY", None, utcnow()
    await db.flush()
    await _audit(db, principal, "file.upload", row.id)
    return row


_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def import_name(url: str, kind: str) -> str:
    """The file name of an import: the URL's last path segment, unsafe characters made
    `_`, the extension that matches the content; `import.<kind>` when nothing is left."""
    segment = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    name = _UNSAFE_NAME.sub("_", segment).strip("._")[:200]
    stem = name.rsplit(".", 1)[0] if "." in name else name
    return f"{stem or 'import'}.{kind}"[:NAME_MAX]


async def import_bytes(
    db: AsyncSession,
    store: ObjectStore,
    ctx: TenantContext,
    principal: Principal,
    url: str,
    data: bytes,
) -> File:
    """An imported file goes through the same three steps as an upload, so the same rules
    apply (FR-UPLOAD-003, FR-UPLOAD-014); it lands in Pending, never started."""
    kind = inspect.sniff(data)
    if kind is None:
        raise rejected("unsupported_format")
    row = await create_upload(db, ctx, principal, import_name(url, kind))
    await put_content(db, store, ctx, row.id, data)
    return await complete(db, store, ctx, principal, row.id)


async def purge_expired(db: AsyncSession, store: ObjectStore) -> int:
    """Unfinished uploads past their 24 h session lose their content (FR-UPLOAD-005)."""
    rows = (
        await db.execute(
            select(File)
            .where(File.status.in_(("UPLOADING", "UPLOADED")), File.expires_at <= utcnow())
            .with_for_update(skip_locked=True)
        )
    ).scalars()
    count = 0
    for row in rows:
        await _reject(db, store, row, "expired")
        count += 1
    return count


def _has_job():
    return exists().where(OcrJob.file_id == File.id)


async def pending(db: AsyncSession, ctx: TenantContext) -> list[File]:
    """READY originals the caller uploaded in this tenant without a job (FR-UPLOAD-013)."""
    return list(
        (
            await db.execute(
                select(File)
                .where(
                    File.tenant_id == ctx.tenant_id,
                    _mine(ctx),
                    File.status == "READY",
                    File.purpose == "OCR_TASK",
                    ~_has_job(),
                )
                .order_by(File.created_at.desc(), File.id.desc())
            )
        ).scalars()
    )


async def delete_pending(
    db: AsyncSession,
    store: ObjectStore,
    ctx: TenantContext,
    principal: Principal,
    file_id: str,
) -> None:
    row = await _own_upload(db, ctx, file_id)  # row lock: serialised with job creation
    if (await db.execute(select(exists().where(OcrJob.file_id == row.id)))).scalar():
        raise AppError(409, "file_in_use", "error.file_in_use")
    if row.storage_path:
        await store.delete(row.storage_path)
    row.status, row.storage_path, row.updated_at = "DELETED", None, utcnow()
    await db.flush()
    await _audit(db, principal, "file.delete", row.id)


async def file_access(db: AsyncSession, ctx: TenantContext, file_id: str) -> File:
    """A file the caller may read: one they uploaded, or one whose job they can see
    (FR-UPLOAD-011, FR-OCR-017 visibility)."""
    row = await db.get(File, file_id)
    if row is None or row.tenant_id != ctx.tenant_id or row.status != "READY":
        raise not_found()
    mine = row.created_by_user_id == ctx.user_id
    if not mine:
        from sqlalchemy import or_

        from app.services import review_service

        q = select(OcrJob.id).where(OcrJob.file_id == row.id, OcrJob.tenant_id == ctx.tenant_id)
        owner = submitter_scope(ctx)
        if owner is not None:
            # reviewers read the original of a job they review (FR-VERIFY-019)
            q = q.where(or_(OcrJob.created_by_user_id == owner, review_service.reviewable(ctx)))
        if (await db.execute(q.limit(1))).scalar() is None:
            raise not_found()
    return row


async def read_original(store: ObjectStore, row: File) -> bytes:
    try:
        return await store.get(row.storage_path or "")
    except ObjectMissing:
        raise not_found() from None


async def page_preview(store: ObjectStore, row: File, page: int) -> tuple[bytes, str]:
    """Images are their own preview; a PDF page is rendered once and cached (FR-UPLOAD-011)."""
    if page < 1 or page > (row.page_count or 1):
        raise not_found()
    if row.mime_type != "application/pdf":
        return await read_original(store, row), row.mime_type or "application/octet-stream"
    name = f"previews/{row.id}/page_{page}.png"
    try:
        return await store.get(name), "image/png"
    except ObjectMissing:
        pass
    try:
        png = await asyncio.to_thread(
            inspect.render_page_png, await read_original(store, row), page
        )
    except (inspect.PageOutOfRange, inspect.FileCorrupt):
        raise not_found() from None
    await store.put(name, png, "image/png")
    return png, "image/png"
