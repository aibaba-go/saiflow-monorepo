"""rebuild-notifications Task 4: `python -m app.cli reminders-run-once`."""

import subprocess
import sys

import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import API_DIR, _env_for

pytestmark = pytest.mark.integration


def _cli(settings, *args: str, **env: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", *args],
        cwd=API_DIR,
        env={**_env_for(settings), **env},
        capture_output=True,
        text=True,
        timeout=60,
    )


async def _expiring_today_tenant(db) -> int:
    """A personal tenant whose subscription ends later today (Bangkok): stage d0 now."""
    user = (
        await db.execute(text("insert into users (line_user_id) values ('L-cli') returning id"))
    ).scalar_one()
    tenant = (
        await db.execute(
            text("insert into tenants (kind, owner_user_id) values ('personal', :u) returning id"),
            {"u": user},
        )
    ).scalar_one()
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source)"
            " values (:t, 'kinder', 'month', now() - interval '1 month',"
            " date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'"
            " + interval '23 hours 59 minutes', 'auto')"
        ),
        {"t": tenant},
    )
    await db.commit()
    return tenant


async def test_run_once_cli_prints_count(db, migrated_db, monkeypatch):
    # FR-SYS-037: the enabled command must not depend on the test runner's worker switch.
    monkeypatch.setenv("REMINDERS_ENABLED", "false")
    tenant = await _expiring_today_tenant(db)
    r = _cli(
        migrated_db, "reminders-run-once", REMINDERS_ENABLED="true", SMTP_HOST="", SMTP_FROM=""
    )
    assert r.returncode == 0, r.stdout + r.stderr
    assert "reminders OK (1 created)" in r.stdout
    count = (
        await db.execute(
            text("select count(*) from notifications where tenant_id = :t"), {"t": tenant}
        )
    ).scalar_one()
    assert count == 1
    again = _cli(
        migrated_db, "reminders-run-once", REMINDERS_ENABLED="true", SMTP_HOST="", SMTP_FROM=""
    )
    assert "reminders OK (0 created)" in again.stdout


async def test_run_once_cli_disabled(db, migrated_db):
    await _expiring_today_tenant(db)
    r = _cli(migrated_db, "reminders-run-once", REMINDERS_ENABLED="false")
    assert r.returncode == 0 and "reminders disabled" in r.stdout
    assert (await db.execute(text("select count(*) from notifications"))).scalar_one() == 0
