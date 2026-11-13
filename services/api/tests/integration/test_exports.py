"""Exports of confirmed results and download tickets (FR-ENTRY-015)."""

import io
from copy import deepcopy
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
from tests.integration.test_template_mapping import (
    FALLBACK,
    GENERIC_JSON,
    GENERIC_OUTPUT,
    VISION_RAW,
    FakeLlm,
    raw_result,
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


async def test_head_download_and_ticket_match_get_metadata(
    api, line, mail, store, sm, ai_settings, llm, db, ticket_secret, monkeypatch
):
    """FR-ENTRY-015: a downloader may HEAD first; it gets GET headers but no file body."""
    job = await confirmed_job(api, line, mail, store, sm, ai_settings, llm, db)
    export_id = (await api.post(f"{JOBS}/{job['id']}/exports")).json()["id"]
    direct_url = f"/api/v1/exports/{export_id}/download"
    ticket_url = (await api.post(f"/api/v1/exports/{export_id}/ticket")).json()["url"]
    # HTTPX suppresses HEAD bodies itself, so also inspect what the ASGI app sends.
    sent_bodies = []
    inner_app = api._transport.app

    async def capture(scope, receive, send):
        async def record(message):
            if scope["method"] == "HEAD" and message["type"] == "http.response.body":
                sent_bodies.append(message.get("body", b""))
            await send(message)

        await inner_app(scope, receive, record)

    monkeypatch.setattr(api._transport, "app", capture)
    async with client_like(api) as bare:
        for client, url in ((api, direct_url), (bare, ticket_url)):
            head = await client.head(url)
            assert head.status_code == 200, head.status_code
            downloaded = await client.get(url)
            assert downloaded.status_code == 200
            for name in ("content-type", "content-disposition", "content-length", "cache-control"):
                assert head.headers[name] == downloaded.headers[name]
            assert int(head.headers["content-length"]) == len(downloaded.content) > 0
            assert head.content == b""
            # A metadata probe does not consume the ticket or invalidate the export.
            assert (await client.head(url)).status_code == 200
        assert sent_bodies and all(body == b"" for body in sent_bodies)
        assert (await bare.head(direct_url)).status_code == 401


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
    assert (await api.head(f"/api/v1/exports/{first}/download")).status_code == 404
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
    assert (await bare.head(url)).status_code == 404


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
    assert (await other.head(f"/api/v1/exports/{export_id}/download")).status_code == 404
    assert (await other.post(f"/api/v1/exports/{export_id}/ticket")).status_code == 404
    # the ticket dies with its session
    await api.post("/api/v1/auth/logout")
    assert (await client_like(api).get(url)).status_code == 404
    assert (await client_like(api).head(url)).status_code == 404
    tampered = url[:-2] + ("AA" if not url.endswith("AA") else "BB")
    assert (await client_like(api).get(tampered)).status_code == 404
    assert (await client_like(api).head(tampered)).status_code == 404


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
    assert (await api.head(f"/api/v1/exports/{xid}/download", headers=h)).status_code == 403
    assert (await api.post(f"/api/v1/exports/{xid}/ticket", headers=h)).status_code == 403
    assert (await other.post(f"/api/v1/exports/{xid}/ticket", headers=h)).status_code == 404
    assert (await other.get(f"/api/v1/exports/{xid}/download", headers=h)).status_code == 200
    assert (await owner.post(f"/api/v1/exports/{xid}/ticket", headers=h)).status_code == 200
    # FR-SYS-107-01: each authorized colleague must create/reuse an export they can ticket.
    await db.execute(
        text(
            "update ocr_jobs set status='SUCCEEDED', review_status='CONFIRMED', "
            "confirmed_version_id=:v where id=:j"
        ),
        {"v": vid, "j": job["id"]},
    )
    await db.commit()
    own = await other.post(f"{JOBS}/{job['id']}/exports", headers=h)
    assert own.status_code == 201, own.text
    own_id = own.json()["id"]
    assert own_id != xid
    again = await other.post(f"{JOBS}/{job['id']}/exports", headers=h)
    assert again.status_code == 200 and again.json()["id"] == own_id
    ticket = await other.post(f"/api/v1/exports/{own_id}/ticket", headers=h)
    assert ticket.status_code == 200, ticket.text
    download = await client_like(api).get(ticket.json()["url"])
    assert download.status_code == 200
    load_workbook(io.BytesIO(download.content))
    # Creating a colleague's file must not break reuse or authorization of the owner's.
    reused = await owner.post(f"{JOBS}/{job['id']}/exports", headers=h)
    assert reused.status_code == 200 and reused.json()["id"] == xid
    assert (await owner.post(f"/api/v1/exports/{own_id}/ticket", headers=h)).status_code == 404


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


async def _download_workbook(api, job_id, headers=None):
    response = await api.post(f"{JOBS}/{job_id}/exports", headers=headers or {})
    assert response.status_code == 201, response.text
    export_id = response.json()["id"]
    download = await api.get(f"/api/v1/exports/{export_id}/download", headers=headers or {})
    assert download.status_code == 200, download.text
    return export_id, load_workbook(io.BytesIO(download.content))


def _assert_text_cells(workbook, expected):
    cells = [cell for row in workbook.worksheets[0].iter_rows() for cell in row]
    for value in expected:
        matches = [c for c in cells if c.value == value]
        assert matches, (value, [c.value for c in cells])
        assert all(c.data_type == "s" for c in matches)


@pytest.mark.parametrize("engine", ["textin", "google_vision"])
async def test_both_primary_template_save_confirm_export_exact_cells(
    api, line, mail, store, sm, ai_settings, llm, db, engine
):
    # AC-FR-OCR-025-04, FR-OCR-016, FR-ENTRY-015.
    await registered(api, line, mail)
    job = await tax_job(api, store, sm, ai_settings, llm, db, engine=engine)
    vendor = await raw_result(db, job["id"])
    assert vendor.engine == engine
    body = await result(api, job["id"])
    assert body["structured"]["document"]["invoice_date"] == "2026-10-01"
    assert body["structured"]["goods"]["line_items"][0]["seq"] == 1
    assert body["structured"]["goods"]["line_items"][0]["quantity"] == "1200"
    assert body["structured"]["summary"]["net_total"] == "16050.40"
    body["structured"]["document"]["invoice_no"] = "007123"
    body["structured"]["goods"]["line_items"][0]["quantity"] = "123456789012.34567890"
    body["structured"]["goods"]["line_items"][0]["amount"] = "123456789012.30"
    saved = await save(api, job["id"], body["version"], body["structured"])
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == body["version"] + 1
    done = await save(
        api, job["id"], saved.json()["version"], saved.json()["structured"], confirm=True
    )
    assert done.status_code == 200, done.text
    export_id, workbook = await _download_workbook(api, job["id"])
    _assert_text_cells(
        workbook,
        ["007123", "2026-10-01", "1", "123456789012.34567890", "123456789012.30", "16050.40"],
    )
    template_version = body["template"]["template_version_id"]
    template_id, version = (
        await db.execute(
            text("select template_id, version from document_template_versions where id=:v"),
            {"v": template_version},
        )
    ).one()
    assert workbook["_saiflow"]["A1"].value == f"template:{template_id}:v{version}"
    assert workbook["_saiflow"].sheet_state == "hidden"
    export_version = (
        await db.execute(
            text(
                "select v.version from exports e join result_versions v "
                "on v.id=e.result_version_id where e.id=:e"
            ),
            {"e": export_id},
        )
    ).scalar_one()
    assert export_version == saved.json()["version"]
    assert tuple(await raw_result(db, job["id"])) == tuple(vendor)


@pytest.mark.parametrize("mode", ["generic", "invalid-llm", "no-llm"])
async def test_vision_generic_or_fallback_save_confirm_export_exact_text(
    api, line, mail, store, sm, ai_settings, llm, db, mode
):
    # AC-FR-OCR-025-01/03/05, AC-FR-OCR-026-03: latest confirmed version, not the raw/version 1.
    await registered(api, line, mail)
    job = await vision_job(
        api,
        store,
        sm,
        ai_settings,
        llm,
        db,
        output=GENERIC_JSON if mode == "generic" else "null",
        no_llm=mode == "no-llm",
    )
    body = await result(api, job["id"])
    expected = GENERIC_OUTPUT if mode == "generic" else FALLBACK
    assert body["structured"] == expected
    denied = await api.post(f"{JOBS}/{job['id']}/exports")
    assert (denied.status_code, denied.json()["code"]) == (409, "result_not_confirmed")
    assert not any(key.startswith("exports/") for key in store.objects)
    edited = deepcopy(body["structured"])
    if mode == "generic":
        edited["invoice_no"] = "007123"
        edited["items"][0]["big"] = "12345678901234567891"
    else:
        edited["ocr_text"]["page_1"] += "\n已核验 -12345678901234567890"
    saved = await save(api, job["id"], body["version"], edited)
    assert saved.status_code == 200 and saved.json()["version"] == 2, saved.text
    done = await save(api, job["id"], 2, edited, confirm=True)
    assert done.status_code == 200, done.text
    assert done.json()["structured"] == edited
    export_id, workbook = await _download_workbook(api, job["id"])
    assert workbook["_saiflow"]["A1"].value == "generic"
    if mode == "generic":
        _assert_text_cells(
            workbook,
            [
                "007123",
                "12345678901234567890",
                "-12345678901234567890",
                "12345678901234567891",
                "9007199254740992",
                "-9007199254740992",
                "9007199254740991",
                "-9007199254740991",
                "0",
                "False",
                "123456789012.30",
            ],
        )
    else:
        _assert_text_cells(workbook, ["ocr_text", "page_1", "page_2", edited["ocr_text"]["page_1"]])
        sheet = workbook.worksheets[0]
        blank = next(row for row in sheet.iter_rows() if row[0].value == "page_2")
        assert blank[1].value in (None, "")  # Excel's empty text cell is decoded as None.
    version = (
        await db.execute(
            text(
                "select v.version from exports e join result_versions v "
                "on v.id=e.result_version_id where e.id=:e"
            ),
            {"e": export_id},
        )
    ).scalar_one()
    assert version == 2
    assert tuple(await raw_result(db, job["id"])) == ("google_vision", VISION_RAW)
    assert llm.calls == ([] if mode == "no-llm" else ["generic"])


@pytest.mark.parametrize("fallback", [False, True], ids=["generic", "ocr-text"])
async def test_vision_general_result_review_and_export_permissions(
    api, line, mail, store, sm, ai_settings, llm, db, fallback
):
    # AC-FR-OCR-025-01/026-03, FR-VERIFY-010/011/012, FR-ENTRY-015, FR-REPORT-007.
    from app.repositories import report_query
    from app.services.report_config import CardSpec
    from tests.integration.review_helpers import review_org, set_level
    from tests.integration.tenancy_helpers import make_role

    org = await review_org(api, line, mail, db)
    await set_level(db, org.tenant_id, 2, code=None)
    client = org.clerk.client
    job = await vision_job(
        client,
        store,
        sm,
        ai_settings,
        llm,
        db,
        output="null" if fallback else GENERIC_JSON,
        headers=org.h,
    )
    body = await result(client, job["id"], org.h)
    edited = deepcopy(body["structured"])
    edited["note"] = "reviewed version"
    saved = await save(client, job["id"], body["version"], edited, headers=org.h)
    assert saved.status_code == 200, saved.text
    confirmed = await save(client, job["id"], saved.json()["version"], edited, True, org.h)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["review"]["stage"] == "PENDING_L1"
    assert confirmed.json()["review"]["required_level"] == 2
    for level, reviewer in ((1, org.r1), (2, org.r2)):
        assert (await client.post(f"{JOBS}/{job['id']}/exports", headers=org.h)).status_code == 409
        assert (
            await save(
                client, job["id"], saved.json()["version"], body["structured"], headers=org.h
            )
        ).status_code == 409
        detail = await reviewer.client.get(f"/api/v1/reviews/{job['id']}", headers=org.h)
        assert detail.status_code == 200, detail.text
        assert detail.json()["level"] == level
        readonly = await result(reviewer.client, job["id"], org.h)
        assert readonly["structured"] == edited and readonly["version"] == saved.json()["version"]
        approved = await reviewer.client.post(
            f"/api/v1/reviews/{job['id']}/decision",
            json={"level": level, "decision": "approve"},
            headers=org.h,
        )
        assert approved.status_code == 200, approved.text
    assert (await client.get(f"{JOBS}/{job['id']}", headers=org.h)).json()["stage"] == "CONFIRMED"
    export_id, workbook = await _download_workbook(client, job["id"], org.h)
    _assert_text_cells(workbook, ["reviewed version"])
    assert workbook["_saiflow"]["A1"].value == "generic"
    role = await make_role(db, org.tenant_id, "No export", ["upload_ocr", "verify_own"])
    await db.execute(
        text("update memberships set role_id=:r where tenant_id=:t and user_id=:u"),
        {"r": role, "t": org.tenant_id, "u": org.clerk.user_id},
    )
    await db.commit()
    assert (await client.post(f"{JOBS}/{job['id']}/exports", headers=org.h)).status_code == 403
    assert (
        await client.get(f"/api/v1/exports/{export_id}/download", headers=org.h)
    ).status_code == 403
    tax_id, tax_version = (
        await db.execute(
            text(
                "select t.id, v.id from document_templates t "
                "join document_template_versions v on v.template_id=t.id "
                "where t.code='tax_invoice'"
            )
        )
    ).one()
    spec = CardSpec(
        id="count",
        type="stat",
        title="Count",
        template_id=tax_id,
        version_ids=(tax_version,),
        grain="document",
        table=None,
        columns=(),
        agg="count",
        measure=None,
        dim_kind="none",
        dim=None,
        time_grain=None,
        series=None,
        date_field=None,
        unit_mode=None,
        unit_value=None,
        unit=None,
        precision=0,
    )
    async with sm() as fresh:
        diag, rows = await report_query.run(
            fresh,
            report_query.build(spec, tenant_id=org.tenant_id, scope_user_id=None, period=None),
        )
    assert diag["documents"] == 0 and rows == []  # generic/fallback never become template data
    assert tuple(await raw_result(db, job["id"])) == ("google_vision", VISION_RAW)
