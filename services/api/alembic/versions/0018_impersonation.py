"""admin impersonation (admin-impersonate-user: FR-SYS-145, FR-SYS-148). A platform admin
issues a one-time ticket for a registered user; redeeming it in web-pc opens a customer
session that remembers the admin. Only the SHA-256 of a ticket is stored.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
T = "impersonation_tickets"


def upgrade() -> None:
    op.create_table(
        T,
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        sa.Column("token_hash", sa.LargeBinary, nullable=False, unique=True),
        sa.Column(
            "admin_id", sa.BigInteger, sa.ForeignKey(f"{S}.admin_accounts.id"), nullable=False
        ),
        sa.Column("user_id", sa.BigInteger, sa.ForeignKey(f"{S}.users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        schema=S,
    )
    op.add_column(
        "customer_sessions",
        sa.Column(
            "impersonated_by_admin_id", sa.BigInteger, sa.ForeignKey(f"{S}.admin_accounts.id")
        ),
        schema=S,
    )
    op.create_check_constraint(
        "customer_sessions_impersonation_user",
        "customer_sessions",
        "impersonated_by_admin_id is null or kind = 'user'",
        schema=S,
    )


def downgrade() -> None:
    # impersonated sessions cannot be told apart once the column is gone: end them first
    op.execute(
        f"UPDATE {S}.customer_sessions SET revoked_at = now() "
        "WHERE impersonated_by_admin_id IS NOT NULL AND revoked_at IS NULL"
    )
    op.drop_constraint("customer_sessions_impersonation_user", "customer_sessions", schema=S)
    op.drop_column("customer_sessions", "impersonated_by_admin_id", schema=S)
    op.drop_table(T, schema=S)
