# ruff: noqa: F811  (pytest fixtures imported from test_results)
"""The change log of a job: one row per save holding every field change as JSON, one row
per template switch (FR-VERIFY-007; review-flow Task 3)."""

from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.test_results import (  # noqa: F401  (fixtures)
    ai_settings,
    llm,
    result,
    save,
    sm,
    tax_job,
)

JOBS = "/api/v1/ocr/jobs"


async def changes(c, job_id, headers=None):
    r = await c.get(f"{JOBS}/{job_id}/changes", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


async def test_save_records_field_change(api, line, store, sm, ai_settings, llm, db):
    me = await login(api, line, "U1")
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    structured = body["structured"]
    structured["document"]["invoice_no"] = "IV-002"
    r = await save(api, job["id"], body["version"], structured)
    assert r.status_code == 200, r.text
    rows = (
        await db.execute(
            text("select kind, items from result_changes where job_id = :j"), {"j": job["id"]}
        )
    ).all()
    assert len(rows) == 1 and rows[0][0] == "SAVE"
    assert rows[0][1] == [
        {"path": "document.invoice_no", "before": "IV00000001", "after": "IV-002"}
    ]
    out = await changes(api, job["id"])
    assert len(out) == 1
    entry = out[0]
    assert entry["kind"] == "FIELD" and entry["path"] == "document.invoice_no"
    assert (entry["before"], entry["after"]) == ("IV00000001", "IV-002")
    assert entry["version"] == r.json()["version"]
    assert entry["user_name"] == me.get("display_name")
    assert entry["created_at"]


async def test_unchanged_save_records_nothing(api, line, store, sm, ai_settings, llm, db):
    await login(api, line, "U1")
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    assert (await save(api, job["id"], body["version"], body["structured"])).status_code == 200
    assert await changes(api, job["id"]) == []


async def test_switch_to_generic_records_template(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-007-03
    await login(api, line, "U1")
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    r = await api.post(f"{JOBS}/{job['id']}/generic")
    assert r.status_code == 200, r.text
    out = await changes(api, job["id"])
    assert len(out) == 1
    assert out[0]["kind"] == "TEMPLATE" and out[0]["path"] is None
    assert out[0]["from_template"].startswith("Tax Invoice") and out[0]["to_template"] is None


async def test_auto_mapping_records_nothing(api, line, store, sm, ai_settings, llm, db):
    await login(api, line, "U1")
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    assert await changes(api, job["id"]) == []


async def test_changes_404_for_invisible_job(api, line, store, sm, ai_settings, llm, db):
    from tests.integration.tenancy_helpers import client_like

    await login(api, line, "U1")
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    other = client_like(api)
    await login(other, line, "U2")
    assert (await other.get(f"{JOBS}/{job['id']}/changes")).status_code == 404
