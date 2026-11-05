"""Customer billing endpoints (rebuild-plans-metering): usage of the current tenant."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_tenant_context, require_csrf_header, require_user
from app.schemas.billing import PlanApplicationIn, PlanApplicationOut, UsageOut
from app.schemas.loose import ensure_text
from app.services import metering_service, plan_application_service
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1/billing", tags=["billing"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Tenant = Annotated[TenantContext, Depends(get_tenant_context)]


@router.get("/usage", operation_id="getUsage", response_model=UsageOut)
async def get_usage(ctx: Tenant, db: Db) -> UsageOut:
    """Plan, validity, this month's scans and the free quota (FR-SYS-033)."""
    return UsageOut(**await metering_service.usage(db, ctx))


@router.get(
    "/applications", operation_id="listPlanApplications", response_model=list[PlanApplicationOut]
)
async def list_applications(ctx: Tenant, db: Db) -> list[PlanApplicationOut]:
    found = await plan_application_service.list_for_tenant(db, ctx)
    return [PlanApplicationOut.model_validate(a, from_attributes=True) for a in found]


@router.post(
    "/applications",
    operation_id="applyForPlan",
    status_code=201,
    response_model=PlanApplicationOut,
)
async def apply_for_plan(
    req: PlanApplicationIn,
    ctx: Tenant,
    db: Db,
    user: Annotated[Principal, Depends(require_user)],  # guests cannot apply (401)
) -> PlanApplicationOut:
    ensure_text(req)
    application = await plan_application_service.apply(db, ctx, req.plan_code, req.period, req.note)
    return PlanApplicationOut.model_validate(application, from_attributes=True)
