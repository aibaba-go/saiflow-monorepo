from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.db import Base
from app.errors import AppError
from app.models import (
    CustomerSession,
    EmailCode,
    FreeQuota,
    ImpersonationTicket,
    Subscription,
    Tenant,
    User,
)
from app.models.report import HomepagePreference
from app.repositories import tenant_repo, user_repo
from app.schemas.admin_query import AdminUserOut
from app.services import (
    email_code_service,
    free_quota_service,
    password_service,
    subscription_service,
    user_service,
)
from app.services.audit_service import AuditEvent, record


async def create(
    db: AsyncSession,
    admin_id: int,
    email: str | None,
    display_name: str | None,
    phone: str | None,
    password: str | None,
) -> AdminUserOut:
    clean_email, name, number, secret = user_service._collect(
        lambda: email_code_service.normalize_email(email),
        lambda: user_service.normalize_display_name(display_name),
        lambda: user_service.normalize_phone(phone),
        lambda: password_service.validate_password(password),
    )
    existing = (
        await db.execute(select(User.id).where(User.email == clean_email))
    ).scalar_one_or_none()
    if existing is not None:
        raise AppError(409, "email_taken", "error.email_taken", ["email"])
    password_hash = await password_service.hash_password(secret)
    now = utcnow()
    try:
        user = await user_repo.create(
            db,
            None,
            email=clean_email,
            display_name=name,
            phone=number,
            password_hash=password_hash,
            registered_at=now,
        )
        tenant = await tenant_repo.create(db, "personal", user.id)
        await subscription_service.start_default(db, tenant.id, now)
        await free_quota_service.grant_personal(db, tenant.id, now)
        await record(
            db,
            AuditEvent(
                "admin", str(admin_id), "admin.user.create", "user", str(user.id), "success"
            ),
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "email_taken", "error.email_taken", ["email"]) from None
    return AdminUserOut(
        user_id=user.id,
        display_name=user.display_name,
        email=user.email,
        phone=user.phone,
        registered=True,
        registered_at=user.registered_at,
        created_at=user.created_at,
        personal_tenant_id=tenant.id,
        line_linked=False,
    )


async def _locked(db: AsyncSession, user_id: int) -> tuple[User, Tenant]:
    user = (
        await db.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one_or_none()
    if user is None:
        raise AppError(404, "not_found", "error.not_found")
    tenant = (
        await db.execute(
            select(Tenant)
            .where(Tenant.owner_user_id == user_id, Tenant.kind == "personal")
            .with_for_update()
        )
    ).scalar_one()
    return user, tenant


_TECHNICAL = {
    "homepage_preferences",
    "impersonation_tickets",
    "email_codes",
    "customer_sessions",
    "free_quotas",
    "subscriptions",
}
_ORGANIZATION = {
    "memberships",
    "invitations",
    "organization_applications",
    "verification_applications",
    "organizations",
    "roles",
    "tenants",
}


async def remove(db: AsyncSession, admin_id: int, user_id: int) -> None:
    user, tenant = await _locked(db, user_id)
    if await db.scalar(
        select(Subscription.id)
        .where(Subscription.tenant_id == tenant.id, Subscription.source != "auto")
        .limit(1)
    ):
        raise AppError(409, "user_has_billing", "error.user_has_billing")
    if await db.scalar(
        select(FreeQuota.tenant_id)
        .where(FreeQuota.tenant_id == tenant.id, FreeQuota.remaining != FreeQuota.granted)
        .limit(1)
    ):
        raise AppError(409, "user_has_data", "error.user_has_data")
    # Fail closed for all referenced history; only the explicit technical allowlist is removed.
    for table in Base.metadata.tables.values():
        if table.name in _TECHNICAL or table.name == "users":
            continue
        conditions = []
        for fk in table.foreign_keys:
            if fk.column.table.name == "users":
                condition = fk.parent == user.id
                if table.name == "tenants":
                    condition = condition & (table.c.id != tenant.id)
                conditions.append(condition)
            elif fk.column.table.name == "tenants":
                conditions.append(fk.parent == tenant.id)
        if conditions and await db.scalar(
            select(1).select_from(table).where(or_(*conditions)).limit(1)
        ):
            code = "user_has_organization" if table.name in _ORGANIZATION else "user_has_data"
            raise AppError(409, code, f"error.{code}")
    try:
        for model, condition in (
            (HomepagePreference, HomepagePreference.user_id == user.id),
            (ImpersonationTicket, ImpersonationTicket.user_id == user.id),
            (EmailCode, EmailCode.user_id == user.id),
            (CustomerSession, CustomerSession.user_id == user.id),
            (FreeQuota, FreeQuota.tenant_id == tenant.id),
            (Subscription, Subscription.tenant_id == tenant.id),
            (Tenant, Tenant.id == tenant.id),
            (User, User.id == user.id),
        ):
            await db.execute(delete(model).where(condition))
        await record(
            db,
            AuditEvent(
                "admin", str(admin_id), "admin.user.delete", "user", str(user.id), "success"
            ),
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "user_has_data", "error.user_has_data") from None
