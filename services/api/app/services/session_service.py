"""Customer sessions (guest or user). The cookie holds a random token; the database
keeps only its SHA-256. A session ends after 30 idle days; every use extends it."""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.repositories import session_repo, tenant_repo
from app.services.audit_service import AuditEvent, record

CUSTOMER_COOKIE = "saiflow_session"
CUSTOMER_IDLE = timedelta(days=30)


@dataclass(frozen=True)
class Principal:
    kind: Literal["guest", "user"]
    session_id: int
    tenant_id: int  # guest: its temporary tenant; user: the personal tenant
    user_id: int | None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


async def create_guest(db: AsyncSession) -> tuple[str, Principal]:
    tenant = await tenant_repo.create(db, "guest")
    token = new_token()
    row = await session_repo.create(db, hash_token(token), "guest", tenant.id, None)
    await record(
        db, AuditEvent("guest", str(tenant.id), "guest.create", "tenant", str(tenant.id), "success")
    )
    return token, Principal("guest", row.id, tenant.id, None)


async def create_user_session(db: AsyncSession, user_id: int, tenant_id: int) -> str:
    token = new_token()
    await session_repo.create(db, hash_token(token), "user", tenant_id, user_id)
    return token


async def resolve(db: AsyncSession, token: str) -> Principal | None:
    row = await session_repo.active_by_hash(db, hash_token(token))
    now = utcnow()
    if row is None or now - row.last_used_at > CUSTOMER_IDLE:
        return None
    await session_repo.touch(db, row.id, now)
    return Principal(row.kind, row.id, row.tenant_id, row.user_id)  # type: ignore[arg-type]


async def revoke(db: AsyncSession, session_id: int) -> None:
    await session_repo.revoke(db, session_id, utcnow())
