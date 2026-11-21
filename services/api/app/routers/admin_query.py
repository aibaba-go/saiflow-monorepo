"""Admin read-only queries: operation log (FR-SYS-003) and user search (FR-SYS-080); plus
the one-time link to enter web-pc as a user (FR-SYS-145).
Query parameters are taken as strings and checked here, so a bad value is 400 with the
field (like request bodies), never FastAPI's 422."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import (
    BIGINT_MAX,
    AdminContext,
    PathId,
    get_admin,
    get_db,
    get_settings,
    require_csrf_header,
)
from app.errors import AppError
from app.schemas.admin_query import (
    AdminUserCreate,
    AdminUserOut,
    AuditEntryOut,
    AuditPageOut,
    ImpersonationLinkOut,
    UserPageOut,
)
from app.schemas.loose import ensure_text
from app.services import admin_query_service, admin_user_service, impersonation_service
from app.services.admin_query_service import AuditFilter

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)
Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]
ACTOR_TYPES = {"user", "guest", "admin", "system"}


def _bad(field: str) -> AppError:
    return AppError(400, "validation_error", "error.validation", [field])


def _int(raw: str | None, field: str, low: int, high: int) -> int | None:
    if raw is None:
        return None
    if not (raw.isascii() and raw.isdigit() and len(raw) <= 19) or not low <= int(raw) <= high:
        raise _bad(field)
    return int(raw)


def _time(raw: str | None, field: str) -> datetime | None:
    if raw is None:
        return None
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        raise _bad(field) from None
    if value.tzinfo is None:
        raise _bad(field)
    return value


def _text(raw: str | None, field: str, max_len: int) -> str | None:
    if raw is None:
        return None
    if len(raw) > max_len:
        raise _bad(field)
    return raw


@router.get("/audit-log", operation_id="adminListAuditLog", response_model=AuditPageOut)
async def list_audit_log(
    db: Db,
    admin: Admin,
    limit: str | None = None,
    before: str | None = None,
    since: str | None = None,
    until: str | None = None,
    actor_type: str | None = None,
    action_prefix: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
) -> AuditPageOut:
    """The operation log, newest first, read-only (FR-SYS-003)."""
    if actor_type is not None and actor_type not in ACTOR_TYPES:
        raise _bad("actor_type")
    f = AuditFilter(
        limit=_int(limit, "limit", 1, 100) or 50,
        before=_int(before, "before", 1, BIGINT_MAX),
        since=_time(since, "since"),
        until=_time(until, "until"),
        actor_type=actor_type,
        action_prefix=_text(action_prefix, "action_prefix", 64),
        target_type=_text(target_type, "target_type", 64),
        target_id=_text(target_id, "target_id", 128),
    )
    rows, next_before = await admin_query_service.audit_page(db, f)
    return AuditPageOut(
        items=[AuditEntryOut.model_validate(r, from_attributes=True) for r in rows],
        next_before=next_before,
    )


@router.get("/users", operation_id="adminSearchUsers", response_model=UserPageOut)
async def search_users(
    db: Db, admin: Admin, q: str | None = None, page: str | None = None
) -> UserPageOut:
    """Customer users by email, nickname or user id; every user when q is empty (FR-SYS-080)."""
    term = (q or "").strip()
    if term and len(term) < 2 and not term.isdigit():
        raise _bad("q")
    if len(term) > 200:
        raise _bad("q")
    number = _int(page, "page", 1, 10_000) or 1
    items, more = await admin_query_service.search_users(db, term, number)
    return UserPageOut(items=items, has_more=more)


@router.post("/users", operation_id="adminCreateUser", status_code=201, response_model=AdminUserOut)
async def create_user(req: AdminUserCreate, db: Db, admin: Admin) -> AdminUserOut:
    ensure_text(req)
    return await admin_user_service.create(
        db, admin.account.id, req.email, req.display_name, req.phone, req.password
    )


@router.delete("/users/{user_id}", operation_id="adminDeleteUser", status_code=204)
async def delete_user(user_id: PathId, db: Db, admin: Admin) -> Response:
    await admin_user_service.remove(db, admin.account.id, user_id)
    return Response(status_code=204)


@router.post(
    "/users/{user_id}/impersonation",
    operation_id="adminImpersonateUser",
    response_model=ImpersonationLinkOut,
)
async def impersonate_user(
    user_id: PathId,
    db: Db,
    admin: Admin,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ImpersonationLinkOut:
    """A one-time, 60-second web-pc link that enters as this registered user (FR-SYS-145)."""
    link = await impersonation_service.issue(db, settings, admin.account, user_id)
    return ImpersonationLinkOut(url=link.url, expires_in=link.expires_in)
