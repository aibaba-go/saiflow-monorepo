"""Customer billing endpoints (rebuild-plans-metering): usage of the current tenant."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_tenant_context, require_csrf_header
from app.schemas.billing import UsageOut
from app.services import metering_service
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
