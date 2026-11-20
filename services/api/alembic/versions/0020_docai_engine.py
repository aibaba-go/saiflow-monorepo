"""Google Document AI OCR replaces Google Cloud Vision (docai-backup-engine: FR-SYS-005,
FR-OCR-021, FR-OCR-027).

- Jobs and raw results may record google_docai; google_vision stays allowed as history.
- Engine health tracks only the selectable engines; the Vision row goes.
- A saved primary or backup engine of google_vision becomes google_docai.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
# Frozen copies of app.ocr.states at this revision (migrations never import app code).
RECORDED = "'textin', 'google_vision', 'google_docai'"
SELECTABLE = "'textin', 'google_docai'"
OLD = "'textin', 'google_vision'"  # 0009
ENGINE_KEYS = "'ocr_primary_engine', 'ocr_backup_engine'"


def _checks(recorded: str, health: str) -> None:
    for name, table, nullable in (
        ("ocr_jobs_engine", "ocr_jobs", True),
        ("ocr_raw_results_engine", "ocr_raw_results", False),
    ):
        op.drop_constraint(name, table, schema=S, type_="check")
        condition = f"engine in ({recorded})"
        op.create_check_constraint(
            name, table, f"engine is null or {condition}" if nullable else condition, schema=S
        )
    op.drop_constraint("ocr_engine_health_engine", "ocr_engine_health", schema=S, type_="check")
    op.create_check_constraint(
        "ocr_engine_health_engine", "ocr_engine_health", f"engine in ({health})", schema=S
    )


def _rename_setting(old: str, new: str) -> None:
    op.execute(
        f"UPDATE {S}.system_settings SET value = '\"{new}\"'::jsonb, updated_at = now() "
        f"WHERE key IN ({ENGINE_KEYS}) AND value = '\"{old}\"'::jsonb"
    )


def upgrade() -> None:
    op.execute(f"DELETE FROM {S}.ocr_engine_health WHERE engine = 'google_vision'")
    _checks(RECORDED, SELECTABLE)
    _rename_setting("google_vision", "google_docai")


def downgrade() -> None:
    bind = op.get_bind()
    used = bind.execute(
        sa.text(
            f"SELECT EXISTS (SELECT 1 FROM {S}.ocr_jobs WHERE engine = 'google_docai') "
            f"OR EXISTS (SELECT 1 FROM {S}.ocr_raw_results WHERE engine = 'google_docai')"
        )
    ).scalar()
    if used:
        raise RuntimeError(
            "refusing to downgrade 0020: Document AI results exist; "
            "roll back the image instead (docs/deployment/README.md §4)"
        )
    op.execute(f"DELETE FROM {S}.ocr_engine_health WHERE engine = 'google_docai'")
    _checks(OLD, OLD)
    _rename_setting("google_docai", "google_vision")
