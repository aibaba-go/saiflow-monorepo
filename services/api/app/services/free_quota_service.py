"""Free quotas (FR-SYS-031): one grant per tenant. Personal: at registration, no expiry,
paused while the tenant has no active subscription. Organization: at approval, valid one
calendar month. Guests get none."""

from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing_time import add_months
from app.models import FreeQuota
from app.services import settings_service
from app.services.audit_service import AuditEvent, record

FREE_QUOTA_PERSONAL = "free_quota_personal"
FREE_QUOTA_ORGANIZATION = "free_quota_organization"


async def _grant(db: AsyncSession, tenant_id: int, amount: int, expires_at, now) -> None:
    inserted = (
        await db.execute(
            insert(FreeQuota)
            .values(
                tenant_id=tenant_id,
                granted=amount,
                remaining=amount,
                expires_at=expires_at,
                granted_at=now,
            )
            .on_conflict_do_nothing(index_elements=[FreeQuota.tenant_id])
            .returning(FreeQuota.tenant_id)
        )
    ).scalar_one_or_none()
    if inserted is not None:  # each tenant is granted once (AC-FR-SYS-031-02)
        await record(
            db, AuditEvent("system", None, "free_quota.grant", "tenant", str(tenant_id), "success")
        )


async def grant_personal(db: AsyncSession, tenant_id: int, now: datetime) -> None:
    amount = await settings_service.get_int(db, FREE_QUOTA_PERSONAL, 100)
    await _grant(db, tenant_id, amount, None, now)


async def grant_organization(db: AsyncSession, tenant_id: int, now: datetime) -> None:
    amount = await settings_service.get_int(db, FREE_QUOTA_ORGANIZATION, 100)
    await _grant(db, tenant_id, amount, add_months(now, 1), now)


def usable(row: FreeQuota | None, tenant_kind: str, active: bool, now: datetime) -> int:
    """Free scans that may be spent right now."""
    if row is None or tenant_kind == "guest":
        return 0
    if tenant_kind == "organization":
        return row.remaining if row.expires_at is None or row.expires_at > now else 0
    return row.remaining if active else 0  # personal: paused while expired


def in_period(row: FreeQuota | None, tenant_kind: str, now: datetime) -> bool:
    """An organization's free scans are still inside their month (even if all are used)."""
    return tenant_kind == "organization" and row is not None and not is_expired(row, now)


def is_expired(row: FreeQuota, now: datetime) -> bool:
    return row.expires_at is not None and row.expires_at <= now
