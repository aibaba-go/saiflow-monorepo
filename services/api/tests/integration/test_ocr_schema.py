"""Tables of the scan flow (ocr-scan-flow Task 2; ADR-009 §2 T1–T9) and the seed templates
(FR-TEMPLATE-006)."""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.services.claim_service import tenant_scoped_tables

S = "saiflow_v3"
MIGRATION = Path(__file__).parents[2] / "alembic" / "versions" / "0009_ocr_scan_flow.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m0009", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _tenant(conn) -> int:
    return await conn.scalar(
        text(f"insert into {S}.tenants (kind, status) values ('guest', 'active') returning id")
    )


async def _job(conn, tenant_id: int, key: str | None = None) -> str:
    file_id, job_id = str(uuid.uuid4()), str(uuid.uuid4())
    await conn.execute(
        text(
            f"insert into {S}.files (id, tenant_id, original_name, status, page_count) "
            "values (:f, :t, 'a.png', 'READY', 1)"
        ),
        {"f": file_id, "t": tenant_id},
    )
    await conn.execute(
        text(
            f"insert into {S}.ocr_jobs (id, tenant_id, file_id, status, idempotency_key) "
            "values (:j, :t, :f, 'QUEUED', :k)"
        ),
        {"j": job_id, "t": tenant_id, "f": file_id, "k": key},
    )
    return job_id


async def test_seed_templates_once(db_engine):
    async with db_engine.begin() as conn:
        assert await conn.scalar(text(f"select count(*) from {S}.document_templates")) == 2
        codes = (await conn.execute(text(f"select code from {S}.document_templates"))).scalars()
        assert set(codes) == {"tax_invoice", "billing_note"}
        assert await conn.scalar(text(f"select count(*) from {S}.document_template_versions")) == 2
        await conn.run_sync(_migration().seed_templates)
        assert await conn.scalar(text(f"select count(*) from {S}.document_template_versions")) == 2
        missing = await conn.scalar(
            text(
                f"select count(*) from {S}.document_templates t where t.current_version_id is null"
            )
        )
        assert missing == 0


async def test_raw_result_is_immutable_for_app_role(db_engine, app_role_db):
    async with db_engine.begin() as conn:
        job_id = await _job(conn, await _tenant(conn))
    await app_role_db.execute(
        text(
            f"insert into {S}.ocr_raw_results (id, job_id, engine, payload) "
            "values (:r, :j, 'textin', '{}'::jsonb)"
        ),
        {"r": str(uuid.uuid4()), "j": job_id},
    )
    await app_role_db.commit()
    assert await app_role_db.scalar(text(f"select count(*) from {S}.ocr_raw_results")) == 1
    for sql in (
        f"update {S}.ocr_raw_results set payload = '[]'::jsonb",
        f"delete from {S}.ocr_raw_results",
    ):
        with pytest.raises(DBAPIError):
            await app_role_db.execute(text(sql))
        await app_role_db.rollback()


async def test_status_check_rejects_unknown(db_engine):
    with pytest.raises(IntegrityError):
        async with db_engine.begin() as conn:
            job_id = await _job(conn, await _tenant(conn))
            await conn.execute(
                text(f"update {S}.ocr_jobs set status = 'DONE' where id = :j"), {"j": job_id}
            )


async def test_one_current_version_per_job(db_engine):
    with pytest.raises(IntegrityError):
        async with db_engine.begin() as conn:
            job_id = await _job(conn, await _tenant(conn))
            for n in (1, 2):
                await conn.execute(
                    text(
                        f"insert into {S}.result_versions (id, job_id, version, is_current) "
                        "values (:i, :j, :n, true)"
                    ),
                    {"i": str(uuid.uuid4()), "j": job_id, "n": n},
                )


async def test_idempotency_key_unique_per_tenant_only(db_engine):
    async with db_engine.begin() as conn:
        a, b = await _tenant(conn), await _tenant(conn)
        await _job(conn, a, "K")
        await _job(conn, b, "K")  # another tenant may use the same key (A8)
    with pytest.raises(IntegrityError):
        async with db_engine.begin() as conn:
            await _job(conn, a, "K")


def test_tenant_scoped_tables_include_files_and_jobs():
    names = {t.name for t in tenant_scoped_tables()}
    assert {"files", "ocr_jobs"} <= names
    assert "ocr_raw_results" not in names  # immutable; it follows its job


def _alembic(settings, *args):
    import os
    import subprocess
    import sys

    env = {
        **os.environ,
        "DB_HOST": settings.db_host,
        "DB_PORT": str(settings.db_port),
        "DB_NAME": settings.db_name,
        "DB_USER": settings.db_user,
        "DB_PASSWORD": settings.db_password.get_secret_value(),
    }
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=MIGRATION.parents[2],
        env=env,
        capture_output=True,
        text=True,
    )


def test_downgrade_0009_refuses_with_files_and_round_trips_when_empty(db_settings_session):
    import asyncio

    from app.db import create_engine

    async def run(sql: str):
        engine = create_engine(db_settings_session)
        async with engine.begin() as conn:
            await conn.execute(text("SET LOCAL session_replication_role = replica"))
            res = await conn.execute(text(sql))
            value = res.scalar() if sql.startswith("select") else None
        await engine.dispose()
        return value

    asyncio.run(run(f"insert into {S}.tenants (kind) values ('guest')"))
    asyncio.run(
        run(
            f"insert into {S}.files (id, tenant_id, original_name) "
            f"select 'f-downgrade', max(id), 'a.png' from {S}.tenants"
        )
    )
    try:
        r = _alembic(db_settings_session, "downgrade", "0008")
        assert r.returncode != 0 and "document data" in r.stderr
        assert asyncio.run(run(f"select count(*) from {S}.files")) == 1
    finally:
        asyncio.run(run(f"delete from {S}.files"))
        asyncio.run(run(f"delete from {S}.tenants"))
    down = _alembic(db_settings_session, "downgrade", "0008")
    assert down.returncode == 0, down.stderr
    up = _alembic(db_settings_session, "upgrade", "head")
    assert up.returncode == 0, up.stderr
    assert asyncio.run(run(f"select count(*) from {S}.document_template_versions")) == 2
