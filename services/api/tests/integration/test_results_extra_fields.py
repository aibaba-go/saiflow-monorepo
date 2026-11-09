# ruff: noqa: F811  (pytest fixtures imported from test_results)
"""Extra header fields in a template group: saved, re-read and deleted as new versions
of the result only; required, lock and permission rules unchanged (FR-VERIFY-015 AC-05..07)."""

from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.review_helpers import confirm, member, org_job, review_org, set_level
from tests.integration.tenancy_helpers import add_member, make_role
from tests.integration.test_results import (  # noqa: F401  (fixtures)
    ai_settings,
    llm,
    registered,
    result,
    save,
    sm,
    tax_job,
)


async def _groups(db, template_version_id):
    return (
        await db.execute(
            text("select groups from document_template_versions where id = :v"),
            {"v": template_version_id},
        )
    ).scalar()


async def _saves(db, job_id):
    return (
        (
            await db.execute(
                text(
                    "select items from result_changes where job_id = :j and kind = 'SAVE' "
                    "order by created_at"
                ),
                {"j": job_id},
            )
        )
        .scalars()
        .all()
    )


async def test_extra_field_saved_reread_template_unchanged(
    api, line, store, sm, ai_settings, llm, db
):  # AC-FR-VERIFY-015-05
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    tpl_id = body["template"]["template_version_id"]
    groups_before = await _groups(db, tpl_id)
    structured = body["structured"]
    structured["document"]["Remark"] = "000123.4500"
    r = await save(api, job["id"], body["version"], structured)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == body["version"] + 1
    again = await result(api, job["id"])
    assert again["version"] == body["version"] + 1
    assert again["structured"]["document"]["Remark"] == "000123.4500"  # text, not a number
    assert again["structured"]["document"]["invoice_no"] == "IV00000001"
    assert again["template"]["groups"] == body["template"]["groups"]
    assert await _groups(db, tpl_id) == groups_before  # the template is not updated
    old = (
        await db.execute(
            text("select structured from result_versions where job_id=:j and version=:v"),
            {"j": job["id"], "v": body["version"]},
        )
    ).scalar()
    assert "Remark" not in old["document"]  # the old version is kept as it was
    assert await _saves(db, job["id"]) == [
        [{"path": "document.Remark", "before": None, "after": "000123.4500"}]
    ]


async def test_extra_field_delete_and_noop_save(api, line, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-015-06
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    structured = body["structured"]
    structured["document"]["Remark"] = "Pay next week"
    added = (await save(api, job["id"], body["version"], structured)).json()
    same = await save(api, job["id"], added["version"], added["structured"])
    assert same.status_code == 200 and same.json()["version"] == added["version"]  # no-op
    assert len(await _saves(db, job["id"])) == 1
    gone = added["structured"]
    del gone["document"]["Remark"]
    r = await save(api, job["id"], added["version"], gone)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == added["version"] + 1
    after = await result(api, job["id"])
    assert "Remark" not in after["structured"]["document"]
    assert after["structured"]["document"]["invoice_no"] == "IV00000001"  # template fields stay
    assert "invoice_date" in after["structured"]["document"]
    assert (await _saves(db, job["id"]))[-1] == [
        {"path": "document.Remark", "before": "Pay next week", "after": None}
    ]


async def test_extra_field_adds_no_required_rule(
    api, line, mail, store, sm, ai_settings, llm, db
):  # AC-FR-VERIFY-015-07 (required)
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    structured = body["structured"]
    date = structured["document"]["invoice_date"]
    assert date
    structured["document"]["Remark"] = ""
    structured["document"]["invoice_date"] = None
    draft = await save(api, job["id"], body["version"], structured)
    assert draft.status_code == 200, draft.text  # a draft may miss required fields
    r = await save(api, job["id"], draft.json()["version"], draft.json()["structured"], True)
    assert (r.status_code, r.json()["code"]) == (422, "required_missing")
    assert "structured.document.invoice_date" in r.json()["fields"]
    assert "structured.document.Remark" not in r.json()["fields"]
    assert (await result(api, job["id"]))["version"] == draft.json()["version"]
    fixed = draft.json()["structured"]
    fixed["document"]["invoice_date"] = date
    ok = await save(api, job["id"], draft.json()["version"], fixed, True)
    assert ok.status_code == 200, ok.text  # the empty extra field does not block confirming
    assert ok.json()["confirmed"] is True and ok.json()["structured"]["document"]["Remark"] == ""


async def test_extra_field_locked_when_confirmed(
    api, line, mail, store, sm, ai_settings, llm, db
):  # AC-FR-VERIFY-015-07 (lock)
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    done = await save(api, job["id"], body["version"], body["structured"], True)
    assert done.status_code == 200, done.text
    structured = done.json()["structured"]
    structured["document"]["Remark"] = "late"
    r = await save(api, job["id"], done.json()["version"], structured)
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")
    assert "Remark" not in (await result(api, job["id"]))["structured"]["document"]


async def test_extra_field_locked_in_review_and_permission(
    api, line, mail, store, sm, ai_settings, llm, db
):  # AC-FR-VERIFY-015-07 (review lock, permission)
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    mine = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    theirs = await org_job(org.owner, org, store, sm, ai_settings, llm, db)
    # verify_own only (may see colleagues' jobs): an extra field on one is refused
    viewer = await member(api, line, mail, "VIEWER")
    role = await make_role(db, org.tenant_id, "Viewer", ["verify_own", "data_browse"])
    await add_member(db, org.tenant_id, viewer.user_id, role)
    body = await result(viewer.client, theirs["id"], org.h)
    structured = body["structured"]
    structured["document"]["Remark"] = "not mine"
    r = await save(viewer.client, theirs["id"], body["version"], structured, headers=org.h)
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    assert (
        "Remark"
        not in (await result(org.owner.client, theirs["id"], org.h))["structured"]["document"]
    )
    # own job: saved; once in review it is locked like any other field
    body = await result(org.clerk.client, mine["id"], org.h)
    structured = body["structured"]
    structured["document"]["Remark"] = "mine"
    r = await save(org.clerk.client, mine["id"], body["version"], structured, headers=org.h)
    assert r.status_code == 200, r.text
    assert (await confirm(org.clerk, org, mine["id"])).status_code == 200
    status = (
        await db.execute(
            text("select review_status from ocr_jobs where id = :j"), {"j": mine["id"]}
        )
    ).scalar()
    assert status == "PENDING_L1"
    held = await result(org.clerk.client, mine["id"], org.h)
    assert held["structured"]["document"]["Remark"] == "mine"
    edit = held["structured"]
    edit["document"]["Remark"] = "changed in review"
    r = await save(org.clerk.client, mine["id"], held["version"], edit, headers=org.h)
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")
    del edit["document"]["Remark"]
    r = await save(org.clerk.client, mine["id"], held["version"], edit, headers=org.h)
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")
    assert (await result(org.clerk.client, mine["id"], org.h))["structured"]["document"][
        "Remark"
    ] == "mine"
