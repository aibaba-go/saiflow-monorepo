"""Platform admin template samples (FR-SYS-142, FR-TEMPLATE-008/014): the admin console uploads
a sample, the same worker builds a candidate, the admin saves it as a system or tenant draft.
No tenant quota is reserved or charged; a sample is visible to its admin alone; delete and
the seven-day purge remove every object. Engines and the LLM are fakes."""

from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import admin_client, client_like, make_org
from tests.integration.test_ocr_jobs import scans_left
from tests.integration.test_ocr_worker import FakeEngine
from tests.integration.test_template_samples import (
    ANSWER,
    SAMPLES,
    SampleLlm,
    ai_settings,  # noqa: F401  (fixture)
    audits,
    business,
    sample_objects,
    sm,  # noqa: F401  (fixture)
    step,
)
from tests.integration.test_uploads import JPG, pdf

ADMIN_SAMPLES = "/api/v1/admin/template-samples"
ADMIN_TEMPLATES = "/api/v1/admin/templates"


async def upload(c, data=None, name="s.pdf"):
    return await c.post(
        ADMIN_SAMPLES,
        files={"file": (name, pdf(1) if data is None else data, "application/octet-stream")},
    )


async def reservations(db) -> int:
    return (await db.execute(text("select count(*) from quota_reservations"))).scalar()


async def admin_id(db, username="ops") -> str:
    row = await db.execute(text("select id from admin_accounts where username=:u"), {"u": username})
    return str(row.scalar())


async def test_admin_upload_to_ready_without_quota(api, line, store, db, sm, ai_settings):  # noqa: F811
    me = await login(api, line)
    before, held, rows = await scans_left(api), await reservations(db), await business(db)
    admin = await admin_client(api, db)
    r = await upload(admin, pdf(2))
    assert r.status_code == 202, r.text
    s = r.json()
    assert (s["status"], s["source"], s["file_kind"], s["pages"]) == ("QUEUED", "UPLOAD", "pdf", 2)
    assert await reservations(db) == held  # nothing reserved for anyone
    assert await audits(db, "template_sample.create") == [
        ("admin", await admin_id(db), s["id"], "success")
    ]

    assert await step(sm, store, ai_settings, llm=SampleLlm(ANSWER)) is True
    out = (await admin.get(f"{ADMIN_SAMPLES}/{s['id']}")).json()
    assert out["status"] == "READY" and out["charged_pages"] == 0
    assert out["candidate"]["values"]["header.invoice_no"] == "IV-0001"
    assert await reservations(db) == held and await scans_left(api) == before
    assert await business(db) == rows

    listed = (await admin.get(ADMIN_SAMPLES)).json()["items"]
    assert [i["id"] for i in listed] == [s["id"]] and listed[0]["candidate"] is None
    orig = await admin.get(f"{ADMIN_SAMPLES}/{s['id']}/original")
    assert orig.status_code == 200 and orig.content.startswith(b"%PDF")
    assert orig.headers["cache-control"] == "private, no-store"
    page = await admin.get(f"{ADMIN_SAMPLES}/{s['id']}/pages/2")
    assert page.status_code == 200 and page.headers["content-type"] == "image/png"
    assert (await admin.get(f"{ADMIN_SAMPLES}/{s['id']}/pages/3")).status_code == 404
    names = sample_objects(store, s["id"])
    assert names and all(n.startswith(f"samples/admin/{s['id']}/") for n in names)

    # a customer never sees it, not even with the same ID
    assert (await api.get(f"{SAMPLES}/{s['id']}")).status_code == 404
    assert s["id"] not in str((await api.get(SAMPLES)).json())
    assert me["tenant_id"]


async def test_admin_sample_checks_and_visibility(api, line, store, db):
    admin = await admin_client(api, db)
    other = await admin_client(api, db, "ops2")
    r = await upload(admin, b"%PDF-1.7\n" + b"0" * 64)
    assert (r.status_code, r.json()["code"]) == (422, "sample_file_corrupt")
    r = await upload(admin, pdf(51))
    assert (r.status_code, r.json()["code"]) == (422, "sample_pdf_pages")
    assert sample_objects(store) == []
    sid = (await upload(admin, JPG, "x.pdf")).json()["id"]

    for path, method in (
        ("", "get"),
        ("/original", "get"),
        ("/pages/1", "get"),
        ("/retry", "post"),
        ("/cancel", "post"),
        ("", "delete"),
    ):
        r = await getattr(other, method)(f"{ADMIN_SAMPLES}/{sid}{path}")
        assert (r.status_code, r.json()["code"]) == (404, "not_found"), path
    assert (await other.get(ADMIN_SAMPLES)).json()["items"] == []
    for action in ("retry", "cancel", "delete"):
        assert await audits(db, f"template_sample.{action}") == [
            ("admin", await admin_id(db, "ops2"), sid, "failure")
        ]
    assert (await admin.get(f"{ADMIN_SAMPLES}/{sid}")).json()["status"] == "QUEUED"

    # customers and the anonymous cannot reach the admin routes
    await login(api, line)
    assert (await api.get(ADMIN_SAMPLES)).status_code == 401
    assert (await client_like(api).get(f"{ADMIN_SAMPLES}/{sid}")).status_code == 401
    # writes need the CSRF header like every admin write
    r = await admin.post(f"{ADMIN_SAMPLES}/{sid}/cancel", headers={"X-Requested-With": "x"})
    assert (r.status_code, r.json()["code"]) == (403, "csrf_header_missing")


async def test_save_as_system_or_tenant_draft(api, line, store, db, sm, ai_settings):  # noqa: F811
    me = await login(api, line)
    org, _ = await make_org(db, me["user_id"])
    admin = await admin_client(api, db)
    sid = (await upload(admin)).json()["id"]

    def body(scope, code, **extra):
        return {
            "scope": scope,
            "content": {**ANSWER["template"], "code": code},
            "source": "sample",
            "sample_id": sid,
            "pending_confirmations": [
                {"path": "groups[0].items[0]", "attr": "primary", "value": True}
            ],
            **extra,
        }

    r = await admin.post(ADMIN_TEMPLATES, json=body("system", "sys_inv"))
    assert (r.status_code, r.json()["code"]) == (404, "not_found")  # not READY yet
    await step(sm, store, ai_settings, llm=SampleLlm(ANSWER))

    r = await admin.post(ADMIN_TEMPLATES, json=body("system", "sys_inv"))
    assert r.status_code == 201, r.text
    sys_tpl = r.json()
    assert sys_tpl["scope"] == "system" and sys_tpl["current"] is None
    assert len(sys_tpl["pending_confirmations"]) == 1
    r = await admin.post(
        f"{ADMIN_TEMPLATES}/{sys_tpl['id']}/activate", json={"revision": sys_tpl["revision"]}
    )
    assert (r.status_code, r.json()["code"]) == (422, "template_unconfirmed")

    r = await admin.post(ADMIN_TEMPLATES, json=body("tenant", "org_inv", tenant_id=org))
    assert r.status_code == 201, r.text
    assert r.json()["owner_name"]
    # the sample stays for another draft; a missing sample ID is a validation error
    assert (await admin.get(f"{ADMIN_SAMPLES}/{sid}")).json()["status"] == "READY"
    r = await admin.post(ADMIN_TEMPLATES, json=body("system", "x", sample_id=None))
    assert (r.status_code, r.json()["code"]) == (422, "validation_error")

    # another admin's sample, or a customer's, cannot back an admin draft
    other = await admin_client(api, db, "ops2")
    r = await other.post(ADMIN_TEMPLATES, json=body("system", "y"))
    assert (r.status_code, r.json()["code"]) == (404, "not_found")
    tenant_sid = await api.post(SAMPLES, files={"file": ("a.pdf", pdf(1), "application/pdf")})
    r = await admin.post(
        ADMIN_TEMPLATES, json=body("system", "z", sample_id=tenant_sid.json()["id"])
    )
    assert (r.status_code, r.json()["code"]) == (404, "not_found")
    # nor can an admin sample back a customer's template
    r = await api.post(
        "/api/v1/managed-templates",
        json={"content": {**ANSWER["template"], "code": "c"}, "source": "sample", "sample_id": sid},
    )
    assert r.status_code == 404


async def test_admin_retry_cancel_delete_and_purge(api, line, store, db, sm, ai_settings):  # noqa: F811
    from app.ocr import sample_worker

    admin = await admin_client(api, db)
    held = await reservations(db)
    sid = (await upload(admin)).json()["id"]
    r = await admin.post(f"{ADMIN_SAMPLES}/{sid}/cancel")
    assert r.json()["status"] == "CANCELED"
    assert (await admin.post(f"{ADMIN_SAMPLES}/{sid}/cancel")).json()["status"] == "CANCELED"
    assert len(await audits(db, "template_sample.cancel")) == 1
    assert (await admin.post(f"{ADMIN_SAMPLES}/{sid}/retry")).json()["status"] == "QUEUED"
    await step(sm, store, ai_settings, FakeEngine(script=["content"]))
    out = (await admin.get(f"{ADMIN_SAMPLES}/{sid}")).json()
    assert (out["status"], out["failed_stage"]) == ("FAILED", "OCR")
    assert (await admin.post(f"{ADMIN_SAMPLES}/{sid}/retry")).json()["status"] == "QUEUED"
    await step(sm, store, ai_settings, llm=SampleLlm("not json", "still not json"))
    out = (await admin.get(f"{ADMIN_SAMPLES}/{sid}")).json()
    assert (out["status"], out["failed_stage"]) == ("FAILED", "GENERATE")
    r = await admin.post(f"{ADMIN_SAMPLES}/{sid}/retry")
    assert r.json()["status"] == "GENERATING"  # the stored OCR is reused
    await step(sm, store, ai_settings, llm=SampleLlm(ANSWER))
    assert (await admin.get(f"{ADMIN_SAMPLES}/{sid}")).json()["status"] == "READY"
    r = await admin.post(f"{ADMIN_SAMPLES}/{sid}/retry")
    assert (r.status_code, r.json()["code"]) == (409, "sample_not_retryable")
    r = await admin.post(f"{ADMIN_SAMPLES}/{sid}/cancel")
    assert (r.status_code, r.json()["code"]) == (409, "sample_not_cancelable")
    assert await reservations(db) == held  # never anything to reserve or release

    assert len(sample_objects(store, sid)) == 3
    assert (await admin.delete(f"{ADMIN_SAMPLES}/{sid}")).status_code == 204
    assert sample_objects(store, sid) == []
    assert (await admin.get(f"{ADMIN_SAMPLES}/{sid}")).status_code == 404
    assert await audits(db, "template_sample.delete") == [
        ("admin", await admin_id(db), sid, "success")
    ]

    old = (await upload(admin)).json()["id"]
    await db.execute(
        text("update template_samples set expires_at = now() - interval '1 minute' where id=:i"),
        {"i": old},
    )
    await db.commit()
    assert (await admin.get(f"{ADMIN_SAMPLES}/{old}")).status_code == 404
    assert await sample_worker.purge_expired(sm, store) == 1
    assert sample_objects(store) == []
    status = await db.execute(text("select status from template_samples where id=:i"), {"i": old})
    assert status.scalar() == "CANCELED"
