"""Plans, subscriptions, free quotas, scan reservations, plan applications
(rebuild-plans-metering, FR-SYS-030..034). None of these tables is tenant-scoped business
data, so guest claiming never moves them (A8)."""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

_TS = DateTime(timezone=True)


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (
        CheckConstraint("monthly_quota > 0", name="plans_quota_positive"),
        CheckConstraint("member_limit is null or member_limit > 0", name="plans_limit_positive"),
        CheckConstraint("tenant_kind in ('personal', 'organization')", name="plans_tenant_kind"),
        CheckConstraint("code <> 'kinder' or member_limit = 1", name="plans_kinder_one_member"),
    )

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    monthly_quota: Mapped[int] = mapped_column(Integer)
    member_limit: Mapped[int | None] = mapped_column(Integer)
    tenant_kind: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint("period in ('month', 'year')", name="subscriptions_period"),
        CheckConstraint("ends_at > starts_at", name="subscriptions_end_after_start"),
        CheckConstraint("source in ('auto', 'admin', 'application')", name="subscriptions_source"),
        Index("ix_subscriptions_tenant_start", "tenant_id", "starts_at"),
        Index("ix_subscriptions_plan", "plan_code"),
        Index("ix_subscriptions_application", "application_id"),
        Index("ix_subscriptions_admin", "set_by_admin_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    plan_code: Mapped[str] = mapped_column(Text, ForeignKey("plans.code"))
    period: Mapped[str] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(_TS)
    ends_at: Mapped[datetime] = mapped_column(_TS)
    source: Mapped[str] = mapped_column(Text)
    application_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("plan_applications.id", use_alter=True)
    )
    set_by_admin_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("admin_accounts.id"))
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class FreeQuota(Base):
    __tablename__ = "free_quotas"
    __table_args__ = (CheckConstraint("remaining >= 0", name="free_quotas_remaining"),)

    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"), primary_key=True)
    granted: Mapped[int] = mapped_column(Integer)
    remaining: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(_TS)
    granted_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class QuotaReservation(Base):
    __tablename__ = "quota_reservations"
    __table_args__ = (
        CheckConstraint("pages > 0", name="quota_reservations_pages"),
        CheckConstraint(
            "from_free >= 0 and from_monthly >= 0 and from_free + from_monthly = pages",
            name="quota_reservations_split",
        ),
        Index("ix_quota_reservations_tenant_month", "tenant_id", "month"),
        Index("quota_reservations_reference", "tenant_id", "reference", unique=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    reference: Mapped[str] = mapped_column(Text)
    pages: Mapped[int] = mapped_column(Integer)
    from_free: Mapped[int] = mapped_column(Integer)
    from_monthly: Mapped[int] = mapped_column(Integer)
    month: Mapped[date] = mapped_column(Date)
    reserved_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    released_at: Mapped[datetime | None] = mapped_column(_TS)


class PlanApplication(Base):
    __tablename__ = "plan_applications"
    __table_args__ = (
        CheckConstraint("period in ('month', 'year')", name="plan_applications_period"),
        CheckConstraint(
            "status in ('pending', 'approved', 'rejected')", name="plan_applications_status"
        ),
        Index(
            "plan_applications_one_pending",
            "tenant_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_plan_applications_tenant", "tenant_id"),
        Index("ix_plan_applications_applicant", "applicant_user_id"),
        Index("ix_plan_applications_plan", "plan_code"),
        Index("ix_plan_applications_admin", "decided_by_admin_id"),
        Index("ix_plan_applications_subscription", "subscription_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    applicant_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    plan_code: Mapped[str] = mapped_column(Text, ForeignKey("plans.code"))
    period: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    reject_reason: Mapped[str | None] = mapped_column(Text)
    decided_by_admin_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("admin_accounts.id")
    )
    decided_at: Mapped[datetime | None] = mapped_column(_TS)
    subscription_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("subscriptions.id"))
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
