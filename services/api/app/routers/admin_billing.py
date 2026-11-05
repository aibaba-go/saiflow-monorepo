"""Platform admin endpoints for plans, subscriptions, reservations, plan applications and
free-quota settings (rebuild-plans-metering); admin session only."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminContext, get_admin, get_db, require_csrf_header
from app.schemas.billing import (
    PlanOut,
    PlanUpdateIn,
    ReservationOut,
    SubscriptionIn,
    SubscriptionOut,
)
from app.schemas.loose import ensure_text
from app.schemas.organization import IntSettingIn, IntSettingOut
from app.services import (
    free_quota_service,
    metering_service,
    plan_service,
    settings_service,
    subscription_service,
)

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]


@router.get("/plans", operation_id="adminListPlans", response_model=list[PlanOut])
async def list_plans(db: Db, admin: Admin) -> list[PlanOut]:
    return [
        PlanOut.model_validate(p, from_attributes=True) for p in await plan_service.list_plans(db)
    ]


@router.patch("/plans/{code}", operation_id="adminUpdatePlan", response_model=PlanOut)
async def update_plan(code: str, req: PlanUpdateIn, db: Db, admin: Admin) -> PlanOut:
    ensure_text(req)
    changes = {k: getattr(req, k) for k in req.model_fields_set if k != "invalid_fields"}
    plan = await plan_service.update_plan(db, admin.account.id, code, changes)
    return PlanOut.model_validate(plan, from_attributes=True)


@router.get(
    "/tenants/{tenant_id}/subscriptions",
    operation_id="adminListSubscriptions",
    response_model=list[SubscriptionOut],
)
async def list_subscriptions(tenant_id: int, db: Db, admin: Admin) -> list[SubscriptionOut]:
    found = await subscription_service.history(db, tenant_id)
    return [SubscriptionOut.model_validate(s, from_attributes=True) for s in found]


@router.put(
    "/tenants/{tenant_id}/subscription",
    operation_id="adminSetSubscription",
    response_model=SubscriptionOut,
)
async def set_subscription(
    tenant_id: int, req: SubscriptionIn, db: Db, admin: Admin
) -> SubscriptionOut:
    ensure_text(req)
    sub = await subscription_service.set_subscription(
        db,
        tenant_id=tenant_id,
        plan_code=req.plan_code,
        period=req.period,
        starts_at=subscription_service.parse_time(req.starts_at, "starts_at"),
        ends_at=subscription_service.parse_time(req.ends_at, "ends_at"),
        source="admin",
        admin_id=admin.account.id,
    )
    await db.commit()
    await db.refresh(sub)
    return SubscriptionOut.model_validate(sub, from_attributes=True)


@router.get(
    "/tenants/{tenant_id}/reservations",
    operation_id="adminListReservations",
    response_model=list[ReservationOut],
)
async def list_reservations(tenant_id: int, db: Db, admin: Admin) -> list[ReservationOut]:
    found = await metering_service.reservations(db, tenant_id)
    return [ReservationOut.model_validate(r, from_attributes=True) for r in found]


def _free_quota_setting(path: str, key: str, name: str) -> None:
    @router.get(f"/settings/{path}", operation_id=f"adminGet{name}", response_model=IntSettingOut)
    async def get_setting(db: Db, admin: Admin) -> IntSettingOut:
        return IntSettingOut(value=await settings_service.get_int(db, key, 100))

    @router.put(f"/settings/{path}", operation_id=f"adminSet{name}", response_model=IntSettingOut)
    async def set_setting(req: IntSettingIn, db: Db, admin: Admin) -> IntSettingOut:
        await settings_service.set_int(db, key, req.value, admin.account.id)
        return IntSettingOut(value=req.value)


_free_quota_setting(
    "free-quota-personal", free_quota_service.FREE_QUOTA_PERSONAL, "FreeQuotaPersonal"
)
_free_quota_setting(
    "free-quota-organization", free_quota_service.FREE_QUOTA_ORGANIZATION, "FreeQuotaOrganization"
)
