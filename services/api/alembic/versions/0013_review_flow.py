"""review_flow: review levels, review rounds and records, the change log, review notices,
the review statuses PENDING_L1 / PENDING_L2, ocr_jobs.official_at, the organization's
review email switch and the review_pending notification type (review-flow).

Schema only, plus one fill: jobs confirmed before this revision are official business data
from their confirmation time. App-role privileges come from the default privileges set in
0003.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)

# Frozen copies of the app constants at this revision (migrations never import app code).
OLD_REVIEW = "'UNREVIEWED', 'EDITED', 'CONFIRMED'"
NEW_REVIEW = "'UNREVIEWED', 'EDITED', 'PENDING_L1', 'PENDING_L2', 'CONFIRMED'"
OLD_TYPES = "'subscription_expiry', 'usage', 'free_quota_expiry'"
NEW_TYPES = OLD_TYPES + ", 'review_pending'"


def _fk(name: str, target: str, kind=sa.BigInteger, nullable: bool = True, **kw) -> sa.Column:
    return sa.Column(name, kind, sa.ForeignKey(f"{S}.{target}", **kw), nullable=nullable)


def _now(name: str) -> sa.Column:
    return sa.Column(name, TS, nullable=False, server_default=sa.func.now())


def backfill_official_at(conn) -> None:
    conn.execute(
        sa.text(
            f"update {S}.ocr_jobs set official_at = confirmed_at "
            "where review_status = 'CONFIRMED' and official_at is null"
        )
    )


def upgrade() -> None:
    op.add_column("ocr_jobs", sa.Column("official_at", TS), schema=S)
    op.drop_constraint("ocr_jobs_review_status", "ocr_jobs", schema=S)
    op.create_check_constraint(
        "ocr_jobs_review_status", "ocr_jobs", f"review_status in ({NEW_REVIEW})", schema=S
    )
    op.add_column(
        "organizations",
        sa.Column(
            "review_email_enabled", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        schema=S,
    )
    op.drop_constraint("notifications_type", "notifications", schema=S)
    op.create_check_constraint(
        "notifications_type", "notifications", f"type in ({NEW_TYPES})", schema=S
    )

    op.create_table(
        "review_levels",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("tenant_id", "tenants.id", nullable=False),
        _fk("template_id", "document_templates.id"),
        sa.Column("level", sa.Integer, nullable=False),
        _fk("updated_by_user_id", "users.id"),
        _now("updated_at"),
        sa.CheckConstraint("level between 0 and 2", name="review_levels_level"),
        schema=S,
    )
    op.create_index(
        "uq_review_levels_template",
        "review_levels",
        ["tenant_id", "template_id"],
        unique=True,
        schema=S,
        postgresql_where=sa.text("template_id is not null"),
    )
    op.create_index(
        "uq_review_levels_generic",
        "review_levels",
        ["tenant_id"],
        unique=True,
        schema=S,
        postgresql_where=sa.text("template_id is null"),
    )

    op.create_table(
        "review_rounds",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("job_id", "ocr_jobs.id", sa.Text, nullable=False),
        sa.Column("round_no", sa.Integer, nullable=False),
        sa.Column("required_level", sa.Integer, nullable=False),
        sa.Column("current_level", sa.Integer, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="OPEN"),
        _fk("confirmed_by_user_id", "users.id"),
        _fk("confirmed_version_id", "result_versions.id", sa.Text, ondelete="SET NULL"),
        _fk("l1_reviewer_user_id", "users.id"),
        _now("level_entered_at"),
        _now("created_at"),
        sa.Column("closed_at", TS),
        sa.CheckConstraint(
            "status in ('OPEN', 'APPROVED', 'RETURNED')", name="review_rounds_status"
        ),
        sa.CheckConstraint("required_level in (1, 2)", name="review_rounds_required"),
        sa.CheckConstraint(
            "current_level in (1, 2) and current_level <= required_level",
            name="review_rounds_current",
        ),
        sa.UniqueConstraint("job_id", "round_no", name="uq_review_rounds_job_no"),
        schema=S,
    )
    op.create_index("ix_review_rounds_job_id", "review_rounds", ["job_id"], schema=S)
    op.create_index(
        "uq_review_rounds_open",
        "review_rounds",
        ["job_id"],
        unique=True,
        schema=S,
        postgresql_where=sa.text("status = 'OPEN'"),
    )

    op.create_table(
        "review_records",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("round_id", "review_rounds.id", nullable=False),
        _fk("job_id", "ocr_jobs.id", sa.Text, nullable=False),
        sa.Column("level", sa.Integer, nullable=False),
        _fk("reviewer_user_id", "users.id", nullable=False),
        sa.Column("decision", sa.Text, nullable=False),
        sa.Column("comment", sa.Text),
        _now("created_at"),
        sa.CheckConstraint("decision in ('APPROVE', 'RETURN')", name="review_records_decision"),
        sa.CheckConstraint("level in (1, 2)", name="review_records_level"),
        schema=S,
    )
    op.create_index("ix_review_records_round_id", "review_records", ["round_id"], schema=S)
    op.create_index("ix_review_records_job", "review_records", ["job_id", "id"], schema=S)

    op.create_table(
        "result_changes",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("job_id", "ocr_jobs.id", sa.Text, nullable=False),
        _fk("version_id", "result_versions.id", sa.Text, ondelete="SET NULL"),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("items", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("from_template", sa.Text),
        sa.Column("to_template", sa.Text),
        _fk("user_id", "users.id"),
        _now("created_at"),
        sa.CheckConstraint("kind in ('SAVE', 'TEMPLATE')", name="result_changes_kind"),
        schema=S,
    )
    op.create_index("ix_result_changes_job", "result_changes", ["job_id", "id"], schema=S)

    op.create_table(
        "review_notices",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("job_id", "ocr_jobs.id", sa.Text, nullable=False),
        sa.Column("round_no", sa.Integer, nullable=False),
        sa.Column("level", sa.Integer, nullable=False),
        _fk("recipient_user_id", "users.id", nullable=False),
        _fk("notification_id", "notifications.id", nullable=False),
        sa.Column("email_status", sa.Text, nullable=False),
        sa.Column("email_error", sa.Text),
        _now("created_at"),
        sa.Column("email_at", TS),
        sa.CheckConstraint(
            "email_status in ('pending', 'sending', 'sent', 'failed', 'skipped')",
            name="review_notices_email",
        ),
        sa.CheckConstraint("level in (1, 2)", name="review_notices_level"),
        schema=S,
    )
    op.create_index("ix_review_notices_job_id", "review_notices", ["job_id"], schema=S)
    op.create_index(
        "ix_review_notices_recipient", "review_notices", ["recipient_user_id"], schema=S
    )
    op.create_index(
        "ix_review_notices_pending",
        "review_notices",
        ["id"],
        schema=S,
        postgresql_where=sa.text("email_status = 'pending'"),
    )

    backfill_official_at(op.get_bind())


def downgrade() -> None:
    for table in ("review_notices", "result_changes", "review_records", "review_rounds"):
        op.drop_table(table, schema=S)
    op.drop_table("review_levels", schema=S)
    op.execute(f"delete from {S}.notifications where type = 'review_pending'")
    op.drop_constraint("notifications_type", "notifications", schema=S)
    op.create_check_constraint(
        "notifications_type", "notifications", f"type in ({OLD_TYPES})", schema=S
    )
    op.drop_column("organizations", "review_email_enabled", schema=S)
    op.execute(
        f"update {S}.ocr_jobs set review_status = 'EDITED' "
        "where review_status in ('PENDING_L1', 'PENDING_L2')"
    )
    op.drop_constraint("ocr_jobs_review_status", "ocr_jobs", schema=S)
    op.create_check_constraint(
        "ocr_jobs_review_status", "ocr_jobs", f"review_status in ({OLD_REVIEW})", schema=S
    )
    op.drop_column("ocr_jobs", "official_at", schema=S)
