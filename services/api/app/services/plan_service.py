"""The plan catalog (FR-SYS-030): four fixed plans; the admin edits monthly quota and
member limit, which apply to existing subscriptions at once (D3)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import Plan
from app.services.audit_service import record
from app.services.organization_service import Actor, fields_error

KINDER = "kinder"


async def list_plans(db: AsyncSession) -> list[Plan]:
    return list((await db.execute(select(Plan).order_by(Plan.sort_order))).scalars())


async def get_plan(db: AsyncSession, code: str, *, lock: bool = False) -> Plan:
    plan = await db.get(Plan, code, with_for_update=lock, populate_existing=lock)
    if plan is None:
        raise AppError(404, "not_found", "error.not_found")
    return plan


async def update_plan(
    db: AsyncSession, admin_id: int, code: str, changes: dict[str, int | None]
) -> Plan:
    """`changes` holds only the fields present in the request; member_limit None means
    unlimited."""
    plan = await get_plan(db, code, lock=True)
    bad = []
    if "monthly_quota" in changes:
        quota = changes["monthly_quota"]
        if quota is None or quota < 1:
            bad.append("monthly_quota")
    if "member_limit" in changes:
        limit = changes["member_limit"]
        if code == KINDER or (limit is not None and limit < 1):
            bad.append("member_limit")  # Kinder stays at 1 (FR-SYS-030)
    if bad:
        raise fields_error(bad)
    for key, value in changes.items():
        setattr(plan, key, value)
    plan.updated_at = utcnow()
    await record(db, Actor("admin", admin_id).event("plan.update", "plan", code))
    await db.commit()
    await db.refresh(plan)
    return plan
