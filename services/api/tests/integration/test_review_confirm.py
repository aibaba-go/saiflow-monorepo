# ruff: noqa: F811  (pytest fixtures imported from test_results)
"""Confirming into review, the lock, stages, the export gate and reviewers' read access
(FR-VERIFY-011, 009, 006, 017; FR-ENTRY-015; review-flow Task 4)."""

from sqlalchemy import text

from tests.integration.review_helpers import JOBS, confirm, org_job, review_org, set_level
from tests.integration.test_results import (  # noqa: F401  (fixtures)
    ai_settings,
    llm,
    registered,
    result,
    save,
    sm,
    tax_job,
)
from tests.integration.test_template_mapping import mapping_pass


async def test_level0_confirm_is_official(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-010-01, AC-FR-VERIFY-009-04
    org = await review_org(api, line, mail, db)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    r = await confirm(org.clerk, org, job["id"])
    assert r.status_code == 200, r.text
    assert r.json()["review"]["stage"] == "CONFIRMED"
    got = (await org.clerk.client.get(f"{JOBS}/{job['id']}", headers=org.h)).json()
    assert got["stage"] == "CONFIRMED" and got["review_level"] is None
    official = (
        await db.execute(text("select official_at from ocr_jobs where id=:j"), {"j": job["id"]})
    ).scalar()
    assert official is not None
    e = await org.clerk.client.post(f"{JOBS}/{job['id']}/exports", headers=org.h)
    assert e.status_code == 201, e.text


async def test_level1_confirm_pending(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-011-01, AC-FR-VERIFY-009-06
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    r = await confirm(org.clerk, org, job["id"])
    assert r.status_code == 200, r.text
    review = r.json()["review"]
    assert review["stage"] == "PENDING_L1" and review["required_level"] == 1
    assert r.json()["confirmed"] is True
    got = (await org.clerk.client.get(f"{JOBS}/{job['id']}", headers=org.h)).json()
    assert got["stage"] == "PENDING_REVIEW" and got["review_level"] == 1
    rounds = (
        await db.execute(
            text(
                "select round_no, required_level, current_level, review_rounds.status, "
                "review_rounds.confirmed_by_user_id, "
                "official_at is null from review_rounds join ocr_jobs j on j.id = job_id "
                "where job_id = :j"
            ),
            {"j": job["id"]},
        )
    ).all()
    assert [tuple(x) for x in rounds] == [(1, 1, 1, "OPEN", org.clerk.user_id, True)]


async def test_personal_confirm_official(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-011-02
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    body = await result(api, job["id"])
    r = await save(api, job["id"], body["version"], body["structured"], confirm=True)
    assert r.json()["review"]["stage"] == "CONFIRMED"


async def test_pending_locked_409(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-006-02
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    body = await result(org.clerk.client, job["id"], org.h)
    c = org.clerk.client
    r = await save(
        c, job["id"], body["version"], body["structured"] | {"x": {"y": "1"}}, False, org.h
    )
    assert (r.status_code, r.json()["code"]) == (409, "result_confirmed")
    r = await save(c, job["id"], body["version"], body["structured"], True, org.h)
    assert r.status_code == 409
    assert (await c.post(f"{JOBS}/{job['id']}/generic", headers=org.h)).status_code == 409


async def test_pending_export_409(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-ENTRY-015-05
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    r = await org.clerk.client.post(f"{JOBS}/{job['id']}/exports", headers=org.h)
    assert r.status_code == 409


async def test_history_filter_pending(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-017-03
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 2)
    pending = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    other = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, pending["id"])
    await db.execute(
        text("update ocr_jobs set review_status='CONFIRMED' where id=:j"), {"j": other["id"]}
    )
    await db.execute(
        text("update review_rounds set current_level = 2 where job_id = :j"), {"j": pending["id"]}
    )
    await db.execute(
        text("update ocr_jobs set review_status='PENDING_L2' where id=:j"), {"j": pending["id"]}
    )
    await db.commit()
    r = await org.clerk.client.get(f"{JOBS}?stage=PENDING_REVIEW", headers=org.h)
    items = r.json()["items"]
    assert [(i["id"], i["review_level"]) for i in items] == [(pending["id"], 2)]


async def test_late_conversion_does_not_replace_pending(
    api, line, mail, store, sm, ai_settings, llm, db
):  # Review Focus 1
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1, None)  # the generic result needs level 1
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    c = org.clerk.client
    assert (await c.post(f"{JOBS}/{job['id']}/generic", headers=org.h)).status_code == 200
    billing = (
        await db.execute(
            text(
                "select v.id from document_template_versions v join document_templates t "
                "on t.id = v.template_id where t.code = 'billing_note'"
            )
        )
    ).scalar()
    r = await c.post(
        f"{JOBS}/{job['id']}/template", json={"template_version_id": billing}, headers=org.h
    )
    assert r.status_code == 202, r.text
    before = await result(c, job["id"], org.h)
    r = await confirm(org.clerk, org, job["id"])
    assert r.status_code == 200, r.text
    assert r.json()["review"]["stage"] == "PENDING_L1"
    llm.replies["convert"] = [{"document": {"billing_no": "B-1", "billing_date": "01/10/2569"}}]
    await mapping_pass(sm, ai_settings, llm)
    after = await result(c, job["id"], org.h)
    assert after["version"] == before["version"] and after["review"]["stage"] == "PENDING_L1"


async def test_reviewer_reads_pending_job_and_file(
    api, line, mail, store, sm, ai_settings, llm, db
):  # Review Focus 2
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    await confirm(org.clerk, org, job["id"])
    r1 = org.r1.client
    assert (await r1.get(f"{JOBS}/{job['id']}", headers=org.h)).status_code == 200
    assert (await r1.get(f"{JOBS}/{job['id']}/result", headers=org.h)).status_code == 200
    assert (await r1.get(f"{JOBS}/{job['id']}/changes", headers=org.h)).status_code == 200
    page = await r1.get(f"/api/v1/files/{job['file_id']}/pages/1/preview", headers=org.h)
    assert page.status_code == 200, page.text
    listed = (await r1.get(JOBS, headers=org.h)).json()["items"]
    assert job["id"] not in [i["id"] for i in listed]
    assert (await org.r2.client.get(f"{JOBS}/{job['id']}", headers=org.h)).status_code == 404
    # a reviewer still cannot change it
    body = await result(r1, job["id"], org.h)
    r = await save(r1, job["id"], body["version"], body["structured"], False, org.h)
    assert r.status_code == 404  # saving is not a review action


async def test_delete_results_while_pending(api, line, mail, store, sm, ai_settings, llm, db):
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await org_job(org.clerk, org, store, sm, ai_settings, llm, db)
    body = await result(org.clerk.client, job["id"], org.h)
    body["structured"]["document"]["invoice_no"] = "X-1"
    await save(org.clerk.client, job["id"], body["version"], body["structured"], True, org.h)
    r = await org.clerk.client.delete(f"{JOBS}/{job['id']}/results", headers=org.h)
    assert r.status_code == 204, r.text
    for table in ("review_rounds", "review_records", "result_changes"):
        n = (
            await db.execute(
                text(f"select count(*) from {table} where job_id=:j"), {"j": job["id"]}
            )
        ).scalar()
        assert n == 0, table
    assert (await org.r1.client.get(f"{JOBS}/{job['id']}", headers=org.h)).status_code == 404
