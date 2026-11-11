import os
import subprocess
import sys
from pathlib import Path

import asyncpg
import pytest

pytestmark = pytest.mark.integration
API_DIR = Path(__file__).resolve().parents[2]


async def test_upgrade_creates_version_table_in_schema(db_settings):
    env = {
        **os.environ,
        "DB_HOST": db_settings.db_host,
        "DB_PORT": str(db_settings.db_port),
        "DB_NAME": db_settings.db_name,
        "DB_USER": db_settings.db_user,
        "DB_PASSWORD": db_settings.db_password.get_secret_value(),
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    conn = await asyncpg.connect(
        host=db_settings.db_host,
        port=db_settings.db_port,
        database=db_settings.db_name,
        user=db_settings.db_user,
        password=db_settings.db_password.get_secret_value(),
    )
    try:
        rows = await conn.fetch(
            "select table_schema from information_schema.tables where table_name='alembic_version'"
        )
    finally:
        await conn.close()
    assert {r["table_schema"] for r in rows} == {"saiflow_v3"}


async def test_card_refs_backfill_uses_each_current_config_and_safe_downgrade(
    api, line, db, db_engine
):
    """FR-REPORT-006/014: migrate actual legacy aggregate refs, including malformed drafts.
    Published snapshots remain byte-for-byte immutable; downgrade keeps delete protection."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text

    from tests.integration.db_fixtures import _migration
    from tests.integration.report_helpers import YEAR, published, report_org
    from tests.report_samples import page

    org = await report_org(api, line, db)
    report = await published(org.owner, org, page(org.card("a"), org.card("b"), period=YEAR))
    await db.rollback()
    migration = _migration("0017_report_card_refs.py")

    def exercise(conn):
        migration.op = Operations(MigrationContext.configure(conn))
        before = conn.execute(text("select config::text from report_snapshots order by id")).all()
        migration.downgrade()
        assert conn.scalar(text("select count(*) from report_template_refs")) == 2
        # The saved draft and current published config must be expanded separately.
        conn.execute(
            text("""update reports set draft = jsonb_set(draft, '{cards,0,id}',
            '"draft_a"'::jsonb) where id = :r"""),
            {"r": report["id"]},
        )
        legacy = conn.scalar(
            text("""insert into reports (tenant_id, name, draft)
            values (:t, 'Malformed', '{"cards": {"data": "bad"}}') returning id"""),
            {"t": org.tenant_id},
        )
        conn.execute(
            text("""insert into report_template_refs
            (report_id, kind, template_id, template_version_id) values (:r, 'DRAFT', :t, :v)"""),
            {"r": legacy, "t": org.template_id, "v": org.version_id},
        )
        migration.upgrade()
        refs = conn.execute(
            text("""select kind, card_id from report_template_refs
            where report_id = :r order by kind, card_id"""),
            {"r": report["id"]},
        ).all()
        assert refs == [
            ("DRAFT", "b"),
            ("DRAFT", "draft_a"),
            ("PUBLISHED", "a"),
            ("PUBLISHED", "b"),
        ]
        assert (
            conn.scalar(
                text("select card_id from report_template_refs where report_id = :r"), {"r": legacy}
            )
            is None
        )
        assert (
            conn.execute(text("select config::text from report_snapshots order by id")).all()
            == before
        )
        migration.downgrade()
        assert conn.scalar(text("select count(*) from report_template_refs")) == 3
        migration.upgrade()
        assert conn.scalar(text("select count(*) from report_template_refs")) == 5

    async with db_engine.begin() as conn:
        await conn.run_sync(exercise)
