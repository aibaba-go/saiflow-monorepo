import asyncio
import subprocess
import sys

import pytest
from sqlalchemy import text

from app.db import create_sessionmaker
from app.services.audit_service import AuditEvent, find_first_broken, record
from tests.integration.db_fixtures import API_DIR, _env_for

pytestmark = pytest.mark.integration


def _event(i: int) -> AuditEvent:
    return AuditEvent("system", None, "x.test", "thing", str(i), "success")


async def _write(db, n: int, start: int = 0) -> None:
    for i in range(start, start + n):
        await record(db, _event(i))
        await db.commit()


async def test_record_links_to_previous(db):
    await _write(db, 3)
    rows = (await db.execute(text("select prev_hash, hash from audit_log order by id"))).all()
    assert rows[0].prev_hash == bytes(32)
    assert rows[1].prev_hash == rows[0].hash and rows[2].prev_hash == rows[1].hash
    assert await find_first_broken(db) is None


def _verify_cli(settings) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "audit-verify"],
        cwd=API_DIR,
        env=_env_for(settings),
        capture_output=True,
        text=True,
    )


async def test_verify_detects_tampering(db, migrated_db):  # AC-FR-SYS-003-04
    await _write(db, 3)
    ok = _verify_cli(migrated_db)
    assert ok.returncode == 0 and "audit log OK (3 entries)" in ok.stdout
    await db.execute(text("SET session_replication_role = replica"))
    await db.execute(text("update audit_log set action = 'forged' where id = 2"))
    await db.execute(text("SET session_replication_role = origin"))
    await db.commit()
    assert await find_first_broken(db) == 2
    bad = _verify_cli(migrated_db)
    assert bad.returncode == 1 and "id 2" in bad.stdout


async def test_concurrent_writes_keep_chain_valid(db, db_engine):  # Review Focus 4
    maker = create_sessionmaker(db_engine)

    async def writer(start: int) -> None:
        async with maker() as s:
            await _write(s, 20, start)

    await asyncio.gather(writer(0), writer(100))
    assert (await db.execute(text("select count(*) from audit_log"))).scalar_one() == 40
    assert await find_first_broken(db) is None
