from collections.abc import AsyncIterator

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

# Serialises audit writes so every entry links to the one written just before it.
AUDIT_LOCK_KEY = 4207001


async def lock_chain(db: AsyncSession) -> None:
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": AUDIT_LOCK_KEY})


async def last_hash(db: AsyncSession) -> bytes | None:
    return (
        await db.execute(select(AuditLog.hash).order_by(AuditLog.id.desc()).limit(1))
    ).scalar_one_or_none()


async def all_in_order(db: AsyncSession) -> AsyncIterator[AuditLog]:
    result = await db.stream_scalars(select(AuditLog).order_by(AuditLog.id))
    async for row in result:
        yield row
