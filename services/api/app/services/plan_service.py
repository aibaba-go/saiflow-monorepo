"""The plan catalog (FR-SYS-030): four fixed plans; the admin edits monthly quota and
member limit, which apply to existing subscriptions at once (D3)."""

import re
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import Plan
from app.services.audit_service import record
from app.services.organization_service import Actor, fields_error

KINDER = "kinder"
INT4_MAX = 2**31 - 1


INVALID = object()
_PRICE_TEXT = re.compile(r"^\d{1,10}(\.\d{1,2})?$")
PRICE_LIMIT = Decimal(10) ** 10


def parse_price(raw: object) -> object:
    """A THB price as Decimal: >= 0, at most two decimals, below 10^10; None = contact
    sales. Returns INVALID for anything else (bools, exponents, blanks, more decimals)."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return INVALID
    if isinstance(raw, str):
        if not _PRICE_TEXT.match(raw):
            return INVALID
        value = Decimal(raw)
    elif isinstance(raw, int | float):
        value = Decimal(str(raw))
        exponent = value.as_tuple().exponent
        if not value.is_finite() or not isinstance(exponent, int) or exponent < -2:
            return INVALID
    else:
        return INVALID
    if value < 0 or value >= PRICE_LIMIT:
        return INVALID
    return value


async def list_plans(db: AsyncSession) -> list[Plan]:
    return list((await db.execute(select(Plan).order_by(Plan.sort_order))).scalars())


async def get_plan(db: AsyncSession, code: str, *, lock: bool = False) -> Plan:
    plan = await db.get(Plan, code, with_for_update=lock, populate_existing=lock)
    if plan is None:
        raise AppError(404, "not_found", "error.not_found")
    return plan


async def update_plan(
    db: AsyncSession, admin_id: int, code: str, changes: dict[str, object]
) -> Plan:
    """`changes` holds only the fields present in the request; member_limit None means
    unlimited."""
    plan = await get_plan(db, code, lock=True)
    bad = []
    if "monthly_quota" in changes:
        quota = changes["monthly_quota"]
        if quota is None or not 1 <= quota <= INT4_MAX:
            bad.append("monthly_quota")
    if "member_limit" in changes:
        limit = changes["member_limit"]
        if code == KINDER or (limit is not None and not 1 <= limit <= INT4_MAX):
            bad.append("member_limit")  # Kinder stays at 1 (FR-SYS-030)
    for field in ("monthly_price", "yearly_price"):
        if field in changes:
            price = parse_price(changes[field])
            if price is INVALID:
                bad.append(field)
            else:
                changes[field] = price
    if bad:
        raise fields_error(bad)
    for key, value in changes.items():
        setattr(plan, key, value)
    plan.updated_at = utcnow()
    await record(db, Actor("admin", admin_id).event("plan.update", "plan", code))
    await db.commit()
    await db.refresh(plan)
    return plan
