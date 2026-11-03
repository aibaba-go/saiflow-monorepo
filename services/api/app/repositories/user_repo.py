from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def get(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)


async def by_line_id(db: AsyncSession, line_user_id: str) -> User | None:
    return (
        await db.execute(select(User).where(User.line_user_id == line_user_id))
    ).scalar_one_or_none()


async def create(db: AsyncSession, line_user_id: str, **fields) -> User:
    user = User(line_user_id=line_user_id, **fields)
    db.add(user)
    await db.flush()
    return user
