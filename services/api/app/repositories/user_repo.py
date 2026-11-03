from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def get(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)
