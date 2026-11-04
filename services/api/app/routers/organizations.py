"""Customer endpoints for organizations (rebuild-tenant-rbac). Management endpoints take
the organization ID in the path and resolve it through the tenant access rule."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_principal, require_csrf_header, require_registered_user
from app.permissions import Permission
from app.schemas.loose import ensure_text
from app.schemas.organization import (
    AcceptedOut,
    AcceptIn,
    ApplicationOut,
    AssignRoleIn,
    InvitationCreatedOut,
    InvitationOut,
    OrganizationOut,
    OrganizationProfileIn,
    RoleCreateIn,
    RoleOut,
)
from app.services import membership_service, organization_service, role_service, tenant_access
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


def _role_out(role) -> RoleOut:
    return RoleOut(
        id=role.id, name=role.name, permissions=sorted(role.permissions), is_default=role.is_default
    )


@router.get(
    "/organizations/{tenant_id}/roles", operation_id="listRoles", response_model=list[RoleOut]
)
async def list_roles(ctx: Org, db: Db) -> list[RoleOut]:
    return [_role_out(r) for r in await role_service.list_roles(db, ctx)]


@router.post(
    "/organizations/{tenant_id}/roles",
    operation_id="createRole",
    status_code=201,
    response_model=RoleOut,
)
async def create_role(req: RoleCreateIn, ctx: Org, db: Db) -> RoleOut:
    ensure_text(req)
    return _role_out(await role_service.create_role(db, ctx, req.name, req.permissions))


@router.patch(
    "/organizations/{tenant_id}/roles/{role_id}", operation_id="updateRole", response_model=RoleOut
)
async def update_role(role_id: int, req: RoleCreateIn, ctx: Org, db: Db) -> RoleOut:
    ensure_text(req)
    return _role_out(await role_service.update_role(db, ctx, role_id, req.name, req.permissions))


@router.delete(
    "/organizations/{tenant_id}/roles/{role_id}", operation_id="deleteRole", status_code=204
)
async def delete_role(role_id: int, ctx: Org, db: Db) -> Response:
    await role_service.delete_role(db, ctx, role_id)
    return Response(status_code=204)


@router.put("/organizations/{tenant_id}/members/{user_id}/role", operation_id="assignRole")
async def assign_role(user_id: int, req: AssignRoleIn, ctx: Org, db: Db) -> dict:
    ensure_text(req)
    if req.role_id is None:
        raise organization_service.fields_error(["role_id"])
    await role_service.assign_role(db, ctx, user_id, req.role_id)
    return {"user_id": user_id, "role_id": req.role_id}


async def path_tenant(
    tenant_id: int, db: Db, principal: Annotated[Principal, Depends(get_principal)]
) -> TenantContext:
    """Like org_context, but lets a personal tenant through so the service can say why it
    is not allowed (400) instead of 404."""
    return await tenant_access.resolve_tenant(db, principal, tenant_id)


AnyTenant = Annotated[TenantContext, Depends(path_tenant)]


@router.post(
    "/organizations/{tenant_id}/invitations",
    operation_id="createInvitation",
    status_code=201,
    response_model=InvitationCreatedOut,
)
async def create_invitation(ctx: AnyTenant, db: Db) -> InvitationCreatedOut:
    invitation, token = await membership_service.create_invitation(db, ctx)
    return InvitationCreatedOut(
        id=invitation.id,
        created_at=invitation.created_at,
        expires_at=invitation.expires_at,
        token=token,
    )


@router.get(
    "/organizations/{tenant_id}/invitations",
    operation_id="listInvitations",
    response_model=list[InvitationOut],
)
async def list_invitations(ctx: Org, db: Db) -> list[InvitationOut]:
    found = await membership_service.list_open_invitations(db, ctx)
    return [InvitationOut.model_validate(i, from_attributes=True) for i in found]


@router.delete(
    "/organizations/{tenant_id}/invitations/{invitation_id}",
    operation_id="revokeInvitation",
    status_code=204,
)
async def revoke_invitation(invitation_id: int, ctx: Org, db: Db) -> Response:
    await membership_service.revoke_invitation(db, ctx, invitation_id)
    return Response(status_code=204)


@router.post("/invitations/accept", operation_id="acceptInvitation", response_model=AcceptedOut)
async def accept_invitation(req: AcceptIn, db: Db, principal: Registered) -> AcceptedOut:
    ensure_text(req)
    tenant_id = await membership_service.accept(db, principal.user_id, req.token)  # type: ignore[arg-type]
    return AcceptedOut(tenant_id=tenant_id)
