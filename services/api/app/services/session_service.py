"""Customer sessions (guest or user). The cookie holds a random token; the database
keeps only its SHA-256. A session ends after 30 idle days; every use extends it.
A session an admin entered as the user (FR-SYS-148) ends after 30 idle minutes, two hours
in total, or as soon as that admin is disabled."""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import AdminAccount, CustomerSession
from app.repositories import session_repo, tenant_repo
from app.services.audit_service import AuditEvent, record

CUSTOMER_COOKIE = "saiflow_session"
CUSTOMER_IDLE = timedelta(days=30)
IMPERSONATION_IDLE = timedelta(minutes=30)
IMPERSONATION_MAX = timedelta(hours=2)


@dataclass(frozen=True)
class Principal:
    kind: Literal["guest", "user"]
    session_id: int
    tenant_id: int  # guest: its temporary tenant; user: the personal tenant
    user_id: int | None
    impersonated_by: int | None = None  # the admin who entered as this user (FR-SYS-148)


def idle_limit(principal: Principal) -> timedelta:
    """How long the session may sit unused; also the cookie lifetime."""
    return IMPERSONATION_IDLE if principal.impersonated_by is not None else CUSTOMER_IDLE


async def session_alive(db: AsyncSession, row: CustomerSession, now: datetime) -> bool:
    """Whether a session row may still be used: not revoked, within its idle limit, and,
    for an admin-entered session, within two hours and its admin still enabled."""
    if row.revoked_at is not None:
        return False
    if row.impersonated_by_admin_id is None:
        return now - row.last_used_at <= CUSTOMER_IDLE
    if now - row.last_used_at > IMPERSONATION_IDLE or now - row.created_at > IMPERSONATION_MAX:
        return False
    admin = await db.get(AdminAccount, row.impersonated_by_admin_id)
    return admin is not None and admin.disabled_at is None


def principal_of(row: CustomerSession) -> Principal:
    return Principal(
        row.kind,  # type: ignore[arg-type]
        row.id,
        row.tenant_id,
        row.user_id,
        row.impersonated_by_admin_id,
    )


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


async def create_guest(db: AsyncSession) -> tuple[str, Principal]:
    from app.services import subscription_service  # import here: it depends on this module's peers

    tenant = await tenant_repo.create(db, "guest")
    await subscription_service.start_default(db, tenant.id, utcnow())  # FR-SYS-012
    token = new_token()
    row = await session_repo.create(db, hash_token(token), "guest", tenant.id, None)
    await record(
        db, AuditEvent("guest", str(tenant.id), "guest.create", "tenant", str(tenant.id), "success")
    )
    return token, Principal("guest", row.id, tenant.id, None)


async def create_user_session(
    db: AsyncSession, user_id: int, tenant_id: int, impersonated_by: int | None = None
) -> str:
    token = new_token()
    row = await session_repo.create(db, hash_token(token), "user", tenant_id, user_id)
    if impersonated_by is not None:
        row.impersonated_by_admin_id = impersonated_by
        await db.flush()
    return token


async def resolve(db: AsyncSession, token: str) -> Principal | None:
    row = await session_repo.active_by_hash(db, hash_token(token))
    now = utcnow()
    if row is None or not await session_alive(db, row, now):
        return None
    await session_repo.touch(db, row.id, now)
    return principal_of(row)


async def revoke(db: AsyncSession, session_id: int) -> None:
    await session_repo.revoke(db, session_id, utcnow())
