"""Results: versions, conflicts, the confirm gate and the lock (FR-VERIFY-015, 009, 006;
Review Focus 2)."""

import asyncio
from copy import deepcopy

import pytest
from sqlalchemy import text

from app.db import create_sessionmaker
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.integration.test_ocr_jobs import new_job
from tests.integration.test_template_mapping import (
    FALLBACK,
    GENERIC_JSON,
    GENERIC_OUTPUT,
    TAX_OUTPUT,
    VISION_RAW,
    FakeLlm,
    mapping_pass,
    raw_result,
    recognised,
    select_primary,
    vision_job,
)

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


async def tax_job(api, store, sm, settings, llm, db, engine="textin"):
    """A job whose current result is a converted Tax Invoice, from either primary."""
    tax = (
        await db.execute(
            text(
                "select v.id from document_template_versions v join document_templates t "
                "on t.id = v.template_id where t.code = 'tax_invoice'"
            )
        )
    ).scalar()
    await select_primary(db, engine)
    if engine == "google_vision":
        llm.replies["generic"] = [GENERIC_JSON]
    job = await recognised(api, store, sm, settings, llm, engine=engine)
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


@pytest.mark.parametrize(
    ("case", "expected"),
    [
        ("org_free_valid", True),  # no plan, free scans still valid: it could scan, so it confirms
        ("org_free_used_up", True),  # 0 left but still in its month
        ("org_free_expired", False),
        ("org_plan_active", True),
        ("personal_plan_expired", False),  # personal free scans pause while the plan is expired
    ],
)
async def test_may_confirm_follows_scanning(line, mail, db, case, expected):
    """Option A (owner 2026-11-06): confirming needs what scanning needs, an active plan or
    free scans still inside their validity; only when both are gone is it plan_expired."""
    from app.clock import utcnow
    from app.services import metering_service
    from tests.integration.tenancy_helpers import make_org

    uid = (
        await db.execute(text("insert into users (line_user_id) values ('U-mc') returning id"))
    ).scalar_one()
    if case.startswith("org"):
        tid, _ = await make_org(db, uid)
        left, until = (
            (0, "now() + interval '5 days'")
            if case == "org_free_used_up"
            else (
                98,
                "now() - interval '1 day'"
                if case == "org_free_expired"
                else "now() + interval '30 days'",
            )
        )
        await db.execute(
            text(
                "insert into free_quotas (tenant_id, granted, remaining, expires_at) "
                f"values (:t, 100, :r, {until})"
            ),
            {"t": tid, "r": left},
        )
        if case == "org_plan_active":
            await db.execute(
                text(
                    "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, "
                    "source) values (:t, 'starter', 'month', now() - interval '1 day', "
                    "now() + interval '20 days', 'admin')"
                ),
                {"t": tid},
            )
    else:
        tid = (
            await db.execute(text("insert into tenants (kind) values ('personal') returning id"))
        ).scalar_one()
        await db.execute(
            text("insert into free_quotas (tenant_id, granted, remaining) values (:t, 50, 50)"),
            {"t": tid},
        )
        await db.execute(
            text(
                "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, "
                "source) values (:t, 'kinder', 'month', now() - interval '40 days', "
                "now() - interval '10 days', 'auto')"
            ),
            {"t": tid},
        )
    await db.commit()
    assert await metering_service.may_confirm(db, tid, utcnow()) is expected


async def test_type_warning_on_result_clears_after_fix(api, line, store, sm, ai_settings, llm, db):
    """AC-FR-OCR-016-02: an unparseable amount is kept and flagged; fixing it clears it."""
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    body["structured"]["summary"]["net_total"] = "约一万"
    saved = await save(api, job["id"], body["version"], body["structured"])
    assert saved.status_code == 200, saved.text
    out = saved.json()
    assert out["structured"]["summary"]["net_total"] == "约一万"
    assert {"path": "summary.net_total", "code": "type_mismatch"} in out["warnings"]
    out["structured"]["summary"]["net_total"] = "10000.00"
    fixed = await save(api, job["id"], out["version"], out["structured"])
    assert all(w["path"] != "summary.net_total" for w in fixed.json()["warnings"])


async def test_amount_issues_recheck_after_save(api, line, mail, store, sm, ai_settings, llm, db):
    """AC-FR-OCR-013-03: issues are recomputed on each version; they never block confirm."""
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    body["structured"]["goods"]["line_items"] = [
        {"description": "A", "quantity": "3", "unit_price": "100.00", "amount": "310.00"}
    ]
    body["structured"]["summary"] = {"vat_amount": "0.00", "net_total": "310.00"}
    out = (await save(api, job["id"], body["version"], body["structured"])).json()
    assert out["amount_issues"] == [
        {"path": "goods.line_items[0].amount", "computed": "300.00", "recognised": "310.00"}
    ]
    out["structured"]["goods"]["line_items"][0]["amount"] = "300.00"
    out["structured"]["summary"]["net_total"] = "300.00"
    fixed = (await save(api, job["id"], out["version"], out["structured"])).json()
    assert fixed["amount_issues"] == []
    fixed["structured"]["summary"]["net_total"] = "999.00"  # an issue does not block confirm
    done = await save(api, job["id"], fixed["version"], fixed["structured"], confirm=True)
    assert done.status_code == 200, done.text
    assert done.json()["confirmed"] is True and done.json()["amount_issues"]


@pytest.mark.parametrize("fallback", [False, True], ids=["generic", "ocr-text"])
async def test_vision_result_exact_roundtrip_versions_and_confirm(
    api, line, mail, store, sm, ai_settings, llm, db, fallback
):
    # AC-FR-OCR-025-01/03/05, 026-03; FR-VERIFY-015/009/006.
    me = await registered(api, line, mail)
    job = await vision_job(
        api, store, sm, ai_settings, llm, db, output="null" if fallback else GENERIC_JSON
    )
    original = FALLBACK if fallback else GENERIC_OUTPUT
    body = await result(api, job["id"])
    assert body["structured"] == original and body["template"] is None
    assert body["missing_required"] == [] and body["version"] == 1
    edited = deepcopy(body["structured"])
    if fallback:
        edited["ocr_text"]["page_1"] += "\n人工核验 12345678901234567890"
        assert edited["ocr_text"]["page_2"] == ""
    else:
        edited["invoice_no"] = "IV-edited"
        edited["seller"]["negative"] = "-12345678901234567891"
        edited["items"][0]["big"] = "12345678901234567891"
    response = await save(api, job["id"], body["version"], edited)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["structured"] == edited and saved["version"] == 2
    assert (await result(api, job["id"]))["structured"] == edited
    if not fallback:
        for node in (
            saved["structured"],
            saved["structured"]["seller"],
            saved["structured"]["items"][0],
        ):
            assert type(node["safe_max"]) is int and type(node["safe_min"]) is int
            assert node["flag"] is False and type(node["zero"]) is int
    old = (
        await db.execute(
            text("select structured from result_versions where job_id=:j and version=1"),
            {"j": job["id"]},
        )
    ).scalar_one()
    assert old == original
    unchanged = await save(api, job["id"], saved["version"], edited)
    assert unchanged.status_code == 200 and unchanged.json()["version"] == 2
    stale = await save(api, job["id"], 1, original)
    assert (stale.status_code, stale.json()["code"]) == (409, "version_conflict")
    confirmed = await save(api, job["id"], 2, edited, confirm=True)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["structured"] == edited and confirmed.json()["confirmed"] is True
    assert (await api.get(f"{JOBS}/{job['id']}")).json()["stage"] == "CONFIRMED"
    state = (
        await db.execute(
            text(
                "select confirmed_by_user_id, confirmed_version_id, official_at "
                "from ocr_jobs where id=:j"
            ),
            {"j": job["id"]},
        )
    ).one()
    assert state.confirmed_by_user_id == me["user_id"] and state.official_at is not None
    assert (await save(api, job["id"], 2, original)).status_code == 409
    assert (await api.post(f"{JOBS}/{job['id']}/generic")).status_code == 409
    assert tuple(await raw_result(db, job["id"])) == ("google_vision", VISION_RAW)
    assert llm.calls == ["generic"]


@pytest.mark.parametrize("fallback", [False, True], ids=["generic", "ocr-text"])
@pytest.mark.parametrize("gate", ["guest", "unregistered", "expired"])
async def test_vision_general_result_keeps_confirmation_gates(
    api, line, mail, store, sm, ai_settings, llm, db, fallback, gate
):
    # AC-FR-OCR-025-01/026-03: free-form has no required-field gate, not no auth/plan gate.
    if gate == "guest":
        assert (await api.post("/api/v1/auth/guest")).status_code == 200
    elif gate == "unregistered":
        await login(api, line)
    else:
        me = await registered(api, line, mail)
    job = await vision_job(
        api, store, sm, ai_settings, llm, db, output="null" if fallback else GENERIC_JSON
    )
    if gate == "expired":
        await db.execute(
            text(
                "update subscriptions set starts_at=now()-interval '40 days', "
                "ends_at=now()-interval '10 days' where tenant_id=:t"
            ),
            {"t": me["tenant_id"]},
        )
        await db.commit()
    body = await result(api, job["id"])
    edited = deepcopy(body["structured"])
    edited["note"] = "saved draft, not confirmed"
    draft = await save(api, job["id"], body["version"], edited)
    assert draft.status_code == 200, draft.text
    denied = await save(
        api,
        job["id"],
        draft.json()["version"],
        edited | {"another": "must not be saved"},
        confirm=True,
    )
    assert denied.status_code == {"guest": 401, "unregistered": 403, "expired": 402}[gate]
    current = await result(api, job["id"])
    assert current["structured"] == edited and current["version"] == draft.json()["version"]
    assert current["confirmed"] is False
    assert tuple(await raw_result(db, job["id"])) == ("google_vision", VISION_RAW)
