from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

SELECT_JOBS = """SELECT j.id, j.tenant_id, j.created_by_user_id, f.original_name,
j.status, j.review_status, j.created_at, j.official_at
FROM saiflow_v3.ocr_jobs j JOIN saiflow_v3.files f
ON f.id = j.file_id AND f.tenant_id = j.tenant_id"""
STAGE = """CASE WHEN j.status IN ('FAILED','CANCELLED') THEN 'OCR_FAILED'
WHEN j.status NOT IN ('SUCCEEDED','PARTIAL_SUCCESS') THEN 'OCR_PROCESSING'
WHEN j.review_status = 'CONFIRMED' THEN 'CONFIRMED'
WHEN j.review_status IN ('PENDING_L1','PENDING_L2') THEN 'PENDING_REVIEW'
WHEN j.pending_mapping_id IS NOT NULL THEN 'TEMPLATE_MATCHING' ELSE 'VERIFYING' END AS stage"""


def upgrade():
    select = SELECT_JOBS.replace("j.official_at\n", f"j.official_at, {STAGE}\n")
    op.execute(f"CREATE OR REPLACE VIEW reporting.jobs WITH (security_barrier=true) AS {select}")


def downgrade():
    op.execute("DROP VIEW reporting.jobs")
    op.execute(f"CREATE VIEW reporting.jobs WITH (security_barrier=true) AS {SELECT_JOBS}")
    op.execute("""DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'saiflow_v3_reporter') THEN
      GRANT SELECT ON reporting.jobs TO saiflow_v3_reporter;
    END IF; END $$""")
