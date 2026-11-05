"""web-admin-console Task 3: OCR engine and LLM settings (FR-SYS-005)."""

import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.services import ocr_settings_service
from tests.integration.tenancy_helpers import admin_client, registered_client

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
