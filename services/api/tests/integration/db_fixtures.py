"""Fixtures for tests that need the real PostgreSQL (TEST_DB_*): migrated schema,
a session per test, an HTTPS test client, and a full cleanup after every test."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import BigInteger, Column, ForeignKey, Table, Text, text

from app.db import SCHEMA, Base, create_engine, create_sessionmaker
from app.main import create_app

API_DIR = Path(__file__).resolve().parents[2]
CSRF = {"X-Requested-With": "SaiFlow"}
WEB_REDIRECT = "https://saiflow-app.aibaba.asia/login"

# A tenant-owned table that exists only in tests, so guest-data claiming has data to move.
test_tenant_items = Table(
    "test_tenant_items",
    Base.metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("tenant_id", BigInteger, ForeignKey(f"{SCHEMA}.tenants.id"), nullable=False),
    Column("label", Text, nullable=False),
    Column("created_by_user_id", BigInteger),  # tenancy: "only what I submitted"
    info={"tenant_scoped": True},
)


async def _create_test_tables(settings) -> None:
    engine = create_engine(settings)
    async with engine.begin() as conn:
        await conn.run_sync(test_tenant_items.drop, checkfirst=True)  # columns may have changed
        await conn.run_sync(test_tenant_items.create)
    await engine.dispose()


def _env_for(settings) -> dict:
    return {
        **os.environ,
        "DB_HOST": settings.db_host,
        "DB_PORT": str(settings.db_port),
        "DB_NAME": settings.db_name,
        "DB_USER": settings.db_user,
        "DB_PASSWORD": settings.db_password.get_secret_value(),
    }


APP_ROLE = "saiflow_v3_app"  # what migration 0003 grants to (DB_APP_USER default)
APP_ROLE_PASSWORD = "local-app"


async def _ensure_app_role(settings) -> None:
    """The least-privilege application role, as the server has it (AC-FR-SYS-003-06)."""
    engine = create_engine(settings)
    async with engine.begin() as conn:
        exists = await conn.scalar(
            text("select 1 from pg_roles where rolname = :r"), {"r": APP_ROLE}
        )
        if not exists:
            await conn.execute(text(f"CREATE ROLE {APP_ROLE} LOGIN"))
        # always reset: a local role left over with another password must still work (M6)
        await conn.execute(text(f"ALTER ROLE {APP_ROLE} LOGIN PASSWORD '{APP_ROLE_PASSWORD}'"))
        await conn.execute(text(f'GRANT CONNECT ON DATABASE "{settings.db_name}" TO {APP_ROLE}'))
    await engine.dispose()


@pytest.fixture(scope="session")
def migrated_db(db_settings_session):
    asyncio.run(_ensure_app_role(db_settings_session))
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_DIR,
        env=_env_for(db_settings_session),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    asyncio.run(_create_test_tables(db_settings_session))
    return db_settings_session


def _seed_templates(conn) -> None:
    import importlib.util

    path = API_DIR / "alembic" / "versions" / "0009_ocr_scan_flow.py"
    spec = importlib.util.spec_from_file_location("m0009", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.seed_templates(conn)


async def _truncate_all(engine) -> None:
    import app.models  # noqa: F401  (registers every table on Base.metadata)

    names = [f'"{SCHEMA}"."{t.name}"' for t in Base.metadata.sorted_tables]
    if not names:
        return
    async with engine.begin() as conn:
        # replica role skips the append-only trigger on audit_log (superuser test DB only)
        await conn.execute(text("SET LOCAL session_replication_role = replica"))
        await conn.execute(text(f"TRUNCATE {', '.join(names)} RESTART IDENTITY CASCADE"))
        # seed rows written by migrations (0004, 0005)
        await conn.execute(
            text(
                f'INSERT INTO "{SCHEMA}".plans (code, monthly_quota, member_limit, tenant_kind, '
                "sort_order, monthly_price, yearly_price) VALUES "
                "('kinder', 1000, 1, 'personal', 1, NULL, 888), "
                "('starter', 5000, 2, 'organization', 2, 599, 5990), "
                "('intermediate', 10000, 5, 'organization', 3, NULL, NULL), "
                "('advance', 100000, NULL, 'organization', 4, NULL, NULL)"
            )
        )
        await conn.execute(
            text(
                f'INSERT INTO "{SCHEMA}".system_settings (key, value) '
                "VALUES ('org_member_limit_unpaid', '2'), ('free_quota_personal', '100'), "
                "('free_quota_organization', '100')"
            )
        )
        # seed rows written by 0009 (the two system templates)
        await conn.run_sync(_seed_templates)
        # seed rows written by 0008 (OCR and LLM settings)
        from app.services.ocr_settings_service import DEFAULTS as OCR_DEFAULTS

        for key, value in OCR_DEFAULTS.items():
            await conn.execute(
                text(
                    f'INSERT INTO "{SCHEMA}".system_settings (key, value) '
                    "VALUES (:k, CAST(:v AS jsonb))"
                ),
                {"k": key, "v": json.dumps(value)},
            )


@pytest.fixture
async def db_engine(migrated_db):
    engine = create_engine(migrated_db)
    yield engine
    await _truncate_all(engine)
    await engine.dispose()


@pytest.fixture
async def db(db_engine):
    async with create_sessionmaker(db_engine)() as session:
        yield session


@pytest.fixture
def app_settings(migrated_db):
    """Settings for the app under test; tests may replace fields with model_copy. The app
    connects as the least-privilege application role, as on the server (M6); `db` stays
    the superuser for setup and assertions."""
    return migrated_db.model_copy(
        update={
            "line_login_redirect_uris": WEB_REDIRECT,
            "db_user": APP_ROLE,
            "db_password": SecretStr(APP_ROLE_PASSWORD),
        }
    )


@pytest.fixture
def line():
    from tests.integration.fake_line import FakeLineClient

    return FakeLineClient()


@pytest.fixture
def mail():
    from tests.integration.fake_email import FakeEmailSender

    return FakeEmailSender()


async def login(api, line, sub: str = "U1", **claims) -> dict:
    """Log in through the real endpoint with a fake LINE identity; returns MeResponse."""
    line.add(f"tok-{sub}", sub, **claims)
    r = await api.post("/api/v1/auth/line", json={"id_token": f"tok-{sub}"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
async def api(db_engine, app_settings, line, mail):
    from asgi_lifespan import LifespanManager

    app = create_app(app_settings)
    app.state.line_client = line
    app.state.email_sender = mail
    async with LifespanManager(app) as manager:
        transport = httpx.ASGITransport(app=manager.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://test", headers=CSRF
        ) as client:
            client.app = app
            yield client


@pytest.fixture
async def app_role_db(migrated_db, db_engine):
    """A session connected as the application role instead of the test superuser."""
    settings = migrated_db.model_copy(
        update={"db_user": APP_ROLE, "db_password": SecretStr(APP_ROLE_PASSWORD)}
    )
    engine = create_engine(settings)
    async with create_sessionmaker(engine)() as session:
        yield session
    await engine.dispose()
