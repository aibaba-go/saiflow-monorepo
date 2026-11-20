import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None
S = "saiflow_v3"


def upgrade():
    op.create_table(
        "report_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey(f"{S}.tenants.id"), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False, unique=True),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        schema=S,
    )
    op.create_index("ix_report_assets_tenant_id", "report_assets", ["tenant_id"], schema=S)
    op.create_table(
        "homepage_preferences",
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey(f"{S}.users.id"), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey(f"{S}.tenants.id"), primary_key=True),
        sa.Column("report_id", sa.BigInteger(), sa.ForeignKey(f"{S}.reports.id"), nullable=True),
        schema=S,
    )


def downgrade():
    op.drop_table("homepage_preferences", schema=S)
    op.drop_table("report_assets", schema=S)
