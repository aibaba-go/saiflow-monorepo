"""The caller's own notifications (rebuild-notifications, FR-SYS-036): newest first, read or
unread, never deleted (D7)."""

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Notification

DEFAULT_LIMIT, MAX_LIMIT = 20, 100


async def unread_count(db: AsyncSession, user_id: int) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
    ).scalar_one()


async def page(
    db: AsyncSession, user_id: int, limit: int, before: int | None
) -> tuple[list[Notification], int | None]:
    """One page, newest first, and the `before` cursor for the next page (None at the end)."""
    query = select(Notification).where(Notification.user_id == user_id)
    if before is not None:
        query = query.where(Notification.id < before)
    rows = list(
        (await db.execute(query.order_by(Notification.id.desc()).limit(limit + 1))).scalars()
    )
    more = len(rows) > limit
    rows = rows[:limit]
    return rows, rows[-1].id if more else None


async def mark_read(db: AsyncSession, user_id: int, ids: list[int] | None) -> tuple[int, int]:
    """Mark the caller's unread notifications read: the given IDs (others' and unknown ones
    are ignored), or all of them when ids is None. Returns (updated, unread left)."""
    query = update(Notification).where(
        Notification.user_id == user_id, Notification.read_at.is_(None)
    )
    if ids is not None:
        if not ids:
            return 0, await unread_count(db, user_id)
        query = query.where(Notification.id.in_(ids))
    updated = (await db.execute(query.values(read_at=utcnow()))).rowcount
    await db.commit()
    return updated, await unread_count(db, user_id)
