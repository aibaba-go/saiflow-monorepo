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


def _fields_error(fields: list[str]) -> AppError:
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
        raise _fields_error(bad)
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
    """Hook for B-2c: grant the organization's one-time free quota here (D5)."""


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
        raise _fields_error(["reason"])
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
