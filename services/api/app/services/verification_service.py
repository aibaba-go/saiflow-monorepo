"""Enterprise verification of an organization (FR-SYS-027): owner or 企业认证申请 submits,
the platform admin approves, rejects or sets the status directly. It only marks the
organization; it unlocks nothing yet (D4, D14)."""

import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import Organization, VerificationApplication
from app.permissions import Permission
from app.services.audit_service import record
from app.services.organization_service import Actor, fields_error
from app.services.tenant_access import TenantContext, not_found, require

TAX_ID = re.compile(r"^[0-9]{13}$")
LEGAL_NAME_MAX = 255
ADDRESS_MAX = 512


def _check(legal_name: str | None, tax_id: str | None, address: str | None) -> dict[str, str]:
    out, bad = {}, []
    name = (legal_name or "").strip()
    if 1 <= len(name) <= LEGAL_NAME_MAX:
        out["legal_name"] = name
    else:
        bad.append("legal_name")
    tax = (tax_id or "").strip()
    if TAX_ID.match(tax):
        out["tax_id"] = tax
    else:
        bad.append("tax_id")
    addr = (address or "").strip()
    if 1 <= len(addr) <= ADDRESS_MAX:
        out["registered_address"] = addr
    else:
        bad.append("registered_address")
    if bad:
        raise fields_error(bad)
    return out


async def _organization(db: AsyncSession, tenant_id: int) -> Organization:
    org = await db.get(Organization, tenant_id, with_for_update=True, populate_existing=True)
    if org is None:
        raise not_found()
    return org


async def submit(
    db: AsyncSession,
    ctx: TenantContext,
    legal_name: str | None,
    tax_id: str | None,
    registered_address: str | None,
) -> VerificationApplication:
    if not ctx.is_owner:
        require(ctx, Permission.VERIFICATION_APPLY)
    data = _check(legal_name, tax_id, registered_address)
    org = await _organization(db, ctx.tenant_id)
    application = VerificationApplication(
        tenant_id=ctx.tenant_id, submitted_by_user_id=ctx.user_id, **data
    )
    db.add(application)
    try:
        await db.flush()
    except IntegrityError:  # one pending application per organization
        await db.rollback()
        raise AppError(409, "application_pending", "organization.application_pending") from None
    org.verification_status = "pending"
    await record(
        db,
        Actor("user", ctx.user_id).event("verification.submit", "organization", ctx.tenant_id),  # type: ignore[arg-type]
    )
    await db.commit()
    await db.refresh(application)
    return application


async def _pending(db: AsyncSession, application_id: int) -> VerificationApplication:
    application = await db.get(
        VerificationApplication, application_id, with_for_update=True, populate_existing=True
    )
    if application is None:
        raise not_found()
    if application.status != "pending":
        raise AppError(409, "already_decided", "organization.already_decided")
    return application


async def approve(db: AsyncSession, admin_id: int, application_id: int) -> None:
    application = await _pending(db, application_id)
    org = await _organization(db, application.tenant_id)
    now = utcnow()
    application.status, application.decided_by_admin_id, application.decided_at = (
        "approved",
        admin_id,
        now,
    )
    org.legal_name, org.tax_id = application.legal_name, application.tax_id
    org.registered_address = application.registered_address
    org.verification_status, org.verified_at = "verified", now
    await record(
        db, Actor("admin", admin_id).event("verification.approve", "organization", org.tenant_id)
    )
    await db.commit()


async def reject(db: AsyncSession, admin_id: int, application_id: int, reason: str | None) -> None:
    clean = (reason or "").strip()
    if not clean:
        raise fields_error(["reason"])
    application = await _pending(db, application_id)
    org = await _organization(db, application.tenant_id)
    application.status, application.reject_reason = "rejected", clean
    application.decided_by_admin_id, application.decided_at = admin_id, utcnow()
    org.verification_status = "rejected"
    await record(
        db, Actor("admin", admin_id).event("verification.reject", "organization", org.tenant_id)
    )
    await db.commit()


async def set_verified(db: AsyncSession, admin_id: int, tenant_id: int, verified: bool) -> None:
    org = await _organization(db, tenant_id)
    org.verification_status = "verified" if verified else "none"
    org.verified_at = utcnow() if verified else None
    action = "verification.set" if verified else "verification.unset"
    await record(db, Actor("admin", admin_id).event(action, "organization", tenant_id))
    await db.commit()


async def status(db: AsyncSession, tenant_id: int) -> dict:
    org = await db.get(Organization, tenant_id)
    if org is None:
        raise not_found()
    reason = None
    if org.verification_status == "rejected":
        reason = (
            await db.execute(
                select(VerificationApplication.reject_reason)
                .where(
                    VerificationApplication.tenant_id == tenant_id,
                    VerificationApplication.status == "rejected",
                )
                .order_by(VerificationApplication.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    return {
        "status": org.verification_status,
        "legal_name": org.legal_name,
        "tax_id": org.tax_id,
        "registered_address": org.registered_address,
        "reject_reason": reason,
    }


async def list_applications(db: AsyncSession, state: str | None) -> list[VerificationApplication]:
    q = select(VerificationApplication).order_by(VerificationApplication.id)
    if state is not None:
        q = q.where(VerificationApplication.status == state)
    return list((await db.execute(q)).scalars())
