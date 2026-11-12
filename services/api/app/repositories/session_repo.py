from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CustomerSession


async def create(
    db: AsyncSession, token_hash: bytes, kind: str, tenant_id: int, user_id: int | None
) -> CustomerSession:
    row = CustomerSession(token_hash=token_hash, kind=kind, tenant_id=tenant_id, user_id=user_id)
    db.add(row)
    await db.flush()
    return row


async def active_by_hash(db: AsyncSession, token_hash: bytes) -> CustomerSession | None:
    return (
        await db.execute(
            select(CustomerSession).where(
                CustomerSession.token_hash == token_hash, CustomerSession.revoked_at.is_(None)
            )
        )
    ).scalar_one_or_none()


async def touch(db: AsyncSession, session_id: int, at: datetime) -> None:
    await db.execute(
        update(CustomerSession).where(CustomerSession.id == session_id).values(last_used_at=at)
    )


async def revoke_all_of_user(db: AsyncSession, user_id: int, at: datetime) -> None:
    await db.execute(
        update(CustomerSession)
        .where(CustomerSession.user_id == user_id, CustomerSession.revoked_at.is_(None))
        .values(revoked_at=at)
    )


async def revoke(db: AsyncSession, session_id: int, at: datetime) -> None:
    await db.execute(
        update(CustomerSession).where(CustomerSession.id == session_id).values(revoked_at=at)
    )
