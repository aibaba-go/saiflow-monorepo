"""Primary/backup engines with per-document retries and a global switch (FR-OCR-021)."""

from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.db import create_sessionmaker
from app.ocr.engines import EngineFailure, EngineResult, EngineUnavailable, recognise
from app.services.ocr_settings_service import OcrSettings

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


async def test_retries_then_backup(sm):  # AC-FR-OCR-021-01
    textin = FakeEngine("textin", ["service"] * 4)
    vision = FakeEngine("google_vision")
    sleeps: list[float] = []
    result = await _run(sm, {"textin": textin, "google_vision": vision}, sleeps=sleeps)
    assert (textin.calls, vision.calls) == (4, 1)
    assert result.engine == "google_vision"
    assert sleeps == [2, 4, 8]


async def test_content_failure_no_retry(sm, db):  # AC-FR-OCR-021-02
    textin = FakeEngine("textin", ["content"])
    vision = FakeEngine("google_vision")
    with pytest.raises(EngineFailure) as err:
        await _run(sm, {"textin": textin, "google_vision": vision})
    assert err.value.kind == "content"
    assert (textin.calls, vision.calls) == (1, 0)
    failures = (
        await db.execute(
            text("select consecutive_failures from ocr_engine_health where engine = 'textin'")
        )
    ).scalar()
    assert not failures


async def test_global_switch_and_probe_back(sm):  # AC-FR-OCR-021-03
    t0 = utcnow()
    one_try = OcrSettings(**{**SETTINGS.__dict__, "retry_per_document": 1})
    textin = FakeEngine("textin", ["service"] * 10)
    vision = FakeEngine("google_vision")
    engines = {"textin": textin, "google_vision": vision}
    for _ in range(3):  # 2 calls each: the 5th failure in total trips the switch
        await _run(sm, engines, one_try, now=t0)
    assert textin.calls == 6
    calls = textin.calls
    await _run(sm, engines, one_try, now=t0 + timedelta(seconds=10))
    assert textin.calls == calls  # switched: straight to the backup
    textin.script = []  # TextIn has recovered
    result = await _run(sm, engines, one_try, now=t0 + timedelta(seconds=301))
    assert result.engine == "textin"  # the probe succeeded
    vision_calls = vision.calls
    result = await _run(sm, engines, one_try, now=t0 + timedelta(seconds=302))
    assert result.engine == "textin" and vision.calls == vision_calls


async def test_no_backup_fails_unavailable(sm):  # AC-FR-OCR-021-04
    no_backup = OcrSettings(**{**SETTINGS.__dict__, "backup_engine": "none"})
    textin = FakeEngine("textin", ["service"] * 4)
    with pytest.raises(EngineFailure) as err:
        await _run(sm, {"textin": textin}, no_backup)
    assert err.value.kind == "service" and textin.calls == 4


async def test_missing_key_engine_skipped(sm):
    vision = FakeEngine("google_vision")
    result = await _run(sm, {"google_vision": vision})  # TextIn has no key: not in the map
    assert result.engine == "google_vision"
    with pytest.raises(EngineUnavailable):
        await _run(sm, {})
