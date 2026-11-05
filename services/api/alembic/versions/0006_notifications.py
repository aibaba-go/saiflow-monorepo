"""notifications: in-app notifications and the reminder ledger (rebuild-notifications).
App-role privileges come from the default privileges set in 0003.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)
# Frozen copies of app.models.notification at this revision (migrations never import app code).
KIND_SQL = "'subscription_expiry', 'usage', 'free_quota_expiry'"
STAGE_CHECK = (
    "(kind = 'subscription_expiry' and stage in ('d7', 'd3', 'd1', 'd0', 'after'))"
    " or (kind = 'usage' and stage in ('low', 'month_end'))"
    " or (kind = 'free_quota_expiry' and stage in ('d7', 'd3', 'd1', 'd0'))"
)


def _fk(name: str, target: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.BigInteger, sa.ForeignKey(f"{S}.{target}"), nullable=nullable)


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("user_id", "users.id"),
        _fk("tenant_id", "tenants.id"),
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", TS),
        sa.CheckConstraint(f"type in ({KIND_SQL})", name="notifications_type"),
        schema=S,
    )
    op.create_index(
        "ix_notifications_user_id_desc",
        "notifications",
        ["user_id", sa.text("id desc")],
        schema=S,
    )
    op.create_index(
        "ix_notifications_user_unread",
        "notifications",
        ["user_id"],
        postgresql_where=sa.text("read_at is null"),
        schema=S,
    )
    op.create_index("ix_notifications_tenant", "notifications", ["tenant_id"], schema=S)

    op.create_table(
        "reminders",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("tenant_id", "tenants.id"),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("cycle", sa.Text, nullable=False),
        sa.Column("stage", sa.Text, nullable=False),
        _fk("recipient_user_id", "users.id"),
        _fk("notification_id", "notifications.id"),
        sa.Column("email_status", sa.Text, nullable=False),
        sa.Column("email_error", sa.Text),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("email_at", TS),
        sa.CheckConstraint(f"kind in ({KIND_SQL})", name="reminders_kind"),
        sa.CheckConstraint(STAGE_CHECK, name="reminders_stage"),
        sa.CheckConstraint(
            "email_status in ('pending', 'sent', 'failed', 'skipped')", name="reminders_email"
        ),
        schema=S,
    )
    op.create_index(
        "reminders_once",
        "reminders",
        ["tenant_id", "kind", "cycle", "stage"],
        unique=True,
        schema=S,
    )
    op.create_index("ix_reminders_recipient", "reminders", ["recipient_user_id"], schema=S)
    op.create_index("ix_reminders_notification", "reminders", ["notification_id"], schema=S)


def downgrade() -> None:
    # Dropping these tables would erase every user's notifications; refuse while any exist.
    bind = op.get_bind()
    for table in ["notifications", "reminders"]:
        if bind.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {S}.{table})")).scalar():
            raise RuntimeError(
                f"refusing to downgrade 0006: notification data present in {S}.{table}; "
                "roll back the image instead (docs/deployment/README.md §4)"
            )
    op.drop_table("reminders", schema=S)
    op.drop_table("notifications", schema=S)
