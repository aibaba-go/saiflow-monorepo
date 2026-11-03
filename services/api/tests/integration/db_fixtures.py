"""Fixtures for tests that need the real PostgreSQL (TEST_DB_*): migrated schema,
a session per test, an HTTPS test client, and a full cleanup after every test."""

import os
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from sqlalchemy import text

from app.db import SCHEMA, Base, create_engine, create_sessionmaker
from app.main import create_app

API_DIR = Path(__file__).resolve().parents[2]
CSRF = {"X-Requested-With": "SaiFlow"}


def _env_for(settings) -> dict:
    return {
        **os.environ,
        "DB_HOST": settings.db_host,
        "DB_PORT": str(settings.db_port),
        "DB_NAME": settings.db_name,
        "DB_USER": settings.db_user,
        "DB_PASSWORD": settings.db_password.get_secret_value(),
    }


@pytest.fixture(scope="session")
def migrated_db(db_settings_session):
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_DIR,
        env=_env_for(db_settings_session),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return db_settings_session


async def _truncate_all(engine) -> None:
    import app.models  # noqa: F401  (registers every table on Base.metadata)

    names = [f'"{SCHEMA}"."{t.name}"' for t in Base.metadata.sorted_tables]
    if not names:
        return
    async with engine.begin() as conn:
        # replica role skips the append-only trigger on audit_log (superuser test DB only)
        await conn.execute(text("SET LOCAL session_replication_role = replica"))
        await conn.execute(text(f"TRUNCATE {', '.join(names)} RESTART IDENTITY CASCADE"))


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
    """Settings for the app under test; tests may replace fields with model_copy."""
    return migrated_db


@pytest.fixture
async def api(db_engine, app_settings):
    from asgi_lifespan import LifespanManager

    app = create_app(app_settings)
    async with LifespanManager(app) as manager:
        transport = httpx.ASGITransport(app=manager.app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url="https://test", headers=CSRF
        ) as client:
            client.app = app
            yield client
