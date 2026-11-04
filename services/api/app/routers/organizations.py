"""Customer endpoints for organizations (rebuild-tenant-rbac). Management endpoints take
the organization ID in the path and resolve it through the tenant access rule."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_principal, require_csrf_header, require_registered_user
from app.permissions import Permission
from app.schemas.loose import ensure_text
from app.schemas.organization import ApplicationOut, OrganizationOut, OrganizationProfileIn
from app.services import organization_service, tenant_access
from app.services.organization_service import Actor
from app.services.session_service import Principal
from app.services.tenant_access import TenantContext

router = APIRouter(
    prefix="/api/v1", tags=["organizations"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Registered = Annotated[Principal, Depends(require_registered_user)]


@router.post(
    "/organization-applications",
    operation_id="applyForOrganization",
    status_code=201,
    response_model=ApplicationOut,
)
async def apply_for_organization(
    req: OrganizationProfileIn, db: Db, principal: Registered
) -> ApplicationOut:
    ensure_text(req)
    application = await organization_service.apply(
        db,
        principal.user_id,
        req.name,
        req.contact_phone,
        req.address,  # type: ignore[arg-type]
    )
    return ApplicationOut.model_validate(application, from_attributes=True)


@router.get(
    "/me/organization-applications",
    operation_id="listMyOrganizationApplications",
    response_model=list[ApplicationOut],
)
async def list_my_applications(db: Db, principal: Registered) -> list[ApplicationOut]:
    found = await organization_service.my_applications(db, principal.user_id)  # type: ignore[arg-type]
    return [ApplicationOut.model_validate(a, from_attributes=True) for a in found]


async def org_context(
    tenant_id: int, db: Db, principal: Annotated[Principal, Depends(get_principal)]
) -> TenantContext:
    """The caller's context in organization {tenant_id}; 404 unless it is an organization
    the caller can use (FR-SYS-017)."""
    ctx = await tenant_access.resolve_tenant(db, principal, tenant_id)
    if ctx.kind != "organization":
        raise tenant_access.not_found()
    return ctx


Org = Annotated[TenantContext, Depends(org_context)]


def require_manager(ctx: TenantContext) -> None:
    """Owner, or a member with 成员管理 (FR-SYS-023)."""
    if not ctx.is_owner:
        tenant_access.require(ctx, Permission.MEMBER_MANAGE)


@router.get(
    "/organizations/{tenant_id}", operation_id="getOrganization", response_model=OrganizationOut
)
async def get_organization(ctx: Org, db: Db) -> OrganizationOut:
    return OrganizationOut(**await organization_service.organization_view(db, ctx.tenant_id))


@router.patch(
    "/organizations/{tenant_id}", operation_id="updateOrganization", response_model=OrganizationOut
)
async def update_organization(req: OrganizationProfileIn, ctx: Org, db: Db) -> OrganizationOut:
    ensure_text(req)
    require_manager(ctx)
    await organization_service.update_profile(
        db,
        ctx.tenant_id,
        Actor("user", ctx.user_id),
        req.name,
        req.contact_phone,
        req.address,  # type: ignore[arg-type]
    )
    return OrganizationOut(**await organization_service.organization_view(db, ctx.tenant_id))
