"""Template samples (FR-TEMPLATE-008, FR-TEMPLATE-014; D8; contract §4): upload or start
from an OCR result, the worker (OCR, then the LLM), scans charged or released exactly once,
cancel wins, retry, recovery, access by the creator only, delete and the seven-day purge.
Engines and the LLM are fakes; the store is the in-memory one."""

import asyncio
import json
from datetime import timedelta

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.clock import utcnow
from app.db import create_sessionmaker
from app.ocr import sample_worker, worker
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant
from tests.integration.test_ocr_jobs import new_job, scans_left
from tests.integration.test_ocr_worker import FakeEngine
from tests.integration.test_uploads import JPG, pdf, png

SAMPLES = "/api/v1/template-samples"
LLM_URL = "https://api.deepseek.com/chat/completions"  # the seeded llm_base_url

ANSWER = {
    "template": {
        "code": "invoice",
        "name": "Invoice",
        "names": {"en": "Invoice", "th": "ใบแจ้งหนี้"},
        "description": "A supplier invoice",
        "groups": [
            {
                "key": "header",
                "name": "Header",
                "items": [
                    {
                        "kind": "field",
                        "key": "invoice_no",
                        "name": "Invoice number",
                        "type": "string",
                        "required": True,
                        "primary": True,
                        "sample": "IV-0001",
                    },
                    {
                        "kind": "field",
                        "key": "supplier",
                        "name": "Supplier ACME Trading",
                        "type": "string",
                        "sample": "ACME Trading",
                    },
                    {
                        "kind": "field",
                        "key": "grand_total",
                        "name": "Grand total",
                        "type": "amount",
                        "role": "grand_total",
                        "sample": "1070.00",
                    },
                    {
                        "kind": "table",
                        "key": "lines",
                        "name": "Lines",
                        "columns": [
                            {"key": "description", "name": "Description", "type": "string"},
                            {
                                "key": "amount",
                                "name": "Amount",
                                "type": "amount",
                                "role": "line_total",
                            },
                        ],
                        "sample_rows": [["Widget", "1000.00"]],
                    },
                ],
            }
        ],
    }
}


class SampleLlm:
    """A fake chat endpoint over httpx.MockTransport; records every request."""

    def __init__(self, *replies, on_call=None):
        self.replies, self.on_call, self.requests = list(replies), on_call, []
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.on_call:
            self.on_call()
        if not self.replies:
            raise AssertionError("unexpected LLM call")
        reply = self.replies.pop(0)
        content = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


@pytest.fixture
def sm(db_engine):
    return create_sessionmaker(db_engine)


@pytest.fixture
def ai_settings(app_settings):
    return app_settings.model_copy(update={"llm_api_key": SecretStr("llm-key")})


async def _no_sleep(_s):
    return None


async def step(sm, store, settings, engine=None, llm=None):
    return await sample_worker.run_once(
        sm,
        store,
        settings,
        engines={"textin": engine or FakeEngine()},
        sleep=_no_sleep,
        llm_transport=(llm or SampleLlm()).transport,
        llm_sleep=lambda _s: None,
    )


async def create(c, data=None, name="s.pdf", headers=None):
    return await c.post(
        SAMPLES,
        files={"file": (name, pdf(1) if data is None else data, "application/octet-stream")},
        headers=headers,
    )


async def subscribe(db, tid):
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            "values (:t, 'starter', 'month', now() - interval '1 day', now() + interval '20 days', "
            "'admin')"
        ),
        {"t": tid},
    )
    await db.commit()


async def get(c, sid, headers=None):
    return await c.get(f"{SAMPLES}/{sid}", headers=headers)


BUSINESS = (
    "document_templates",
    "document_template_versions",
    "ocr_jobs",
    "ocr_raw_results",
    "result_versions",
    "files",
)


async def business(db) -> dict[str, int]:
    return {t: (await db.execute(text(f"select count(*) from {t}"))).scalar() for t in BUSINESS}


async def audits(db, action) -> list[tuple]:
    rows = await db.execute(
        text(
            "select actor_type, actor_id, target_id, result from audit_log "
            "where action = :a order by id"
        ),
        {"a": action},
    )
    return [tuple(r) for r in rows]


def sample_objects(store, sid=None) -> list[str]:
    return [k for k in store.objects if k.startswith("samples/") and (sid is None or sid in k)]


async def open_reservations(db, sid) -> int:
    return (
        await db.execute(
            text(
                "select count(*) from quota_reservations "
                "where reference like :r and released_at is null"
            ),
            {"r": f"template_sample:{sid}:%"},
        )
    ).scalar()


# ---------------------------------------------------------------------------------------
# upload, worker, candidate


async def test_upload_to_ready_candidate(api, line, store, db, sm, ai_settings):  # 014-02/03
    me = await login(api, line)
    before, rows = await scans_left(api), await business(db)
    r = await create(api, pdf(2))
    assert r.status_code == 202, r.text
    s = r.json()
    assert (s["status"], s["source"], s["file_kind"], s["pages"]) == ("QUEUED", "UPLOAD", "pdf", 2)
    assert s["candidate"] is None and s["charged_pages"] == 0
    assert await scans_left(api) == before - 2  # reserved like an OCR job
    assert await audits(db, "template_sample.create") == [
        ("user", str(me["user_id"]), s["id"], "success")
    ]

    llm = SampleLlm(ANSWER)
    assert await step(sm, store, ai_settings, llm=llm) is True
    out = (await get(api, s["id"])).json()
    assert (out["status"], out["failed_stage"], out["error_code"]) == ("READY", None, None)
    assert out["charged_pages"] == 2 and out["ready_at"]
    assert await scans_left(api) == before - 2  # kept: charged once

    cand = out["candidate"]
    content = cand["content"]
    items = content["groups"][0]["items"]
    for it in items[:3]:  # nothing is decided for the person
        assert (it["required"], it["primary"], it["role"]) == (False, False, None)
    assert all((c["required"], c["role"]) == (False, None) for c in items[3]["columns"])
    assert "ACME" not in json.dumps(content) and items[1]["name"] == "Supplier"
    assert cand["values"] == {
        "header.invoice_no": "IV-0001",
        "header.supplier": "ACME Trading",
        "header.grand_total": "1070.00",
        "header.lines": [["Widget", "1000.00"]],
    }
    sugg = {(x["path"], x["attr"]): x["value"] for x in cand["suggestions"]}
    assert sugg[("groups[0].items[0]", "required")] is True
    assert sugg[("groups[0].items[0]", "primary")] is True
    assert sugg[("groups[0].items[2]", "role")] == "grand_total"
    assert sugg[("groups[0].items[3].columns[1]", "role")] == "line_total"

    assert len(llm.requests) == 1 and str(llm.requests[0].url) == LLM_URL
    assert "IV1" in llm.requests[0].content.decode()  # the engine's OCR went to the model
    assert b"llm-key" not in llm.requests[0].content
    assert await business(db) == rows  # no template, job, raw result or version
    assert await step(sm, store, ai_settings) is False  # nothing left

    listed = (await api.get(SAMPLES)).json()["items"]
    assert [i["id"] for i in listed] == [s["id"]] and listed[0]["candidate"] is None
    orig = await api.get(f"{SAMPLES}/{s['id']}/original")
    assert orig.status_code == 200 and orig.content.startswith(b"%PDF")
    assert orig.headers["cache-control"] == "private, no-store"
    page = await api.get(f"{SAMPLES}/{s['id']}/pages/2")
    assert page.status_code == 200 and page.headers["content-type"] == "image/png"
    assert (await api.get(f"{SAMPLES}/{s['id']}/pages/3")).status_code == 404
    names = sample_objects(store)
    assert all(n.split("/")[2] == s["id"] for n in names)  # samples/<tenant>/<id>/...
    assert sorted(n.split("/")[3] for n in names) == ["candidate.json", "ocr.json", "original.pdf"]


async def test_file_checks(api, line, store, db):  # AC-FR-TEMPLATE-014-02
    await login(api, line)
    before = await scans_left(api)
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w/>")
    cases = [
        (buf.getvalue(), "a.pdf", "sample_file_type"),  # a disguised docx
        (b"", "a.png", "sample_file_type"),
        (pdf(51), "a.pdf", "sample_pdf_pages"),
        (b"%PDF-1.7\n" + b"0" * 64, "a.pdf", "sample_file_corrupt"),
        (b"%PDF" + b"0" * (20 * 1024 * 1024), "a.pdf", "sample_file_too_large"),
    ]
    for data, name, code in cases:
        r = await create(api, data, name)
        assert (r.status_code, r.json().get("code")) == (422, code), (name, r.text[:300])
    assert await scans_left(api) == before and sample_objects(store) == []  # nothing reserved
    assert (await create(api, png(), "x.bin")).json()["file_kind"] == "png"  # by content
    assert (await create(api, JPG, "x.pdf")).json()["file_kind"] == "jpg"
    raw = await api.post(SAMPLES, content=pdf(50), headers={"Content-Type": "application/pdf"})
    assert raw.status_code == 202 and raw.json()["pages"] == 50
    assert await scans_left(api) == before - 52


async def test_permissions_need_manage_and_upload(api, line, store, db):  # AC-014-01
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    await subscribe(db, org)
    only_manage = await make_role(db, org, "Templates", ["template_manage"])
    only_upload = await make_role(db, org, "Uploader", ["upload_ocr"])
    both = await make_role(db, org, "Both", ["template_manage", "upload_ocr"])
    a, b, c = client_like(api), client_like(api), client_like(api)
    ids = []
    for client, sub, role in ((a, "M1", only_manage), (b, "M2", only_upload), (c, "M3", both)):
        m = await login(client, line, sub)
        await add_member(db, org, m["user_id"], role)
        ids.append(m["user_id"])

    r = await create(a, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    r = await create(b, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    assert (await b.get(SAMPLES, headers=tenant(org))).status_code == 403  # no management
    assert await audits(db, "template_sample.create") == [
        ("user", str(ids[0]), None, "failure"),
        ("user", str(ids[1]), None, "failure"),
    ]
    assert (await a.get(SAMPLES, headers=tenant(org))).json()["items"] == []

    r = await create(c, headers=tenant(org))
    assert r.status_code == 202, r.text
    # the owner manages templates too, but only the creator sees a sample
    assert (await get(owner, r.json()["id"], tenant(org))).status_code == 404
    assert (await get(a, r.json()["id"], tenant(org))).status_code == 404
    assert (await get(c, r.json()["id"], tenant(org))).status_code == 200

    await api.post("/api/v1/auth/guest")  # a guest never manages templates
    assert (await create(api)).status_code == 403


async def test_only_creator_in_same_tenant(api, line, store, db):  # AC-FR-TEMPLATE-014-05
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    sid = (await create(owner)).json()["id"]  # in the personal tenant
    org, _ = await make_org(db, me["user_id"])
    other = client_like(api)
    stranger = await login(other, line, "STRANGER")

    assert (await get(owner, sid, tenant(org))).status_code == 404  # same user, other tenant
    for path, method in (
        ("", "get"),
        ("/original", "get"),
        ("/pages/1", "get"),
        ("/retry", "post"),
        ("/cancel", "post"),
        ("", "delete"),
    ):
        r = await getattr(other, method)(f"{SAMPLES}/{sid}{path}")
        assert (r.status_code, r.json()["code"]) == (404, "not_found"), path
    assert sid not in json.dumps((await other.get(SAMPLES)).json())
    for action in ("retry", "cancel", "delete"):
        assert await audits(db, f"template_sample.{action}") == [
            ("user", str(stranger["user_id"]), sid, "failure")
        ]
    assert (await get(owner, sid)).json()["status"] == "QUEUED"  # untouched


# ---------------------------------------------------------------------------------------
# scans: charged or released exactly once


async def test_release_once_through_cancel_and_retry(api, line, store, db, sm, ai_settings):
    await login(api, line)
    before = await scans_left(api)
    sid = (await create(api, pdf(2))).json()["id"]
    assert await scans_left(api) == before - 2

    # two cancels at once: one release
    r1, r2 = await asyncio.gather(
        api.post(f"{SAMPLES}/{sid}/cancel"), api.post(f"{SAMPLES}/{sid}/cancel")
    )
    assert (r1.status_code, r2.status_code) == (200, 200)
    assert r1.json()["status"] == r2.json()["status"] == "CANCELED"
    assert await scans_left(api) == before
    assert len(await audits(db, "template_sample.cancel")) == 1
    assert await step(sm, store, ai_settings) is False  # a cancelled sample is not claimed

    assert (await api.post(f"{SAMPLES}/{sid}/retry")).json()["status"] == "QUEUED"
    assert await scans_left(api) == before - 2  # a new OCR task reserves again
    await step(sm, store, ai_settings, FakeEngine(script=["content"]))
    out = (await get(api, sid)).json()
    assert (out["status"], out["failed_stage"], out["error_code"]) == (
        "FAILED",
        "OCR",
        "ocr_failed",
    )
    assert await scans_left(api) == before
    await sample_worker.recover(sm, utcnow() + timedelta(hours=1))  # changes nothing
    assert await scans_left(api) == before

    # two retries at once: one new reservation, the other is refused
    r1, r2 = await asyncio.gather(
        api.post(f"{SAMPLES}/{sid}/retry"), api.post(f"{SAMPLES}/{sid}/retry")
    )
    assert sorted((r1.status_code, r2.status_code)) == [200, 409]
    assert {r1.json().get("code"), r2.json().get("code")} == {None, "sample_not_retryable"}
    assert await scans_left(api) == before - 2 and await open_reservations(db, sid) == 1
    await step(sm, store, ai_settings, llm=SampleLlm(ANSWER))
    out = (await get(api, sid)).json()
    assert out["status"] == "READY" and out["charged_pages"] == 2
    assert await scans_left(api) == before - 2

    r = await api.post(f"{SAMPLES}/{sid}/retry")
    assert (r.status_code, r.json()["code"]) == (409, "sample_not_retryable")
    r = await api.post(f"{SAMPLES}/{sid}/cancel")
    assert (r.status_code, r.json()["code"]) == (409, "sample_not_cancelable")
    assert len(await audits(db, "template_sample.retry")) == 2


async def test_quota_short_stores_nothing(api, line, store, db):
    await login(api, line)
    left = await scans_left(api)
    r = await create(api, pdf(50))
    while r.status_code == 202 and left >= 50:
        left -= 50
        r = await create(api, pdf(50))
    assert r.status_code == 402, r.text
    assert (
        len(sample_objects(store))
        == (await db.execute(text("select count(*) from template_samples"))).scalar()
    )


async def test_generation_retry_never_recharges(api, line, store, db, sm, ai_settings):
    await login(api, line)
    before = await scans_left(api)
    sid = (await create(api, pdf(1))).json()["id"]
    engine = FakeEngine()
    bad = SampleLlm("not json", {"template": {"groups": []}})  # one repair, then failure
    await step(sm, store, ai_settings, engine, bad)
    out = (await get(api, sid)).json()
    assert (out["status"], out["failed_stage"], out["error_code"]) == (
        "FAILED",
        "GENERATE",
        "llm_invalid_output",
    )
    assert len(bad.requests) == 2 and out["candidate"] is None
    assert await scans_left(api) == before - 1 and out["charged_pages"] == 1  # OCR succeeded

    assert (await api.post(f"{SAMPLES}/{sid}/retry")).json()["status"] == "GENERATING"
    await step(sm, store, ai_settings, engine, SampleLlm(ANSWER))
    assert (await get(api, sid)).json()["status"] == "READY"
    assert engine.calls == 1  # the stored OCR payload was reused
    assert await scans_left(api) == before - 1


async def test_llm_not_configured(api, line, store, db, sm, app_settings, ai_settings):
    await login(api, line)
    before = await scans_left(api)
    sid = (await create(api)).json()["id"]
    llm = SampleLlm()
    await step(sm, store, app_settings, llm=llm)  # no llm_api_key
    out = (await get(api, sid)).json()
    assert (out["status"], out["failed_stage"], out["error_code"]) == (
        "FAILED",
        "GENERATE",
        "llm_not_configured",
    )
    assert llm.requests == [] and await scans_left(api) == before - 1
    await api.post(f"{SAMPLES}/{sid}/retry")
    await step(sm, store, ai_settings, llm=SampleLlm(ANSWER))
    assert (await get(api, sid)).json()["status"] == "READY"
    assert await scans_left(api) == before - 1


async def test_ocr_unavailable_and_worker_error_release(api, line, store, db, sm, ai_settings):
    await login(api, line)
    before = await scans_left(api)
    sid = (await create(api)).json()["id"]
    await step(sm, store, ai_settings, FakeEngine(script=["service"] * 5))
    out = (await get(api, sid)).json()
    assert (out["failed_stage"], out["error_code"]) == ("OCR", "ocr_unavailable")
    assert await scans_left(api) == before

    await api.post(f"{SAMPLES}/{sid}/retry")
    real_get = store.get

    async def broken(name):
        if name.startswith("samples/"):
            raise RuntimeError("storage hiccup")
        return await real_get(name)

    store.get = broken
    assert await step(sm, store, ai_settings) is True
    out = (await get(api, sid)).json()
    assert (out["status"], out["failed_stage"], out["error_code"]) == (
        "FAILED",
        "OCR",
        "worker_error",
    )
    assert await scans_left(api) == before


# ---------------------------------------------------------------------------------------
# cancel wins, recovery


async def test_cancel_wins_over_a_returning_worker(api, line, store, db, sm, ai_settings):
    await login(api, line)
    before = await scans_left(api)
    sid = (await create(api)).json()["id"]
    main_loop = asyncio.get_running_loop()

    def cancel_now():  # engines and the LLM run in a worker thread
        r = asyncio.run_coroutine_threadsafe(
            api.post(f"{SAMPLES}/{sid}/cancel"), main_loop
        ).result()
        assert r.status_code == 200, r.text

    await step(sm, store, ai_settings, FakeEngine(on_call=cancel_now))
    out = (await get(api, sid)).json()
    assert out["status"] == "CANCELED" and out["charged_pages"] == 0
    assert await scans_left(api) == before  # released once, OCR result thrown away
    assert sample_objects(store, sid) == [k for k in sample_objects(store, sid) if "original" in k]

    # cancelled again while generating: the OCR stays charged, the candidate is dropped
    await api.post(f"{SAMPLES}/{sid}/retry")
    llm = SampleLlm(ANSWER, on_call=cancel_now)
    await step(sm, store, ai_settings, llm=llm)
    out = (await get(api, sid)).json()
    assert out["status"] == "CANCELED" and out["candidate"] is None
    assert len(llm.requests) == 1 and await scans_left(api) == before - 1
    assert not any(k.endswith("candidate.json") for k in sample_objects(store, sid))
    # and generating again needs no new OCR and no new scans
    assert (await api.post(f"{SAMPLES}/{sid}/retry")).json()["status"] == "GENERATING"
    await step(sm, store, ai_settings, llm=SampleLlm(ANSWER))
    assert (await get(api, sid)).json()["status"] == "READY"
    assert await scans_left(api) == before - 1


async def test_recovery(api, line, store, db, sm, ai_settings):
    await login(api, line)
    before = await scans_left(api)
    ocr, gen, fresh, waiting = [(await create(api)).json()["id"] for _ in range(4)]
    now = utcnow()
    for sid, status, ago, done in (
        (ocr, "OCR_RUNNING", 20, False),
        (gen, "GENERATING", 20, True),
        (fresh, "OCR_RUNNING", 1, False),
    ):
        await db.execute(
            text(
                "update template_samples set status=:s, claimed_at=:c, "
                "ocr_done_at = case when :d then cast(:c as timestamptz) else null end "
                "where id=:i"
            ),
            {"s": status, "c": now - timedelta(minutes=ago), "d": done, "i": sid},
        )
    await db.execute(
        text("update template_samples set status='GENERATING', claimed_at=null where id=:i"),
        {"i": waiting},
    )
    await db.commit()
    assert await scans_left(api) == before - 4

    assert await sample_worker.recover(sm, utcnow()) == 2
    state = {}
    for sid in (ocr, gen, fresh, waiting):
        body = (await get(api, sid)).json()
        state[sid] = (body["status"], body["failed_stage"], body["error_code"])
    assert state == {
        ocr: ("FAILED", "OCR", "ocr_interrupted"),
        gen: ("FAILED", "GENERATE", "generate_interrupted"),
        fresh: ("OCR_RUNNING", None, None),
        waiting: ("GENERATING", None, None),  # not claimed yet: the worker takes it
    }
    assert await scans_left(api) == before - 3  # the interrupted OCR is released
    assert await sample_worker.recover(sm, utcnow(), startup=True) == 1  # the fresh one
    assert await scans_left(api) == before - 2
    assert await sample_worker.recover(sm, utcnow(), startup=True) == 0
    assert await scans_left(api) == before - 2


# ---------------------------------------------------------------------------------------
# from an existing OCR result


async def _recognised_job(api, store, sm, app_settings):
    job = (await new_job(api)).json()
    await worker.run_once(
        sm, store, app_settings, engines={"textin": FakeEngine()}, sleep=_no_sleep
    )
    return job


async def _job_state(db, job_id):
    job = (
        await db.execute(
            text("select status, updated_at, current_mapping_id from ocr_jobs where id=:j"),
            {"j": job_id},
        )
    ).one()
    raw = (await db.execute(text("select payload from ocr_raw_results"))).scalars().all()
    versions = (await db.execute(text("select count(*) from result_versions"))).scalar()
    return tuple(job), raw, versions


async def test_from_job_is_free_and_leaves_the_job(api, line, store, db, sm, ai_settings):
    await login(api, line)
    job = await _recognised_job(api, store, sm, ai_settings)
    before, job_before, rows = (
        await scans_left(api),
        await _job_state(db, job["id"]),
        await business(db),
    )
    r = await api.post(f"{SAMPLES}/from-job", json={"job_id": job["id"]})
    assert r.status_code == 202, r.text
    s = r.json()
    assert (s["status"], s["source"], s["source_job_id"]) == ("GENERATING", "OCR_RESULT", job["id"])
    assert await scans_left(api) == before

    llm = SampleLlm(ANSWER)
    engine = FakeEngine()
    await step(sm, store, ai_settings, engine, llm)
    out = (await get(api, s["id"])).json()
    assert out["status"] == "READY" and out["charged_pages"] == 0 and engine.calls == 0
    assert "IV1" in llm.requests[0].content.decode()  # the job's raw payload was used
    assert await scans_left(api) == before
    assert await _job_state(db, job["id"]) == job_before  # job, raw and results unchanged
    assert await business(db) == rows
    orig = await api.get(f"{SAMPLES}/{s['id']}/original")
    files = [v[0] for k, v in store.objects.items() if not k.startswith("samples/")]
    assert orig.status_code == 200 and orig.content in files  # the job's own file, not a copy
    assert not any(k.startswith("samples/") and "original" in k for k in store.objects)
    assert len(await audits(db, "template_sample.create_from_job")) == 1

    await api.delete(f"{SAMPLES}/{s['id']}")  # deleting the sample keeps the job's file
    assert (await api.get(f"/api/v1/ocr/jobs/{job['id']}")).status_code == 200
    assert await business(db) == rows


async def test_from_job_needs_manage_but_not_upload(api, line, store, db, sm, ai_settings):
    # AC-FR-SYS-140-02: without upload_ocr a manager can still reuse a visible OCR result
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    await subscribe(db, org)
    job = (await new_job(owner, headers=tenant(org))).json()
    await worker.run_once(sm, store, ai_settings, engines={"textin": FakeEngine()}, sleep=_no_sleep)
    browse = await make_role(db, org, "Browse", ["template_manage", "data_browse"])
    own_only = await make_role(db, org, "Own", ["template_manage"])
    no_manage = await make_role(db, org, "Viewer", ["data_browse"])
    a, b, c = client_like(api), client_like(api), client_like(api)
    for client, sub, role in ((a, "B1", browse), (b, "B2", own_only), (c, "B3", no_manage)):
        m = await login(client, line, sub)
        await add_member(db, org, m["user_id"], role)

    r = await a.post(f"{SAMPLES}/from-job", json={"job_id": job["id"]}, headers=tenant(org))
    assert r.status_code == 202, r.text
    r = await b.post(f"{SAMPLES}/from-job", json={"job_id": job["id"]}, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (404, "not_found")  # not in their scope
    r = await c.post(f"{SAMPLES}/from-job", json={"job_id": job["id"]}, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    r = await create(a, headers=tenant(org))  # a new upload still needs upload_ocr
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")


async def test_from_job_needs_a_visible_successful_job(api, line, store, db, sm, app_settings):
    await login(api, line)
    queued = (await new_job(api)).json()
    r = await api.post(f"{SAMPLES}/from-job", json={"job_id": queued["id"]})
    assert (r.status_code, r.json()["code"]) == (409, "sample_source_not_ready")
    await worker.run_once(
        sm, store, app_settings, engines={"textin": FakeEngine()}, sleep=_no_sleep
    )

    other = client_like(api)
    stranger = await login(other, line, "STRANGER")
    before = await scans_left(other)
    for job_id in (queued["id"], "no-such-job"):
        r = await other.post(f"{SAMPLES}/from-job", json={"job_id": job_id})
        assert (r.status_code, r.json()["code"]) == (404, "not_found")
    assert await audits(db, "template_sample.create_from_job") == [
        ("user", str(stranger["user_id"]), queued["id"], "failure"),
        ("user", str(stranger["user_id"]), "no-such-job", "failure"),
    ]
    assert await scans_left(other) == before
    assert (await db.execute(text("select count(*) from template_samples"))).scalar() == 0


# ---------------------------------------------------------------------------------------
# delete and the seven-day purge


async def test_delete_and_expiry_purge_every_object(api, line, store, db, sm, ai_settings):
    me = await login(api, line)
    before = await scans_left(api)
    ready, queued, old = [(await create(api)).json()["id"] for _ in range(3)]
    await db.execute(
        text(
            "update template_samples set created_at = created_at - interval '1 second' "
            "where id = :i"
        ),
        {"i": ready},
    )
    await db.commit()
    await step(sm, store, ai_settings, llm=SampleLlm(ANSWER))
    assert (await get(api, ready)).json()["status"] == "READY"
    assert len(sample_objects(store, ready)) == 3
    rows = await business(db)

    assert (await api.delete(f"{SAMPLES}/{ready}")).status_code == 204
    assert (await get(api, ready)).status_code == 404
    assert sample_objects(store, ready) == []
    assert (await api.delete(f"{SAMPLES}/{queued}")).status_code == 204
    assert sample_objects(store, queued) == []
    assert await scans_left(api) == before - 2  # the unfinished one gave its scan back
    assert await audits(db, "template_sample.delete") == [
        ("user", str(me["user_id"]), ready, "success"),
        ("user", str(me["user_id"]), queued, "success"),
    ]

    await db.execute(
        text("update template_samples set expires_at = now() - interval '1 minute' where id=:i"),
        {"i": old},
    )
    await db.commit()
    assert (await get(api, old)).status_code == 404  # past seven days: gone at once
    assert (await api.get(SAMPLES)).json()["items"] == []
    assert await sample_worker.purge_expired(sm, store) == 1
    assert sample_objects(store) == []
    assert await scans_left(api) == before - 1  # expired before OCR: released
    assert await audits(db, "template_sample.purge") == [("system", None, old, "success")]
    assert await sample_worker.purge_expired(sm, store) == 0
    keys = (
        await db.execute(
            text(
                "select count(*) from template_samples where purged_at is not null "
                "and original_key is null and ocr_key is null and candidate_key is null"
            )
        )
    ).scalar()
    assert keys == 3
    assert await business(db) == rows
    assert await step(sm, store, ai_settings) is False


# ---------------------------------------------------------------------------------------
# the existing worker loop


async def test_formal_worker_ignores_samples(api, line, store, db, sm, ai_settings):
    await login(api, line)
    sid = (await create(api)).json()["id"]
    assert await worker.run_once(sm, store, ai_settings, engines={"textin": FakeEngine()}) is False
    assert (await get(api, sid)).json()["status"] == "QUEUED"


async def test_loop_runs_samples(api, line, store, db, sm, app_settings, monkeypatch):
    calls = []

    async def fake_run(_sm, _store, _settings):
        calls.append("run")
        return False

    async def fake_recover(_sm, _now, *, startup=False):
        calls.append(("recover", startup))
        return 0

    async def idle(*_a, **_k):
        return False

    monkeypatch.setattr(worker.sample_worker, "run_once", fake_run)
    monkeypatch.setattr(worker.sample_worker, "recover", fake_recover)
    monkeypatch.setattr(worker, "run_once", idle)  # the formal queue is covered elsewhere
    monkeypatch.setattr(worker, "recover", idle)
    monkeypatch.setattr(worker.mapping_worker, "run_once", idle)
    monkeypatch.setattr(worker.mapping_worker, "recover", idle)
    monkeypatch.setattr(worker, "RECOVER_EVERY", 0.0)
    stop = asyncio.Event()
    settings = app_settings.model_copy(
        update={"ocr_poll_seconds": 0.01, "ocr_worker_enabled": True}
    )
    task = asyncio.create_task(worker.loop(sm, store, settings, stop))
    for _ in range(200):
        if "run" in calls and ("recover", False) in calls:
            break
        await asyncio.sleep(0.02)
    stop.set()
    await task
    assert calls[0] == ("recover", True)
    assert "run" in calls and ("recover", False) in calls
