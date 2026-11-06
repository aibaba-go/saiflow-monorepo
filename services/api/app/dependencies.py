from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Path, Request
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import Settings
from app.cookies import refresh_later
from app.errors import AppError
from app.integrations.email import SmtpSender
from app.integrations.line import LineClient
from app.integrations.storage import GcsStore, ObjectStore
from app.models import AdminAccount, AdminSession
from app.rate_limit import SlidingWindowLimiter
from app.repositories import user_repo
from app.services import admin_service, session_service, tenant_access
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_store(request: Request) -> ObjectStore:
    """The private object store; 503 storage_unavailable until GCS_BUCKET is configured.
    Tests put a MemoryStore on app.state.store."""
    store = getattr(request.app.state, "store", None)
    if store is not None:
        return store
    settings: Settings = request.app.state.settings
    if not settings.gcs_bucket:
        raise AppError(503, "storage_unavailable", "error.storage_unavailable")
    store = GcsStore(settings.gcs_bucket, settings.gcs_credentials_file)
    request.app.state.store = store
    return store


def get_engine(request: Request) -> AsyncEngine | None:
    # None when the app runs without its lifespan (unit tests patch the database check).
    return getattr(request.app.state, "engine", None)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER, CSRF_VALUE = "X-Requested-With", "SaiFlow"


def require_csrf_header(request: Request) -> None:
    """Cookie-authenticated writes must carry a custom header: sibling aibaba.asia
    subdomains are same-site, so SameSite alone does not stop forged requests."""
    if request.method in UNSAFE_METHODS and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise AppError(403, "csrf_header_missing", "error.csrf")


async def get_optional_principal(
    request: Request, db: Annotated[AsyncSession, Depends(get_db)]
) -> Principal | None:
    token = request.cookies.get(session_service.CUSTOMER_COOKIE)
    if not token:
        return None
    principal = await session_service.resolve(db, token)
    if principal is not None:
        await db.commit()  # keep the extended lifetime
        max_age = int(session_service.CUSTOMER_IDLE.total_seconds())
        refresh_later(request, session_service.CUSTOMER_COOKIE, token, max_age)
    return principal


async def get_principal(
    principal: Annotated[Principal | None, Depends(get_optional_principal)],
) -> Principal:
    if principal is None:
        raise AppError(401, "unauthenticated", "auth.required")
    return principal


TENANT_HEADER = "X-Tenant-Id"


BIGINT_MAX = 2**63 - 1

# Path IDs: anything outside 1..bigint is answered 404 by the validation handler (N1)
PathId = Annotated[int, Path(gt=0, le=BIGINT_MAX)]


async def get_tenant_context(
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(get_principal)],
    raw: Annotated[
        str | None,
        Header(
            alias=TENANT_HEADER,
            description="Tenant this request acts on; omit for your own tenant (FR-SYS-017).",
        ),
    ] = None,
) -> TenantContext:
    """The tenant this request acts on (FR-SYS-017): header X-Tenant-Id, or the caller's own
    tenant. Any value that cannot name a usable tenant (not digits, zero, beyond bigint) is
    404, exactly like a tenant the caller is not a member of."""
    tenant_id: int | None = None
    if raw is not None:
        if not raw.isascii() or not raw.isdigit() or len(raw) > 19:
            raise tenant_access.not_found()
        tenant_id = int(raw)
        if not 0 < tenant_id <= BIGINT_MAX:
            raise tenant_access.not_found()
    return await tenant_access.resolve_tenant(db, principal, tenant_id)


async def require_user(principal: Annotated[Principal, Depends(get_principal)]) -> Principal:
    if principal.kind != "user":
        raise AppError(401, "unauthenticated", "auth.required")
    return principal


async def require_registered_user(
    principal: Annotated[Principal, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Principal:
    user = await user_repo.get(db, principal.user_id)  # type: ignore[arg-type]
    if user is None or user.registered_at is None:
        raise AppError(403, "registration_required", "auth.registration_required")
    return principal


def get_guest_limiter(request: Request) -> SlidingWindowLimiter:
    return request.app.state.guest_limiter


def get_line_client(request: Request) -> LineClient:
    client = getattr(request.app.state, "line_client", None)
    if client is None:
        raise AppError(503, "line_unavailable", "auth.line_unavailable")
    return client


def get_email_sender(request: Request) -> SmtpSender:
    sender = getattr(request.app.state, "email_sender", None)
    if sender is None:
        raise AppError(503, "email_unavailable", "error.email_service_unavailable")
    return sender


@dataclass(frozen=True)
class AdminContext:
    session: AdminSession
    account: AdminAccount


async def get_admin(request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> AdminContext:
    token = request.cookies.get(admin_service.ADMIN_COOKIE)
    found = await admin_service.resolve_admin(db, token) if token else None
    if found is None:
        raise AppError(401, "unauthenticated", "auth.required")
    max_age = int(admin_service.ADMIN_IDLE.total_seconds())
    refresh_later(request, admin_service.ADMIN_COOKIE, token, max_age)  # type: ignore[arg-type]
    return AdminContext(*found)
