"""ocr_scan_flow: files, OCR jobs, raw results, result versions, templates, mappings,
exports and the engine switching state; the two system templates (ocr-scan-flow,
ADR-009 §2 with T1–T9, §5).

Raw results are append-only (T7): a trigger refuses UPDATE and DELETE, and the app role
loses those privileges on the table. App-role privileges otherwise come from the default
privileges set in 0003.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-06
"""

import hashlib
import json
import os
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
TS = sa.DateTime(timezone=True)
SEED_DIR = Path(__file__).resolve().parents[2] / "app" / "ocr" / "seed"
SEED_CODES = ("tax_invoice", "billing_note")

# Frozen copies of app.ocr.states at this revision (migrations never import app code).
FILE_STATUSES = "'UPLOADING', 'UPLOADED', 'READY', 'REJECTED', 'DELETED'"
JOB_STATUSES = (
    "'QUEUED', 'PREPROCESSING', 'PROCESSING', 'POSTPROCESSING', 'SUCCEEDED', "
    "'PARTIAL_SUCCESS', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'"
)
REVIEW_STATUSES = "'UNREVIEWED', 'EDITED', 'CONFIRMED'"
ENGINES = "'textin', 'google_vision'"
MAPPING_SOURCES = "'AUTO', 'MANUAL'"
MAPPING_STATUSES = "'PENDING', 'MATCHING', 'CONVERTING', 'READY', 'FAILED'"
TEMPLATE_STATUSES = "'ENABLED', 'DISABLED'"
EXPORT_STATUSES = "'GENERATING', 'READY', 'EXPIRED', 'FAILED'"


def _app_role() -> str:
    role = os.environ.get("DB_APP_USER", "saiflow_v3_app")
    if not role.replace("_", "").isalnum():
        raise ValueError(f"unexpected DB_APP_USER {role!r}")
    return role


def _id(name: str = "id", **kw) -> sa.Column:
    return sa.Column(name, sa.Text, primary_key=True, **kw)


def _ref(name: str, target: str, kind=sa.Text, nullable: bool = True) -> sa.Column:
    return sa.Column(name, kind, sa.ForeignKey(f"{S}.{target}"), nullable=nullable)


def _times() -> list[sa.Column]:
    return [
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
    ]


def _index(table: str, *cols: str) -> None:
    op.create_index(f"ix_{table}_{'_'.join(cols)}", table, list(cols), schema=S)


def upgrade() -> None:
    app = _app_role()
    op.create_table(
        "files",
        _id(),
        _ref("tenant_id", "tenants.id", sa.BigInteger, nullable=False),
        _ref("created_by_user_id", "users.id", sa.BigInteger),
        sa.Column("purpose", sa.Text, nullable=False, server_default="OCR_TASK"),
        sa.Column("original_name", sa.Text, nullable=False),
        sa.Column("storage_path", sa.Text),
        sa.Column("mime_type", sa.Text),
        sa.Column("size_bytes", sa.BigInteger),
        sa.Column("page_count", sa.Integer),
        sa.Column("sha256", sa.Text),
        sa.Column("status", sa.Text, nullable=False, server_default="UPLOADING"),
        sa.Column("reject_reason", sa.Text),
        sa.Column("expires_at", TS),
        *_times(),
        sa.CheckConstraint(f"status in ({FILE_STATUSES})", name="files_status"),
        schema=S,
    )
    _index("files", "tenant_id")
    _index("files", "created_by_user_id")
    op.create_index("ix_files_tenant_status", "files", ["tenant_id", "status"], schema=S)

    op.create_table(
        "ocr_jobs",
        _id(),
        _ref("tenant_id", "tenants.id", sa.BigInteger, nullable=False),
        _ref("created_by_user_id", "users.id", sa.BigInteger),
        _ref("file_id", "files.id", nullable=False),
        sa.Column("params", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("capability", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.Text, nullable=False, server_default="QUEUED"),
        sa.Column("idempotency_key", sa.Text),
        _ref("parent_job_id", "ocr_jobs.id"),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_code", sa.Text),
        sa.Column("error_message", sa.Text),
        sa.Column("vendor_request_id", sa.Text),
        sa.Column("engine", sa.Text),
        sa.Column("page_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("table_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("field_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("missing_pages", JSONB),
        sa.Column("review_status", sa.Text, nullable=False, server_default="UNREVIEWED"),
        _ref("reservation_id", "quota_reservations.id", sa.BigInteger),
        sa.Column("current_mapping_id", sa.Text),
        sa.Column("pending_mapping_id", sa.Text),
        sa.Column("confirmed_at", TS),
        _ref("confirmed_by_user_id", "users.id", sa.BigInteger),
        sa.Column("confirmed_version_id", sa.Text),
        sa.Column("started_at", TS),
        sa.Column("finished_at", TS),
        *_times(),
        sa.CheckConstraint(f"status in ({JOB_STATUSES})", name="ocr_jobs_status"),
        sa.CheckConstraint(f"review_status in ({REVIEW_STATUSES})", name="ocr_jobs_review_status"),
        sa.CheckConstraint(f"engine is null or engine in ({ENGINES})", name="ocr_jobs_engine"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_ocr_jobs_tenant_idempotency"),
        schema=S,
    )
    for col in (
        "tenant_id",
        "created_by_user_id",
        "file_id",
        "parent_job_id",
        "reservation_id",
        "current_mapping_id",
        "pending_mapping_id",
        "confirmed_by_user_id",
        "confirmed_version_id",
    ):
        _index("ocr_jobs", col)
    op.create_index("ix_ocr_jobs_tenant_created", "ocr_jobs", ["tenant_id", "created_at"], schema=S)
    op.create_index("ix_ocr_jobs_status_created", "ocr_jobs", ["status", "created_at"], schema=S)

    op.create_table(
        "ocr_raw_results",
        _id(),
        _ref("job_id", "ocr_jobs.id", nullable=False),
        sa.Column("engine", sa.Text, nullable=False),
        sa.Column("payload", JSONB),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(f"engine in ({ENGINES})", name="ocr_raw_results_engine"),
        schema=S,
    )
    _index("ocr_raw_results", "job_id")

    op.create_table(
        "document_templates",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _ref("tenant_id", "tenants.id", sa.BigInteger),
        sa.Column("code", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="ENABLED"),
        sa.Column("current_version_id", sa.BigInteger),
        sa.Column("deleted_at", TS),
        *_times(),
        sa.CheckConstraint(f"status in ({TEMPLATE_STATUSES})", name="document_templates_status"),
        schema=S,
    )
    _index("document_templates", "tenant_id")
    _index("document_templates", "current_version_id")
    op.create_index(
        "uq_document_templates_scope_code",
        "document_templates",
        [sa.text("coalesce(tenant_id, 0)"), "code"],
        unique=True,
        postgresql_where=sa.text("deleted_at is null"),
        schema=S,
    )

    op.create_table(
        "document_template_versions",
        sa.Column("id", sa.BigInteger, sa.Identity(), primary_key=True),
        _ref("template_id", "document_templates.id", sa.BigInteger, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("groups", JSONB, nullable=False),
        sa.Column("content_hash", sa.Text, nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("template_id", "version", name="uq_template_version_no"),
        schema=S,
    )
    _index("document_template_versions", "template_id")

    op.create_table(
        "template_mappings",
        _id(),
        _ref("job_id", "ocr_jobs.id", nullable=False),
        _ref("raw_result_id", "ocr_raw_results.id", nullable=False),
        _ref("template_id", "document_templates.id", sa.BigInteger),
        _ref("template_version_id", "document_template_versions.id", sa.BigInteger),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="PENDING"),
        _ref("created_by_user_id", "users.id", sa.BigInteger),
        sa.Column("base_version_id", sa.Text),
        sa.Column("result_version_id", sa.Text),
        sa.Column("match_score", sa.Float),
        sa.Column("match_reason", sa.Text),
        sa.Column("candidates", JSONB),
        sa.Column("warnings", JSONB),
        sa.Column("dropped_keys", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_code", sa.Text),
        sa.Column("error_message", sa.Text),
        sa.Column("llm_calls", sa.Integer, nullable=False, server_default="0"),
        sa.Column("prompt_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("model", sa.Text),
        sa.Column("prompt_version", sa.Text),
        sa.Column("duration_ms", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("started_at", TS),
        sa.Column("finished_at", TS),
        *_times(),
        sa.CheckConstraint(f"source in ({MAPPING_SOURCES})", name="template_mappings_source"),
        sa.CheckConstraint(f"status in ({MAPPING_STATUSES})", name="template_mappings_status"),
        schema=S,
    )
    for col in (
        "job_id",
        "raw_result_id",
        "template_id",
        "template_version_id",
        "created_by_user_id",
        "base_version_id",
        "result_version_id",
    ):
        _index("template_mappings", col)

    op.create_table(
        "result_versions",
        _id(),
        _ref("job_id", "ocr_jobs.id", nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("is_current", sa.Boolean, nullable=False, server_default="true"),
        _ref("created_by_user_id", "users.id", sa.BigInteger),
        sa.Column("structured", JSONB),
        sa.Column("mapping_id", sa.Text),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("job_id", "version", name="uq_result_version_job_version"),
        schema=S,
    )
    for col in ("job_id", "created_by_user_id", "mapping_id"):
        _index("result_versions", col)
    op.create_index(
        "uq_result_versions_job_current",
        "result_versions",
        ["job_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
        schema=S,
    )

    op.create_table(
        "exports",
        _id(),
        _ref("job_id", "ocr_jobs.id", nullable=False),
        _ref("result_version_id", "result_versions.id", nullable=False),
        sa.Column("format", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default="GENERATING"),
        sa.Column("storage_path", sa.Text),
        sa.Column("expires_at", TS),
        _ref("created_by_user_id", "users.id", sa.BigInteger, nullable=False),
        *_times(),
        sa.CheckConstraint("format in ('XLSX')", name="exports_format"),
        sa.CheckConstraint(f"status in ({EXPORT_STATUSES})", name="exports_status"),
        schema=S,
    )
    for col in ("job_id", "result_version_id", "created_by_user_id"):
        _index("exports", col)

    op.create_table(
        "ocr_engine_health",
        sa.Column("engine", sa.Text, primary_key=True),
        sa.Column("consecutive_failures", sa.Integer, nullable=False, server_default="0"),
        sa.Column("switched_at", TS),
        sa.Column("last_probe_at", TS),
        sa.CheckConstraint(f"engine in ({ENGINES})", name="ocr_engine_health_engine"),
        schema=S,
    )

    # Cyclic references (T5): checked at commit, so one transaction may write either side first.
    for name, table, col, target in (
        ("fk_ocr_jobs_current_mapping", "ocr_jobs", "current_mapping_id", "template_mappings"),
        ("fk_ocr_jobs_pending_mapping", "ocr_jobs", "pending_mapping_id", "template_mappings"),
        ("fk_ocr_jobs_confirmed_version", "ocr_jobs", "confirmed_version_id", "result_versions"),
        ("fk_result_versions_mapping", "result_versions", "mapping_id", "template_mappings"),
        ("fk_mappings_base_version", "template_mappings", "base_version_id", "result_versions"),
        ("fk_mappings_result_version", "template_mappings", "result_version_id", "result_versions"),
        (
            "fk_templates_current_version",
            "document_templates",
            "current_version_id",
            "document_template_versions",
        ),
    ):
        op.create_foreign_key(
            name,
            table,
            target,
            [col],
            ["id"],
            source_schema=S,
            referent_schema=S,
            deferrable=True,
            initially="DEFERRED",
        )

    # T7: raw results are written once (NFR-SEC-010)
    op.execute(
        f"""
        CREATE FUNCTION {S}.ocr_raw_results_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'ocr_raw_results is append-only';
        END $fn$;
        """
    )
    op.execute(
        f"CREATE TRIGGER ocr_raw_results_no_update_delete BEFORE UPDATE OR DELETE "
        f"ON {S}.ocr_raw_results FOR EACH ROW EXECUTE FUNCTION {S}.ocr_raw_results_append_only()"
    )
    op.execute(
        f"CREATE TRIGGER ocr_raw_results_no_truncate BEFORE TRUNCATE ON {S}.ocr_raw_results "
        f"FOR EACH STATEMENT EXECUTE FUNCTION {S}.ocr_raw_results_append_only()"
    )
    op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {S}.ocr_raw_results FROM {app}")

    seed_templates(op.get_bind())


def content_hash(version: dict) -> str:
    canonical = json.dumps(
        {k: version[k] for k in ("name", "description", "groups")},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def seed_templates(conn) -> None:
    """The system templates (FR-TEMPLATE-006, ADR-009 §5): insert each template once, and a
    new version only when its content changed. Safe to run again (a sync Connection)."""
    for code in SEED_CODES:
        seed = json.loads((SEED_DIR / f"{code}.json").read_text(encoding="utf-8"))
        version = {
            "name": seed["name"],
            "description": seed.get("description"),
            "groups": seed["groups"],
        }
        digest = content_hash(version)
        template_id = conn.execute(
            sa.text(
                f"select id from {S}.document_templates "
                "where tenant_id is null and code = :c and deleted_at is null"
            ),
            {"c": code},
        ).scalar()
        if template_id is None:
            template_id = conn.execute(
                sa.text(
                    f"insert into {S}.document_templates (code, name) values (:c, :n) returning id"
                ),
                {"c": code, "n": seed["name"]},
            ).scalar()
        latest = conn.execute(
            sa.text(
                f"select content_hash, version from {S}.document_template_versions "
                "where template_id = :t order by version desc limit 1"
            ),
            {"t": template_id},
        ).first()
        if latest is not None and latest[0] == digest:
            continue
        version_id = conn.execute(
            sa.text(
                f"insert into {S}.document_template_versions "
                "(template_id, version, name, description, groups, content_hash) "
                "values (:t, :v, :n, :d, cast(:g as jsonb), :h) returning id"
            ),
            {
                "t": template_id,
                "v": (latest[1] + 1) if latest else 1,
                "n": version["name"],
                "d": version["description"],
                "g": json.dumps(version["groups"], ensure_ascii=False),
                "h": digest,
            },
        ).scalar()
        conn.execute(
            sa.text(
                f"update {S}.document_templates set current_version_id = :v, name = :n, "
                "updated_at = now() where id = :t"
            ),
            {"v": version_id, "n": seed["name"], "t": template_id},
        )


def downgrade() -> None:
    # Dropping these tables would erase every uploaded document and result; refuse while any
    # file exists (the seed templates alone may go).
    bind = op.get_bind()
    if bind.execute(sa.text(f"SELECT EXISTS (SELECT 1 FROM {S}.files)")).scalar():
        raise RuntimeError(
            f"refusing to downgrade 0009: document data present in {S}.files; "
            "roll back the image instead (docs/deployment/README.md §4)"
        )
    # CASCADE drops the cyclic foreign keys with the tables
    for t in (
        "exports",
        "ocr_engine_health",
        "result_versions",
        "template_mappings",
        "document_template_versions",
        "document_templates",
        "ocr_raw_results",
        "ocr_jobs",
        "files",
    ):
        op.execute(f"DROP TABLE IF EXISTS {S}.{t} CASCADE")
    op.execute(f"DROP FUNCTION IF EXISTS {S}.ocr_raw_results_append_only()")
