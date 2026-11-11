"""Report access: the gate, manage/view/export rights, the caller's data scope, the platform
admin's synthetic preview and the access audit (FR-REPORT-001/003/004/005/011/016,
FR-SYS-139; template-report-management contract §5/§6)."""

from datetime import UTC, datetime
from json import dumps

from sqlalchemy import text

from app.services import report_service
from tests.integration.db_fixtures import login
from tests.integration.report_helpers import (
    ADMIN_R,
    TPL,
    YEAR,
    R,
    Who,
    cards,
    create_report,
    data,
    doc,
    formal,
    join,
    preview,
    publish,
    published,
    query,
    report_audits,
    report_org,
    subscribe,
    template_content,
)
from tests.integration.tenancy_helpers import (
    add_member,
    admin_client,
    client_like,
    make_org,
    make_role,
    tenant,
)
from tests.report_samples import page


def metric(org, cid="c_1", **kw):
    return org.card(cid, type="metric", **kw)


async def test_viewer_sees_published_reports_of_own_org(api, line, db):
    # AC-FR-REPORT-001-01
    org = await report_org(api, line, db)
    other = await report_org(api, line, db, sub="OTHER")
    viewer = await join(api, line, db, org, "VIEWER", ["report_view"])
    draft = await create_report(org.owner, org, page(metric(org)), name="Draft only")
    pub = await published(org.owner, org, page(metric(org)), name="Monthly")
    theirs = await published(other.owner, other, page(metric(other)), name="Theirs")

    r = await viewer.client.get(R, headers=org.h)
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [(i["id"], i["name"], i["can_manage"]) for i in items] == [(pub["id"], "Monthly", False)]
    d = (await viewer.client.get(f"{R}/{pub['id']}", headers=org.h)).json()
    assert d["draft"] is None and d["draft_errors"] == [] and d["published"]["version"] == 1
    assert d["can_manage"] is False and d["can_export"] is False
    assert (await viewer.client.get(f"{R}/{draft['id']}", headers=org.h)).status_code == 404
    # another organization's report is not found through this tenant
    assert (await viewer.client.get(f"{R}/{theirs['id']}", headers=org.h)).status_code == 404
    assert (await query(viewer, org, theirs["id"])).status_code == 404
    # the manager lists drafts too
    names = {i["name"] for i in (await org.owner.client.get(R, headers=org.h)).json()["items"]}
    assert names == {"Draft only", "Monthly"}


async def test_gate_and_rights_match_direct_requests(api, line, db):
    # AC-FR-REPORT-001-02
    org = await report_org(api, line, db)
    pub = await published(org.owner, org, page(metric(org)))
    nobody = await join(api, line, db, org, "PLAIN", ["upload_ocr", "data_browse", "export"])
    for path in (R, f"{R}/{pub['id']}"):
        r = await nobody.client.get(path, headers=org.h)
        assert (r.status_code, r.json()["code"]) == (403, "permission_denied"), path
    r = await query(nobody, org, pub["id"])
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    r = await nobody.client.get(f"{R}/{pub['id']}/csv", params={"card_id": "c_1"}, headers=org.h)
    assert r.status_code == 403
    # a personal tenant has no reports
    solo = client_like(api)
    await login(solo, line, "SOLO")
    r = await solo.get(R)
    assert (r.status_code, r.json()["code"]) == (403, "report_unavailable")
    # a guest neither
    guest = client_like(api)
    assert (await guest.post("/api/v1/auth/guest")).status_code in (200, 201)
    r = await guest.get(R)
    assert (r.status_code, r.json()["code"]) == (403, "report_unavailable")
    # an organization whose plan expired (or never had one) is refused, even for the owner
    lapsed_owner = client_like(api)
    me = await login(lapsed_owner, line, "LAPSED")
    lapsed, _ = await make_org(db, me["user_id"], name="Lapsed")
    await subscribe(db, lapsed, expired=True)
    r = await lapsed_owner.get(R, headers=tenant(lapsed))
    assert (r.status_code, r.json()["code"]) == (403, "report_unavailable")
    r = await lapsed_owner.post(f"{R}/{pub['id']}/data", json={}, headers=tenant(lapsed))
    assert (r.status_code, r.json()["code"]) == (403, "report_unavailable")
    # the same organization once its plan lapses
    await db.execute(
        text("update subscriptions set ends_at = now() - interval '1 hour' where tenant_id = :t"),
        {"t": org.tenant_id},
    )
    await db.commit()
    r = await query(org.owner, org, pub["id"])
    assert (r.status_code, r.json()["code"]) == (403, "report_unavailable")


async def test_manage_and_view_are_separate(api, line, db):
    # AC-FR-REPORT-005-02, FR-SYS-139
    org = await report_org(api, line, db)
    viewer = await join(api, line, db, org, "VIEW", ["report_view"])
    manager = await join(api, line, db, org, "MGR", ["report_manage"])
    await formal(db, org, viewer.user_id, doc(100))
    await formal(db, org, manager.user_id, doc(7))
    pub = await published(org.owner, org, page(metric(org)))
    # the viewer cannot manage
    r = await viewer.client.post(R, json={"name": "Mine"}, headers=org.h)
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    assert (await publish(viewer, org, pub)).status_code == 403
    assert (await preview(viewer, org, pub["id"], page(metric(org)))).status_code == 403
    r = await viewer.client.get("/api/v1/reports/catalog/templates", headers=org.h)
    assert r.status_code == 403
    # the manager previews the draft on their own data but does not view the published page
    r = await preview(manager, org, pub["id"], page(metric(org)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"] == "own" and body["synthetic"] is False and body["report_version"] is None
    assert cards(body)["c_1"]["rows"][0]["value"] == "7.00"
    r = await query(manager, org, pub["id"])
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    d = (await manager.client.get(f"{R}/{pub['id']}", headers=org.h)).json()
    assert d["can_manage"] is True and d["draft"] is not None and d["can_export"] is False
    r = await manager.client.get(f"{R}/{pub['id']}/csv", params={"card_id": "c_1"}, headers=org.h)
    assert r.status_code == 403
    # the viewer reads the published page on their own data
    got = await data(viewer, org, pub["id"])
    assert got["scope"] == "own" and got["report_version"] == 1
    assert cards(got)["c_1"]["rows"][0]["value"] == "100.00"


async def test_results_follow_the_callers_scope(api, line, db):
    # AC-FR-REPORT-003-01, 003-02, 011-04
    org = await report_org(api, line, db)
    other = await report_org(api, line, db, sub="OTHER")
    u = await join(api, line, db, org, "U", ["report_view", "report_manage", "export"])
    w = await join(api, line, db, org, "W", ["upload_ocr"])
    browser = await join(api, line, db, org, "BROWSE", ["report_view", "data_browse"])
    await formal(db, org, u.user_id, doc(10))
    await formal(db, org, u.user_id, doc(5, vendor="Beta"))
    await formal(db, org, w.user_id, doc(1000))
    await formal(db, org, org.owner.user_id, doc(200))
    await formal(db, other, other.owner.user_id, doc(9999))
    config = page(org.card("c_1", agg="sum"), period=YEAR)
    pub = await published(org.owner, org, config)

    everyone = await data(org.owner, org, pub["id"])
    assert everyone["scope"] == "all"
    assert {r["dimension"]: r["value"] for r in cards(everyone)["c_1"]["rows"]} == {
        "ACME": "1210.00",
        "Beta": "5.00",
    }
    assert cards(everyone)["c_1"]["diagnostics"]["documents"] == 4
    # the member sees only their own documents, freshly queried
    mine = await data(
        u, org, pub["id"], can_browse_all=True, scope="all", tenant_id=other.tenant_id
    )
    assert mine["scope"] == "own"
    c = cards(mine)["c_1"]
    assert {r["dimension"]: r["value"] for r in c["rows"]} == {"ACME": "10.00", "Beta": "5.00"}
    assert c["diagnostics"]["documents"] == 2
    r = await preview(u, org, pub["id"], config)
    assert r.json()["scope"] == "own"
    assert {x["value"] for x in cards(r.json())["c_1"]["rows"]} == {"10.00", "5.00"}
    csv = await u.client.get(f"{R}/{pub['id']}/csv", params={"card_id": "c_1"}, headers=org.h)
    assert csv.status_code == 200, csv.text
    body = csv.content.decode("utf-8-sig")
    assert "scope,own" in body and "1210.00" not in body and "9999" not in body
    # data_browse reads the whole organization
    assert (await data(browser, org, pub["id"]))["scope"] == "all"
    # the other organization's report is not reachable from this tenant
    theirs = await published(other.owner, other, page(other.card("c_1")))
    assert (await query(u, org, theirs["id"])).status_code == 404


async def test_forged_configuration_is_refused(api, line, db):
    # AC-FR-REPORT-011-04, AC-FR-REPORT-006-02 (unknown paths)
    org = await report_org(api, line, db)
    report = await create_report(org.owner, org, page(metric(org)))
    for path in ("header.total; drop table reports", "header.secret", "header'.total"):
        bad = page(metric(org, measure=path))
        r = await org.owner.client.put(
            f"{R}/{report['id']}",
            json={"revision": report["revision"], "name": "Ops", "config": bad},
            headers=org.h,
        )
        assert r.status_code == 200, r.text  # an incomplete draft is kept ...
        report = r.json()
        assert any(e["path"].endswith("measure.path") for e in report["draft_errors"]), path
        r = await publish(org.owner, org, report)  # ... and never published
        assert (r.status_code, r.json()["code"]) == (422, "report_invalid")
        prev = await preview(org.owner, org, report["id"], bad)
        assert prev.status_code == 200
        assert cards(prev.json())["c_1"]["error_code"] == "invalid_config"
    r = await org.owner.client.put(
        f"{R}/{report['id']}",
        json={"revision": report["revision"], "name": "Ops", "config": "select 1"},
        headers=org.h,
    )
    assert (r.status_code, r.json()["code"]) == (422, "report_invalid")
    # a version of another organization's template is not available here
    other = await report_org(api, line, db, sub="OTHER")
    stolen = page(metric(org, template_id=other.template_id, version_ids=[other.version_id]))
    prev = await preview(org.owner, org, report["id"], stolen)
    assert (prev.status_code, prev.json()["code"]) == (422, "report_invalid")
    assert "cards" not in prev.json()  # denied bindings never reach a statistics query


async def test_admin_configures_with_synthetic_preview_only(api, line, db, monkeypatch):
    # AC-FR-REPORT-003-03, FR-SYS-142/143
    org = await report_org(api, line, db)
    await formal(db, org, org.owner.user_id, doc(4321.5, vendor="RealVendor"))
    admin = await admin_client(api, db)
    r = await admin.post(ADMIN_R, json={"tenant_id": org.tenant_id, "name": "Set up by ops"})
    assert r.status_code == 201, r.text
    rep = r.json()
    cats = await admin.get(f"{ADMIN_R}/catalog/templates", params={"tenant_id": org.tenant_id})
    assert any(t["template_id"] == org.template_id for t in cats.json()["items"])
    config = page(org.card("c_1"), period=YEAR)
    r = await admin.put(
        f"{ADMIN_R}/{rep['id']}",
        json={"revision": rep["revision"], "name": "Set up by ops", "config": config},
    )
    assert r.status_code == 200, r.text
    rep = r.json()
    # A timestamp may legitimately contain the same digits as a customer's amount.
    preview_at = datetime(2026, 11, 11, 6, 30, 0, 432100, tzinfo=UTC)
    with monkeypatch.context() as clock:
        clock.setattr(report_service, "utcnow", lambda: preview_at)
        r = await admin.post(f"{ADMIN_R}/{rep['id']}/preview", json={"config": config})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["synthetic"] is True and body["scope"] == "synthetic"
    assert body["generated_at"] == "2026-11-11T06:30:00.432100Z"
    # Scan every non-clock response field, not a substring of the real timestamp.
    text_ = dumps({key: value for key, value in body.items() if key != "generated_at"})
    assert "RealVendor" not in text_ and "4321" not in text_
    assert cards(body)["c_1"]["rows"]  # made-up rows
    # there is no data or CSV route for the admin, and the user routes need a member
    assert (await admin.post(f"{ADMIN_R}/{rep['id']}/data", json={})).status_code in (404, 405)
    assert (
        await admin.get(f"{ADMIN_R}/{rep['id']}/csv", params={"card_id": "c_1"})
    ).status_code in (404, 405)
    r = await admin.post(f"{R}/{rep['id']}/data", json={}, headers=org.h)
    assert r.status_code == 401
    # the admin publishes; members then read real data
    r = await admin.post(f"{ADMIN_R}/{rep['id']}/publish", json={"revision": rep["revision"]})
    assert r.status_code == 200, r.text
    assert r.json()["published"]["published_by_admin_id"] is not None
    got = await data(org.owner, org, rep["id"])
    assert cards(got)["c_1"]["rows"][0]["dimension"] == "RealVendor"
    # a personal tenant is not a valid admin target
    solo = client_like(api)
    me = await login(solo, line, "SOLO")
    personal = (
        await db.execute(
            text("select id from tenants where kind = 'personal' and owner_user_id = :u"),
            {"u": me["user_id"]},
        )
    ).scalar_one()
    r = await admin.post(ADMIN_R, json={"tenant_id": personal, "name": "x"})
    assert r.status_code == 404
    audits = await report_audits(db)
    admin_rows = [a for a in audits if a[1] == "admin"]
    assert {a[0] for a in admin_rows} >= {"report.create", "report.save", "report.preview"}
    assert any(a[0] == "report.preview" and "scope=synthetic" in a[2] for a in admin_rows)


async def test_access_is_audited_without_values(api, line, db):
    # AC-FR-REPORT-004-01, 004-02
    org = await report_org(api, line, db)
    viewer = await join(api, line, db, org, "VIEW", ["report_view"])
    await formal(db, org, viewer.user_id, doc(123.45, vendor="SecretVendor"))
    pub = await published(org.owner, org, page(metric(org), period=YEAR))
    await data(viewer, org, pub["id"])
    await data(viewer, org, pub["id"], refresh=True)
    plain = await join(api, line, db, org, "PLAIN", ["upload_ocr"])
    await query(plain, org, pub["id"])
    audits = await report_audits(db)
    actions = [(a[0], a[3]) for a in audits]
    assert ("report.create", "success") in actions and ("report.publish", "success") in actions
    view = [a for a in audits if a[0] == "report.view" and a[3] == "success"]
    assert len(view) == 1
    t = org.tenant_id
    assert view[0][1] == "user"
    assert view[0][2] == f"{t}/{pub['id']}/v1/2026-01-01..2026-12-31/scope=own"
    assert any(a[0] == "report.refresh" and a[3] == "success" for a in audits)
    assert any(
        a[0] == "report.view" and a[3] == "failure" and a[2].endswith("permission_denied")
        for a in audits
    )
    actor_ids = {
        r[0]
        for r in await db.execute(
            text("select actor_id from audit_log where action = 'report.view'")
        )
    }
    assert str(viewer.user_id) in actor_ids
    joined = " ".join(a[2] for a in audits)
    assert "SecretVendor" not in joined and "123.45" not in joined and "select" not in joined


async def test_delegated_manage_and_immediate_revocation(api, line, db):
    # AC-FR-SYS-139-01, AC-FR-SYS-139-02
    org = await report_org(api, line, db)
    c = client_like(api)
    me = await login(c, line, "DELEGATE")
    role_id = await make_role(db, org.tenant_id, "Report designer", ["report_manage"])
    await add_member(db, org.tenant_id, me["user_id"], role_id)
    m = Who(c, me["user_id"])
    await formal(db, org, m.user_id, doc(7))
    await formal(db, org, org.owner.user_id, doc(500))
    # M designs, previews (own data only) and publishes
    report = await create_report(m, org, page(metric(org), period=YEAR), name="By M")
    prev = await preview(m, org, report["id"], page(metric(org), period=YEAR))
    assert prev.status_code == 200 and prev.json()["scope"] == "own"
    assert cards(prev.json())["c_1"]["rows"][0]["value"] == "7.00"
    r = await publish(m, org, report)
    assert r.status_code == 200, r.text
    report = r.json()
    # ... but has none of the other rights
    assert (await query(m, org, report["id"])).status_code == 403
    csv = await m.client.get(f"{R}/{report['id']}/csv", params={"card_id": "c_1"}, headers=org.h)
    assert csv.status_code == 403
    r = await m.client.post(TPL, json={"content": template_content(code="m_tpl")}, headers=org.h)
    assert r.status_code == 403
    # the owner revokes report_manage while M still has the designer open
    r = await org.owner.client.patch(
        f"/api/v1/organizations/{org.tenant_id}/roles/{role_id}",
        json={"name": "Report designer", "permissions": ["upload_ocr"]},
        headers=org.h,
    )
    assert r.status_code == 200, r.text
    edited = page(metric(org, cid="c_2"), period=YEAR)
    r = await m.client.put(
        f"{R}/{report['id']}",
        json={"revision": report["revision"], "name": "Changed", "config": edited},
        headers=org.h,
    )
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    r = await publish(m, org, report)
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    # neither the draft nor the published page changed
    d = (await org.owner.client.get(f"{R}/{report['id']}", headers=org.h)).json()
    assert d["revision"] == report["revision"] and d["name"] == "By M"
    assert d["published"]["version"] == 1
    assert [x["id"] for x in d["draft"]["cards"]] == ["c_1"]
