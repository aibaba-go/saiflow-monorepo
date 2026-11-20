"""Card-scoped historical template bindings (FR-REPORT-006/014).

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-11

Preserve aggregate legacy refs for deletion protection when their configuration cannot
be matched safely. Only concrete card refs authorize history. Never rewrite snapshots.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

S = "saiflow_v3"


def upgrade() -> None:
    op.add_column("report_template_refs", sa.Column("card_id", sa.Text(), nullable=True), schema=S)
    op.drop_constraint("uq_report_template_ref", "report_template_refs", schema=S)
    op.create_unique_constraint(
        "uq_report_template_ref",
        "report_template_refs",
        ["report_id", "kind", "card_id", "template_version_id"],
        schema=S,
    )
    # Expand only guarded arrays, compare JSONB numeric ids without casting arbitrary
    # customer configuration text. Each ref uses its own draft/current published config.
    op.execute(f"""
        INSERT INTO {S}.report_template_refs
            (report_id, kind, card_id, template_id, template_version_id, created_at)
        SELECT DISTINCT ref.report_id, ref.kind, c.card->>'id', ref.template_id,
            ref.template_version_id, ref.created_at
        FROM {S}.report_template_refs ref
        JOIN {S}.reports r ON r.id = ref.report_id
        LEFT JOIN {S}.report_snapshots snap ON snap.id = r.published_snapshot_id
        CROSS JOIN LATERAL (SELECT CASE WHEN ref.kind = 'DRAFT' THEN r.draft
            ELSE snap.config END AS config) cfg
        CROSS JOIN LATERAL jsonb_array_elements(CASE
            WHEN jsonb_typeof(cfg.config->'cards') = 'array' THEN cfg.config->'cards'
            ELSE '[]'::jsonb END) AS c(card)
        WHERE ref.card_id IS NULL AND jsonb_typeof(c.card->'id') = 'string'
            AND length(c.card->>'id') BETWEEN 1 AND 64
            AND c.card->'data'->'template_id' = to_jsonb(ref.template_id)
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
                WHEN jsonb_typeof(c.card->'data'->'template_version_ids') = 'array'
                THEN c.card->'data'->'template_version_ids' ELSE '[]'::jsonb END) AS v(id)
                WHERE v.id = to_jsonb(ref.template_version_id))
        ON CONFLICT DO NOTHING
    """)
    op.execute(f"""
        DELETE FROM {S}.report_template_refs legacy
        WHERE legacy.card_id IS NULL AND EXISTS (
            SELECT 1 FROM {S}.report_template_refs concrete
            WHERE concrete.report_id = legacy.report_id AND concrete.kind = legacy.kind
                AND concrete.template_version_id = legacy.template_version_id
                AND concrete.card_id IS NOT NULL)
    """)


def downgrade() -> None:
    # Collapse per-card duplicates before restoring the 0016 aggregate constraint.
    # All referenced templates remain protected; neither configurations nor data change.
    op.execute(f"""
        DELETE FROM {S}.report_template_refs extra
        USING {S}.report_template_refs kept
        WHERE extra.report_id = kept.report_id AND extra.kind = kept.kind
            AND extra.template_version_id = kept.template_version_id AND extra.id > kept.id
    """)
    op.drop_constraint("uq_report_template_ref", "report_template_refs", schema=S)
    op.drop_column("report_template_refs", "card_id", schema=S)
    op.create_unique_constraint(
        "uq_report_template_ref",
        "report_template_refs",
        ["report_id", "kind", "template_version_id"],
        schema=S,
    )
