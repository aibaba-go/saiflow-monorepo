"""Re-seed the system templates: the Billing Note's primary fields are its date and total,
not its number, which many billing notes do not carry (found on the dev VPS, 2026-11-06).

The seeding of 0009 adds a new version only when a template's content changed and makes it
current; earlier versions stay, since results and mappings refer to them. Downgrade keeps
the new version (template versions are never deleted).
"""

import importlib.util
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _seeding():
    path = Path(__file__).with_name("0009_ocr_scan_flow.py")
    spec = importlib.util.spec_from_file_location("migration_0009", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def upgrade() -> None:
    _seeding().seed_templates(op.get_bind())


def downgrade() -> None:
    pass
