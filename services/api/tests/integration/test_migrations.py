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
        "DB_SCHEMA": db_settings.db_schema,
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
