"""OCR jobs (FR-OCR-017, FR-VERIFY-017): creation with reservation, idempotency, visibility,
stages, cancel, rerun, delete results, and guest claiming (Review Focus 5)."""

import uuid

from sqlalchemy import text

from app.services import metering_service
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.integration.test_uploads import pdf, png, upload

JOBS = "/api/v1/ocr/jobs"


async def scans_left(c, headers=None) -> int:
    body = (await c.get("/api/v1/billing/usage", headers=headers or {})).json()
    return body["month"]["remaining"] + body["free"]["remaining"]


async def new_job(c, data=None, name="a.png", headers=None, key=None):
    fid = (await upload(c, name, data or png(), headers)).json()["id"]
    body = {"file_id": fid} | ({"idempotency_key": key} if key else {})
    return await c.post(JOBS, json=body, headers=headers or {})


async def test_create_reserves_and_leaves_pending(api, line, store):  # AC-FR-OCR-017-01
    await login(api, line)
    before = await scans_left(api)
    r = await new_job(api, pdf(3), "c.pdf")
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["status"] == "QUEUED" and job["stage"] == "OCR_PROCESSING"
    assert (job["page_count"], job["file_name"]) == (3, "c.pdf")
    assert await scans_left(api) == before - 3
    assert (await api.get("/api/v1/files/pending")).json() == []


async def test_idempotent_replay(api, line, store):  # AC-FR-OCR-017-02
    await login(api, line)
    before = await scans_left(api)
    fid = (await upload(api, "a.png", png())).json()["id"]
    first = await api.post(JOBS, json={"file_id": fid, "idempotency_key": "K1"})
    again = await api.post(JOBS, json={"file_id": fid, "idempotency_key": "K1"})
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["id"] == again.json()["id"]
    assert await scans_left(api) == before - 1
    # the same file cannot get a second job under another key
    other = await api.post(JOBS, json={"file_id": fid, "idempotency_key": "K2"})
    assert (other.status_code, other.json()["code"]) == (409, "file_in_use")


async def test_quota_exceeded_and_plan_expired(api, line, store, db):  # AC-FR-OCR-017-03
    me = await login(api, line)
    tid = me["tenant_id"]
    await db.execute(text("update free_quotas set remaining = 0 where tenant_id = :t"), {"t": tid})
    await db.commit()
    left = await scans_left(api)
    await metering_service.reserve(db, tid, left - 2, "fill")
    await db.commit()
    r = await new_job(api, pdf(3), "c.pdf")
    assert (r.status_code, r.json()["code"]) == (402, "quota_exceeded")
    assert r.json()["details"]["available"] == 2
    await db.execute(
        text(
            "update subscriptions set starts_at = now() - interval '40 days', "
            "ends_at = now() - interval '10 days' where tenant_id = :t"
        ),
        {"t": tid},
    )
    await db.commit()
    r = await new_job(api, png(), "b.png")
    assert (r.status_code, r.json()["code"]) == (402, "plan_expired")
    count = (await db.execute(text("select count(*) from ocr_jobs"))).scalar()
    assert count == 0
    assert len((await api.get("/api/v1/files/pending")).json()) == 2  # still pending


async def test_cancel_queued_releases(api, line, store):  # AC-FR-OCR-017-04
    await login(api, line)
    before = await scans_left(api)
    job = (await new_job(api, pdf(3), "c.pdf")).json()
    r = await api.post(f"{JOBS}/{job['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
    assert r.json()["stage"] == "OCR_FAILED"
    assert await scans_left(api) == before
    r = await api.post(f"{JOBS}/{job['id']}/cancel")
    assert (r.status_code, r.json()["code"]) == (409, "job_terminal")


async def test_cancel_running_requests(api, line, store, db):
    await login(api, line)
    job = (await new_job(api)).json()
    await db.execute(text("update ocr_jobs set status='PROCESSING' where id=:j"), {"j": job["id"]})
    await db.commit()
    r = await api.post(f"{JOBS}/{job['id']}/cancel")
    assert r.json()["status"] == "CANCEL_REQUESTED"


async def test_visibility_by_data_browse(api, line, store, db):  # AC-FR-OCR-017-05
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
    worker_role = await make_role(db, org, "Clerk", ["upload_ocr", "verify_own"])
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], worker_role)
    mine = (await new_job(api, headers=tenant(org))).json()
    theirs = (await new_job(owner, headers=tenant(org))).json()
    ids = {j["id"] for j in (await api.get(JOBS, headers=tenant(org))).json()["items"]}
    assert ids == {mine["id"]}
    r = await api.get(f"{JOBS}/{theirs['id']}", headers=tenant(org))
    assert r.status_code == 404
    ids = {j["id"] for j in (await owner.get(JOBS, headers=tenant(org))).json()["items"]}
    assert ids == {mine["id"], theirs["id"]}


async def test_list_stage_filter_and_literal_keyword(api, line, store, db):  # FR-VERIFY-017
    await login(api, line)
    a = (await new_job(api, name="invoice_2026.pdf", data=pdf(1))).json()
    b = (await new_job(api, name="bill%.png")).json()
    c = (await new_job(api, name="x.png")).json()
    await db.execute(
        text("update ocr_jobs set status='SUCCEEDED', review_status='CONFIRMED' where id=:j"),
        {"j": a["id"]},
    )
    await db.execute(text("update ocr_jobs set status='SUCCEEDED' where id=:j"), {"j": b["id"]})
    await db.execute(text("update ocr_jobs set status='FAILED' where id=:j"), {"j": c["id"]})
    await db.commit()

    async def ids(**params):
        r = await api.get(JOBS, params=params)
        assert r.status_code == 200, r.text
        return [j["id"] for j in r.json()["items"]]

    assert await ids(stage="VERIFYING") == [b["id"]]
    assert await ids(stage="CONFIRMED") == [a["id"]]
    assert await ids(stage="OCR_FAILED") == [c["id"]]
    assert await ids() == [c["id"], b["id"], a["id"]]  # newest first
    assert await ids(q="INVOICE") == [a["id"]]
    assert await ids(q="%") == [b["id"]]
    assert (await api.get(JOBS, params={"stage": "DONE"})).status_code == 400
    assert (await api.get(JOBS, params={"page_size": "101"})).status_code == 400


async def test_rerun_new_job_reserves_again(api, line, store, db):
    await login(api, line)
    job = (await new_job(api)).json()
    await db.execute(text("update ocr_jobs set status='FAILED' where id=:j"), {"j": job["id"]})
    await db.commit()
    before = await scans_left(api)
    r = await api.post(f"{JOBS}/{job['id']}/rerun")
    assert r.status_code == 201
    assert r.json()["id"] != job["id"] and r.json()["status"] == "QUEUED"
    assert await scans_left(api) == before - 1
    parent = (
        await db.execute(
            text("select parent_job_id from ocr_jobs where id=:j"), {"j": r.json()["id"]}
        )
    ).scalar()
    assert parent == job["id"]
    queued = await api.post(f"{JOBS}/{r.json()['id']}/rerun")
    assert (queued.status_code, queued.json()["code"]) == (409, "job_not_terminal")


async def test_delete_results_keeps_raw(api, line, store, db):
    await login(api, line)
    job = (await new_job(api)).json()
    raw_id, version_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(text("update ocr_jobs set status='SUCCEEDED' where id=:j"), {"j": job["id"]})
    await db.execute(
        text(
            "insert into ocr_raw_results (id, job_id, engine, payload) "
            "values (:r, :j, 'textin', '{}')"
        ),
        {"r": raw_id, "j": job["id"]},
    )
    await db.execute(
        text(
            "insert into result_versions (id, job_id, version, is_current, structured) "
            "values (:v, :j, 1, true, '{}')"
        ),
        {"v": version_id, "j": job["id"]},
    )
    await db.commit()
    r = await api.delete(f"{JOBS}/{job['id']}/results")
    assert r.status_code == 204
    assert (await db.execute(text("select count(*) from result_versions"))).scalar() == 0
    assert (await db.execute(text("select count(*) from ocr_raw_results"))).scalar() == 1


async def test_other_tenant_header_404(api, line, store, db):  # Review Focus 5
    me = await login(api, line)
    org, _ = await make_org(db, me["user_id"])
    job = (await new_job(api)).json()  # personal tenant
    assert (await api.get(f"{JOBS}/{job['id']}", headers=tenant(org))).status_code == 404
    assert (await api.get(f"{JOBS}/{job['id']}")).status_code == 200


async def test_guest_job_claimed_on_registration(api, line, mail, store, db):  # Review Focus 5
    from tests.integration.test_registration import register

    await api.post("/api/v1/auth/guest")
    job = (await new_job(api)).json()
    me = await register(api, line, mail, sub="G1", email="g1@example.com")
    row = (
        await db.execute(
            text("select tenant_id, created_by_user_id from ocr_jobs where id=:j"), {"j": job["id"]}
        )
    ).one()
    assert row == (me["tenant_id"], me["user_id"])
    file_owner = (
        await db.execute(
            text("select created_by_user_id from files where id=:f"), {"f": job["file_id"]}
        )
    ).scalar()
    assert file_owner == me["user_id"]
    assert (await api.get(f"{JOBS}/{job['id']}")).status_code == 200
