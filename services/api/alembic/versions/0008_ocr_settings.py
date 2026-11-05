"""OCR engine and LLM settings (web-admin-console, FR-SYS-005, PRD §4.6): seven rows in
system_settings. Keys stay in the server environment file, never in the database.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-06
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"
# Frozen copy of app.services.ocr_settings_service.DEFAULTS at this revision.
DEFAULTS = {
    "ocr_primary_engine": "textin",
    "ocr_backup_engine": "google_vision",
    "ocr_retry_per_document": 3,
    "ocr_switch_threshold": 5,
    "ocr_probe_interval_seconds": 300,
    "llm_base_url": "https://api.deepseek.com",
    "llm_model": "deepseek-flash",
}


def upgrade() -> None:
    for key, value in DEFAULTS.items():
        op.get_bind().execute(
            sa.text(
                f"INSERT INTO {S}.system_settings (key, value) VALUES (:k, CAST(:v AS jsonb)) "
                "ON CONFLICT (key) DO NOTHING"
            ),
            {"k": key, "v": json.dumps(value)},
        )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text(f"DELETE FROM {S}.system_settings WHERE key = ANY(:keys)"),
        {"keys": list(DEFAULTS)},
    )
