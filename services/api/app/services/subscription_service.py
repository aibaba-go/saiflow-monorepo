"""Subscriptions (FR-SYS-012): one current subscription per tenant, every change kept as
a period row (A1). Personal and guest tenants start with a Kinder month; organizations
start with none and are set by the admin or by an approved plan application."""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing_time import PERIOD_MONTHS, add_months
from app.clock import utcnow
from app.errors import AppError
from app.locks import xact_lock
from app.models import Plan, Subscription, Tenant
from app.services import plan_service
from app.services.audit_service import AuditEvent, record
from app.services.organization_service import Actor, fields_error

TENANT_LOCK = 4207004
KINDER = "kinder"


def tenant_plan_kind(tenant_kind: str) -> str:
    """Which plans a tenant may hold: guests count as personal."""
    return "organization" if tenant_kind == "organization" else "personal"


def is_active(sub: Subscription | None, now: datetime) -> bool:
    return sub is not None and sub.starts_at <= now < sub.ends_at


async def current(db: AsyncSession, tenant_id: int, now: datetime) -> Subscription | None:
    """The active subscription, or else the most recent one."""
    rows = list(
        (
            await db.execute(
                select(Subscription)
                .where(Subscription.tenant_id == tenant_id)
                .order_by(Subscription.starts_at.desc(), Subscription.id.desc())
            )
        ).scalars()
    )
    for sub in rows:
        if is_active(sub, now):
            return sub
    return rows[0] if rows else None


async def history(db: AsyncSession, tenant_id: int) -> list[Subscription]:
    return list(
        (
            await db.execute(
                select(Subscription)
                .where(Subscription.tenant_id == tenant_id)
                .order_by(Subscription.starts_at, Subscription.id)
            )
        ).scalars()
    )


async def start_default(db: AsyncSession, tenant_id: int, now: datetime) -> Subscription:
    """A Kinder month for a new personal or guest tenant; rides the caller's transaction."""
    sub = Subscription(
        tenant_id=tenant_id,
        plan_code=KINDER,
        period="month",
        starts_at=now,
        ends_at=add_months(now, 1),
        source="auto",
    )
    db.add(sub)
    await db.flush()
    await record(
        db, AuditEvent("system", None, "subscription.auto", "tenant", str(tenant_id), "success")
    )
    return sub


async def check_plan_rules(
    db: AsyncSession, tenant_id: int, plan_code: str | None, now: datetime
) -> tuple[Tenant, Plan, Subscription | None]:
    """The tenant, the plan and the current subscription, if this plan is allowed now."""
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise AppError(404, "not_found", "error.not_found")
    plan = await db.get(Plan, plan_code) if plan_code else None
    if plan is None or plan.tenant_kind != tenant_plan_kind(tenant.kind):
        raise fields_error(["plan_code"])
    sub = await current(db, tenant_id, now)
    if is_active(sub, now):
        held = await plan_service.get_plan(db, sub.plan_code)  # type: ignore[union-attr]
        if plan.sort_order < held.sort_order:  # no downgrade while active
            raise fields_error(["plan_code"])
    return tenant, plan, sub


def parse_time(raw: str | None, field: str) -> datetime | None:
    if raw is None:
        return None
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        raise fields_error([field]) from None
    if value.tzinfo is None:
        raise fields_error([field])
    return value


async def set_subscription(
    db: AsyncSession,
    *,
    tenant_id: int,
    plan_code: str | None,
    period: str | None,
    starts_at: datetime | None,
    ends_at: datetime | None,
    source: str,
    admin_id: int,
    application_id: int | None = None,
) -> Subscription:
    """Add a subscription period (FR-SYS-012, A5 defaults). Does not commit."""
    if period not in PERIOD_MONTHS:
        bad = ["period"] if plan_code else ["plan_code", "period"]
        raise fields_error(bad)
    await xact_lock(db, TENANT_LOCK, tenant_id)
    now = utcnow()
    _, plan, sub = await check_plan_rules(db, tenant_id, plan_code, now)
    if starts_at is None:
        same_and_active = is_active(sub, now) and sub.plan_code == plan.code  # type: ignore[union-attr]
        if same_and_active:  # chain after the last period of this plan, queued ones included
            starts_at = (
                await db.execute(
                    select(func.max(Subscription.ends_at)).where(
                        Subscription.tenant_id == tenant_id,
                        Subscription.plan_code == plan.code,
                        Subscription.ends_at > now,
                    )
                )
            ).scalar_one()
        else:
            starts_at = now
    if ends_at is None:
        ends_at = add_months(starts_at, PERIOD_MONTHS[period])
    if ends_at <= starts_at:
        raise fields_error(["ends_at"])
    new = Subscription(
        tenant_id=tenant_id,
        plan_code=plan.code,
        period=period,
        starts_at=starts_at,
        ends_at=ends_at,
        source=source,
        application_id=application_id,
        set_by_admin_id=admin_id,
    )
    db.add(new)
    await db.flush()
    await record(db, Actor("admin", admin_id).event("subscription.set", "tenant", tenant_id))
    return new
