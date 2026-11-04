"""Roles (FR-SYS-002): the default role, custom roles, assignment. One role per member;
the owner has no role and every permission point."""

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import permissions
from app.errors import AppError
from app.models import Membership, Role
from app.permissions import Permission
from app.services.audit_service import record
from app.services.organization_service import Actor
from app.services.tenant_access import TenantContext, not_found, require

NAME_MAX = 64


def _denied() -> AppError:
    return AppError(403, "permission_denied", "error.permission_denied")


def _check_name(name: str | None) -> str:
    clean = (name or "").strip()
    if not 1 <= len(clean) <= NAME_MAX:
        raise AppError(400, "validation_error", "error.validation", ["name"])
    return clean


def _check_permissions(codes: list[str] | None) -> list[str]:
    parsed = permissions.parse(codes or [])
    if parsed is None:
        raise AppError(400, "validation_error", "error.validation", ["permissions"])
    return sorted(parsed)


async def list_roles(db: AsyncSession, ctx: TenantContext) -> list[Role]:
    return list(
        (
            await db.execute(select(Role).where(Role.tenant_id == ctx.tenant_id).order_by(Role.id))
        ).scalars()
    )


async def _role(db: AsyncSession, ctx: TenantContext, role_id: int) -> Role:
    role = await db.get(Role, role_id)
    if role is None or role.tenant_id != ctx.tenant_id:
        raise not_found()
    return role


async def _commit_unique_name(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "role_name_taken", "role.name_taken") from None


async def create_role(
    db: AsyncSession, ctx: TenantContext, name: str | None, codes: list[str] | None
) -> Role:
    require(ctx, Permission.ROLE_MANAGE)
    role = Role(
        tenant_id=ctx.tenant_id, name=_check_name(name), permissions=_check_permissions(codes)
    )
    db.add(role)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "role_name_taken", "role.name_taken") from None
    await record(db, Actor("user", ctx.user_id).event("role.create", "role", role.id))  # type: ignore[arg-type]
    await _commit_unique_name(db)
    await db.refresh(role)
    return role


async def update_role(
    db: AsyncSession,
    ctx: TenantContext,
    role_id: int,
    name: str | None,
    codes: list[str] | None,
) -> Role:
    require(ctx, Permission.ROLE_MANAGE)
    if role_id == ctx.role_id:  # A5: no editing your own role
        raise _denied()
    role = await _role(db, ctx, role_id)
    if name is not None:
        role.name = _check_name(name)
    if codes is not None:
        role.permissions = _check_permissions(codes)
    await record(db, Actor("user", ctx.user_id).event("role.update", "role", role.id))  # type: ignore[arg-type]
    await _commit_unique_name(db)
    await db.refresh(role)
    return role


async def default_role_id(db: AsyncSession, tenant_id: int) -> int:
    return (
        await db.execute(select(Role.id).where(Role.tenant_id == tenant_id, Role.is_default))
    ).scalar_one()


async def delete_role(db: AsyncSession, ctx: TenantContext, role_id: int) -> None:
    require(ctx, Permission.ROLE_MANAGE)
    role = await _role(db, ctx, role_id)
    if role.is_default:
        raise AppError(409, "default_role_protected", "role.default_protected")
    if role_id == ctx.role_id:
        raise _denied()
    default = await default_role_id(db, ctx.tenant_id)
    await db.execute(  # A4: holders fall back to the default role
        update(Membership).where(Membership.role_id == role_id).values(role_id=default)
    )
    await db.delete(role)
    await record(db, Actor("user", ctx.user_id).event("role.delete", "role", role_id))  # type: ignore[arg-type]
    await db.commit()


async def active_membership(
    db: AsyncSession, tenant_id: int, user_id: int, *, lock: bool = False
) -> Membership:
    q = select(Membership).where(
        Membership.tenant_id == tenant_id,
        Membership.user_id == user_id,
        Membership.removed_at.is_(None),
    )
    if lock:
        q = q.with_for_update()
    membership = (await db.execute(q)).scalar_one_or_none()
    if membership is None:
        raise not_found()
    return membership


async def assign_role(db: AsyncSession, ctx: TenantContext, user_id: int, role_id: int) -> None:
    require(ctx, Permission.ROLE_MANAGE)
    if user_id == ctx.user_id:  # A5: not your own role
        raise _denied()
    membership = await active_membership(db, ctx.tenant_id, user_id, lock=True)
    if membership.is_owner:
        raise _denied()
    await _role(db, ctx, role_id)
    membership.role_id = role_id
    await record(
        db,
        Actor("user", ctx.user_id).event("member.role_assign", "membership", membership.id),  # type: ignore[arg-type]
    )
    await db.commit()
