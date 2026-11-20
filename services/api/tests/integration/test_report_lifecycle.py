"""Report lifecycle: drafts, immutable publishing, unpublish/delete, revisions, page
capacity and explicit template versions (FR-REPORT-005/006/014/017; template-report-
management contract §5)."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.integration.report_helpers import (
    TPL,
    YEAR,
    R,
    cards,
    create_report,
    data,
    doc,
    formal,
    join,
    new_template,
    new_version,
    preview,
    publish,
    published,
    query,
    report_audits,
    report_org,
    template_content,
)
from tests.integration.tenancy_helpers import admin_client
from tests.report_samples import groups_v2, page


async def save(who, org, report, config, name="Ops", revision=None):
    return await who.client.put(
        f"{R}/{report['id']}",
        json={
            "revision": report["revision"] if revision is None else revision,
            "name": name,
            "config": config,
        },
        headers=org.h,
    )


async def test_incomplete_draft_keeps_the_published_page(api, line, db):
    # AC-FR-REPORT-014-01
    org = await report_org(api, line, db)
    viewer = await join(api, line, db, org, "VIEW", ["report_view"])
    await formal(db, org, viewer.user_id, doc(50))
    p1 = await published(org.owner, org, page(org.card("c_1"), period=YEAR))
    assert p1["status"] == "published" and p1["published"]["version"] == 1
    broken = org.card("c_2", type="bar", measure=None)
    r = await save(org.owner, org, p1, page(org.card("c_1"), broken, period=YEAR))
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["status"] == "changed"
    assert [e["card_id"] for e in draft["draft_errors"]] == ["c_2"]
    assert draft["draft_errors"][0]["path"] == "cards[1].data.measure.path"
    # reopened, the draft is as saved
    again = (await org.owner.client.get(f"{R}/{p1['id']}", headers=org.h)).json()
    assert [c["id"] for c in again["draft"]["cards"]] == ["c_1", "c_2"]
    r = await publish(org.owner, org, draft)
    assert (r.status_code, r.json()["code"]) == (422, "report_invalid")
    assert {e["card_id"] for e in r.json()["details"]["errors"]} == {"c_2"}
    # members still read P1
    got = await data(viewer, org, p1["id"])
    assert got["report_version"] == 1 and [c["card_id"] for c in got["cards"]] == ["c_1"]
    cur = (await org.owner.client.get(f"{R}/{p1['id']}", headers=org.h)).json()
    assert cur["revision"] == draft["revision"] and cur["published"]["version"] == 1
    assert any(a[0] == "report.publish" and a[3] == "failure" for a in await report_audits(db))


async def test_publish_is_immutable_then_unpublish_and_delete(api, line, db):
    # AC-FR-REPORT-014-02
    org = await report_org(api, line, db)
    viewer = await join(api, line, db, org, "VIEW", ["report_view", "export"])
    job = await formal(db, org, viewer.user_id, doc(50))
    first = page(org.card("c_1", title="Spend"), period=YEAR)
    p1 = await published(org.owner, org, first)
    second = page(org.card("c_1", title="Spend v2"), period=YEAR)
    r = await save(org.owner, org, p1, second)
    r = await publish(org.owner, org, r.json())
    assert r.status_code == 200, r.text
    p2 = r.json()
    assert p2["published"]["version"] == 2 and p2["status"] == "published"
    # editing the draft does not change P2
    r = await save(org.owner, org, p2, page(org.card("c_1", title="Edited"), period=YEAR))
    edited = r.json()
    assert edited["status"] == "changed"
    seen = (await viewer.client.get(f"{R}/{p1['id']}", headers=org.h)).json()
    assert seen["published"]["config"]["cards"][0]["title"] == "Spend v2"
    assert (await data(viewer, org, p1["id"]))["report_version"] == 2
    # published snapshots cannot be rewritten, even directly
    with pytest.raises(DBAPIError):
        await db.execute(text("update report_snapshots set name = 'forged'"))
    await db.rollback()
    # unpublish: the published page is gone for members, the draft stays for managers
    r = await org.owner.client.post(
        f"{R}/{p1['id']}/unpublish", json={"revision": edited["revision"]}, headers=org.h
    )
    assert r.status_code == 200, r.text
    unpub = r.json()
    assert unpub["status"] == "draft" and unpub["published"] is None
    assert (await viewer.client.get(R, headers=org.h)).json()["items"] == []
    assert (await viewer.client.get(f"{R}/{p1['id']}", headers=org.h)).status_code == 404
    assert (await query(viewer, org, p1["id"])).status_code == 404
    csv = await viewer.client.get(f"{R}/{p1['id']}/csv", params={"card_id": "c_1"}, headers=org.h)
    assert csv.status_code == 404
    r = await org.owner.client.post(
        f"{R}/{p1['id']}/unpublish", json={"revision": unpub["revision"]}, headers=org.h
    )
    assert (r.status_code, r.json()["code"]) == (409, "report_not_published")
    # delete: gone from list and detail; history, audits and documents stay
    r = await org.owner.client.delete(
        f"{R}/{p1['id']}", params={"revision": unpub["revision"]}, headers=org.h
    )
    assert r.status_code == 204, r.text
    assert (await org.owner.client.get(f"{R}/{p1['id']}", headers=org.h)).status_code == 404
    assert (await org.owner.client.get(R, headers=org.h)).json()["items"] == []
    snaps = (
        await db.execute(
            text("select count(*) from report_snapshots where report_id = :r"), {"r": p1["id"]}
        )
    ).scalar_one()
    assert snaps == 2
    jobs = (
        await db.execute(text("select count(*) from ocr_jobs where id = :j"), {"j": job.id})
    ).scalar_one()
    assert jobs == 1
    actions = [a[0] for a in await report_audits(db) if a[3] == "success"]
    for action in ("report.create", "report.save", "report.publish", "report.unpublish"):
        assert action in actions
    assert actions[-1] == "report.delete"


async def test_stale_revisions_conflict(api, line, db):
    # AC-FR-REPORT-014-03 (server side)
    org = await report_org(api, line, db)
    b = await join(api, line, db, org, "B", ["report_manage"])
    base = await published(org.owner, org, page(org.card("c_1"), period=YEAR))
    stale = base["revision"]
    r = await save(org.owner, org, base, page(org.card("c_1", title="A wins"), period=YEAR))
    assert r.status_code == 200
    current = r.json()["revision"]
    attempts = [
        await save(b, org, base, page(org.card("c_1", title="B"), period=YEAR), revision=stale),
        await b.client.post(f"{R}/{base['id']}/publish", json={"revision": stale}, headers=org.h),
        await b.client.post(f"{R}/{base['id']}/unpublish", json={"revision": stale}, headers=org.h),
        await b.client.delete(f"{R}/{base['id']}", params={"revision": stale}, headers=org.h),
    ]
    for r in attempts:
        assert (r.status_code, r.json()["code"]) == (409, "revision_conflict"), r.text
        assert r.json()["details"] == {"revision": current}
    after = (await org.owner.client.get(f"{R}/{base['id']}", headers=org.h)).json()
    assert after["draft"]["cards"][0]["title"] == "A wins" and after["revision"] == current
    assert after["published"]["version"] == 1
    r = await save(b, org, base, page(org.card("c_1"), period=YEAR), revision="1")
    assert (r.status_code, r.json()["code"]) == (422, "validation_error")


async def test_page_capacity_30_cards(api, line, db):
    # AC-FR-REPORT-017-02 (cards)
    org = await report_org(api, line, db)
    await formal(db, org, org.owner.user_id, doc(1))
    thirty = page(*[org.card(f"c_{i}", type="metric") for i in range(30)], period=YEAR)
    report = await create_report(org.owner, org, thirty)
    assert report["draft_errors"] == []
    r = await publish(org.owner, org, report)
    assert r.status_code == 200, r.text
    got = await data(org.owner, org, report["id"])
    assert len(got["cards"]) == 30 and all(c["status"] == "not_applicable" for c in got["cards"])
    one_more = page(*[org.card(f"c_{i}", type="metric") for i in range(31)], period=YEAR)
    r = await save(org.owner, org, r.json(), one_more)
    assert (r.status_code, r.json()["code"]) == (422, "report_invalid")
    assert r.json()["details"]["errors"][0]["path"] == "cards"
    r = await preview(org.owner, org, report["id"], one_more)
    assert (r.status_code, r.json()["code"]) == (422, "report_invalid")


async def test_explicit_versions_and_confirmed_paths(api, line, db):
    # AC-FR-REPORT-006-01
    org = await report_org(api, line, db)
    v1 = org.version_id
    v2 = await new_version(org.owner.client, org.tenant_id, org.template_id, groups_v2())
    other = await new_template(org.owner.client, org.tenant_id, code="rpt_b")
    vb = other["current_version"]["id"]
    await formal(db, org, org.owner.user_id, doc(10), version_id=v1)
    await formal(db, org, org.owner.user_id, doc(20), version_id=v2)
    await formal(db, org, org.owner.user_id, doc(5), version_id=vb, template_id=other["id"])
    a = org.card("a", type="metric", version_ids=[v1, v2])
    b = org.card("b", type="metric", template_id=other["id"], version_ids=[vb])
    report = await create_report(org.owner, org, page(a, b, period=YEAR))
    errs = report["draft_errors"]
    assert errs and all(e["card_id"] == "a" and "confirmed_paths" in e["path"] for e in errs)
    a["data"]["confirmed_paths"] = ["header.total"]
    r = await save(org.owner, org, report, page(a, b, period=YEAR))
    assert r.json()["draft_errors"] == []
    r = await publish(org.owner, org, r.json())
    assert r.status_code == 200, r.text
    # a third version becomes active: it is not counted automatically
    v3 = await new_version(
        org.owner.client, org.tenant_id, org.template_id, groups_v2(extra="memo")
    )
    await formal(db, org, org.owner.user_id, doc(1000), version_id=v3)
    got = cards(await data(org.owner, org, report["id"]))
    assert got["a"]["rows"][0]["value"] == "30.00"
    assert got["b"]["rows"][0]["value"] == "5.00"
    # AC-FR-REPORT-002-01: a viewer (no catalog access) reads the templates and the versions
    # the page names, not v3
    viewer = await join(api, line, db, org, "SRCV", ["report_view"])
    seen = (await viewer.client.get(f"{R}/{report['id']}", headers=org.h)).json()
    assert seen["draft"] is None
    src = {s["template_id"]: s for s in seen["sources"]}
    assert set(src) == {org.template_id, other["id"]}
    assert [v["id"] for v in src[org.template_id]["versions"]] == [v1, v2]
    assert [v["version"] for v in src[org.template_id]["versions"]] == [1, 2]
    assert src[other["id"]]["name"] and [v["id"] for v in src[other["id"]]["versions"]] == [vb]
    # a card spans one template only
    mixed = org.card("m", type="metric", version_ids=[v1, vb], confirmed=["header.total"])
    r = await save(org.owner, org, r.json(), page(mixed, period=YEAR))
    assert any(
        e["path"] == "cards[0].data.template_version_ids[1]" for e in r.json()["draft_errors"]
    )


async def test_incompatible_versions_are_refused(api, line, db):
    # AC-FR-REPORT-006-02
    org = await report_org(api, line, db)
    v1 = org.version_id
    retyped = await new_version(
        org.owner.client, org.tenant_id, org.template_id, groups_v2(total_type="string")
    )
    moved = await new_version(
        org.owner.client, org.tenant_id, org.template_id, groups_v2(move_total=True)
    )
    for vid in (retyped, moved):
        c = org.card("t", type="metric", version_ids=[v1, vid], confirmed=["header.total"])
        report = await create_report(org.owner, org, page(c, period=YEAR))
        assert any(
            e["card_id"] == "t" and e["path"].startswith("cards[0].data.measure")
            for e in report["draft_errors"]
        ), report["draft_errors"]
        r = await publish(org.owner, org, report)
        assert (r.status_code, r.json()["code"]) == (422, "report_invalid")
    # a field that is not in the template at all
    c = org.card("t", type="metric", measure="totals.total")
    report = await create_report(org.owner, org, page(c, period=YEAR))
    assert report["draft_errors"][0]["path"] == "cards[0].data.measure.path"


async def test_bound_versions_outlive_disabling_but_no_new_bindings(api, line, db):
    # AC-FR-REPORT-006-03
    org = await report_org(api, line, db)
    v1 = org.version_id
    v2 = await new_version(org.owner.client, org.tenant_id, org.template_id, groups_v2())
    await formal(db, org, org.owner.user_id, doc(10), version_id=v1)
    bound = org.card("c_1", type="metric", version_ids=[v1])
    report = await published(org.owner, org, page(bound, period=YEAR))
    tpl = (await org.owner.client.get(f"{TPL}/{org.template_id}", headers=org.h)).json()
    r = await org.owner.client.post(
        f"{TPL}/{org.template_id}/status",
        json={"revision": tpl["revision"], "status": "DISABLED"},
        headers=org.h,
    )
    assert r.status_code == 200, r.text
    # the published card keeps counting
    got = cards(await data(org.owner, org, report["id"]))
    assert got["c_1"]["status"] == "not_applicable" and got["c_1"]["rows"][0]["value"] == "10.00"
    # still editable with what it binds ...
    r = await save(org.owner, org, report, page(bound, period=YEAR), name="Renamed")
    assert r.json()["draft_errors"] == []
    r = await publish(org.owner, org, r.json())
    assert r.status_code == 200, r.text
    # Historical access belongs to the existing card, not to every new card in the report.
    for renamed in (True, False):
        copy_card = org.card("new_card", type="metric", version_ids=[v1])
        config = page(copy_card, period=YEAR) if renamed else page(bound, copy_card, period=YEAR)
        attempt = await preview(org.owner, org, report["id"], config)
        assert attempt.status_code == 422, attempt.text
        attempt = await save(org.owner, org, r.json(), config)
        assert attempt.status_code == 200 and attempt.json()["draft_errors"]
        assert (await publish(org.owner, org, attempt.json())).status_code == 422
        # Another save / preview cannot turn an invalid new card into a historic binding.
        again = await save(org.owner, org, attempt.json(), config)
        assert again.json()["draft_errors"]
        assert (await preview(org.owner, org, report["id"], config)).status_code == 422
        r = await save(org.owner, org, again.json(), page(bound, period=YEAR))
        assert r.json()["draft_errors"] == []
    # ... but a version it does not bind yet is refused
    wider = org.card("c_1", type="metric", version_ids=[v1, v2], confirmed=["header.total"])
    r = await save(org.owner, org, r.json(), page(wider, period=YEAR))
    assert r.status_code == 200
    assert any("template_version_ids[1]" in e["path"] for e in r.json()["draft_errors"])
    assert (await publish(org.owner, org, r.json())).status_code == 422
    # and a new report cannot bind the disabled template
    fresh = await create_report(org.owner, org, page(bound, period=YEAR), name="New")
    assert fresh["draft_errors"]
    assert (await publish(org.owner, org, fresh)).status_code == 422
    cat = await org.owner.client.get(
        "/api/v1/reports/catalog/templates", params={"report_id": report["id"]}, headers=org.h
    )
    item = next(t for t in cat.json()["items"] if t["template_id"] == org.template_id)
    assert item["usable"] is False and [v["id"] for v in item["versions"]] == [v1]
    cat = await org.owner.client.get("/api/v1/reports/catalog/templates", headers=org.h)
    assert all(t["template_id"] != org.template_id for t in cat.json()["items"])


@pytest.mark.parametrize("was_published", [False, True])
async def test_system_grant_revocation_preserves_only_the_bound_card(api, line, db, was_published):
    # AC-FR-REPORT-006-03: a draft reference also protects its exact historic binding.
    org = await report_org(api, line, db)
    admin = await admin_client(api, db)
    base = "/api/v1/admin/templates"
    r = await admin.post(
        base, json={"scope": "system", "content": template_content(code="sys_report")}
    )
    assert r.status_code == 201, r.text
    tpl = r.json()
    r = await admin.post(f"{base}/{tpl['id']}/activate", json={"revision": tpl["revision"]})
    assert r.status_code == 200, r.text
    tpl = r.json()["template"]
    vid = tpl["current_version"]["id"]
    r = await admin.put(
        f"{base}/{tpl['id']}/grants",
        json={"revision": tpl["revision"], "mode": "PLANS", "plans": ["starter"]},
    )
    assert r.status_code == 200, r.text
    tpl = r.json()
    bound = org.card("historic", type="metric", template_id=tpl["id"], version_ids=[vid])
    config = page(bound, period=YEAR)
    report = await create_report(org.owner, org, config)
    assert report["draft_errors"] == []
    if was_published:
        r = await publish(org.owner, org, report)
        assert r.status_code == 200, r.text
        report = r.json()
    await formal(db, org, org.owner.user_id, doc(25), template_id=tpl["id"], version_id=vid)
    r = await admin.put(
        f"{base}/{tpl['id']}/grants",
        json={"revision": tpl["revision"], "mode": "PLANS", "plans": ["advance"]},
    )
    assert r.status_code == 200, r.text
    r = await preview(org.owner, org, report["id"], config)
    assert r.status_code == 200 and r.json()["cards"][0]["rows"][0]["value"] == "25.00"
    r = await save(org.owner, org, report, config, name="Historic renamed")
    assert r.status_code == 200 and r.json()["draft_errors"] == []
    r = await publish(org.owner, org, r.json())
    assert r.status_code == 200, r.text
    assert (
        cards(await data(org.owner, org, report["id"]))["historic"]["rows"][0]["value"] == "25.00"
    )
    # Reading the old definition is not a reusable grant, even within the same report.
    copied = {**bound, "id": "copied"}
    config = page(bound, copied, period=YEAR)
    for _ in range(2):
        denied = await preview(org.owner, org, report["id"], config)
        assert denied.status_code == 422 and "cards" not in denied.json()
        r = await save(org.owner, org, r.json(), config)
        assert r.status_code == 200 and r.json()["draft_errors"]
        assert (await publish(org.owner, org, r.json())).status_code == 422
    fresh = await create_report(org.owner, org, page(bound, period=YEAR), name="Copy")
    assert fresh["draft_errors"] and (await publish(org.owner, org, fresh)).status_code == 422
