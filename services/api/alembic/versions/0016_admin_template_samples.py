"""admin template samples: a platform admin may start a template from a sample in the admin
console (template-report-management: FR-TEMPLATE-008/014, FR-SYS-142). Such a sample has no
tenant (no customer quota is reserved or charged) and belongs to the creating admin account.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
T = "template_samples"


def upgrade() -> None:
    op.add_column(
        T,
        sa.Column("created_by_admin_id", sa.BigInteger, sa.ForeignKey(f"{S}.admin_accounts.id")),
        schema=S,
    )
    op.create_index(f"ix_{T}_created_by_admin_id", T, ["created_by_admin_id"], schema=S)
    op.alter_column(T, "tenant_id", existing_type=sa.BigInteger, nullable=True, schema=S)
    op.create_check_constraint(
        "template_samples_owner",
        T,
        "(tenant_id is null) = (created_by_admin_id is not null)",
        schema=S,
    )
    op.create_check_constraint(
        "template_samples_admin_upload",
        T,
        "created_by_admin_id is null or (source = 'UPLOAD' and reservation_id is null)",
        schema=S,
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM {S}.{T} WHERE tenant_id IS NULL")
    op.drop_constraint("template_samples_admin_upload", T, schema=S)
    op.drop_constraint("template_samples_owner", T, schema=S)
    op.alter_column(T, "tenant_id", existing_type=sa.BigInteger, nullable=False, schema=S)
    op.drop_index(f"ix_{T}_created_by_admin_id", T, schema=S)
    op.drop_column(T, "created_by_admin_id", schema=S)
