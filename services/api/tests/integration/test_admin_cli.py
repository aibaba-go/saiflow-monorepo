import subprocess
import sys

import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import API_DIR, _env_for

pytestmark = pytest.mark.integration


def _cli(settings, *args: str, password: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", *args],
        cwd=API_DIR,
        env=_env_for(settings),
        input=None if password is None else password + "\n",
        capture_output=True,
        text=True,
    )


async def test_password_length_and_hash(db, migrated_db):  # AC-FR-SYS-019-04
    short = _cli(migrated_db, "admin-create", "ops", password="a" * 11)
    assert short.returncode == 1 and "at least 12" in short.stdout + short.stderr
    assert (await db.execute(text("select count(*) from admin_accounts"))).scalar_one() == 0
    ok = _cli(migrated_db, "admin-create", "ops", password="b" * 12)
    assert ok.returncode == 0, ok.stdout + ok.stderr
    stored = (await db.execute(text("select password_hash from admin_accounts"))).scalar_one()
    assert stored.startswith("$argon2id$") and "b" * 12 not in stored
    assert "b" * 12 not in ok.stdout + ok.stderr


async def test_duplicate_username_fails(db, migrated_db):
    assert _cli(migrated_db, "admin-create", "ops", password="c" * 12).returncode == 0
    assert _cli(migrated_db, "admin-create", "ops", password="c" * 12).returncode == 1


async def test_disable_and_reset_commands(db, migrated_db):
    assert _cli(migrated_db, "admin-create", "ops", password="c" * 12).returncode == 0
    assert _cli(migrated_db, "admin-reset-password", "ops", password="d" * 12).returncode == 0
    assert _cli(migrated_db, "admin-reset-password", "ops", password="short").returncode == 1
    assert _cli(migrated_db, "admin-disable", "ops").returncode == 0
    assert _cli(migrated_db, "admin-disable", "nobody").returncode == 1
    disabled = (await db.execute(text("select disabled_at from admin_accounts"))).scalar_one()
    assert disabled is not None
    actions = (
        (
            await db.execute(
                text("select action from audit_log where actor_type = 'system' order by id")
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["admin.create", "admin.reset_password", "admin.disable"]
