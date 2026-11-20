"""Organizations: applications and approval (FR-SYS-021), admin management (FR-SYS-022),
profile edits (FR-SYS-023)."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import Membership, Organization, OrganizationApplication, Role, Tenant
from app.permissions import DEFAULT_ROLE
from app.services.audit_service import AuditEvent, record
from app.services.user_service import normalize_phone

NAME_MAX = 128
ADDRESS_MAX = 512
DEFAULT_ROLE_NAME = "Member"


@dataclass(frozen=True)
class Actor:
    """Who is acting, for the operation log."""

    type: Literal["user", "admin"]
    id: int

    def event(self, action: str, target_type: str, target_id: object) -> AuditEvent:
        return AuditEvent(self.type, str(self.id), action, target_type, str(target_id), "success")


def fields_error(fields: list[str]) -> AppError:
    return AppError(400, "validation_error", "error.validation", fields)


def check_profile(
    name: str | None, contact_phone: str | None, address: str | None, *, partial: bool = False
) -> dict[str, str | None]:
    """Validated profile values (A2). With partial=True only the given fields are checked
    and returned; required fields still cannot be cleared."""
    out: dict[str, str | None] = {}
    bad: list[str] = []
    if not partial or name is not None:
        clean = (name or "").strip()
        if 1 <= len(clean) <= NAME_MAX:
            out["name"] = clean
        else:
            bad.append("name")
    if not partial or contact_phone is not None:
        try:
            phone = normalize_phone(contact_phone)
        except AppError:
            phone = None
        if phone:
            out["contact_phone"] = phone
        else:
            bad.append("contact_phone")
    if not partial or address is not None:
        clean_addr = (address or "").strip()
        if len(clean_addr) <= ADDRESS_MAX:
            out["address"] = clean_addr or None
        else:
            bad.append("address")
    if bad:
        raise fields_error(bad)
    return out


async def apply(
    db: AsyncSession, user_id: int, name: str | None, contact_phone: str | None, address: str | None
) -> OrganizationApplication:
    profile = check_profile(name, contact_phone, address)
    application = OrganizationApplication(applicant_user_id=user_id, **profile)
    db.add(application)
    try:
        await db.flush()
    except IntegrityError:  # the partial unique index: one pending application per user
        await db.rollback()
        raise AppError(409, "application_pending", "organization.application_pending") from None
    await record(
        db, Actor("user", user_id).event("org.apply", "organization_application", application.id)
    )
    await db.commit()
    await db.refresh(application)
    return application


async def my_applications(db: AsyncSession, user_id: int) -> list[OrganizationApplication]:
    return list(
        (
            await db.execute(
                select(OrganizationApplication)
                .where(OrganizationApplication.applicant_user_id == user_id)
                .order_by(OrganizationApplication.id.desc())
            )
        ).scalars()
    )


async def list_applications(db: AsyncSession, status: str | None) -> list[OrganizationApplication]:
    q = select(OrganizationApplication).order_by(OrganizationApplication.id)
    if status is not None:
        q = q.where(OrganizationApplication.status == status)
    return list((await db.execute(q)).scalars())


async def _pending_for_update(db: AsyncSession, application_id: int) -> OrganizationApplication:
    application = await db.get(
        OrganizationApplication, application_id, with_for_update=True, populate_existing=True
    )
    if application is None:
        raise AppError(404, "not_found", "error.not_found")
    if application.status != "pending":
        raise AppError(409, "already_decided", "organization.already_decided")
    return application


async def on_organization_created(db: AsyncSession, tenant_id: int) -> None:
    """The organization's one-time free quota, valid one month (FR-SYS-031)."""
    from app.services import free_quota_service  # here: it imports this module

    await free_quota_service.grant_organization(db, tenant_id, utcnow())


async def approve(db: AsyncSession, admin_id: int, application_id: int) -> int:
    application = await _pending_for_update(db, application_id)
    tenant = Tenant(kind="organization")
    db.add(tenant)
    await db.flush()
    db.add(
        Organization(
            tenant_id=tenant.id,
            name=application.name,
            contact_phone=application.contact_phone,
            address=application.address,
        )
    )
    role = Role(
        tenant_id=tenant.id,
        name=DEFAULT_ROLE_NAME,
        permissions=sorted(DEFAULT_ROLE),
        is_default=True,
    )
    db.add(role)
    db.add(Membership(tenant_id=tenant.id, user_id=application.applicant_user_id, is_owner=True))
    application.status, application.tenant_id = "approved", tenant.id
    application.decided_by_admin_id, application.decided_at = admin_id, utcnow()
    await on_organization_created(db, tenant.id)
    await record(db, Actor("admin", admin_id).event("org.approve", "organization", tenant.id))
    await db.commit()
    return tenant.id


async def reject(db: AsyncSession, admin_id: int, application_id: int, reason: str | None) -> None:
    clean = (reason or "").strip()
    if not clean:
        raise fields_error(["reason"])
    application = await _pending_for_update(db, application_id)
    application.status, application.reject_reason = "rejected", clean
    application.decided_by_admin_id, application.decided_at = admin_id, utcnow()
    await record(
        db, Actor("admin", admin_id).event("org.reject", "organization_application", application_id)
    )
    await db.commit()


async def member_count(db: AsyncSession, tenant_id: int) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Membership)
            .where(Membership.tenant_id == tenant_id, Membership.removed_at.is_(None))
        )
    ).scalar_one()


async def _organization(db: AsyncSession, tenant_id: int, *, lock: bool = False) -> Organization:
    org = await db.get(Organization, tenant_id, with_for_update=lock, populate_existing=lock)
    if org is None:
        raise AppError(404, "not_found", "error.not_found")
    return org


async def organization_view(db: AsyncSession, tenant_id: int) -> dict:
    org = await _organization(db, tenant_id)
    return {
        "tenant_id": org.tenant_id,
        "name": org.name,
        "contact_phone": org.contact_phone,
        "address": org.address,
        "status": org.status,
        "verification_status": org.verification_status,
        "member_count": await member_count(db, tenant_id),
        "created_at": org.created_at,
    }


async def list_organizations(db: AsyncSession) -> list[dict]:
    ids = (
        await db.execute(select(Organization.tenant_id).order_by(Organization.tenant_id))
    ).scalars()
    return [await organization_view(db, tid) for tid in list(ids)]


async def update_profile(
    db: AsyncSession,
    tenant_id: int,
    actor: Actor,
    name: str | None,
    contact_phone: str | None,
    address: str | None,
    ctx=None,
) -> None:
    """Change any of name, contact phone and address (FR-SYS-022/023); no re-approval.
    With a customer `ctx`, the caller must still be owner or 成员管理 once the organization
    is locked (N2). A request that changes nothing writes no audit row (N6)."""
    from app.permissions import Permission
    from app.services.tenant_access import refresh, require

    changes = check_profile(name, contact_phone, address, partial=True)
    org = await _organization(db, tenant_id, lock=True)
    if ctx is not None:
        fresh = await refresh(db, ctx)
        if not fresh.is_owner:
            require(fresh, Permission.MEMBER_MANAGE)
    changed = {k: v for k, v in changes.items() if getattr(org, k) != v}
    if not changed:
        await db.commit()
        return
    for key, value in changed.items():
        setattr(org, key, value)
    await record(db, actor.event("org.update", "organization", tenant_id))
    await db.commit()


async def set_status(
    db: AsyncSession, admin_id: int, tenant_id: int, status: Literal["active", "disabled"]
) -> None:
    org = await _organization(db, tenant_id, lock=True)
    org.status = status
    action = "org.enable" if status == "active" else "org.disable"
    await record(db, Actor("admin", admin_id).event(action, "organization", tenant_id))
    await db.commit()
