"""Platform admin endpoints for organizations (FR-SYS-022); admin session only."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminContext, get_admin, get_db, require_csrf_header
from app.schemas.loose import ensure_text
from app.schemas.organization import (
    AcceptedOut,
    AdminApplicationOut,
    AdminVerificationOut,
    IntSettingIn,
    IntSettingOut,
    OrganizationOut,
    OrganizationProfileIn,
    RejectIn,
    SetVerifiedIn,
)
from app.services import organization_service, settings_service, verification_service
from app.services.organization_service import Actor

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


@router.get(
    "/organizations", operation_id="adminListOrganizations", response_model=list[OrganizationOut]
)
async def list_organizations(db: Db, admin: Admin) -> list[OrganizationOut]:
    return [OrganizationOut(**o) for o in await organization_service.list_organizations(db)]


@router.get(
    "/organizations/{tenant_id}",
    operation_id="adminGetOrganization",
    response_model=OrganizationOut,
)
async def get_organization(tenant_id: int, db: Db, admin: Admin) -> OrganizationOut:
    return OrganizationOut(**await organization_service.organization_view(db, tenant_id))


@router.patch(
    "/organizations/{tenant_id}",
    operation_id="adminUpdateOrganization",
    response_model=OrganizationOut,
)
async def update_organization(
    tenant_id: int, req: OrganizationProfileIn, db: Db, admin: Admin
) -> OrganizationOut:
    ensure_text(req)
    await organization_service.update_profile(
        db, tenant_id, Actor("admin", admin.account.id), req.name, req.contact_phone, req.address
    )
    return OrganizationOut(**await organization_service.organization_view(db, tenant_id))


@router.post("/organizations/{tenant_id}/disable", operation_id="adminDisableOrganization")
async def disable_organization(tenant_id: int, db: Db, admin: Admin) -> dict:
    await organization_service.set_status(db, admin.account.id, tenant_id, "disabled")
    return {"status": "disabled"}


@router.post("/organizations/{tenant_id}/enable", operation_id="adminEnableOrganization")
async def enable_organization(tenant_id: int, db: Db, admin: Admin) -> dict:
    await organization_service.set_status(db, admin.account.id, tenant_id, "active")
    return {"status": "active"}


@router.get(
    "/settings/org-member-limit-unpaid",
    operation_id="adminGetOrgMemberLimit",
    response_model=IntSettingOut,
)
async def get_member_limit(db: Db, admin: Admin) -> IntSettingOut:
    key = settings_service.ORG_MEMBER_LIMIT_UNPAID
    return IntSettingOut(value=await settings_service.get_int(db, key, 2))


@router.put(
    "/settings/org-member-limit-unpaid",
    operation_id="adminSetOrgMemberLimit",
    response_model=IntSettingOut,
)
async def set_member_limit(req: IntSettingIn, db: Db, admin: Admin) -> IntSettingOut:
    key = settings_service.ORG_MEMBER_LIMIT_UNPAID
    await settings_service.set_int(db, key, req.value, admin.account.id)
    return IntSettingOut(value=req.value)


@router.get(
    "/verification-applications",
    operation_id="adminListVerificationApplications",
    response_model=list[AdminVerificationOut],
)
async def list_verification_applications(
    db: Db, admin: Admin, status: Literal["pending", "approved", "rejected"] | None = None
) -> list[AdminVerificationOut]:
    found = await verification_service.list_applications(db, status)
    return [AdminVerificationOut.model_validate(a, from_attributes=True) for a in found]


@router.post(
    "/verification-applications/{application_id}/approve",
    operation_id="adminApproveVerification",
)
async def approve_verification(application_id: int, db: Db, admin: Admin) -> dict:
    await verification_service.approve(db, admin.account.id, application_id)
    return {"status": "approved"}


@router.post(
    "/verification-applications/{application_id}/reject", operation_id="adminRejectVerification"
)
async def reject_verification(
    application_id: int, db: Db, admin: Admin, req: RejectIn | None = None
) -> dict:
    req = req or RejectIn()
    ensure_text(req)
    await verification_service.reject(db, admin.account.id, application_id, req.reason)
    return {"status": "rejected"}


@router.put("/organizations/{tenant_id}/verification", operation_id="adminSetVerification")
async def set_verification(tenant_id: int, req: SetVerifiedIn, db: Db, admin: Admin) -> dict:
    await verification_service.set_verified(db, admin.account.id, tenant_id, req.verified)
    return {"verified": req.verified}
