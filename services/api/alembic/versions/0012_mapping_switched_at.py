"""ocr_jobs.mapping_switched_at: when the current result last changed template or went to
the generic result, so a failed manual conversion from before it is no longer shown
(ocr-ui-parity, final review 3)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def upgrade() -> None:
    op.add_column(
        "ocr_jobs", sa.Column("mapping_switched_at", sa.DateTime(timezone=True)), schema=S
    )


def downgrade() -> None:
    op.drop_column("ocr_jobs", "mapping_switched_at", schema=S)
