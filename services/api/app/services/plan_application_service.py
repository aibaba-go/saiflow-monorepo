"""Renewal and opening applications (FR-SYS-032). Payment happens offline; approving an
application sets the subscription (FR-SYS-012) with source 'application'."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing_time import PERIOD_MONTHS
from app.clock import utcnow
from app.errors import AppError
from app.models import PlanApplication, Subscription
from app.permissions import Permission
from app.services import subscription_service
from app.services.audit_service import record
from app.services.organization_service import Actor, fields_error
from app.services.tenant_access import TenantContext, not_found, require

NOTE_MAX = 512


async def apply(
    db: AsyncSession,
    ctx: TenantContext,
    plan_code: str | None,
    period: str | None,
    note: str | None,
) -> PlanApplication:
    if ctx.kind == "organization" and not ctx.is_owner:
        require(ctx, Permission.PLAN_APPLY)
    bad = []
    if period not in PERIOD_MONTHS:
        bad.append("period")
    clean_note = (note or "").strip() or None
    if clean_note is not None and len(clean_note) > NOTE_MAX:
        bad.append("note")
    try:
        await subscription_service.check_plan_rules(db, ctx.tenant_id, plan_code, utcnow())
    except AppError as exc:
        if exc.fields is None:
            raise
        bad = list(exc.fields) + bad
    if bad:
        raise fields_error(bad)
    application = PlanApplication(
        tenant_id=ctx.tenant_id,
        applicant_user_id=ctx.user_id,
        plan_code=plan_code,
        period=period,
        note=clean_note,
    )
    db.add(application)
    try:
        await db.flush()
    except IntegrityError:  # one pending application per tenant (A6)
        await db.rollback()
        raise AppError(409, "application_pending", "organization.application_pending") from None
    await record(
        db,
        Actor("user", ctx.user_id).event(
            "plan_application.submit", "plan_application", application.id
        ),  # type: ignore[arg-type]
    )
    await db.commit()
    await db.refresh(application)
    return application


async def _pending(db: AsyncSession, application_id: int) -> PlanApplication:
    application = await db.get(
        PlanApplication, application_id, with_for_update=True, populate_existing=True
    )
    if application is None:
        raise not_found()
    if application.status != "pending":
        raise AppError(409, "already_decided", "organization.already_decided")
    return application


async def approve(
    db: AsyncSession,
    admin_id: int,
    application_id: int,
    starts_at: datetime | None,
    ends_at: datetime | None,
) -> Subscription:
    application = await _pending(db, application_id)
    sub = await subscription_service.set_subscription(
        db,
        tenant_id=application.tenant_id,
        plan_code=application.plan_code,
        period=application.period,
        starts_at=starts_at,
        ends_at=ends_at,
        source="application",
        admin_id=admin_id,
        application_id=application.id,
    )
    application.status, application.subscription_id = "approved", sub.id
    application.decided_by_admin_id, application.decided_at = admin_id, utcnow()
    await record(
        db,
        Actor("admin", admin_id).event(
            "plan_application.approve", "plan_application", application_id
        ),
    )
    await db.commit()
    await db.refresh(sub)
    return sub


async def reject(db: AsyncSession, admin_id: int, application_id: int, reason: str | None) -> None:
    clean = (reason or "").strip()
    if not clean:
        raise fields_error(["reason"])
    application = await _pending(db, application_id)
    application.status, application.reject_reason = "rejected", clean
    application.decided_by_admin_id, application.decided_at = admin_id, utcnow()
    await record(
        db,
        Actor("admin", admin_id).event(
            "plan_application.reject", "plan_application", application_id
        ),
    )
    await db.commit()


async def list_for_tenant(db: AsyncSession, ctx: TenantContext) -> list[PlanApplication]:
    return list(
        (
            await db.execute(
                select(PlanApplication)
                .where(PlanApplication.tenant_id == ctx.tenant_id)
                .order_by(PlanApplication.id.desc())
            )
        ).scalars()
    )


async def list_all(db: AsyncSession, status: str | None) -> list[PlanApplication]:
    q = select(PlanApplication).order_by(PlanApplication.id)
    if status is not None:
        q = q.where(PlanApplication.status == status)
    return list((await db.execute(q)).scalars())
