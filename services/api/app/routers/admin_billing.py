"""Platform admin endpoints for plans, subscriptions, reservations, plan applications and
free-quota settings (rebuild-plans-metering); admin session only."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminContext, get_admin, get_db, require_csrf_header
from app.schemas.billing import PlanOut, PlanUpdateIn
from app.schemas.loose import ensure_text
from app.services import plan_service

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
