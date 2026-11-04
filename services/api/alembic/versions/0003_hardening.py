"""harden-identity: indexes, normalised admin usernames, least-privilege app role

The migration account owns the schema and runs this; the application role (DB_APP_USER,
default saiflow_v3_app) gets only the data privileges it needs, and nothing on audit_log
beyond reading and appending (AC-FR-SYS-003-06).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-04
"""

import os
from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def _app_role() -> str:
    role = os.environ.get("DB_APP_USER", "saiflow_v3_app")
    if not role.replace("_", "").isalnum():
        raise ValueError(f"unexpected DB_APP_USER {role!r}")
    return role


def upgrade() -> None:
    app = _app_role()
    op.create_index("ix_email_codes_user_sent", "email_codes", ["user_id", "sent_at"], schema=S)
    op.create_index("ix_customer_sessions_user", "customer_sessions", ["user_id"], schema=S)
    op.execute(f"UPDATE {S}.admin_accounts SET username = lower(btrim(username))")
    op.create_check_constraint(
        "ck_admin_accounts_username_normalized",
        "admin_accounts",
        "username = lower(btrim(username))",
        schema=S,
    )
    op.execute(f"GRANT USAGE ON SCHEMA {S} TO {app}")
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {S} TO {app}")
    op.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {S} TO {app}")
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {S} "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {app}"
    )
    op.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {S} GRANT USAGE, SELECT ON SEQUENCES TO {app}")
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {S}.audit_log FROM {app}")
    op.execute(f"REVOKE UPDATE, DELETE ON {S}.alembic_version FROM {app}")


def downgrade() -> None:
    app = _app_role()
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {S} REVOKE USAGE, SELECT ON SEQUENCES FROM {app}"
    )
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {S} "
        f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {app}"
    )
    op.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA {S} FROM {app}")
    op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA {S} FROM {app}")
    op.execute(f"REVOKE USAGE ON SCHEMA {S} FROM {app}")
    op.drop_constraint("ck_admin_accounts_username_normalized", "admin_accounts", schema=S)
    op.drop_index("ix_customer_sessions_user", "customer_sessions", schema=S)
    op.drop_index("ix_email_codes_user_sent", "email_codes", schema=S)
