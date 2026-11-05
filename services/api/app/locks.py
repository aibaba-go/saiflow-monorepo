"""Transaction-scoped advisory locks keyed by (namespace, bigint id).

The two-int4 form of pg_advisory_xact_lock overflows for ids beyond 2^31, so the pair is
folded into one bigint key: 16 bits of namespace, 48 bits of id. Ids are identity values,
far below 2^48, so keys do not collide."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_ID_BITS = 48


def lock_key(namespace: int, ident: int) -> int:
    unsigned = ((namespace & 0xFFFF) << _ID_BITS) | (ident & ((1 << _ID_BITS) - 1))
    return unsigned - (1 << 64) if unsigned >= 1 << 63 else unsigned


async def xact_lock(db: AsyncSession, namespace: int, ident: int) -> None:
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock_key(namespace, ident)})
