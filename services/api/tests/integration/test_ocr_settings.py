"""OCR configuration and atomic primary swaps (FR-SYS-005, FR-SYS-162)."""

import asyncio
import threading

import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.db import create_sessionmaker
from app.ocr import worker
from app.services import ocr_settings_service
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import admin_client, registered_client
from tests.integration.test_ocr_jobs import new_job
from tests.integration.test_template_mapping import FakeLlm, PayloadEngine, raw_result

pytestmark = pytest.mark.integration

URL = "/api/v1/admin/ocr-settings"
DEFAULTS = {
    "primary_engine": "textin",
    "backup_engine": "google_vision",
    "retry_per_document": 3,
    "switch_threshold": 5,
    "probe_interval_seconds": 300,
    "llm_base_url": "https://api.deepseek.com",
    "llm_model": "deepseek-flash",
}


async def test_defaults_and_key_status(api, db):  # AC-FR-SYS-005-01
    api.app.state.settings = api.app.state.settings.model_copy(
        update={"textin_app_id": "app-id-1", "textin_secret_code": SecretStr("very-secret-code")}
    )
    admin = await admin_client(api, db)
    r = await admin.get(URL)
    assert r.status_code == 200, r.text
    body = r.json()
    assert {k: body[k] for k in DEFAULTS} == DEFAULTS
    assert body["keys"] == {"textin": True, "google_vision": False, "llm": False}
    assert "very-secret-code" not in r.text and "app-id-1" not in r.text


async def test_patch_one_field(api, db):  # AC-FR-SYS-005-02
    admin = await admin_client(api, db)
    r = await admin.patch(URL, json={"retry_per_document": 2})
    assert r.status_code == 200, r.text
    assert r.json()["retry_per_document"] == 2
    assert {k: r.json()[k] for k in DEFAULTS if k != "retry_per_document"} == {
        k: v for k, v in DEFAULTS.items() if k != "retry_per_document"
    }
    rows = (
        (await db.execute(text("select target_id from audit_log where action = 'setting.update'")))
        .scalars()
        .all()
    )
    assert rows == ["ocr_retry_per_document"]


@pytest.mark.parametrize(
    ("body", "fields"),
    [
        ({"primary_engine": "google_vision"}, ["backup_engine"]),
        ({"primary_engine": "tesseract"}, ["primary_engine"]),
        ({"backup_engine": "textin"}, ["backup_engine"]),
        ({"retry_per_document": 0}, ["retry_per_document"]),
        ({"retry_per_document": 11}, ["retry_per_document"]),
        ({"retry_per_document": "3"}, ["retry_per_document"]),
        ({"retry_per_document": True}, ["retry_per_document"]),
        ({"switch_threshold": 101}, ["switch_threshold"]),
        ({"probe_interval_seconds": 29}, ["probe_interval_seconds"]),
        ({"llm_base_url": "http://api.deepseek.com"}, ["llm_base_url"]),
        ({"llm_base_url": "https://" + "a" * 500}, ["llm_base_url"]),
        ({"llm_model": "   "}, ["llm_model"]),
    ],
)
async def test_validation(api, db, body, fields):  # AC-FR-SYS-005-03
    admin = await admin_client(api, db)
    r = await admin.patch(URL, json=body)
    assert r.status_code == 400 and r.json()["fields"] == fields, (body, r.text)
    assert {k: (await admin.get(URL)).json()[k] for k in DEFAULTS} == DEFAULTS
    assert (
        await db.execute(text("select count(*) from audit_log where action='setting.update'"))
    ).scalar_one() == 0


async def test_backup_none_and_swap(api, db):
    admin = await admin_client(api, db)
    r = await admin.patch(URL, json={"primary_engine": "google_vision", "backup_engine": "none"})
    assert r.status_code == 200, r.text
    r = await admin.patch(URL, json={"primary_engine": "textin", "backup_engine": "google_vision"})
    assert r.status_code == 200


async def test_reader_returns_current(api, db):  # AC-FR-SYS-005-04
    admin = await admin_client(api, db)
    await admin.patch(URL, json={"primary_engine": "google_vision", "backup_engine": "textin"})
    current = await ocr_settings_service.get(db)
    assert (current.primary_engine, current.backup_engine) == ("google_vision", "textin")
    assert current.retry_per_document == 3


async def test_reader_falls_back_to_defaults(db):
    await db.execute(text("delete from system_settings where key like 'ocr_%' or key like 'llm_%'"))
    await db.commit()
    current = await ocr_settings_service.get(db)
    assert current.primary_engine == "textin" and current.llm_model == "deepseek-flash"


async def test_admin_only(api, db, line, mail):  # AC-FR-SYS-005-05
    user, _ = await registered_client(api, line, mail, "U")
    assert (await user.get(URL)).status_code == 401
    assert (await user.patch(URL, json={"retry_per_document": 2})).status_code == 401


async def test_app_role_reads_settings(app_role_db):
    current = await ocr_settings_service.get(app_role_db)
    assert current.switch_threshold == 5


async def _setting_audits(db):
    return (
        await db.execute(
            text("select id, target_id from audit_log where action='setting.update' order by id")
        )
    ).all()


@pytest.mark.parametrize("primary", ["google_vision", "textin"])
async def test_atomic_swap_preserves_other_values_and_audits(api, db, primary):
    # AC-FR-SYS-162-01/02, AC-FR-SYS-005-02/04.
    admin = await admin_client(api, db)
    old = "textin" if primary == "google_vision" else "google_vision"
    custom = {
        "primary_engine": old,
        "backup_engine": primary,
        "retry_per_document": 2,
        "switch_threshold": 9,
        "probe_interval_seconds": 600,
        "llm_base_url": "https://llm.invalid/v1",
        "llm_model": "custom-model",
    }
    initial = await admin.patch(URL, json=custom)
    assert initial.status_code == 200, initial.text
    before = await _setting_audits(db)
    changed = {"primary_engine": primary, "backup_engine": old}
    response = await admin.patch(URL, json=changed)
    assert response.status_code == 200, response.text
    expected = custom | changed
    assert {k: response.json()[k] for k in DEFAULTS} == expected
    reloaded = await admin.get(URL)
    assert {k: reloaded.json()[k] for k in DEFAULTS} == expected
    assert reloaded.json()["keys"] == initial.json()["keys"]
    async with create_sessionmaker(db.bind)() as fresh:
        assert (await ocr_settings_service.get(fresh)).__dict__ == expected
    delta = [row.target_id for row in await _setting_audits(db) if row not in before]
    assert sorted(delta) == ["ocr_backup_engine", "ocr_primary_engine"]
    assert (await admin.patch(URL, json=changed)).status_code == 200
    assert len(await _setting_audits(db)) == len(before) + 2  # no-op is not re-audited


@pytest.mark.parametrize("bad_field", ["conflict", "retry_per_document", "llm_model"])
async def test_invalid_mixed_patch_is_atomic_without_audit(api, db, bad_field):
    # AC-FR-SYS-162-04: do not apply valid fields from an invalid swap request.
    admin = await admin_client(api, db)
    initial = (await admin.get(URL)).json()
    before = await _setting_audits(db)
    request = {"primary_engine": "google_vision", "backup_engine": "textin", "llm_model": "new"}
    if bad_field == "conflict":
        request["backup_engine"] = "google_vision"
        expected_field = "backup_engine"
    else:
        request[bad_field] = 0 if bad_field == "retry_per_document" else " "
        expected_field = bad_field
    response = await admin.patch(URL, json=request)
    assert response.status_code == 400, response.text
    assert response.json()["fields"] == [expected_field]
    assert (await admin.get(URL)).json() == initial
    assert await _setting_audits(db) == before
    async with create_sessionmaker(db.bind)() as fresh:
        assert (await ocr_settings_service.get(fresh)).__dict__ == DEFAULTS


@pytest.mark.parametrize("primary", ["google_vision", "textin"])
async def test_none_backup_is_preserved_by_primary_only_patch(api, db, primary):
    admin = await admin_client(api, db)
    other = "textin" if primary == "google_vision" else "google_vision"
    assert (
        await admin.patch(URL, json={"primary_engine": other, "backup_engine": "none"})
    ).status_code == 200
    before = await _setting_audits(db)
    response = await admin.patch(URL, json={"primary_engine": primary})
    assert response.status_code == 200, response.text
    assert response.json()["backup_engine"] == "none"
    assert (await admin.get(URL)).json()["primary_engine"] == primary
    assert [r.target_id for r in await _setting_audits(db) if r not in before] == [
        "ocr_primary_engine"
    ]


@pytest.mark.parametrize("primary", ["textin", "google_vision"])
async def test_worker_reads_swap_next_job_not_during_active_call(
    api, line, store, db_engine, db, app_settings, primary
):
    # FR-SYS-005, AC-FR-OCR-025-04: hold the first call while saving a global swap.
    await login(api, line)
    admin = await admin_client(api, db)
    other = "google_vision" if primary == "textin" else "textin"
    assert (
        await admin.patch(URL, json={"primary_engine": primary, "backup_engine": other})
    ).status_code == 200
    await db.execute(text("update document_templates set status='DISABLED'"))
    await db.commit()
    sm = create_sessionmaker(db_engine)
    settings = app_settings.model_copy(update={"llm_api_key": SecretStr("synthetic-key")})
    llm = FakeLlm()
    llm.replies["generic"] = [{"document": {"invoice_no": "IV-Vision"}}]
    entered, release = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()

    class BlockingEngine(PayloadEngine):
        def run(self, **kwargs):
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(10), "test did not release the active engine call"
            return super().run(**kwargs)

    first_engine, next_engine = BlockingEngine(primary), PayloadEngine(other)
    engines = {primary: first_engine, other: next_engine}
    first = (await new_job(api)).json()
    task = asyncio.create_task(
        worker.run_once(sm, store, settings, engines=engines, llm_transport=llm.transport)
    )
    try:
        await asyncio.wait_for(entered.wait(), 10)
        swapped = await admin.patch(URL, json={"primary_engine": other, "backup_engine": primary})
        assert swapped.status_code == 200, swapped.text
    finally:
        release.set()
        await asyncio.wait_for(task, 10)
    assert (first_engine.calls, next_engine.calls) == (1, 0)
    assert (await raw_result(db, first["id"])).engine == primary
    second = (await new_job(api)).json()
    assert await worker.run_once(sm, store, settings, engines=engines, llm_transport=llm.transport)
    assert (first_engine.calls, next_engine.calls) == (1, 1)
    assert (await raw_result(db, second["id"])).engine == other
    recorded = (
        await db.execute(
            text("select id, engine, status from ocr_jobs where id in (:a, :b)"),
            {"a": first["id"], "b": second["id"]},
        )
    ).all()
    assert {r.id: (r.engine, r.status) for r in recorded} == {
        first["id"]: (primary, "SUCCEEDED"),
        second["id"]: (other, "SUCCEEDED"),
    }
    assert llm.calls == ["generic"]
