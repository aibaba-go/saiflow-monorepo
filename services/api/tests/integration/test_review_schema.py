"""Tables of the review flow (review-flow Task 1): review levels, rounds, records, change
log rows and notices; the new review statuses; official_at filled for jobs confirmed
before the change."""

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.integration.test_ocr_schema import _job, _tenant

S = "saiflow_v3"
MIGRATION = Path(__file__).parents[2] / "alembic" / "versions" / "0013_review_flow.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m0013", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_migration_backfills_official_at(db_engine):
    async with db_engine.begin() as conn:
        job = await _job(conn, await _tenant(conn))
        await conn.execute(
            text(
                f"update {S}.ocr_jobs set status='SUCCEEDED', review_status='CONFIRMED', "
                "confirmed_at = now() - interval '2 days', official_at = null where id = :j"
            ),
            {"j": job},
        )
        await conn.run_sync(_migration().backfill_official_at)
        same = await conn.scalar(
            text(f"select official_at = confirmed_at from {S}.ocr_jobs where id = :j"), {"j": job}
        )
    assert same is True


async def test_review_status_check_accepts_pending(db_engine):
    async with db_engine.begin() as conn:
        job = await _job(conn, await _tenant(conn))
        await conn.execute(
            text(f"update {S}.ocr_jobs set review_status='PENDING_L2' where id = :j"), {"j": job}
        )
    with pytest.raises(IntegrityError):
        async with db_engine.begin() as conn:
            await conn.execute(
                text(f"update {S}.ocr_jobs set review_status='PENDING_L3' where id = :j"),
                {"j": job},
            )


async def _round(conn, job: str, no: int, status: str = "OPEN") -> None:
    await conn.execute(
        text(
            f"insert into {S}.review_rounds (job_id, round_no, required_level, current_level, "
            "status, level_entered_at) values (:j, :n, 1, 1, :s, now())"
        ),
        {"j": job, "n": no, "s": status},
    )


async def test_one_open_round_per_job(db_engine):
    async with db_engine.begin() as conn:
        job = await _job(conn, await _tenant(conn))
        await _round(conn, job, 1, "RETURNED")
        await _round(conn, job, 2)
    with pytest.raises(IntegrityError):
        async with db_engine.begin() as conn:
            await _round(conn, job, 3)


async def test_level_range(db_engine):
    async with db_engine.begin() as conn:
        tenant = await _tenant(conn)
        await conn.execute(
            text(f"insert into {S}.review_levels (tenant_id, level) values (:t, 2)"), {"t": tenant}
        )
    with pytest.raises(IntegrityError):
        async with db_engine.begin() as conn:
            await conn.execute(
                text(f"update {S}.review_levels set level = 3 where tenant_id = :t"),
                {"t": tenant},
            )
    with pytest.raises(IntegrityError):  # one generic level per tenant
        async with db_engine.begin() as conn:
            await conn.execute(
                text(f"insert into {S}.review_levels (tenant_id, level) values (:t, 1)"),
                {"t": tenant},
            )


async def test_change_rows_and_notification_type(db_engine):
    async with db_engine.begin() as conn:
        tenant = await _tenant(conn)
        job = await _job(conn, tenant)
        user = await conn.scalar(
            text(f"insert into {S}.users (line_user_id) values (:l) returning id"),
            {"l": f"L{uuid.uuid4()}"},
        )
        await conn.execute(
            text(
                f"insert into {S}.result_changes (job_id, kind, items, user_id) "
                """values (:j, 'SAVE', '[{"path": "g.a", "before": "1", "after": "2"}]', :u)"""
            ),
            {"j": job, "u": user},
        )
        nid = await conn.scalar(
            text(
                f"insert into {S}.notifications (user_id, tenant_id, type, data) "
                """values (:u, :t, 'review_pending', '{"stage": "l1"}') returning id"""
            ),
            {"u": user, "t": tenant},
        )
        await conn.execute(
            text(
                f"insert into {S}.review_notices (job_id, round_no, level, recipient_user_id, "
                "notification_id, email_status) values (:j, 1, 1, :u, :n, 'pending')"
            ),
            {"j": job, "u": user, "n": nid},
        )
        enabled = await conn.scalar(
            text(f"select review_email_enabled from {S}.organizations limit 1")
        )
    assert enabled in (None, False)
