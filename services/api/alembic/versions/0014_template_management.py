"""template_management: drafts and activation, system-template grants, permanent "applied"
protection, immutable template versions and template samples (template-report-management:
FR-TEMPLATE-001..014, D2/D4/D5/D8).

Fills:
- every existing system template is granted to all four plans (its behaviour before this
  revision: every tenant could use it; FR-TEMPLATE-006);
- a template a conversion has already been applied to is protected from deletion from the
  first such mapping (FR-TEMPLATE-010).

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-10
"""

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)

# Frozen copies of the app constants at this revision (migrations never import app code).
GRANT_MODES = "'PLANS', 'TARGETS'"
PLAN_CODES = "'kinder', 'starter', 'intermediate', 'advance'"
SAMPLE_SOURCES = "'UPLOAD', 'OCR_RESULT'"
SAMPLE_STATUSES = "'QUEUED', 'OCR_RUNNING', 'GENERATING', 'READY', 'FAILED', 'CANCELED'"
SAMPLE_STAGES = "'OCR', 'GENERATE'"


def _app_role() -> str:
    role = os.environ.get("DB_APP_USER", "saiflow_v3_app")
    if not role.replace("_", "").isalnum():
        raise ValueError(f"unexpected DB_APP_USER {role!r}")
    return role


def _fk(name: str, target: str, kind=sa.BigInteger, nullable: bool = True, **kw) -> sa.Column:
    return sa.Column(name, kind, sa.ForeignKey(f"{S}.{target}", **kw), nullable=nullable)


def _now(name: str) -> sa.Column:
    return sa.Column(name, TS, nullable=False, server_default=sa.func.now())


def grant_system_templates(conn) -> None:
    """System templates without a grant are granted to every plan (the seeded Tax Invoice
    and Billing Note, FR-TEMPLATE-006). Safe to run again (a sync Connection)."""
    conn.execute(
        sa.text(
            f"update {S}.document_templates set grant_mode = 'PLANS', "
            f"grant_plans = array[{PLAN_CODES}]::text[] "
            "where tenant_id is null and grant_mode is null"
        )
    )


def backfill_applied_at(conn) -> None:
    conn.execute(
        sa.text(
            f"update {S}.document_templates t set applied_at = m.first "
            f"from (select v.template_id, min(m.created_at) as first "
            f"from {S}.template_mappings m join {S}.document_template_versions v "
            "on v.id = m.template_version_id group by v.template_id) m "
            "where m.template_id = t.id and t.applied_at is null"
        )
    )


def upgrade() -> None:
    app = _app_role()
    # a fresh database runs every revision in one transaction; the seeding of 0009..0011
    # leaves deferred FK checks on document_templates that would block ALTER TABLE
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    t = "document_templates"
    op.add_column(t, sa.Column("draft", JSONB), schema=S)
    op.add_column(t, sa.Column("draft_updated_at", TS), schema=S)
    op.add_column(
        t, sa.Column("revision", sa.Integer, nullable=False, server_default="1"), schema=S
    )
    op.add_column(t, sa.Column("grant_mode", sa.Text), schema=S)
    op.add_column(
        t,
        sa.Column("grant_plans", ARRAY(sa.Text), nullable=False, server_default="{}"),
        schema=S,
    )
    op.add_column(t, sa.Column("applied_at", TS), schema=S)
    op.add_column(t, _fk("created_by_user_id", "users.id"), schema=S)
    op.create_index(f"ix_{t}_created_by_user_id", t, ["created_by_user_id"], schema=S)
    op.create_check_constraint(
        "document_templates_grant_mode",
        t,
        f"grant_mode is null or grant_mode in ({GRANT_MODES})",
        schema=S,
    )
    op.create_check_constraint(
        "document_templates_grant_plans", t, f"grant_plans <@ array[{PLAN_CODES}]::text[]", schema=S
    )
    op.create_check_constraint(
        "document_templates_grants_system_only",
        t,
        "tenant_id is null or (grant_mode is null and cardinality(grant_plans) = 0)",
        schema=S,
    )
    op.create_check_constraint("document_templates_revision", t, "revision > 0", schema=S)

    op.add_column("document_template_versions", _fk("activated_by_user_id", "users.id"), schema=S)

    op.create_table(
        "template_grant_targets",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("template_id", "document_templates.id", nullable=False),
        _fk("user_id", "users.id"),
        _fk("organization_tenant_id", "tenants.id"),
        _now("created_at"),
        sa.CheckConstraint(
            "(user_id is null) <> (organization_tenant_id is null)",
            name="template_grant_targets_one",
        ),
        schema=S,
    )
    for col in ("template_id", "user_id", "organization_tenant_id"):
        op.create_index(
            f"ix_template_grant_targets_{col}", "template_grant_targets", [col], schema=S
        )
    op.create_index(
        "uq_template_grant_targets_user",
        "template_grant_targets",
        ["template_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("user_id is not null"),
        schema=S,
    )
    op.create_index(
        "uq_template_grant_targets_org",
        "template_grant_targets",
        ["template_id", "organization_tenant_id"],
        unique=True,
        postgresql_where=sa.text("organization_tenant_id is not null"),
        schema=S,
    )

    op.create_table(
        "template_samples",
        sa.Column("id", sa.Text, primary_key=True),
        _fk("tenant_id", "tenants.id", nullable=False),
        _fk("created_by_user_id", "users.id"),
        sa.Column("source", sa.Text, nullable=False),
        _fk("source_job_id", "ocr_jobs.id", kind=sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="QUEUED"),
        sa.Column("failed_stage", sa.Text),
        sa.Column("error_code", sa.Text),
        sa.Column("file_kind", sa.Text),
        sa.Column("size_bytes", sa.BigInteger),
        sa.Column("pages", sa.Integer),
        sa.Column("original_key", sa.Text),
        sa.Column("ocr_key", sa.Text),
        sa.Column("candidate_key", sa.Text),
        sa.Column("engine", sa.Text),
        _fk("reservation_id", "quota_reservations.id"),
        *(
            sa.Column(c, sa.Integer, nullable=False, server_default="0")
            for c in (
                "ocr_attempts",
                "generate_attempts",
                "llm_calls",
                "prompt_tokens",
                "completion_tokens",
            )
        ),
        sa.Column("claimed_at", TS),
        sa.Column("ocr_done_at", TS),
        sa.Column("ready_at", TS),
        sa.Column("cancel_requested_at", TS),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("deleted_at", TS),
        sa.Column("purged_at", TS),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint(f"source in ({SAMPLE_SOURCES})", name="template_samples_source"),
        sa.CheckConstraint(f"status in ({SAMPLE_STATUSES})", name="template_samples_status"),
        sa.CheckConstraint(
            f"failed_stage is null or failed_stage in ({SAMPLE_STAGES})",
            name="template_samples_failed_stage",
        ),
        sa.CheckConstraint(
            "(source = 'OCR_RESULT') = (source_job_id is not null)",
            name="template_samples_source_job",
        ),
        schema=S,
    )
    for col in ("tenant_id", "created_by_user_id", "source_job_id", "reservation_id"):
        op.create_index(f"ix_template_samples_{col}", "template_samples", [col], schema=S)
    op.create_index(
        "ix_template_samples_status", "template_samples", ["status", "created_at"], schema=S
    )
    op.create_index(
        "ix_template_samples_expires",
        "template_samples",
        ["expires_at"],
        postgresql_where=sa.text("purged_at is null"),
        schema=S,
    )

    # D2: an activated version never changes and is never removed (FR-TEMPLATE-013)
    op.execute(
        f"""
        CREATE FUNCTION {S}.document_template_versions_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'document_template_versions is append-only';
        END $fn$;
        """
    )
    op.execute(
        "CREATE TRIGGER document_template_versions_no_update_delete BEFORE UPDATE OR DELETE "
        f"ON {S}.document_template_versions FOR EACH ROW "
        f"EXECUTE FUNCTION {S}.document_template_versions_append_only()"
    )
    op.execute(
        "CREATE TRIGGER document_template_versions_no_truncate BEFORE TRUNCATE "
        f"ON {S}.document_template_versions FOR EACH STATEMENT "
        f"EXECUTE FUNCTION {S}.document_template_versions_append_only()"
    )
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {S}.document_template_versions FROM {app}")

    bind = op.get_bind()
    grant_system_templates(bind)
    backfill_applied_at(bind)


def downgrade() -> None:
    app = _app_role()
    op.execute(
        f"DROP TRIGGER IF EXISTS document_template_versions_no_truncate "
        f"ON {S}.document_template_versions"
    )
    op.execute(
        f"DROP TRIGGER IF EXISTS document_template_versions_no_update_delete "
        f"ON {S}.document_template_versions"
    )
    op.execute(f"DROP FUNCTION IF EXISTS {S}.document_template_versions_append_only()")
    op.execute(f"GRANT UPDATE, DELETE ON {S}.document_template_versions TO {app}")
    op.drop_table("template_samples", schema=S)
    op.drop_table("template_grant_targets", schema=S)
    op.drop_column("document_template_versions", "activated_by_user_id", schema=S)
    t = "document_templates"
    for name in (
        "document_templates_revision",
        "document_templates_grants_system_only",
        "document_templates_grant_plans",
        "document_templates_grant_mode",
    ):
        op.drop_constraint(name, t, schema=S)
    op.drop_index(f"ix_{t}_created_by_user_id", t, schema=S)
    for col in (
        "created_by_user_id",
        "applied_at",
        "grant_plans",
        "grant_mode",
        "revision",
        "draft_updated_at",
        "draft",
    ):
        op.drop_column(t, col, schema=S)
