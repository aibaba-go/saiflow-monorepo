"""Recognition worker (FR-OCR-018, FR-OCR-022): claim, engines, raw result and version 1,
failures and cancellation with the reservation released once, recovery (Review Focus 1)."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.clock import utcnow
from app.db import create_sessionmaker
from app.ocr import worker
from app.ocr.engines import EngineFailure, EngineResult
from tests.integration.db_fixtures import login
from tests.integration.test_ocr_jobs import new_job, scans_left
from tests.integration.test_uploads import pdf


class FakeEngine:
    def __init__(self, name="textin", script=None, structured=None, on_call=None):
        self.name, self.script, self.calls = name, list(script or []), 0
        self.structured = {"invoice_no": "IV1"} if structured is None else structured
        self.on_call = on_call

    def run(self, *, kind, content, filename, pages):
        self.calls += 1
        if self.on_call:
            self.on_call()
        step = self.script.pop(0) if self.script else "ok"
        if step in ("service", "content"):
            raise EngineFailure(step, f"FAKE_{step.upper()}")
        return EngineResult(
            engine=self.name,
            raw={"llm_json": self.structured},
            structured=self.structured,
            page_count=pages,
        )


@pytest.fixture
def sm(db_engine):
    return create_sessionmaker(db_engine)


async def _no_sleep(_seconds):
    return None


async def run(sm, store, app_settings, engines):
    return await worker.run_once(sm, store, app_settings, engines=engines, sleep=_no_sleep)


async def _status(db, job_id):
    return (
        await db.execute(
            text("select status, error_code, engine from ocr_jobs where id=:j"), {"j": job_id}
        )
    ).one()


async def test_success_writes_raw_and_v1(api, line, store, db, sm, app_settings, app_role_db):
    await login(api, line)
    job = (await new_job(api)).json()
    assert await run(sm, store, app_settings, {"textin": FakeEngine()}) is True
    assert tuple(await _status(db, job["id"])) == ("SUCCEEDED", None, "textin")
    raw = (await db.execute(text("select engine, payload from ocr_raw_results"))).one()
    assert raw[0] == "textin" and raw[1] == {"llm_json": {"invoice_no": "IV1"}}
    v = (
        await db.execute(text("select version, is_current, structured from result_versions"))
    ).one()
    assert tuple(v) == (1, True, {"invoice_no": "IV1"})
    with pytest.raises(DBAPIError):  # AC-FR-OCR-018-01: written once
        await app_role_db.execute(text("update ocr_raw_results set payload = '{}'"))
    await app_role_db.rollback()
    # the automatic template mapping starts right after recognition (FR-OCR-019, Task 8)
    stage = (await api.get(f"/api/v1/ocr/jobs/{job['id']}")).json()["stage"]
    assert stage == "TEMPLATE_MATCHING"
    assert await run(sm, store, app_settings, {"textin": FakeEngine()}) is False  # nothing left


async def test_failure_releases_reservation_once(api, line, store, db, sm, app_settings):
    await login(api, line)
    before = await scans_left(api)
    job = (await new_job(api, pdf(3), "c.pdf")).json()
    await run(sm, store, app_settings, {"textin": FakeEngine(script=["content"])})
    assert tuple(await _status(db, job["id"]))[:2] == ("FAILED", "FAKE_CONTENT")
    assert await scans_left(api) == before
    await worker.recover(sm, utcnow() + timedelta(hours=1))  # a later recovery changes nothing
    assert await scans_left(api) == before


async def test_cancel_during_processing_wins(api, line, store, db, sm, app_settings):
    await login(api, line)
    before = await scans_left(api)
    job = (await new_job(api)).json()

    main_loop = asyncio.get_running_loop()

    async def go():
        async with sm() as s:
            await s.execute(
                text("update ocr_jobs set status='CANCEL_REQUESTED' where id=:j"), {"j": job["id"]}
            )
            await s.commit()

    def cancel_now():
        # engines run in a worker thread; the update runs on the test's own loop
        asyncio.run_coroutine_threadsafe(go(), main_loop).result()

    await run(sm, store, app_settings, {"textin": FakeEngine(on_call=cancel_now)})
    assert tuple(await _status(db, job["id"]))[0] == "CANCELLED"
    assert (await db.execute(text("select count(*) from result_versions"))).scalar() == 0
    assert await scans_left(api) == before


@pytest.mark.parametrize(
    ("state", "stale", "expected", "released"),
    [
        ("QUEUED", True, "SUCCEEDED", False),  # never claimed: processed normally
        ("PREPROCESSING", True, "SUCCEEDED", False),  # re-queued, then processed
        ("PREPROCESSING", False, "PREPROCESSING", False),  # still fresh: left alone
        ("PROCESSING", True, "FAILED", True),  # engine result unknown: failed (AC-022-01)
        ("POSTPROCESSING", True, "FAILED", True),
        ("CANCEL_REQUESTED", True, "CANCELLED", True),
    ],
)
async def test_recover_each_state(  # AC-FR-OCR-022-01, Review Focus 1
    api, line, store, db, sm, app_settings, state, stale, expected, released
):
    await login(api, line)
    before = await scans_left(api)
    job = (await new_job(api)).json()
    age = timedelta(minutes=11) if stale else timedelta(minutes=1)
    await db.execute(
        text("update ocr_jobs set status=:s, updated_at=:t where id=:j"),
        {"s": state, "t": utcnow() - age, "j": job["id"]},
    )
    await db.commit()
    await worker.recover(sm, utcnow())
    await run(sm, store, app_settings, {"textin": FakeEngine()})
    status, code, _ = await _status(db, job["id"])
    assert status == expected
    if expected == "FAILED":
        assert code == "VENDOR_UNCERTAIN"
    # a released reservation gives the page back; a job still alive or done keeps it
    assert await scans_left(api) == (before if released else before - 1)
    if released:
        await worker.recover(sm, utcnow() + timedelta(hours=1))
        assert await scans_left(api) == before  # never released twice


async def test_two_workers_claim_once(api, line, store, db, sm, app_settings):
    await login(api, line)
    job = (await new_job(api)).json()
    engine = FakeEngine()
    done = await asyncio.gather(
        run(sm, store, app_settings, {"textin": engine}),
        run(sm, store, app_settings, {"textin": engine}),
    )
    assert sorted(done) == [False, True]
    assert engine.calls == 1
    assert tuple(await _status(db, job["id"]))[0] == "SUCCEEDED"


async def test_missing_object_fails_file_missing(api, line, store, db, sm, app_settings):
    await login(api, line)
    before = await scans_left(api)
    job = (await new_job(api)).json()
    store.objects.clear()
    await run(sm, store, app_settings, {"textin": FakeEngine()})
    assert tuple(await _status(db, job["id"]))[:2] == ("FAILED", "FILE_MISSING")
    assert await scans_left(api) == before


async def test_engine_unavailable_fails(api, line, store, db, sm, app_settings):
    await login(api, line)
    job = (await new_job(api)).json()
    await run(sm, store, app_settings, {})  # no engine has a key
    assert tuple(await _status(db, job["id"]))[:2] == ("FAILED", "OCR_UNAVAILABLE")


async def test_expired_uploads_are_purged(api, line, store, db, sm, app_settings):
    await login(api, line)
    r = await api.post("/api/v1/uploads", json={"file_name": "a.png"})
    uid = r.json()["id"]
    from tests.integration.test_uploads import png

    await api.put(f"/api/v1/uploads/{uid}/content", content=png())
    await db.execute(
        text("update files set expires_at = now() - interval '1 second' where id=:i"), {"i": uid}
    )
    await db.commit()
    assert store.objects
    assert await worker.purge_uploads(sm, store) == 1
    assert store.objects == {}
    status = (await db.execute(text("select status from files where id=:i"), {"i": uid})).scalar()
    assert status == "REJECTED"
