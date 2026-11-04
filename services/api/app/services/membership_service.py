"""Members: invitations and the member limit (FR-SYS-024/025), removal, leaving and
owner transfer (FR-SYS-026/029). Every change that can affect seats or the owner locks
the organization row first, so concurrent requests are serialised per organization."""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import Invitation, Membership, Organization
from app.permissions import Permission
from app.services import settings_service
from app.services.audit_service import record
from app.services.organization_service import Actor, fields_error
from app.services.role_service import default_role_id
from app.services.tenant_access import TenantContext, not_found, require

INVITATION_TTL = timedelta(days=7)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def _gone() -> AppError:
    return AppError(410, "invitation_gone", "invitation.gone")


def _limit_reached() -> AppError:
    return AppError(409, "member_limit_reached", "organization.member_limit_reached")


async def _lock_organization(db: AsyncSession, tenant_id: int) -> Organization:
    org = await db.get(Organization, tenant_id, with_for_update=True, populate_existing=True)
    if org is None:
        raise not_found()
    return org


async def member_limit(db: AsyncSession, tenant_id: int) -> int | None:
    """Seats allowed (None = unlimited). B-2c extends this with plan-based limits; until a
    plan is active the admin-configured unpaid limit applies (D8)."""
    return await settings_service.get_int(db, settings_service.ORG_MEMBER_LIMIT_UNPAID, 2)


def _open(now: datetime):
    return (
        Invitation.accepted_at.is_(None),
        Invitation.revoked_at.is_(None),
        Invitation.expires_at > now,
    )


async def seats_used(
    db: AsyncSession, tenant_id: int, now: datetime, exclude_invitation: int | None = None
) -> int:
    members = (
        await db.execute(
            select(func.count())
            .select_from(Membership)
            .where(Membership.tenant_id == tenant_id, Membership.removed_at.is_(None))
        )
    ).scalar_one()
    q = (
        select(func.count())
        .select_from(Invitation)
        .where(Invitation.tenant_id == tenant_id, *_open(now))
    )
    if exclude_invitation is not None:
        q = q.where(Invitation.id != exclude_invitation)
    return members + (await db.execute(q)).scalar_one()


async def _has_seat(
    db: AsyncSession, tenant_id: int, now: datetime, exclude: int | None = None
) -> bool:
    limit = await member_limit(db, tenant_id)
    return limit is None or await seats_used(db, tenant_id, now, exclude) < limit


def _require_org(ctx: TenantContext) -> None:
    if ctx.kind != "organization":  # personal tenants cannot invite (AC-FR-SYS-024-06)
        raise fields_error(["tenant"])


async def create_invitation(db: AsyncSession, ctx: TenantContext) -> tuple[Invitation, str]:
    _require_org(ctx)
    require(ctx, Permission.MEMBER_MANAGE)
    org = await _lock_organization(db, ctx.tenant_id)
    if org.status != "active":
        raise not_found()
    now = utcnow()
    if not await _has_seat(db, ctx.tenant_id, now):
        raise _limit_reached()
    token = secrets.token_urlsafe(32)
    invitation = Invitation(
        tenant_id=ctx.tenant_id,
        token_hash=hash_token(token),
        created_by_user_id=ctx.user_id,
        created_at=now,
        expires_at=now + INVITATION_TTL,
    )
    db.add(invitation)
    await db.flush()
    await record(
        db, Actor("user", ctx.user_id).event("invitation.create", "invitation", invitation.id)
    )  # type: ignore[arg-type]
    await db.commit()
    await db.refresh(invitation)
    return invitation, token


async def list_open_invitations(db: AsyncSession, ctx: TenantContext) -> list[Invitation]:
    _require_org(ctx)
    require(ctx, Permission.MEMBER_MANAGE)
    return list(
        (
            await db.execute(
                select(Invitation)
                .where(Invitation.tenant_id == ctx.tenant_id, *_open(utcnow()))
                .order_by(Invitation.id)
            )
        ).scalars()
    )


async def revoke_invitation(db: AsyncSession, ctx: TenantContext, invitation_id: int) -> None:
    _require_org(ctx)
    require(ctx, Permission.MEMBER_MANAGE)
    invitation = await db.get(Invitation, invitation_id, with_for_update=True)
    if invitation is None or invitation.tenant_id != ctx.tenant_id:
        raise not_found()
    if invitation.accepted_at is not None or invitation.revoked_at is not None:
        raise _gone()
    invitation.revoked_at = utcnow()
    await record(
        db, Actor("user", ctx.user_id).event("invitation.revoke", "invitation", invitation_id)
    )  # type: ignore[arg-type]
    await db.commit()


async def accept(db: AsyncSession, user_id: int, token: str | None) -> int:
    if not token:
        raise fields_error(["token"])
    tenant_id = (
        await db.execute(
            select(Invitation.tenant_id).where(Invitation.token_hash == hash_token(token))
        )
    ).scalar_one_or_none()
    if tenant_id is None:
        raise _gone()
    org = await _lock_organization(db, tenant_id)
    invitation = (
        await db.execute(
            select(Invitation)
            .where(Invitation.token_hash == hash_token(token))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    now = utcnow()
    if (
        org.status != "active"
        or invitation.accepted_at is not None
        or invitation.revoked_at is not None
        or invitation.expires_at <= now
    ):
        raise _gone()
    existing = (
        await db.execute(
            select(Membership.id).where(
                Membership.tenant_id == tenant_id,
                Membership.user_id == user_id,
                Membership.removed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(409, "already_member", "organization.already_member")
    if not await _has_seat(db, tenant_id, now, exclude=invitation.id):
        raise _limit_reached()
    db.add(
        Membership(
            tenant_id=tenant_id, user_id=user_id, role_id=await default_role_id(db, tenant_id)
        )
    )
    invitation.accepted_by_user_id, invitation.accepted_at = user_id, now
    await record(db, Actor("user", user_id).event("invitation.accept", "invitation", invitation.id))
    await db.commit()
    return tenant_id


def _owner_protected() -> AppError:
    return AppError(409, "owner_protected", "organization.owner_protected")


async def _active_member(db: AsyncSession, tenant_id: int, user_id: int) -> Membership | None:
    return (
        await db.execute(
            select(Membership)
            .where(
                Membership.tenant_id == tenant_id,
                Membership.user_id == user_id,
                Membership.removed_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def remove_member(db: AsyncSession, ctx: TenantContext, user_id: int) -> None:
    require(ctx, Permission.MEMBER_MANAGE)
    await _lock_organization(db, ctx.tenant_id)
    membership = await _active_member(db, ctx.tenant_id, user_id)
    if membership is None:
        raise not_found()
    if membership.is_owner:
        raise _owner_protected()
    membership.removed_at = utcnow()
    await record(db, Actor("user", ctx.user_id).event("member.remove", "membership", membership.id))  # type: ignore[arg-type]
    await db.commit()


async def leave(db: AsyncSession, ctx: TenantContext) -> None:
    if ctx.is_owner:
        raise _owner_protected()
    await _lock_organization(db, ctx.tenant_id)
    membership = await _active_member(db, ctx.tenant_id, ctx.user_id)  # type: ignore[arg-type]
    if membership is None:
        raise not_found()
    if membership.is_owner:  # re-checked under the lock: a transfer may have just made us owner
        raise _owner_protected()
    membership.removed_at = utcnow()
    await record(db, Actor("user", ctx.user_id).event("member.leave", "membership", membership.id))  # type: ignore[arg-type]
    await db.commit()


async def transfer_owner(db: AsyncSession, ctx: TenantContext, user_id: int | None) -> None:
    """FR-SYS-029: one step; the old owner becomes a member with the default role (A9)."""
    if not ctx.is_owner:
        raise AppError(403, "permission_denied", "error.permission_denied")
    await _lock_organization(db, ctx.tenant_id)
    current = await _active_member(db, ctx.tenant_id, ctx.user_id)  # type: ignore[arg-type]
    if current is None or not current.is_owner:  # lost a race with another transfer
        raise AppError(403, "permission_denied", "error.permission_denied")
    target = None if user_id is None else await _active_member(db, ctx.tenant_id, user_id)
    if target is None or target.user_id == ctx.user_id:
        raise fields_error(["user_id"])
    current.is_owner, current.role_id = False, await default_role_id(db, ctx.tenant_id)
    await db.flush()  # the old owner first, so the one-owner index holds
    target.is_owner, target.role_id = True, None
    await record(
        db, Actor("user", ctx.user_id).event("org.owner_transfer", "organization", ctx.tenant_id)
    )  # type: ignore[arg-type]
    await db.commit()


async def list_members(db: AsyncSession, ctx: TenantContext) -> list[dict]:
    from app.models import Role, User

    rows = (
        await db.execute(
            select(Membership, User.display_name, Role)
            .join(User, User.id == Membership.user_id)
            .outerjoin(Role, Role.id == Membership.role_id)
            .where(Membership.tenant_id == ctx.tenant_id, Membership.removed_at.is_(None))
            .order_by(Membership.id)
        )
    ).all()
    return [
        {
            "user_id": m.user_id,
            "display_name": name,
            "is_owner": m.is_owner,
            "role": None if role is None else {"id": role.id, "name": role.name},
            "joined_at": m.joined_at,
        }
        for m, name, role in rows
    ]
