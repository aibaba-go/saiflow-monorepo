"""rebuild-notifications Task 1: notifications and reminders schema (migration 0006)."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.services import claim_service

pytestmark = pytest.mark.integration
API_DIR = Path(__file__).resolve().parents[2]
TABLES = {"notifications", "reminders"}


async def _tenant_and_user(db) -> tuple[int, int]:
    u = (
        await db.execute(
            text("insert into users (line_user_id) values ('L' || gen_random_uuid()) returning id")
        )
    ).scalar_one()
    t = (
        await db.execute(
            text("insert into tenants (kind, owner_user_id) values ('personal', :u) returning id"),
            {"u": u},
        )
    ).scalar_one()
    return t, u


async def _notification(db, t: int, u: int, kind: str = "subscription_expiry") -> int:
    return (
        await db.execute(
            text(
                "insert into notifications (user_id, tenant_id, type, data) "
                "values (:u, :t, :k, '{}'::jsonb) returning id"
            ),
            {"u": u, "t": t, "k": kind},
        )
    ).scalar_one()


async def _reminder(db, t, u, n, kind="subscription_expiry", stage="d7", cycle="c1"):
    await db.execute(
        text(
            "insert into reminders (tenant_id, kind, cycle, stage, recipient_user_id, "
            "notification_id, email_status) values (:t, :k, :c, :s, :u, :n, 'pending')"
        ),
        {"t": t, "k": kind, "c": cycle, "s": stage, "u": u, "n": n},
    )


async def test_notification_tables_exist(db):
    names = set(
        (
            await db.execute(
                text("select tablename from pg_tables where schemaname = 'saiflow_v3'")
            )
        ).scalars()
    )
    assert TABLES <= names
    assert not (TABLES & {t.name for t in claim_service.tenant_scoped_tables()})


async def test_reminder_unique_key(db):
    t, u = await _tenant_and_user(db)
    await _reminder(db, t, u, await _notification(db, t, u))
    n2 = await _notification(db, t, u)
    with pytest.raises(IntegrityError):
        await _reminder(db, t, u, n2)


async def test_reminder_stage_check(db):
    t, u = await _tenant_and_user(db)
    n = await _notification(db, t, u, "usage")
    with pytest.raises(IntegrityError):
        await _reminder(db, t, u, n, kind="usage", stage="d7")


async def test_notification_type_check(db):
    t, u = await _tenant_and_user(db)
    with pytest.raises(IntegrityError):
        await _notification(db, t, u, "invitation")


async def test_app_role_reads_and_writes_notifications(app_role_db):
    t, u = await _tenant_and_user(app_role_db)
    n = await _notification(app_role_db, t, u)
    await _reminder(app_role_db, t, u, n)
    await app_role_db.execute(
        text("update notifications set read_at = now() where id = :n"), {"n": n}
    )
    await app_role_db.execute(
        text(
            "update reminders set email_status = 'sent', email_at = now() "
            "where notification_id = :n"
        ),
        {"n": n},
    )
    await app_role_db.commit()


def test_downgrade_0006_refuses_with_rows(db_settings_session):
    from app.db import create_engine

    async def run(sql: str):
        engine = create_engine(db_settings_session)
        async with engine.begin() as conn:
            res = await conn.execute(text(sql))
            rows = res.all() if sql.startswith("select") else None
        await engine.dispose()
        return rows

    asyncio.run(run("insert into users (line_user_id) values ('L-downgrade')"))
    asyncio.run(
        run("insert into tenants (kind, owner_user_id) select 'personal', max(id) from users")
    )
    asyncio.run(
        run(
            "insert into notifications (user_id, tenant_id, type, data) "
            "select (select max(id) from users), max(id), 'usage', '{}'::jsonb from tenants"
        )
    )
    env = {
        **os.environ,
        "DB_HOST": db_settings_session.db_host,
        "DB_PORT": str(db_settings_session.db_port),
        "DB_NAME": db_settings_session.db_name,
        "DB_USER": db_settings_session.db_user,
        "DB_PASSWORD": db_settings_session.db_password.get_secret_value(),
    }
    r = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0005"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    try:
        assert r.returncode != 0 and "notification data" in r.stderr
        assert asyncio.run(run("select count(*) from notifications"))[0][0] >= 1
    finally:
        asyncio.run(run("delete from notifications"))
        asyncio.run(run("delete from tenants"))
        asyncio.run(run("delete from users"))
