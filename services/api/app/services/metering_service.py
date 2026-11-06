"""Scan-count metering (FR-SYS-013, FR-SYS-033). The interface for recognition (B-3):

    reservation = await metering_service.reserve(db, ctx.tenant_id, page_count, job_id)
        # in the SAME transaction that inserts the job; commit both together
    await metering_service.release(db, ctx.tenant_id, reservation.id)
        # in the transaction that marks the job FAILED or CANCELLED; never on SUCCEEDED

Neither function commits. `reserve` with a reference it has seen before returns the
earlier reservation, so a retried job creation never charges twice; the same reference
with a different page count, or after it was released, is 409 `reservation_conflict`
(use a new reference for a rerun). Errors (AppError): 402 `quota_exceeded` with details
{"available": n}, 402 `plan_expired`, 400 `pages`, 404 for an unknown tenant, and 404
from `release` for a reservation of another tenant.

Lock order: call `reserve` and `release` BEFORE writing any audit row in the same
transaction. `audit_service.record` takes a global lock held until commit; taking the
tenant meter lock after it can deadlock against a concurrent reserve.

Monthly usage is the sum of unreleased `from_monthly` of the tenant's reservations in the
Bangkok month; a release keeps the row in its own month, so a release after month end
gives the scans back to the old month (A4). Every reserve and release of one tenant is
serialised by a transaction-scoped advisory lock."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing_time import month_key
from app.clock import utcnow
from app.errors import AppError
from app.locks import xact_lock
from app.models import FreeQuota, Plan, QuotaReservation, Tenant
from app.services import free_quota_service, subscription_service
from app.services.organization_service import fields_error
from app.services.tenant_access import TenantContext, not_found

METER_LOCK = 4207003


async def _lock(db: AsyncSession, tenant_id: int) -> None:
    await xact_lock(db, METER_LOCK, tenant_id)


async def used_in_month(db: AsyncSession, tenant_id: int, month) -> int:
    """Unreleased monthly-quota scans for the Bangkok month (reminders read this too)."""
    return (
        await db.execute(
            select(func.coalesce(func.sum(QuotaReservation.from_monthly), 0)).where(
                QuotaReservation.tenant_id == tenant_id,
                QuotaReservation.month == month,
                QuotaReservation.released_at.is_(None),
            )
        )
    ).scalar_one()


async def _state(db: AsyncSession, tenant_id: int, now):
    """(tenant kind, active subscription or None, plan or None, free-quota row)."""
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise not_found()
    sub = await subscription_service.current(db, tenant_id, now)
    active = subscription_service.is_active(sub, now)
    plan = await db.get(Plan, sub.plan_code) if active else None  # type: ignore[union-attr]
    free_row = await db.get(FreeQuota, tenant_id, populate_existing=True)
    return tenant.kind, (sub if active else None), plan, free_row


async def may_confirm(db: AsyncSession, tenant_id: int, now) -> bool:
    """Confirming needs what scanning needs (option A, owner 2026-11-06): an active plan, or
    an organization's free scans still inside their validity (even when all are used up).
    A personal tenant's free scans pause while its plan is expired."""
    kind, sub, _plan, free_row = await _state(db, tenant_id, now)
    return sub is not None or free_quota_service.in_period(free_row, kind, now)


async def reserve(db: AsyncSession, tenant_id: int, pages: int, reference: str) -> QuotaReservation:
    if pages < 1:
        raise fields_error(["pages"])
    await _lock(db, tenant_id)
    existing = (
        await db.execute(
            select(QuotaReservation).where(
                QuotaReservation.tenant_id == tenant_id, QuotaReservation.reference == reference
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.pages != pages or existing.released_at is not None:
            raise AppError(409, "reservation_conflict", "billing.reservation_conflict")
        return existing
    now = utcnow()
    kind, sub, plan, free_row = await _state(db, tenant_id, now)
    free = free_quota_service.usable(free_row, kind, sub is not None, now)
    month = month_key(now)
    monthly_left = (
        max(plan.monthly_quota - await used_in_month(db, tenant_id, month), 0) if plan else 0
    )
    if sub is None and free == 0:
        raise AppError(402, "plan_expired", "billing.plan_expired")
    if free + monthly_left < pages:
        raise AppError(
            402,
            "quota_exceeded",
            "billing.quota_exceeded",
            details={"available": free + monthly_left},
        )
    from_free = min(free, pages)
    if from_free:
        free_row.remaining -= from_free  # type: ignore[union-attr]
    reservation = QuotaReservation(
        tenant_id=tenant_id,
        reference=reference,
        pages=pages,
        from_free=from_free,
        from_monthly=pages - from_free,
        month=month,
        reserved_at=now,
    )
    db.add(reservation)
    await db.flush()
    return reservation


async def release(db: AsyncSession, tenant_id: int, reservation_id: int) -> None:
    row = await db.get(QuotaReservation, reservation_id)
    if row is None or row.tenant_id != tenant_id:  # never another tenant's reservation
        raise not_found()
    await _lock(db, row.tenant_id)
    await db.refresh(row)
    if row.released_at is not None:  # once only (AC-FR-SYS-013-04)
        return
    now = utcnow()
    row.released_at = now
    if row.from_free:
        free_row = await db.get(FreeQuota, row.tenant_id, populate_existing=True)
        if free_row is not None and not free_quota_service.is_expired(free_row, now):
            free_row.remaining += row.from_free  # an expired grant stays void
    await db.flush()


async def usage(db: AsyncSession, ctx: TenantContext) -> dict:
    now = utcnow()
    kind, sub, plan, free_row = await _state(db, ctx.tenant_id, now)
    if sub is None:  # the latest started period; a queued future one is not shown
        latest = await subscription_service.latest_started(db, ctx.tenant_id, now)
    else:
        latest = sub
    month = month_key(now)
    used = await used_in_month(db, ctx.tenant_id, month)
    quota = plan.monthly_quota if plan else 0
    if kind == "organization":
        free_left = free_quota_service.usable(free_row, kind, True, now)
    else:
        free_left = free_row.remaining if free_row is not None and kind != "guest" else 0
    return {
        "plan": None
        if latest is None
        else {
            "code": latest.plan_code,
            "period": latest.period,
            "starts_at": latest.starts_at,
            "ends_at": latest.ends_at,
        },
        "active": sub is not None,
        "month": {
            "month": month,
            "quota": quota,
            "used": used,
            "remaining": max(quota - used, 0),
        },
        "free": {
            "remaining": free_left,
            "expires_at": free_row.expires_at if free_row is not None else None,
            "paused": kind == "personal" and sub is None and free_left > 0,
        },
    }


async def reservations(db: AsyncSession, tenant_id: int) -> list[QuotaReservation]:
    return list(
        (
            await db.execute(
                select(QuotaReservation)
                .where(QuotaReservation.tenant_id == tenant_id)
                .order_by(QuotaReservation.id)
            )
        ).scalars()
    )
