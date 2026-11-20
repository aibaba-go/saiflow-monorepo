"""identity: users, minimal tenants, sessions, email codes, admin accounts, audit log

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def _id() -> sa.Column:
    return sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True)


def _ts(name: str, nullable: bool = True, default: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=sa.func.now() if default else None,
    )


def upgrade() -> None:
    op.create_table(
        "users",
        _id(),
        sa.Column("line_user_id", sa.Text, nullable=False, unique=True),
        sa.Column("display_name", sa.Text),
        sa.Column("avatar_url", sa.Text),
        sa.Column("line_email", sa.Text),
        sa.Column("email", sa.Text, unique=True),
        sa.Column("phone", sa.Text),
        _ts("registered_at"),
        _ts("created_at", nullable=False, default=True),
        schema=S,
    )
    op.create_table(
        "tenants",
        _id(),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("owner_user_id", sa.BigInteger, sa.ForeignKey(f"{S}.users.id")),
        sa.Column("status", sa.Text, nullable=False, server_default="active"),
        _ts("created_at", nullable=False, default=True),
        sa.CheckConstraint("kind in ('personal', 'guest')", name="tenants_kind"),
        sa.CheckConstraint("status in ('active', 'claimed')", name="tenants_status"),
        schema=S,
    )
    op.create_index(
        "tenants_one_personal_per_user",
        "tenants",
        ["owner_user_id"],
        unique=True,
        schema=S,
        postgresql_where=sa.text("kind = 'personal'"),
    )
    op.create_table(
        "customer_sessions",
        _id(),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey(f"{S}.users.id")),
        sa.Column("tenant_id", sa.BigInteger, sa.ForeignKey(f"{S}.tenants.id"), nullable=False),
        _ts("created_at", nullable=False, default=True),
        _ts("last_used_at", nullable=False, default=True),
        _ts("revoked_at"),
        sa.CheckConstraint("kind in ('guest', 'user')", name="customer_sessions_kind"),
        schema=S,
    )
    op.create_table(
        "email_codes",
        _id(),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey(f"{S}.users.id"), nullable=False),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("code_hash", sa.LargeBinary, nullable=False),
        _ts("sent_at", nullable=False),
        _ts("expires_at", nullable=False),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
        _ts("used_at"),
        _ts("voided_at"),
        schema=S,
    )
    op.create_table(
        "admin_accounts",
        _id(),
        sa.Column("username", sa.Text, nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("failed_attempts", sa.Integer, nullable=False, server_default="0"),
        _ts("locked_until"),
        _ts("disabled_at"),
        _ts("created_at", nullable=False, default=True),
        schema=S,
    )
    op.create_table(
        "admin_sessions",
        _id(),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        sa.Column(
            "admin_id", sa.BigInteger, sa.ForeignKey(f"{S}.admin_accounts.id"), nullable=False
        ),
        _ts("created_at", nullable=False, default=True),
        _ts("last_used_at", nullable=False, default=True),
        _ts("revoked_at"),
        schema=S,
    )
    op.create_table(
        "audit_log",
        _id(),
        _ts("occurred_at", nullable=False, default=True),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column("actor_id", sa.Text),
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("target_type", sa.Text, nullable=False),
        sa.Column("target_id", sa.Text),
        sa.Column("result", sa.Text, nullable=False),
        sa.Column("prev_hash", sa.LargeBinary, nullable=False),
        sa.Column("hash", sa.LargeBinary, nullable=False),
        sa.CheckConstraint(
            "actor_type in ('user', 'guest', 'admin', 'system')", name="audit_actor_type"
        ),
        sa.CheckConstraint("result in ('success', 'failure')", name="audit_result"),
        schema=S,
    )
    op.execute(
        f"""
        CREATE FUNCTION {S}.audit_log_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only';
        END $fn$;
        """
    )
    op.execute(
        f"CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON {S}.audit_log "
        f"FOR EACH ROW EXECUTE FUNCTION {S}.audit_log_append_only()"
    )
    op.execute(
        f"CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON {S}.audit_log "
        f"FOR EACH STATEMENT EXECUTE FUNCTION {S}.audit_log_append_only()"
    )


def downgrade() -> None:
    op.drop_table("audit_log", schema=S)
    op.execute(f"DROP FUNCTION IF EXISTS {S}.audit_log_append_only()")
    for t in ["admin_sessions", "admin_accounts", "email_codes", "customer_sessions", "tenants"]:
        op.drop_table(t, schema=S)
    op.drop_table("users", schema=S)
