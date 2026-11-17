"""Result versions keep their key order (FR-OCR-023, FR-ENTRY-015).

jsonb sorts object keys by length, so a generic result's fields and table columns came
back in a different order from the document. The json type stores the text as written.
Already-saved results keep the order jsonb gave them.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {S}.result_versions ALTER COLUMN structured TYPE json USING structured::json"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE {S}.result_versions "
        "ALTER COLUMN structured TYPE jsonb USING structured::jsonb"
    )
