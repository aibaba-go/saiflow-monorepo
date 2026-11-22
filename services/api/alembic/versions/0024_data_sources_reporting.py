import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None
S = "saiflow_v3"


def upgrade():
    op.create_table(
        "data_sources",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey(f"{S}.tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("port", sa.Integer(), server_default="5432", nullable=False),
        sa.Column("database", sa.Text(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("password_cipher", sa.Text(), nullable=False),
        sa.Column("ssl_mode", sa.Text(), server_default="verify-full", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("port between 1 and 65535", name="data_sources_port"),
        sa.CheckConstraint("ssl_mode = 'verify-full'", name="data_sources_tls"),
        schema=S,
    )
    op.create_index("ix_data_sources_tenant_id", "data_sources", ["tenant_id"], schema=S)
    op.create_table(
        "report_source_refs",
        sa.Column("report_id", sa.BigInteger(), sa.ForeignKey(f"{S}.reports.id"), primary_key=True),
        sa.Column(
            "source_id", sa.BigInteger(), sa.ForeignKey(f"{S}.data_sources.id"), primary_key=True
        ),
        sa.Column("kind", sa.Text(), primary_key=True),
        sa.CheckConstraint("kind in ('draft', 'published')", name="report_source_refs_kind"),
        schema=S,
    )
    op.execute("CREATE SCHEMA reporting")
    op.execute("REVOKE ALL ON SCHEMA reporting FROM PUBLIC")
    definitions = {
        "jobs": f"SELECT j.id, j.tenant_id, j.created_by_user_id, f.original_name, "
        f"j.status, j.review_status, j.created_at, j.official_at "
        f"FROM {S}.ocr_jobs j JOIN {S}.files f ON f.id = j.file_id AND f.tenant_id = j.tenant_id",
        "plans": f"SELECT code, monthly_quota, tenant_kind FROM {S}.plans",
        "subscriptions": f"SELECT tenant_id, plan_code, starts_at, ends_at FROM {S}.subscriptions",
        "free_quotas": f"SELECT tenant_id, remaining, expires_at FROM {S}.free_quotas",
        "quota_reservations": "SELECT tenant_id, created_by_user_id, from_monthly, "
        "month, released_at "
        f"FROM (SELECT q.*, j.created_by_user_id FROM {S}.quota_reservations q "
        f"LEFT JOIN {S}.ocr_jobs j ON j.id = q.reference AND j.tenant_id = q.tenant_id) q",
    }
    for name, select in definitions.items():
        op.execute(f"CREATE VIEW reporting.{name} WITH (security_barrier=true) AS {select}")
    op.execute("""DO $$ BEGIN
      IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'saiflow_v3_reporter') THEN
        GRANT USAGE ON SCHEMA reporting TO saiflow_v3_reporter;
        GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO saiflow_v3_reporter;
      END IF;
    END $$""")


def downgrade():
    for name in ("quota_reservations", "free_quotas", "subscriptions", "plans", "jobs"):
        op.execute(f"DROP VIEW reporting.{name}")
    op.execute("DROP SCHEMA reporting")
    op.drop_table("report_source_refs", schema=S)
    op.drop_table("data_sources", schema=S)
