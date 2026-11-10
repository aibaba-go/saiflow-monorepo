"""reporting: organization reports (editable draft), immutable published snapshots and the
template versions each report is bound to (template-report-management: FR-REPORT-005..018,
FR-TEMPLATE-010, D6/D7). Configuration only: no statistics are ever stored.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-10
"""

import os
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)

REF_KINDS = "'DRAFT', 'PUBLISHED'"  # frozen copy (migrations never import app code)


def _app_role() -> str:
    role = os.environ.get("DB_APP_USER", "saiflow_v3_app")
    if not role.replace("_", "").isalnum():
        raise ValueError(f"unexpected DB_APP_USER {role!r}")
    return role


def _fk(name: str, target: str, kind=sa.BigInteger, nullable: bool = True, **kw) -> sa.Column:
    return sa.Column(name, kind, sa.ForeignKey(f"{S}.{target}", **kw), nullable=nullable)


def _now(name: str) -> sa.Column:
    return sa.Column(name, TS, nullable=False, server_default=sa.func.now())


def upgrade() -> None:
    app = _app_role()
    op.create_table(
        "reports",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("tenant_id", "tenants.id", nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("draft", JSONB, nullable=False),
        sa.Column("revision", sa.Integer, nullable=False, server_default="1"),
        sa.Column("published_snapshot_id", sa.BigInteger),
        _fk("created_by_user_id", "users.id"),
        _fk("updated_by_user_id", "users.id"),
        sa.Column("deleted_at", TS),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint("revision > 0", name="reports_revision"),
        schema=S,
    )
    op.create_index(
        "ix_reports_tenant",
        "reports",
        ["tenant_id"],
        postgresql_where=sa.text("deleted_at is null"),
        schema=S,
    )
    op.create_index(
        "ix_reports_published_snapshot_id", "reports", ["published_snapshot_id"], schema=S
    )

    op.create_table(
        "report_snapshots",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("report_id", "reports.id", nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("config", JSONB, nullable=False),
        _fk("published_by_user_id", "users.id"),
        _fk("published_by_admin_id", "admin_accounts.id"),
        _now("published_at"),
        sa.UniqueConstraint("report_id", "version", name="uq_report_snapshot_no"),
        schema=S,
    )
    op.create_index("ix_report_snapshots_report_id", "report_snapshots", ["report_id"], schema=S)
    op.create_foreign_key(
        "reports_published_snapshot_id_fkey",
        "reports",
        "report_snapshots",
        ["published_snapshot_id"],
        ["id"],
        source_schema=S,
        referent_schema=S,
        deferrable=True,
        initially="DEFERRED",
    )

    op.create_table(
        "report_template_refs",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _fk("report_id", "reports.id", nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        _fk("template_id", "document_templates.id", nullable=False),
        _fk("template_version_id", "document_template_versions.id", nullable=False),
        _now("created_at"),
        sa.CheckConstraint(f"kind in ({REF_KINDS})", name="report_template_refs_kind"),
        sa.UniqueConstraint(
            "report_id", "kind", "template_version_id", name="uq_report_template_ref"
        ),
        schema=S,
    )
    for col in ("report_id", "template_id", "template_version_id"):
        op.create_index(f"ix_report_template_refs_{col}", "report_template_refs", [col], schema=S)

    # FR-REPORT-014: a published snapshot never changes and is never removed
    op.execute(
        f"""
        CREATE FUNCTION {S}.report_snapshots_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'report_snapshots is append-only';
        END $fn$;
        """
    )
    op.execute(
        "CREATE TRIGGER report_snapshots_no_update_delete BEFORE UPDATE OR DELETE "
        f"ON {S}.report_snapshots FOR EACH ROW EXECUTE FUNCTION {S}.report_snapshots_append_only()"
    )
    op.execute(
        "CREATE TRIGGER report_snapshots_no_truncate BEFORE TRUNCATE "
        f"ON {S}.report_snapshots FOR EACH STATEMENT "
        f"EXECUTE FUNCTION {S}.report_snapshots_append_only()"
    )
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {S}.report_snapshots FROM {app}")


def downgrade() -> None:
    op.drop_table("report_template_refs", schema=S)
    op.drop_constraint("reports_published_snapshot_id_fkey", "reports", schema=S)
    op.drop_table("report_snapshots", schema=S)
    op.drop_table("reports", schema=S)
    op.execute(f"DROP FUNCTION IF EXISTS {S}.report_snapshots_append_only()")
