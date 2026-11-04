"""Platform admin endpoints for organizations (FR-SYS-022); admin session only."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminContext, get_admin, get_db, require_csrf_header
from app.schemas.loose import ensure_text
from app.schemas.organization import AcceptedOut, AdminApplicationOut, RejectIn
from app.services import organization_service

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]


@router.get(
    "/organization-applications",
    operation_id="adminListOrganizationApplications",
    response_model=list[AdminApplicationOut],
)
async def list_applications(
    db: Db, admin: Admin, status: Literal["pending", "approved", "rejected"] | None = None
) -> list[AdminApplicationOut]:
    found = await organization_service.list_applications(db, status)
    return [AdminApplicationOut.model_validate(a, from_attributes=True) for a in found]


@router.post(
    "/organization-applications/{application_id}/approve",
    operation_id="adminApproveOrganization",
    response_model=AcceptedOut,
)
async def approve(application_id: int, db: Db, admin: Admin) -> AcceptedOut:
    tenant_id = await organization_service.approve(db, admin.account.id, application_id)
    return AcceptedOut(tenant_id=tenant_id)


@router.post(
    "/organization-applications/{application_id}/reject",
    operation_id="adminRejectOrganization",
    status_code=200,
)
async def reject(application_id: int, db: Db, admin: Admin, req: RejectIn | None = None) -> dict:
    req = req or RejectIn()
    ensure_text(req)
    await organization_service.reject(db, admin.account.id, application_id, req.reason)
    return {"status": "rejected"}
