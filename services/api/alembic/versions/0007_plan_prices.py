"""plan prices: monthly and yearly price in THB, NULL = contact sales (line-mini-account,
FR-SYS-030 modified). Initial values from the GTM package sheet.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def upgrade() -> None:
    for column in ("monthly_price", "yearly_price"):
        op.add_column("plans", sa.Column(column, sa.Numeric(12, 2)), schema=S)
        op.create_check_constraint(
            f"plans_{column}_nonnegative", "plans", f"{column} is null or {column} >= 0", schema=S
        )
    op.execute(f"UPDATE {S}.plans SET yearly_price = 888 WHERE code = 'kinder'")
    op.execute(
        f"UPDATE {S}.plans SET monthly_price = 599, yearly_price = 5990 WHERE code = 'starter'"
    )


def downgrade() -> None:
    for column in ("monthly_price", "yearly_price"):
        op.drop_constraint(f"plans_{column}_nonnegative", "plans", schema=S)
        op.drop_column("plans", column, schema=S)
