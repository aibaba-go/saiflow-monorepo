from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tenant


async def create(db: AsyncSession, kind: str, owner_user_id: int | None = None) -> Tenant:
    tenant = Tenant(kind=kind, owner_user_id=owner_user_id, status="active")
    db.add(tenant)
    await db.flush()
    return tenant


async def personal_of(db: AsyncSession, user_id: int) -> Tenant | None:
    return (
        await db.execute(
            select(Tenant).where(Tenant.kind == "personal", Tenant.owner_user_id == user_id)
        )
    ).scalar_one_or_none()
