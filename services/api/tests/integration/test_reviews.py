# ruff: noqa: F811  (pytest fixtures imported from test_results)
"""Review queues, detail and decisions (FR-VERIFY-019, 012, 013, 010-03; review-flow
Task 5)."""

import asyncio

from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.review_helpers import JOBS, confirm, org_job, review_org, set_level
from tests.integration.tenancy_helpers import make_role
from tests.integration.test_results import (  # noqa: F401  (fixtures)
    ai_settings,
    llm,
    result,
    save,
    sm,
)

R = "/api/v1/reviews"


async def decide(who, org, job_id, level, decision="approve", comment=None):
    return await who.client.post(
        f"{R}/{job_id}/decision",
        json={"level": level, "decision": decision, "comment": comment},
        headers=org.h,
    )


async def pending_job(org, store, sm, settings, llm, db, by=None):
    job = await org_job(by or org.clerk, org, store, sm, settings, llm, db)
    r = await confirm(by or org.clerk, org, job["id"])
    assert r.status_code == 200, r.text
    return job


async def test_queue_by_level(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-019-01
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 2)
    a = await pending_job(org, store, sm, ai_settings, llm, db)
    b = await pending_job(org, store, sm, ai_settings, llm, db)
    c = await pending_job(org, store, sm, ai_settings, llm, db)
    assert (await decide(org.owner, org, c["id"], 1)).status_code == 200  # c → level 2
    r = await org.r1.client.get(f"{R}?level=1", headers=org.h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert [i["job_id"] for i in body["items"]] == [b["id"], a["id"]]  # newest first
    item = body["items"][0]
    assert item["file_name"] and item["template_name"].startswith("Tax Invoice")
    assert item["confirmed_by_name"] is not None and item["confirmed_at"]
    assert (item["level"], item["required_level"], item["block_reason"]) == (1, 2, None)
    assert (await org.r1.client.get(f"{R}?level=2", headers=org.h)).status_code == 403
    assert (await org.r1.client.get(f"{R}?level=3", headers=org.h)).status_code == 422
    r2 = (await org.r2.client.get(f"{R}?level=2", headers=org.h)).json()
    assert [i["job_id"] for i in r2["items"]] == [c["id"]]


async def test_detail_and_summary(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-019-02, AC-FR-SYS-119-01
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    await pending_job(org, store, sm, ai_settings, llm, db)
    await pending_job(org, store, sm, ai_settings, llm, db)
    own = await pending_job(org, store, sm, ai_settings, llm, db, by=org.owner)
    summary = (await org.owner.client.get(f"{R}/summary", headers=org.h)).json()
    assert summary == {"l1": 2, "l2": 0}
    assert (await org.r1.client.get(f"{R}/summary", headers=org.h)).json() == {"l1": 3, "l2": None}
    items = (await org.owner.client.get(f"{R}?level=1", headers=org.h)).json()["items"]
    reasons = {i["job_id"]: i["block_reason"] for i in items}
    assert reasons[own["id"]] == "own_confirmation"
    d = await org.r1.client.get(f"{R}/{own['id']}", headers=org.h)
    assert d.status_code == 200, d.text
    detail = d.json()
    assert detail["job"]["id"] == own["id"] and detail["level"] == 1
    assert detail["block_reason"] is None and detail["confirmed_by_name"] is not None
    assert (await org.r2.client.get(f"{R}/{own['id']}", headers=org.h)).status_code == 404
    await login(api, line, "SOLO")
    solo = await api.get(f"{R}/summary")  # personal tenant: nothing to review
    assert (solo.status_code, solo.json()) == (200, {"l1": None, "l2": None})


async def test_level2_gate_then_official(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-012-01, 012-02
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 2)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    r = await decide(org.r1, org, job["id"], 1, comment="OK")
    assert r.status_code == 200, r.text
    assert r.json()["job"]["stage"] == "PENDING_REVIEW" and r.json()["level"] == 2
    exp = await org.clerk.client.post(f"{JOBS}/{job['id']}/exports", headers=org.h)
    assert exp.status_code == 409
    r = await decide(org.r2, org, job["id"], 2)
    assert r.status_code == 200, r.text
    assert r.json()["job"]["stage"] == "CONFIRMED"
    official = (
        await db.execute(text("select official_at from ocr_jobs where id=:j"), {"j": job["id"]})
    ).scalar()
    assert official is not None
    exp = await org.clerk.client.post(f"{JOBS}/{job['id']}/exports", headers=org.h)
    assert exp.status_code == 201, exp.text


async def test_confirmer_cannot_review(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-012-03
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db, by=org.owner)
    r = await decide(org.owner, org, job["id"], 1)
    assert (r.status_code, r.json()["code"]) == (403, "reviewer_conflict")
    got = (await org.owner.client.get(f"{JOBS}/{job['id']}", headers=org.h)).json()
    assert got["stage"] == "PENDING_REVIEW" and got["review_level"] == 1


async def test_l1_reviewer_not_l2(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-012-04
    org = await review_org(api, line, mail, db)
    both = await make_role(db, org.tenant_id, "Both", ["review_l1", "review_l2"])
    await db.execute(
        text("update memberships set role_id = :r where tenant_id = :t and user_id = :u"),
        {"r": both, "t": org.tenant_id, "u": org.r1.user_id},
    )
    await db.commit()
    await set_level(db, org.tenant_id, 2)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    assert (await decide(org.r1, org, job["id"], 1)).status_code == 200
    r = await decide(org.r1, org, job["id"], 2)
    assert (r.status_code, r.json()["code"]) == (403, "reviewer_conflict")
    items = (await org.r1.client.get(f"{R}?level=2", headers=org.h)).json()["items"]
    assert items[0]["block_reason"] == "did_level1"


async def test_concurrent_decisions(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-012-05
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    a, b = await asyncio.gather(
        decide(org.r1, org, job["id"], 1), decide(org.owner, org, job["id"], 1)
    )
    assert sorted([a.status_code, b.status_code]) == [200, 409]
    n = (
        await db.execute(
            text("select count(*) from review_records where job_id=:j"), {"j": job["id"]}
        )
    ).scalar()
    assert n == 1


async def test_record_fields(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-013-01
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    assert (await decide(org.r1, org, job["id"], 1, comment="looks right")).status_code == 200
    rec = (await result(org.clerk.client, job["id"], org.h))["review"]["records"]
    assert len(rec) == 1
    assert (rec[0]["round_no"], rec[0]["level"], rec[0]["decision"], rec[0]["comment"]) == (
        1,
        1,
        "APPROVE",
        "looks right",
    )
    assert rec[0]["reviewer_name"] is not None and rec[0]["created_at"]
    audit = (
        (
            await db.execute(
                text("select action from audit_log where target_id = :j"), {"j": job["id"]}
            )
        )
        .scalars()
        .all()
    )
    assert "review.approve" in audit


async def test_return_back_to_verify(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-013-02
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 2)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    await decide(org.r1, org, job["id"], 1)
    r = await decide(org.r2, org, job["id"], 2, "return", "税额不对")
    assert r.status_code == 200, r.text
    assert r.json()["job"]["stage"] == "VERIFYING"
    body = await result(org.clerk.client, job["id"], org.h)
    assert body["confirmed"] is False
    assert body["review"]["stage"] == "NONE"
    assert body["review"]["last_return"]["comment"] == "税额不对"
    assert body["review"]["last_return"]["level"] == 2
    body["structured"]["document"]["invoice_no"] = "IV-FIXED"
    s = await save(org.clerk.client, job["id"], body["version"], body["structured"], True, org.h)
    assert s.status_code == 200, s.text
    assert s.json()["review"]["stage"] == "PENDING_L1"
    assert s.json()["review"]["last_return"] is None
    rounds = (
        await db.execute(
            text("select round_no, status from review_rounds where job_id=:j order by round_no"),
            {"j": job["id"]},
        )
    ).all()
    assert [tuple(x) for x in rounds] == [(1, "RETURNED"), (2, "OPEN")]


async def test_return_needs_comment(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-VERIFY-013-03
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    for blank in ("   ", None, ""):
        r = await decide(org.r1, org, job["id"], 1, "return", blank)
        assert r.status_code == 422, (blank, r.text)
    n = (
        await db.execute(
            text("select count(*) from review_records where job_id=:j"), {"j": job["id"]}
        )
    ).scalar()
    assert n == 0


async def test_comment_too_long_422(api, line, mail, store, sm, ai_settings, llm, db):
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    assert (await decide(org.r1, org, job["id"], 1, "approve", "x" * 501)).status_code == 422
    assert (await decide(org.r1, org, job["id"], 1, "maybe")).status_code == 422
    assert (await decide(org.r1, org, job["id"], 1, "approve", "x" * 500)).status_code == 200


async def test_permission_removed_before_decision(
    api, line, mail, store, sm, ai_settings, llm, db
):  # Review Focus 3
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    assert (await org.r1.client.get(f"{R}?level=1", headers=org.h)).status_code == 200
    await db.execute(
        text("update roles set permissions = '{}' where id = :r"), {"r": org.roles["r1"]}
    )
    await db.commit()
    r = await decide(org.r1, org, job["id"], 1)
    assert r.status_code in (403, 404)
    got = (await org.clerk.client.get(f"{JOBS}/{job['id']}", headers=org.h)).json()
    assert got["review_level"] == 1


async def test_reconfirm_rereads_level(api, line, mail, store, sm, ai_settings, llm, db):
    # Review Focus 4
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 1)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    assert (await decide(org.r1, org, job["id"], 1, "return", "fix")).status_code == 200
    await set_level(db, org.tenant_id, 0)
    r = await confirm(org.clerk, org, job["id"])
    assert r.status_code == 200, r.text
    assert r.json()["review"]["stage"] == "CONFIRMED"


async def test_settings_change_does_not_affect_pending(
    api, line, mail, store, sm, ai_settings, llm, db
):  # AC-FR-VERIFY-010-03
    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 2)
    job = await pending_job(org, store, sm, ai_settings, llm, db)
    await set_level(db, org.tenant_id, 0)
    r = await decide(org.r1, org, job["id"], 1)
    assert r.json()["job"]["stage"] == "PENDING_REVIEW" and r.json()["level"] == 2
    later = await pending_job(org, store, sm, ai_settings, llm, db)
    got = (await org.clerk.client.get(f"{JOBS}/{later['id']}", headers=org.h)).json()
    assert got["stage"] == "CONFIRMED"
