"""In-app notifications and the reminder ledger (rebuild-notifications, FR-SYS-018,
035-038). Neither table is tenant-scoped business data: guests get no reminders, so guest
claiming moves nothing."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

_TS = DateTime(timezone=True)

KINDS = ("subscription_expiry", "usage", "free_quota_expiry")
STAGES = {
    "subscription_expiry": ("d7", "d3", "d1", "d0", "after"),
    "usage": ("low", "month_end"),
    "free_quota_expiry": ("d7", "d3", "d1", "d0"),
}
_KIND_SQL = ", ".join(f"'{k}'" for k in KINDS)
STAGE_CHECK = " or ".join(
    f"(kind = '{k}' and stage in ({', '.join(repr(s) for s in v)}))" for k, v in STAGES.items()
)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(f"type in ({_KIND_SQL})", name="notifications_type"),
        Index("ix_notifications_user_id_desc", "user_id", text("id desc")),
        Index("ix_notifications_user_unread", "user_id", postgresql_where=text("read_at is null")),
        Index("ix_notifications_tenant", "tenant_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    type: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(_TS)


class Reminder(Base):
    """One row per reminder sent: (tenant, kind, cycle, stage) is the once-only key."""

    __tablename__ = "reminders"
    __table_args__ = (
        CheckConstraint(f"kind in ({_KIND_SQL})", name="reminders_kind"),
        CheckConstraint(STAGE_CHECK, name="reminders_stage"),
        CheckConstraint(
            "email_status in ('pending', 'sent', 'failed', 'skipped')", name="reminders_email"
        ),
        Index("reminders_once", "tenant_id", "kind", "cycle", "stage", unique=True),
        Index("ix_reminders_recipient", "recipient_user_id"),
        Index("ix_reminders_notification", "notification_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    kind: Mapped[str] = mapped_column(Text)
    cycle: Mapped[str] = mapped_column(Text)
    stage: Mapped[str] = mapped_column(Text)
    recipient_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    notification_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notifications.id"))
    email_status: Mapped[str] = mapped_column(Text)
    email_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    email_at: Mapped[datetime | None] = mapped_column(_TS)
