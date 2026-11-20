"""rebuild-plans-metering Task 1: billing schema (migration 0005)."""

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

TABLES = {"plans", "subscriptions", "free_quotas", "quota_reservations", "plan_applications"}


async def _tenant(db, kind: str = "organization") -> int:
    return (
        await db.execute(text("insert into tenants (kind) values (:k) returning id"), {"k": kind})
    ).scalar_one()


async def test_billing_tables_exist(db):
    names = set(
        (
            await db.execute(
                text("select tablename from pg_tables where schemaname = 'saiflow_v3'")
            )
        ).scalars()
    )
    assert TABLES <= names
    assert not (TABLES & {t.name for t in claim_service.tenant_scoped_tables()})


async def test_plan_seed(db):
    rows = (
        await db.execute(
            text(
                "select code, monthly_quota, member_limit, tenant_kind from plans "
                "order by sort_order"
            )
        )
    ).all()
    assert [tuple(r) for r in rows] == [
        ("kinder", 1000, 1, "personal"),
        ("starter", 5000, 2, "organization"),
        ("intermediate", 10000, 5, "organization"),
        ("advance", 100000, None, "organization"),
    ]


async def test_free_quota_settings_seeded(db):
    values = dict(
        (
            await db.execute(
                text(
                    "select key, value from system_settings where key in "
                    "('free_quota_personal', 'free_quota_organization')"
                )
            )
        ).all()
    )
    assert values == {"free_quota_personal": 100, "free_quota_organization": 100}


async def test_kinder_member_limit_check(db):
    with pytest.raises(IntegrityError):
        await db.execute(text("update plans set member_limit = 3 where code = 'kinder'"))


async def test_reservation_split_check(db):
    t = await _tenant(db)
    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "insert into quota_reservations (tenant_id, reference, pages, from_free, "
                "from_monthly, month) values (:t, 'job-1', 8, 2, 5, date '2026-11-01')"
            ),
            {"t": t},
        )


async def test_one_pending_plan_application_per_tenant(db):
    t = await _tenant(db)
    u = (
        await db.execute(text("insert into users (line_user_id) values ('U') returning id"))
    ).scalar_one()
    sql = text(
        "insert into plan_applications (tenant_id, applicant_user_id, plan_code, period) "
        "values (:t, :u, 'starter', 'month')"
    )
    await db.execute(sql, {"t": t, "u": u})
    with pytest.raises(IntegrityError):
        await db.execute(sql, {"t": t, "u": u})


async def test_subscription_end_after_start_check(db):
    t = await _tenant(db)
    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, "
                "source) values (:t, 'starter', 'month', now(), now(), 'admin')"
            ),
            {"t": t},
        )


async def test_app_role_reads_and_writes_billing_tables(app_role_db):
    t = await _tenant(app_role_db)
    await app_role_db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, "
            "source) values (:t, 'starter', 'month', now(), now() + interval '1 month', 'admin')"
        ),
        {"t": t},
    )
    await app_role_db.execute(
        text("insert into free_quotas (tenant_id, granted, remaining) values (:t, 100, 100)"),
        {"t": t},
    )
    await app_role_db.execute(
        text(
            "insert into quota_reservations (tenant_id, reference, pages, from_free, "
            "from_monthly, month) values (:t, 'job-1', 3, 3, 0, date '2026-11-01')"
        ),
        {"t": t},
    )
    await app_role_db.execute(text("update plans set monthly_quota = 1000 where code = 'kinder'"))
    await app_role_db.commit()


def test_backfill_gives_existing_tenants_kinder(db_settings_session):
    """Migrate a scratch schema-copy: a personal tenant made at 0004 gets a Kinder month."""
    import asyncio

    from app.db import create_engine

    env = {
        **os.environ,
        "DB_HOST": db_settings_session.db_host,
        "DB_PORT": str(db_settings_session.db_port),
        "DB_NAME": db_settings_session.db_name,
        "DB_USER": db_settings_session.db_user,
        "DB_PASSWORD": db_settings_session.db_password.get_secret_value(),
    }

    def alembic(*args: str) -> None:
        r = subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=API_DIR,
            env=env,
            capture_output=True,
            text=True,
        )
        assert r.returncode == 0, r.stderr

    async def setup() -> int:
        engine = create_engine(db_settings_session)
        async with engine.begin() as conn:
            uid = (
                await conn.execute(
                    text("insert into users (line_user_id) values ('BF') returning id")
                )
            ).scalar_one()
            tid = (
                await conn.execute(
                    text(
                        "insert into tenants (kind, owner_user_id) "
                        "values ('personal', :u) returning id"
                    ),
                    {"u": uid},
                )
            ).scalar_one()
        await engine.dispose()
        return tid

    async def check(tid: int) -> list:
        engine = create_engine(db_settings_session)
        async with engine.begin() as conn:
            rows = (
                await conn.execute(
                    text(
                        "select plan_code, period, source from subscriptions where tenant_id = :t"
                    ),
                    {"t": tid},
                )
            ).all()
            await conn.execute(text("delete from subscriptions where tenant_id = :t"), {"t": tid})
            await conn.execute(text("delete from tenants where id = :t"), {"t": tid})
            await conn.execute(text("delete from users where line_user_id = 'BF'"))
        await engine.dispose()
        return [tuple(r) for r in rows]

    alembic("downgrade", "0004")
    try:
        tid = asyncio.run(setup())
    finally:
        alembic("upgrade", "head")
    assert asyncio.run(check(tid)) == [("kinder", "month", "auto")]
