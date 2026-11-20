"""customer passwords and email-code purposes (customer-email-login: FR-SYS-020,
FR-SYS-152, FR-SYS-156). A registered user may have an argon2 password hash with a
wrong-password counter and lock; every email code records what it is for.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.Text), schema=S)
    op.add_column(
        "users",
        sa.Column("password_failed_attempts", sa.Integer, nullable=False, server_default="0"),
        schema=S,
    )
    op.add_column("users", sa.Column("password_locked_until", sa.DateTime(timezone=True)), schema=S)
    op.add_column(
        "email_codes",
        sa.Column("purpose", sa.Text, nullable=False, server_default="verify"),
        schema=S,
    )
    op.create_check_constraint(
        "email_codes_purpose", "email_codes", "purpose in ('verify', 'login', 'reset')", schema=S
    )


def downgrade() -> None:
    # login and reset codes have no meaning without the column: end them first
    op.execute(
        f"UPDATE {S}.email_codes SET voided_at = now() "
        "WHERE purpose <> 'verify' AND used_at IS NULL AND voided_at IS NULL"
    )
    op.drop_constraint("email_codes_purpose", "email_codes", schema=S)
    op.drop_column("email_codes", "purpose", schema=S)
    op.drop_column("users", "password_locked_until", schema=S)
    op.drop_column("users", "password_failed_attempts", schema=S)
    op.drop_column("users", "password_hash", schema=S)
