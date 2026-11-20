"""The tenant access rule (FR-SYS-017): which tenant a request acts on, what the caller
may do there, and which of its data the caller may see. Every business module (B-3
onwards) goes through `get_tenant_context` → `require` → `submitter_scope`."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import Membership, Organization, Role, Tenant
from app.permissions import ALL, Permission
from app.services.session_service import Principal


@dataclass(frozen=True)
class TenantContext:
    tenant_id: int
    kind: Literal["personal", "guest", "organization"]
    user_id: int | None
    is_owner: bool
    role_id: int | None
    permissions: frozenset[Permission]

    def has(self, p: Permission) -> bool:
        return p in self.permissions


def not_found() -> AppError:
    return AppError(404, "not_found", "error.not_found")


async def resolve_tenant(
    db: AsyncSession, principal: Principal, tenant_id: int | None
) -> TenantContext:
    """The context for `tenant_id` (None = the caller's own tenant). Anything the caller
    cannot use is 404, whatever the reason (A8)."""
    if tenant_id is None or tenant_id == principal.tenant_id:
        kind = "guest" if principal.kind == "guest" else "personal"
        return TenantContext(principal.tenant_id, kind, principal.user_id, True, None, ALL)
    if principal.user_id is None:  # guests use only their own tenant
        raise not_found()
    row = (
        await db.execute(
            select(Membership, Role.permissions)
            .join(Tenant, Tenant.id == Membership.tenant_id)
            .join(Organization, Organization.tenant_id == Membership.tenant_id)
            .outerjoin(Role, Role.id == Membership.role_id)
            .where(
                Membership.tenant_id == tenant_id,
                Membership.user_id == principal.user_id,
                Membership.removed_at.is_(None),
                Tenant.kind == "organization",
                Organization.status == "active",
            )
            .execution_options(populate_existing=True)  # see ownership changes (N2)
        )
    ).one_or_none()
    if row is None:
        raise not_found()
    membership, codes = row
    if membership.is_owner:
        perms = ALL
    else:
        perms = frozenset(Permission(c) for c in codes or [] if c in Permission._value2member_map_)
    return TenantContext(
        tenant_id, "organization", principal.user_id, membership.is_owner, membership.role_id, perms
    )


async def refresh(db: AsyncSession, ctx: TenantContext) -> TenantContext:
    """Re-read the caller's membership and role, e.g. after taking the organization lock,
    so a change committed meanwhile (removal, demotion) is seen (N2)."""
    if ctx.kind != "organization":
        return ctx
    return await resolve_tenant(db, Principal("user", 0, -1, ctx.user_id), ctx.tenant_id)


def require(ctx: TenantContext, p: Permission) -> None:
    if not ctx.has(p):
        raise AppError(403, "permission_denied", "error.permission_denied")


def submitter_scope(ctx: TenantContext) -> int | None:
    """None = the caller sees all of the tenant's data; otherwise only rows submitted by
    this user ID (members without 数据浏览, FR-SYS-017)."""
    return None if ctx.has(Permission.DATA_BROWSE) else ctx.user_id


@dataclass(frozen=True)
class UsableTenant:
    tenant_id: int
    kind: str
    name: str | None
    is_owner: bool
    role: dict | None
    permissions: list[str]


async def usable_tenants(db: AsyncSession, user_id: int) -> list[UsableTenant]:
    personal = (
        await db.execute(
            select(Tenant.id).where(Tenant.kind == "personal", Tenant.owner_user_id == user_id)
        )
    ).scalar_one()
    out = [UsableTenant(personal, "personal", None, True, None, sorted(ALL))]
    rows = (
        await db.execute(
            select(Membership, Organization.name, Role)
            .join(Organization, Organization.tenant_id == Membership.tenant_id)
            .outerjoin(Role, Role.id == Membership.role_id)
            .where(
                Membership.user_id == user_id,
                Membership.removed_at.is_(None),
                Organization.status == "active",
            )
            .order_by(Membership.tenant_id)
        )
    ).all()
    for membership, name, role in rows:
        if membership.is_owner:
            out.append(
                UsableTenant(membership.tenant_id, "organization", name, True, None, sorted(ALL))
            )
        else:
            out.append(
                UsableTenant(
                    membership.tenant_id,
                    "organization",
                    name,
                    False,
                    {"id": role.id, "name": role.name},
                    sorted(role.permissions),
                )
            )
    return out
