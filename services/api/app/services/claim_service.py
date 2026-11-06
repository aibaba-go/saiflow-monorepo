"""Move a guest's data into a user's personal tenant (FR-SYS-010).

Every table that belongs to a tenant declares `info={"tenant_scoped": True}` and has a
`tenant_id` column; claiming moves all of them in the caller's transaction."""

from sqlalchemy import Table, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401  (registers every table)
from app.db import Base
from app.models import Tenant


def tenant_scoped_tables() -> list[Table]:
    return [t for t in Base.metadata.sorted_tables if t.info.get("tenant_scoped")]


async def claim_guest_tenant(
    db: AsyncSession, guest_tenant_id: int, personal_tenant_id: int
) -> None:
    for table in tenant_scoped_tables():
        await db.execute(
            update(table)
            .where(table.c.tenant_id == guest_tenant_id)
            .values(tenant_id=personal_tenant_id)
        )
    # Rows a guest created have no creator; the claiming user becomes it (ocr-scan-flow A9).
    owner = (
        await db.execute(select(Tenant.owner_user_id).where(Tenant.id == personal_tenant_id))
    ).scalar_one_or_none()
    if owner is not None:
        for table in tenant_scoped_tables():
            if "created_by_user_id" in table.c:
                await db.execute(
                    update(table)
                    .where(
                        table.c.tenant_id == personal_tenant_id,
                        table.c.created_by_user_id.is_(None),
                    )
                    .values(created_by_user_id=owner)
                )
    await db.execute(update(Tenant).where(Tenant.id == guest_tenant_id).values(status="claimed"))
