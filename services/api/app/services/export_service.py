"""Exports of confirmed results and their downloads (FR-ENTRY-015). Rules from main's
`routes/exports.py`: generated at once, kept 24 h in private storage, always proxied by the
backend; a 60-second ticket (HMAC over export, user, session and expiry) lets a downloader
without the session cookie (the LINE in-app browser hands downloads to the system browser)
fetch it. Redeeming re-checks the session, the user, the job and the export; any failure
is 404. The ticket key is its own setting (DOWNLOAD_TICKET_SECRET), never a session secret.
"""

import base64
import hashlib
import hmac
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.errors import AppError
from app.integrations.storage import ObjectMissing, ObjectStore
from app.models import (
    CustomerSession,
    DocumentTemplate,
    DocumentTemplateVersion,
    Export,
    File,
    OcrJob,
    ResultVersion,
    TemplateMapping,
)
from app.ocr.xlsx import build_xlsx
from app.permissions import Permission
from app.services import job_service, tenant_access
from app.services.session_service import CUSTOMER_IDLE, Principal
from app.services.tenant_access import TenantContext, not_found, require

EXPORT_TTL = timedelta(hours=24)
TICKET_TTL = timedelta(seconds=60)
LANGUAGES = ("en", "th", "zh")
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def _template(db: AsyncSession, version: ResultVersion):
    if version.mapping_id is None:
        return None, None
    mapping = await db.get(TemplateMapping, version.mapping_id)
    if mapping is None or mapping.template_version_id is None:
        return None, None
    ver = await db.get(DocumentTemplateVersion, mapping.template_version_id)
    tpl = await db.get(DocumentTemplate, ver.template_id) if ver else None
    return ver, tpl


async def create(
    db: AsyncSession,
    store: ObjectStore,
    ctx: TenantContext,
    principal: Principal,
    job_id: str,
    language: str | None,
) -> tuple[Export, bool]:
    """(export, created). Only a confirmed job, and its confirmed version (A5)."""
    require(ctx, Permission.EXPORT)
    lang = language or "en"
    if lang not in LANGUAGES:
        raise AppError(400, "validation_error", "error.validation", ["language"])
    job = await job_service.job_access(db, ctx, job_id, for_update=True)
    if job.review_status != "CONFIRMED" or job.confirmed_version_id is None:
        raise AppError(409, "result_not_confirmed", "error.result_not_confirmed")
    now = utcnow()
    live = (
        await db.execute(
            select(Export).where(
                Export.job_id == job.id,
                Export.result_version_id == job.confirmed_version_id,
                Export.status == "READY",
                Export.expires_at > now,
                Export.storage_path.like(f"%.{lang}.xlsx"),
            )
        )
    ).scalar_one_or_none()
    if live is not None:
        return live, False
    version = await db.get(ResultVersion, job.confirmed_version_id)
    ver, tpl = await _template(db, version)
    data = build_xlsx(
        version.structured,
        (ver.name, ver.groups) if ver else None,
        lang,
        (tpl.id, ver.version) if ver and tpl else None,
    )
    export_id = str(uuid.uuid4())
    name = f"exports/{export_id}.{lang}.xlsx"
    await store.put(name, data, XLSX_MIME)
    export = Export(
        id=export_id,
        job_id=job.id,
        result_version_id=version.id,
        format="XLSX",
        status="READY",
        storage_path=name,
        expires_at=now + EXPORT_TTL,
        created_by_user_id=ctx.user_id,
    )
    db.add(export)
    await db.flush()
    await job_service.audit(db, principal, "export.create", job.id)
    return export, True


async def _visible_export(db: AsyncSession, ctx: TenantContext, export_id: str) -> Export:
    """A live export of a job the caller can see; downloading needs the export permission
    (FR-SYS-107, final review 8)."""
    require(ctx, Permission.EXPORT)
    export = await db.get(Export, export_id)
    if export is None:
        raise not_found()
    await job_service.job_access(db, ctx, export.job_id)  # 404 when the job is not visible
    if export.status != "READY" or export.expires_at is None or export.expires_at <= utcnow():
        raise not_found()
    return export


async def status(db: AsyncSession, ctx: TenantContext, export_id: str) -> Export:
    """A live export the caller may download (main's final page polls it)."""
    return await _visible_export(db, ctx, export_id)


async def content(
    db: AsyncSession, store: ObjectStore, ctx: TenantContext, export_id: str
) -> tuple[bytes, str]:
    export = await _visible_export(db, ctx, export_id)
    return await _bytes(db, store, export)


async def _bytes(db: AsyncSession, store: ObjectStore, export: Export) -> tuple[bytes, str]:
    try:
        data = await store.get(export.storage_path or "")
    except ObjectMissing:
        raise not_found() from None
    job = await db.get(OcrJob, export.job_id)
    file = await db.get(File, job.file_id) if job else None
    stem = (file.original_name.rsplit(".", 1)[0] if file else "result") or "result"
    return data, f"{stem}.xlsx"


def _key(settings: Settings) -> bytes:
    secret = settings.download_ticket_secret
    if secret is None or not secret.get_secret_value():
        raise AppError(503, "download_ticket_unavailable", "error.download_ticket_unavailable")
    return secret.get_secret_value().encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


async def ticket(
    db: AsyncSession, settings: Settings, ctx: TenantContext, principal: Principal, export_id: str
) -> str:
    key = _key(settings)
    export = await _visible_export(db, ctx, export_id)
    if export.created_by_user_id != ctx.user_id:  # a ticket only for one's own export
        raise not_found()
    expires = int((utcnow() + TICKET_TTL).timestamp())
    payload = f"{export.id}.{principal.user_id or 0}.{principal.session_id}.{expires}"
    sig = hmac.new(key, payload.encode("ascii"), hashlib.sha256).digest()
    return f"/api/v1/export-downloads/{_b64(payload.encode('ascii'))}.{_b64(sig)}"


async def redeem(
    db: AsyncSession, store: ObjectStore, settings: Settings, token: str
) -> tuple[bytes, str]:
    key = _key(settings)
    try:
        body, sig = token.split(".", 1)
        payload = _unb64(body).decode("ascii")
        good = hmac.compare_digest(
            _unb64(sig), hmac.new(key, payload.encode("ascii"), hashlib.sha256).digest()
        )
        export_id, user_id, session_id, expires = payload.rsplit(".", 3)
        user, sid, until = int(user_id), int(session_id), int(expires)
    except (ValueError, UnicodeDecodeError):
        raise not_found() from None
    now = utcnow()
    if not good or until < int(now.timestamp()):
        raise not_found()
    session = await db.get(CustomerSession, sid)
    if (
        session is None
        or session.revoked_at is not None
        or now - session.last_used_at > CUSTOMER_IDLE
        or (session.user_id or 0) != user
    ):
        raise not_found()
    principal = Principal(session.kind, session.id, session.tenant_id, session.user_id)  # type: ignore[arg-type]
    export = await db.get(Export, export_id)
    if export is None:
        raise not_found()
    job = await db.get(OcrJob, export.job_id)
    if job is None:
        raise not_found()
    ctx = await tenant_access.resolve_tenant(db, principal, job.tenant_id)
    await _visible_export(db, ctx, export.id)
    return await _bytes(db, store, export)
