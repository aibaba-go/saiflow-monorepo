"""Results: versions, conflicts, the confirm gate and the lock (FR-VERIFY-015, 009, 006;
Review Focus 2)."""

import asyncio

import pytest
from sqlalchemy import text

from app.db import create_sessionmaker
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.integration.test_ocr_jobs import new_job
from tests.integration.test_template_mapping import TAX_OUTPUT, FakeLlm, mapping_pass, recognised

JOBS = "/api/v1/ocr/jobs"


@pytest.fixture
def sm(db_engine):
    return create_sessionmaker(db_engine)


@pytest.fixture
def llm():
    return FakeLlm()


@pytest.fixture
def ai_settings(app_settings):
    from pydantic import SecretStr

    return app_settings.model_copy(update={"llm_api_key": SecretStr("llm-key")})


async def tax_job(api, store, sm, settings, llm, db):
    """A job whose current result is a converted Tax Invoice."""
    tax = (
        await db.execute(
            text(
                "select v.id from document_template_versions v join document_templates t "
                "on t.id = v.template_id where t.code = 'tax_invoice'"
            )
        )
    ).scalar()
    job = await recognised(api, store, sm, settings, llm)
    llm.replies["match"] = [{"ranking": [{"template_version_id": tax, "score": 0.9}]}]
    llm.replies["convert"] = [TAX_OUTPUT]
    await mapping_pass(sm, settings, llm)
    return job


async def result(c, job_id, headers=None):
    r = await c.get(f"{JOBS}/{job_id}/result", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


async def save(c, job_id, version, structured, confirm=False, headers=None):
    body = {"expected_version": version, "structured": structured}
    if confirm:
        body["confirm"] = True
    return await c.patch(f"{JOBS}/{job_id}/result", json=body, headers=headers or {})


async def registered(api, line, mail, sub="R1"):
    from tests.integration.test_registration import register

    return await register(api, line, mail, sub=sub, email=f"{sub.lower()}@example.com")


async def test_save_creates_new_version_keeps_old(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-015-01
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    assert body["template"]["name"].startswith("Tax Invoice") and body["confirmed"] is False
    structured = body["structured"]
    structured["document"]["invoice_no"] = "IV-002"
    r = await save(api, job["id"], body["version"], structured)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == body["version"] + 1
    assert r.json()["structured"]["document"]["invoice_no"] == "IV-002"
    old = (
        await db.execute(
            text("select structured from result_versions where job_id=:j and version=:v"),
            {"j": job["id"], "v": body["version"]},
        )
    ).scalar()
    assert old["document"]["invoice_no"] == "IV00000001"
    again = await save(api, job["id"], r.json()["version"], r.json()["structured"])
    assert again.json()["version"] == r.json()["version"]  # unchanged content: no new version


async def test_conflict_409(api, line, store, sm, ai_settings, llm, db):  # AC-FR-VERIFY-015-02
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    first = dict(body["structured"]) | {"other": {"note": "V"}}
    assert (await save(api, job["id"], body["version"], first)).status_code == 200
    r = await save(api, job["id"], body["version"], body["structured"])
    assert (r.status_code, r.json()["code"]) == (409, "version_conflict")
    # the template's own "other" group is completed (remark: null); the extra key stays
    assert (await result(api, job["id"]))["structured"]["other"]["note"] == "V"


async def test_rows_add_delete(api, line, store, sm, ai_settings, llm, db):  # AC-015-03
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    rows = body["structured"]["goods"]["line_items"]
    rows.append({"seq": 2, "description": "B", "quantity": "3", "amount": "9.00"})
    rows.append({"seq": 3, "description": "C", "quantity": "1", "amount": "1.00"})
    del rows[1]
    r = await save(api, job["id"], body["version"], body["structured"])
    saved = r.json()["structured"]["goods"]["line_items"]
    assert [row["description"] for row in saved] == ["A", "C"]
    assert saved[1]["unit"] is None  # template columns filled in


async def test_permissions_own_vs_others(api, line, store, sm, ai_settings, llm, db):  # AC-015-04
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            "values (:t, 'starter', 'month', now() - interval '1 day', now() + interval '20 days', "
            "'admin')"
        ),
        {"t": org},
    )
    await db.commit()
    role = await make_role(db, org, "Clerk", ["upload_ocr", "verify_own", "data_browse"])
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], role)
    mine = (await new_job(api, headers=tenant(org))).json()
    theirs = (await new_job(owner, headers=tenant(org))).json()
    await db.execute(text("update ocr_jobs set status='SUCCEEDED'"))
    await db.execute(
        text(
            "insert into result_versions (id, job_id, version, is_current, structured) "
            "select gen_random_uuid()::text, id, 1, true, '{}' from ocr_jobs"
        )
    )
    await db.commit()
    assert (
        await save(api, mine["id"], 1, {"a": {"b": "1"}}, headers=tenant(org))
    ).status_code == 200
    r = await save(api, theirs["id"], 1, {"a": {"b": "1"}}, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")


async def test_confirm_required_missing_422_writes_nothing(
    api, line, mail, store, sm, ai_settings, llm, db
):  # AC-FR-VERIFY-009-01
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    body["structured"]["document"]["invoice_date"] = None
    r = await save(api, job["id"], body["version"], body["structured"], confirm=True)
    assert (r.status_code, r.json()["code"]) == (422, "required_missing")
    assert "structured.document.invoice_date" in r.json()["fields"]
    assert (await result(api, job["id"]))["version"] == body["version"]  # nothing written


async def test_guest_confirm_401_draft_ok(api, store, sm, ai_settings, llm, db):  # AC-009-02
    await api.post("/api/v1/auth/guest")
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    body["structured"]["document"]["invoice_no"] = "G-1"
    draft = await save(api, job["id"], body["version"], body["structured"])
    assert draft.status_code == 200
    r = await save(
        api, job["id"], draft.json()["version"], draft.json()["structured"], confirm=True
    )
    assert (r.status_code, r.json()["code"]) == (401, "unauthenticated")


async def test_plan_expired_confirm_402_draft_ok(
    api, line, mail, store, sm, ai_settings, llm, db
):  # AC-009-03
    me = await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    await db.execute(
        text(
            "update subscriptions set starts_at = now() - interval '40 days', "
            "ends_at = now() - interval '10 days' where tenant_id = :t"
        ),
        {"t": me["tenant_id"]},
    )
    await db.commit()
    body = await result(api, job["id"])
    body["structured"]["document"]["invoice_no"] = "EXP-1"
    draft = await save(api, job["id"], body["version"], body["structured"])
    assert draft.status_code == 200
    r = await save(
        api, job["id"], draft.json()["version"], draft.json()["structured"], confirm=True
    )
    assert (r.status_code, r.json()["code"]) == (402, "plan_expired")


async def test_confirm_ok_records_and_audits(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-009-04
    me = await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    r = await save(api, job["id"], body["version"], body["structured"], confirm=True)
    assert r.status_code == 200, r.text
    assert r.json()["confirmed"] is True
    row = (
        await db.execute(
            text(
                "select review_status, confirmed_by_user_id, confirmed_at is not null, "
                "(select version from result_versions where id = confirmed_version_id) "
                "from ocr_jobs where id=:j"
            ),
            {"j": job["id"]},
        )
    ).one()
    assert tuple(row) == ("CONFIRMED", me["user_id"], True, body["version"])
    assert (await api.get(f"{JOBS}/{job['id']}")).json()["stage"] == "CONFIRMED"
    actions = (
        await db.execute(text("select action from audit_log where target_id=:j"), {"j": job["id"]})
    ).scalars()
    assert "result.confirm" in set(actions)


async def test_confirmed_locked(api, line, mail, store, sm, ai_settings, llm, db):  # AC-006-01
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    await save(api, job["id"], body["version"], body["structured"], confirm=True)
    r = await save(api, job["id"], body["version"], body["structured"] | {"x": {"y": "1"}})
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")
    r = await save(api, job["id"], body["version"], body["structured"], confirm=True)
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")


async def test_result_while_recognising_409(api, line, store, db):
    await login(api, line)
    job = (await new_job(api)).json()
    r = await api.get(f"{JOBS}/{job['id']}/result")
    assert (r.status_code, r.json()["code"]) == (409, "job_not_terminal")


async def test_concurrent_save_confirm_switch(api, line, mail, store, sm, ai_settings, llm, db):
    # Review Focus 2: one job row lock serialises every writer
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    edited = body["structured"] | {"other": {"remark": "edit"}}
    responses = await asyncio.gather(
        save(api, job["id"], body["version"], edited),
        save(api, job["id"], body["version"], body["structured"], confirm=True),
        api.post(f"{JOBS}/{job['id']}/generic"),
    )
    codes = sorted(r.status_code for r in responses)
    assert all(c in (200, 409) for c in codes), [r.text for r in responses]
    current = (
        await db.execute(
            text("select count(*) from result_versions where job_id=:j and is_current"),
            {"j": job["id"]},
        )
    ).scalar()
    assert current == 1
    state = (
        await db.execute(text("select review_status from ocr_jobs where id=:j"), {"j": job["id"]})
    ).scalar()
    if state == "CONFIRMED":
        confirmed = (
            await db.execute(
                text(
                    "select v.is_current from ocr_jobs j join result_versions v "
                    "on v.id = j.confirmed_version_id where j.id=:j"
                ),
                {"j": job["id"]},
            )
        ).scalar()
        assert confirmed is True  # nothing replaced the confirmed version afterwards
