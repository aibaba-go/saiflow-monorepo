"""Exports of confirmed results and download tickets (FR-ENTRY-015)."""

import io
from datetime import timedelta

import pytest
from openpyxl import load_workbook
from pydantic import SecretStr
from sqlalchemy import text

from app.clock import utcnow
from app.db import create_sessionmaker
from app.services import export_service
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import client_like
from tests.integration.test_results import registered, result, save, tax_job
from tests.integration.test_template_mapping import FakeLlm

JOBS = "/api/v1/ocr/jobs"


@pytest.fixture
def sm(db_engine):
    return create_sessionmaker(db_engine)


@pytest.fixture
def llm():
    return FakeLlm()


@pytest.fixture
def ai_settings(app_settings):
    return app_settings.model_copy(update={"llm_api_key": SecretStr("llm-key")})


@pytest.fixture
def ticket_secret(api):
    api.app.state.settings = api.app.state.settings.model_copy(
        update={"download_ticket_secret": SecretStr("t" * 32)}
    )


async def confirmed_job(api, line, mail, store, sm, settings, llm, db, sub="R1"):
    await registered(api, line, mail, sub)
    job = await tax_job(api, store, sm, settings, llm, db)
    body = await result(api, job["id"])
    body["structured"]["document"]["invoice_no"] = "007123"
    r = await save(api, job["id"], body["version"], body["structured"], confirm=True)
    assert r.status_code == 200, r.text
    return job


async def test_export_and_download(api, line, mail, store, sm, ai_settings, llm, db):
    # AC-FR-ENTRY-015-01
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    r = await api.post(f"{JOBS}/{job['id']}/exports")
    assert r.status_code == 201, r.text
    export_id = r.json()["id"]
    assert f"exports/{export_id}.en.xlsx" in store.objects
    d = await api.get(f"/api/v1/exports/{export_id}/download")
    assert d.status_code == 200
    assert d.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "attachment" in d.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(d.content))
    values = [c.value for row in wb.worksheets[0].iter_rows() for c in row]
    assert "007123" in values
    assert wb["_saiflow"]["A1"].value.startswith("template:")


async def test_reuse_live_export(api, line, mail, store, sm, ai_settings, llm, db):
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    first = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    again = await api.post(f"{JOBS}/{job['id']}/exports")
    assert again.status_code == 200 and again.json()["id"] == first
    await db.execute(
        text("update exports set expires_at = :t where id = :i"),
        {"t": utcnow() - timedelta(seconds=1), "i": first},
    )
    await db.commit()
    assert (await api.get(f"/api/v1/exports/{first}/download")).status_code == 404
    fresh = await api.post(f"{JOBS}/{job['id']}/exports")
    assert fresh.status_code == 201 and fresh.json()["id"] != first


async def test_unconfirmed_409(api, line, store, sm, ai_settings, llm, db):  # AC-015-02
    await login(api, line)
    job = await tax_job(api, store, sm, ai_settings, llm, db)
    r = await api.post(f"{JOBS}/{job['id']}/exports")
    assert (r.status_code, r.json()["code"]) == (409, "result_not_confirmed")
    assert not any(n.startswith("exports/") for n in store.objects)


async def test_ticket_60s(
    api, line, mail, store, sm, ai_settings, llm, db, ticket_secret, monkeypatch
):
    # AC-FR-ENTRY-015-03
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    export_id = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    url = (await api.post(f"/api/v1/exports/{export_id}/ticket")).json()["url"]
    assert url.startswith("/api/v1/export-downloads/")
    bare = client_like(api)  # no cookie: the system browser's downloader
    assert (await bare.get(url)).status_code == 200
    later = utcnow() + timedelta(seconds=61)
    monkeypatch.setattr(export_service, "utcnow", lambda: later)
    assert (await bare.get(url)).status_code == 404


async def test_other_user_and_session_404(
    api, line, mail, store, sm, ai_settings, llm, db, ticket_secret
):
    # AC-FR-ENTRY-015-04
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    export_id = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    url = (await api.post(f"/api/v1/exports/{export_id}/ticket")).json()["url"]
    other = client_like(api)
    await login(other, line, "V1")
    assert (await other.get(f"/api/v1/exports/{export_id}/download")).status_code == 404
    assert (await other.post(f"/api/v1/exports/{export_id}/ticket")).status_code == 404
    # the ticket dies with its session
    await api.post("/api/v1/auth/logout")
    assert (await client_like(api).get(url)).status_code == 404
    tampered = url[:-2] + ("AA" if not url.endswith("AA") else "BB")
    assert (await client_like(api).get(tampered)).status_code == 404


async def test_member_without_export_403(api, line, mail, store, sm, ai_settings, llm, db):
    from tests.integration.tenancy_helpers import add_member, make_org, make_role, tenant
    from tests.integration.test_ocr_jobs import new_job

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
    role = await make_role(db, org, "Clerk", ["upload_ocr", "verify_own"])
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], role)
    r = await new_job(api, headers=tenant(org))
    assert r.status_code == 201, r.text
    job = r.json()
    await db.execute(text("update ocr_jobs set status='SUCCEEDED', review_status='CONFIRMED'"))
    await db.commit()
    r = await api.post(f"{JOBS}/{job['id']}/exports", headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")


async def test_ticket_needs_the_secret(api, line, mail, store, sm, ai_settings, llm, db):
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    export_id = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    r = await api.post(f"/api/v1/exports/{export_id}/ticket")
    assert (r.status_code, r.json()["code"]) == (503, "download_ticket_unavailable")


async def test_language_gets_its_own_file(api, line, mail, store, sm, ai_settings, llm, db):
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    en = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    th = await api.post(f"{JOBS}/{job['id']}/exports", json={"language": "th"})
    assert th.status_code == 201 and th.json()["id"] != en
    assert f"exports/{th.json()['id']}.th.xlsx" in store.objects
    bad = await api.post(f"{JOBS}/{job['id']}/exports", json={"language": "fr"})
    assert bad.status_code == 400


async def test_download_needs_export_and_ticket_is_own(api, line, mail, store, db, ticket_secret):
    """A colleague who can browse the job but lacks export cannot download; nobody gets a
    ticket for someone else's export (final review 8)."""
    import uuid

    from tests.integration.tenancy_helpers import add_member, make_org, make_role, tenant
    from tests.integration.test_ocr_jobs import new_job

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
    viewer = await make_role(db, org, "Viewer", ["data_browse"])
    exporter = await make_role(db, org, "Exporter", ["data_browse", "export"])
    v = await login(api, line, "V1")
    await add_member(db, org, v["user_id"], viewer)
    other = client_like(api)
    e = await login(other, line, "E1")
    await add_member(db, org, e["user_id"], exporter)
    job = (await new_job(owner, headers=tenant(org))).json()
    vid, xid = str(uuid.uuid4()), str(uuid.uuid4())
    await db.execute(
        text(
            "insert into result_versions (id, job_id, version, structured) "
            "values (:v, :j, 1, '{}'::jsonb)"
        ),
        {"v": vid, "j": job["id"]},
    )
    await db.execute(
        text(
            "insert into exports (id, job_id, result_version_id, format, status, storage_path, "
            "expires_at, created_by_user_id) values (:x, :j, :v, 'XLSX', 'READY', :p, "
            "now() + interval '1 hour', :u)"
        ),
        {"x": xid, "j": job["id"], "v": vid, "p": f"exports/{xid}.en.xlsx", "u": me["user_id"]},
    )
    await db.commit()
    await store.put(f"exports/{xid}.en.xlsx", b"x", "application/octet-stream")
    h = tenant(org)
    assert (await api.get(f"/api/v1/exports/{xid}/download", headers=h)).status_code == 403
    assert (await api.post(f"/api/v1/exports/{xid}/ticket", headers=h)).status_code == 403
    assert (await other.post(f"/api/v1/exports/{xid}/ticket", headers=h)).status_code == 404
    assert (await other.get(f"/api/v1/exports/{xid}/download", headers=h)).status_code == 200
    assert (await owner.post(f"/api/v1/exports/{xid}/ticket", headers=h)).status_code == 200


async def test_get_export(api, line, mail, store, sm, ai_settings, llm, db):
    """An export's state for main's final page; expired or someone else's is 404."""
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    export_id = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    r = await api.get(f"/api/v1/exports/{export_id}")
    assert r.status_code == 200, r.text
    assert r.json()["id"] == export_id and r.json()["status"] == "READY"
    other = client_like(api)
    await login(other, line, "V1")
    assert (await other.get(f"/api/v1/exports/{export_id}")).status_code == 404
    await db.execute(
        text("update exports set expires_at = :t where id = :i"),
        {"t": utcnow() - timedelta(seconds=1), "i": export_id},
    )
    await db.commit()
    assert (await api.get(f"/api/v1/exports/{export_id}")).status_code == 404
