"""Bidirectional primary/backup retries and global health (FR-OCR-021, FR-OCR-025)."""

from dataclasses import replace
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.db import create_sessionmaker
from app.ocr import worker
from app.ocr.engines import EngineFailure, EngineResult, EngineUnavailable, recognise
from app.services.ocr_settings_service import OcrSettings
from tests.integration.db_fixtures import login
from tests.integration.test_ocr_jobs import new_job, scans_left

SETTINGS = OcrSettings(
    primary_engine="textin",
    backup_engine="google_vision",
    retry_per_document=3,
    switch_threshold=5,
    probe_interval_seconds=300,
    llm_base_url="https://llm.invalid",
    llm_model="m",
)


class FakeEngine:
    def __init__(self, name: str, script: list[str] | None = None):
        self.name, self.script, self.calls = name, list(script or []), 0

    def run(self, *, kind, content, filename, pages):
        self.calls += 1
        step = self.script.pop(0) if self.script else "ok"
        if step in ("service", "content"):
            raise EngineFailure(step, f"{self.name.upper()}_{step}")
        return EngineResult(
            engine=self.name, raw={"by": self.name}, structured=None, page_count=pages
        )


@pytest.fixture
def sm(db_engine):
    return create_sessionmaker(db_engine)


@pytest.fixture(params=["textin", "google_vision"])
def selection(request):
    primary = request.param
    backup = "google_vision" if primary == "textin" else "textin"
    return replace(SETTINGS, primary_engine=primary, backup_engine=backup)


async def _run(sm, engines, settings=SETTINGS, now=None, sleeps=None):
    sleeps = [] if sleeps is None else sleeps

    async def sleep(seconds):
        sleeps.append(seconds)

    return await recognise(
        sm,
        kind="png",
        content=b"x",
        filename="a.png",
        pages=1,
        settings=settings,
        engines=engines,
        now=now or utcnow(),
        sleep=sleep,
    )


async def _health(db, engine):
    return (
        await db.execute(
            text(
                "select consecutive_failures, switched_at, last_probe_at "
                "from ocr_engine_health where engine = :e"
            ),
            {"e": engine},
        )
    ).one_or_none()


async def test_healthy_primary_never_calls_backup(sm, db, selection):  # AC-FR-OCR-025-04
    primary = FakeEngine(selection.primary_engine)
    backup = FakeEngine(selection.backup_engine)
    sleeps = []
    result = await _run(sm, {primary.name: primary, backup.name: backup}, selection, sleeps=sleeps)
    assert result.engine == primary.name and result.raw == {"by": primary.name}
    assert (primary.calls, backup.calls, sleeps) == (1, 0, [])
    health = await _health(db, primary.name)
    assert health.consecutive_failures == 0 and health.switched_at is None


async def test_retries_then_backup(sm, selection):  # AC-FR-OCR-021-01
    primary = FakeEngine(selection.primary_engine, ["service"] * 4)
    backup = FakeEngine(selection.backup_engine)
    sleeps = []
    result = await _run(sm, {primary.name: primary, backup.name: backup}, selection, sleeps=sleeps)
    assert (primary.calls, backup.calls) == (4, 1)
    assert result.engine == backup.name
    assert sleeps == [2, 4, 8]


async def test_backup_has_same_retry_budget(sm, selection):  # AC-FR-OCR-021-01
    primary = FakeEngine(selection.primary_engine, ["service"] * 4)
    backup = FakeEngine(selection.backup_engine, ["service"] * 3)
    sleeps = []
    result = await _run(sm, {primary.name: primary, backup.name: backup}, selection, sleeps=sleeps)
    assert result.engine == backup.name and (primary.calls, backup.calls) == (4, 4)
    assert sleeps == [2, 4, 8, 2, 4, 8]


async def test_content_failure_no_retry(sm, db, selection):  # AC-FR-OCR-021-02
    primary = FakeEngine(selection.primary_engine, ["content"])
    backup = FakeEngine(selection.backup_engine)
    sleeps = []
    with pytest.raises(EngineFailure) as err:
        await _run(sm, {primary.name: primary, backup.name: backup}, selection, sleeps=sleeps)
    assert err.value.kind == "content"
    assert (primary.calls, backup.calls, sleeps) == (1, 0, [])
    health = await _health(db, primary.name)
    assert health is None or health.consecutive_failures == 0


async def test_global_switch_and_probe_back(sm, db, selection):  # AC-FR-OCR-021-03
    t0 = utcnow()
    one_try = replace(selection, retry_per_document=1)
    primary = FakeEngine(selection.primary_engine, ["service"] * 10)
    backup = FakeEngine(selection.backup_engine)
    engines = {primary.name: primary, backup.name: backup}
    for _ in range(3):  # the fifth service failure trips the primary's global switch
        assert (await _run(sm, engines, one_try, now=t0)).engine == backup.name
    assert (primary.calls, backup.calls) == (6, 3)
    health = await _health(db, primary.name)
    assert health.consecutive_failures == 6 and health.switched_at == t0
    assert (await _run(sm, engines, one_try, now=t0 + timedelta(seconds=10))).engine == backup.name
    assert (primary.calls, backup.calls) == (6, 4)
    primary.script = []
    assert (
        await _run(sm, engines, one_try, now=t0 + timedelta(seconds=301))
    ).engine == primary.name
    health = await _health(db, primary.name)
    assert health.consecutive_failures == 0 and health.switched_at is None
    assert health.last_probe_at == t0 + timedelta(seconds=301)
    assert (
        await _run(sm, engines, one_try, now=t0 + timedelta(seconds=302))
    ).engine == primary.name
    assert (primary.calls, backup.calls) == (8, 4)


async def test_failed_probe_is_single_call_and_waits_for_interval(sm, db, selection):
    # AC-FR-OCR-021-03: a failed probe does not spend the normal four-call budget.
    t0 = utcnow()
    await db.execute(
        text(
            "insert into ocr_engine_health (engine, consecutive_failures, switched_at) "
            "values (:e, 5, :t) on conflict (engine) do update set "
            "consecutive_failures=5, switched_at=:t, last_probe_at=null"
        ),
        {"e": selection.primary_engine, "t": t0},
    )
    await db.commit()
    primary = FakeEngine(selection.primary_engine, ["service"])
    backup = FakeEngine(selection.backup_engine)
    engines = {primary.name: primary, backup.name: backup}
    sleeps = []
    assert (
        await _run(sm, engines, selection, now=t0 + timedelta(seconds=300), sleeps=sleeps)
    ).engine == backup.name
    assert (primary.calls, backup.calls, sleeps) == (1, 1, [])
    health = await _health(db, primary.name)
    assert health.switched_at == t0 and health.last_probe_at == t0 + timedelta(seconds=300)
    await _run(sm, engines, selection, now=t0 + timedelta(seconds=599))
    assert (primary.calls, backup.calls) == (1, 2)
    assert (
        await _run(sm, engines, selection, now=t0 + timedelta(seconds=600))
    ).engine == primary.name
    assert (primary.calls, backup.calls) == (2, 2)


async def test_no_backup_fails_unavailable(sm, db, selection):  # AC-FR-OCR-021-04
    no_backup = replace(selection, backup_engine="none")
    primary = FakeEngine(selection.primary_engine, ["service"] * 4)
    sleeps = []
    with pytest.raises(EngineFailure) as err:
        await _run(sm, {primary.name: primary}, no_backup, sleeps=sleeps)
    assert err.value.kind == "service" and primary.calls == 4
    assert sleeps == [2, 4, 8]
    assert (await _health(db, primary.name)).switched_at is None


async def test_missing_key_engine_skipped(sm, selection):
    backup = FakeEngine(selection.backup_engine)
    result = await _run(sm, {backup.name: backup}, selection)
    assert result.engine == backup.name and backup.calls == 1
    with pytest.raises(EngineUnavailable):
        await _run(sm, {}, selection)
    with pytest.raises(EngineUnavailable):
        await _run(sm, {backup.name: backup}, replace(selection, backup_engine="none"))


@pytest.mark.parametrize("failure", ["content", "service", "missing_key"])
async def test_worker_failure_terminal_and_releases_once(
    api, line, store, sm, app_settings, db, selection, failure
):
    # AC-FR-OCR-021-02/04, AC-FR-OCR-017-04: symmetric terminal state and reservation.
    await login(api, line)
    for key, value in (
        ("ocr_primary_engine", selection.primary_engine),
        ("ocr_backup_engine", "none"),
    ):
        await db.execute(
            text("update system_settings set value=to_jsonb(cast(:v as text)) where key=:k"),
            {"k": key, "v": value},
        )
    await db.commit()
    before = await scans_left(api)
    job = (await new_job(api)).json()
    primary = FakeEngine(selection.primary_engine, [failure] * 4)
    engines = {} if failure == "missing_key" else {primary.name: primary}
    sleeps = []

    async def no_sleep(seconds):
        sleeps.append(seconds)

    assert await worker.run_once(sm, store, app_settings, engines=engines, sleep=no_sleep)
    state = (
        await db.execute(
            text(
                "select j.status, r.released_at is not null from ocr_jobs j "
                "join quota_reservations r on r.id=j.reservation_id where j.id=:j"
            ),
            {"j": job["id"]},
        )
    ).one()
    assert tuple(state) == ("FAILED", True)
    assert primary.calls == (0 if failure == "missing_key" else 1 if failure == "content" else 4)
    assert sleeps == ([2, 4, 8] if failure == "service" else [])
    assert await scans_left(api) == before
    await worker.recover(sm, utcnow() + timedelta(hours=1))
    assert await scans_left(api) == before
    assert (
        await db.execute(
            text("select count(*) from result_versions where job_id=:j"), {"j": job["id"]}
        )
    ).scalar_one() == 0
