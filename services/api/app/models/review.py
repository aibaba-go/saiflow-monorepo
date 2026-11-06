"""Review levels, review rounds and records, result change rows and review notices
(review-flow; FR-VERIFY-007, 010-013, 019; FR-SYS-126).

None of these tables is tenant-scoped business data that guest claiming must move: guests
never review (their tenant is always level 0), and change rows follow their job."""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

_TS = DateTime(timezone=True)

ROUND_STATUSES = ("OPEN", "APPROVED", "RETURNED")
DECISIONS = ("APPROVE", "RETURN")
CHANGE_KINDS = ("SAVE", "TEMPLATE")
EMAIL_STATUSES = ("pending", "sending", "sent", "failed", "skipped")


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


class ReviewLevel(Base):
    """One per (organization, template); template_id NULL is 通用结果. Absent = 0."""

    __tablename__ = "review_levels"
    __table_args__ = (
        CheckConstraint("level between 0 and 2", name="review_levels_level"),
        Index(
            "uq_review_levels_template",
            "tenant_id",
            "template_id",
            unique=True,
            postgresql_where=text("template_id is not null"),
        ),
        Index(
            "uq_review_levels_generic",
            "tenant_id",
            unique=True,
            postgresql_where=text("template_id is null"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tenants.id"))
    template_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("document_templates.id"))
    level: Mapped[int] = mapped_column(Integer)
    updated_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class ReviewRound(Base):
    """One per confirm that needs review; closed by the final approval or a return."""

    __tablename__ = "review_rounds"
    __table_args__ = (
        CheckConstraint(f"status in ({_in(ROUND_STATUSES)})", name="review_rounds_status"),
        CheckConstraint("required_level in (1, 2)", name="review_rounds_required"),
        CheckConstraint(
            "current_level in (1, 2) and current_level <= required_level",
            name="review_rounds_current",
        ),
        UniqueConstraint("job_id", "round_no", name="uq_review_rounds_job_no"),
        Index(
            "uq_review_rounds_open",
            "job_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    job_id: Mapped[str] = mapped_column(Text, ForeignKey("ocr_jobs.id"), index=True)
    round_no: Mapped[int] = mapped_column(Integer)
    required_level: Mapped[int] = mapped_column(Integer)
    current_level: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, server_default="OPEN")
    confirmed_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    confirmed_version_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("result_versions.id", ondelete="SET NULL")
    )
    l1_reviewer_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    level_entered_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(_TS)


class ReviewRecord(Base):
    """One per decision; never changed (FR-VERIFY-013)."""

    __tablename__ = "review_records"
    __table_args__ = (
        CheckConstraint(f"decision in ({_in(DECISIONS)})", name="review_records_decision"),
        CheckConstraint("level in (1, 2)", name="review_records_level"),
        Index("ix_review_records_job", "job_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    round_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("review_rounds.id"), index=True)
    job_id: Mapped[str] = mapped_column(Text, ForeignKey("ocr_jobs.id"))
    level: Mapped[int] = mapped_column(Integer)
    reviewer_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class ResultChange(Base):
    """The change log (FR-VERIFY-007), kept as JSON like the results themselves: a SAVE row
    holds every field change of one save in `items` ([{path, before, after}]); a TEMPLATE
    row records a switch of template (names; NULL = 通用结果)."""

    __tablename__ = "result_changes"
    __table_args__ = (
        CheckConstraint(f"kind in ({_in(CHANGE_KINDS)})", name="result_changes_kind"),
        Index("ix_result_changes_job", "job_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    job_id: Mapped[str] = mapped_column(Text, ForeignKey("ocr_jobs.id"))
    version_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("result_versions.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(Text)
    items: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    from_template: Mapped[str | None] = mapped_column(Text)
    to_template: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())


class ReviewNotice(Base):
    """One per recipient each time a job enters a review level (FR-SYS-126): the trace of
    the in-app notice and of the one email attempt."""

    __tablename__ = "review_notices"
    __table_args__ = (
        CheckConstraint(f"email_status in ({_in(EMAIL_STATUSES)})", name="review_notices_email"),
        CheckConstraint("level in (1, 2)", name="review_notices_level"),
        Index(
            "ix_review_notices_pending",
            "id",
            postgresql_where=text("email_status = 'pending'"),
        ),
        Index("ix_review_notices_recipient", "recipient_user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    job_id: Mapped[str] = mapped_column(Text, ForeignKey("ocr_jobs.id"), index=True)
    round_no: Mapped[int] = mapped_column(Integer)
    level: Mapped[int] = mapped_column(Integer)
    recipient_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    notification_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("notifications.id"))
    email_status: Mapped[str] = mapped_column(Text)
    email_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(_TS, server_default=func.now())
    email_at: Mapped[datetime | None] = mapped_column(_TS)
