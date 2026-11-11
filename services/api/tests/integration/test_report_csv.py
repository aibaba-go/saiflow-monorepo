"""CSV export of a published card: the same scope, period, versions and diagnostics as the
view, formula-safe text cells, and an explicit failure instead of an incomplete file
(FR-REPORT-016/017; template-report-management contract §7)."""

import csv
import io
from datetime import timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.clock import utcnow
from app.services import report_csv_service
from tests.integration.report_helpers import (
    YEAR,
    R,
    cards,
    data,
    doc,
    formal,
    join,
    published,
    report_audits,
    report_org,
)
from tests.integration.tenancy_helpers import client_like
from tests.report_samples import page

VENDOR = {"kind": "category", "path": "header.vendor", "time_grain": None}
MONTH = {"kind": "date", "path": "header.doc_date", "time_grain": "month"}


async def export(who, org, report_id, card_id="c_1", **period):
    return await who.client.get(
        f"{R}/{report_id}/csv", params={"card_id": card_id, **period}, headers=org.h
    )


def parse(body: bytes) -> tuple[dict, list[list[str]]]:
    """(metadata, rows under the header) of an exported file."""
    text = body.decode("utf-8")
    assert text.startswith("\ufeff")
    lines = list(csv.reader(io.StringIO(text[1:])))
    blank = lines.index([])
    meta = {k: v for k, v in lines[:blank]}
    assert lines[blank + 1] == ["dimension", "series", "unit", "value", "count", "valid_count"]
    return meta, lines[blank + 2 :]


async def test_same_scope_period_and_versions_as_the_view(api, line, db):
    # AC-FR-REPORT-016-01
    org = await report_org(api, line, db)
    u = await join(api, line, db, org, "U", ["report_view", "export"])
    viewer = await join(api, line, db, org, "V", ["report_view"])
    await formal(db, org, u.user_id, doc(10, "ACME", "2026-03-01"))
    await formal(db, org, u.user_id, doc(7, "ACME", "2026-05-01"))
    await formal(db, org, u.user_id, doc("bad", "ACME", "2026-03-02"))
    await formal(db, org, org.owner.user_id, doc(500, "ACME", "2026-03-03"))
    c = org.card("c_1", dimension=MONTH, title="Monthly")
    report = await published(org.owner, org, page(c, period=YEAR), name="Ops")
    period = {"from": "2026-03-01", "to": "2026-03-31"}
    shown = cards(await data(u, org, report["id"], period))["c_1"]
    r = await export(u, org, report["id"], **period)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["cache-control"] == "private, no-store"
    assert f"report-{report['id']}-c_1.csv" in r.headers["content-disposition"]
    meta, rows = parse(r.content)
    assert (
        meta["report"] == "Ops" and meta["card"] == "Monthly" and meta["published_version"] == "1"
    )
    assert (meta["period_from"], meta["period_to"], meta["period_applied"]) == (
        "2026-03-01",
        "2026-03-31",
        "true",
    )
    assert meta["scope"] == "own" and meta["unit"] == "THB"
    assert meta["template_version_ids"] == str(org.version_id)
    assert meta["grain"] == "document" and meta["aggregation"] == "sum"
    assert meta["documents"] == "2" and meta["excluded_invalid_number"] == "1"
    assert rows == [["2026-03", "", "THB", "10.00", "2", "1"]]
    assert [[x["dimension"], x["value"]] for x in shown["rows"]] == [["2026-03", "10.00"]]
    assert "500" not in r.content.decode("utf-8")
    # without the export permission the file is refused
    r = await export(viewer, org, report["id"])
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    r = await export(u, org, report["id"], **{"from": "2026-04-01", "to": "2026-03-01"})
    assert (r.status_code, r.json()["code"]) == (422, "report_period_invalid")
    assert (await export(u, org, report["id"], card_id="nope")).status_code == 404
    audits = [a for a in await report_audits(db) if a[0] == "report.csv"]
    assert audits[0][3] == "success" and audits[0][2].endswith("/scope=own/card=c_1")


async def test_formula_cells_are_escaped_and_failures_are_explicit(api, line, db):
    # AC-FR-REPORT-016-02, AC-FR-REPORT-017-01 (CSV)
    org = await report_org(api, line, db)
    u = org.owner.user_id
    for vendor, total in (("=SUM(A1)", 1), ("+cmd", 2), ("-x", 3), ("@me", 4), ("Plain", "-5")):
        await formal(db, org, u, doc(total, vendor))
    by_desc = {"kind": "category", "path": "lines.items.desc", "time_grain": None}
    many = [{"desc": f"d{i:04d}", "amount": "1"} for i in range(1001)]
    await formal(db, org, u, doc(0, "Wide", items=many))
    vendors = org.card("c_1", dimension=VENDOR)
    wide = org.card(
        "wide",
        measure="lines.items.amount",
        dimension=by_desc,
        grain="table",
        table_key="lines.items",
    )
    report = await published(org.owner, org, page(vendors, wide, period=YEAR))
    r = await export(org.owner, org, report["id"])
    assert r.status_code == 200, r.text
    _, rows = parse(r.content)
    assert [(x[0], x[3]) for x in rows] == [
        ("'+cmd", "2.00"),
        ("'-x", "3.00"),
        ("'=SUM(A1)", "1.00"),
        ("'@me", "4.00"),
        ("Plain", "-5.00"),
        ("Wide", "0.00"),
    ]
    r = await export(org.owner, org, report["id"], card_id="wide")
    assert (r.status_code, r.json()["code"]) == (409, "report_export_failed")
    assert r.json()["details"] == {"card_id": "wide", "error_code": "group_limit"}
    assert "text/csv" not in r.headers["content-type"]
    action, _, target, result = (await report_audits(db))[-1]
    assert (action, result) == ("report.csv", "failure") and target.endswith("group_limit")


@pytest.fixture
def ticket_secret(api):
    api.app.state.settings = api.app.state.settings.model_copy(
        update={"download_ticket_secret": SecretStr("t" * 32)}
    )


async def csv_ticket(who, org, report_id, card_id="c_1", period=None):
    return await who.client.post(
        f"{R}/{report_id}/csv/ticket",
        json={"card_id": card_id, "period": period},
        headers=org.h,
    )


async def test_line_ticket_gives_the_same_file_for_60_seconds(
    api, line, db, ticket_secret, monkeypatch
):
    # AC-FR-REPORT-016-01 in the LINE in-app browser: the system browser has no session
    org = await report_org(api, line, db)
    u = await join(api, line, db, org, "U", ["report_view", "export"])
    await formal(db, org, u.user_id, doc(10, "ACME", "2026-03-01"))
    await formal(db, org, org.owner.user_id, doc(500, "ACME", "2026-03-03"))
    c = org.card("c_1", dimension=MONTH, title="Monthly")
    report = await published(org.owner, org, page(c, period=YEAR), name="Ops")
    period = {"from": "2026-03-01", "to": "2026-03-31"}
    direct = await export(u, org, report["id"], **period)
    r = await csv_ticket(u, org, report["id"], period=period)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("/api/v1/report-downloads/")
    bare = client_like(api)  # no cookie, no tenant header
    got = await bare.get(url)
    assert got.status_code == 200, got.text
    assert got.headers["cache-control"] == "private, no-store"
    assert f"report-{report['id']}-c_1.csv" in got.headers["content-disposition"]
    meta, rows = parse(got.content)
    assert parse(direct.content)[1] == rows == [["2026-03", "", "THB", "10.00", "1", "1"]]
    assert (meta["period_from"], meta["period_to"], meta["scope"]) == (
        "2026-03-01",
        "2026-03-31",
        "own",
    )
    assert "500" not in got.content.decode("utf-8")
    later = utcnow() + timedelta(seconds=61)
    monkeypatch.setattr(report_csv_service, "utcnow", lambda: later)
    assert (await bare.get(url)).status_code == 404
    audits = await report_audits(db)
    assert [a[3] for a in audits if a[0] == "report.csv"] == ["success", "success"]


async def test_ticket_needs_export_and_dies_with_rights_or_session(
    api, line, db, ticket_secret, store
):
    org = await report_org(api, line, db)
    u = await join(api, line, db, org, "U", ["report_view", "export"])
    viewer = await join(api, line, db, org, "V", ["report_view"])
    c = org.card("c_1", dimension=MONTH)
    report = await published(org.owner, org, page(c, period=YEAR))
    r = await csv_ticket(viewer, org, report["id"])
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    assert (await csv_ticket(u, org, report["id"], card_id="c_404")).status_code == 404
    r = await csv_ticket(u, org, report["id"], period={"from": "2026-04-01", "to": None})
    assert (r.status_code, r.json()["code"]) == (422, "report_period_invalid")
    url = (await csv_ticket(u, org, report["id"])).json()["url"]
    bare = client_like(api)
    tampered = url[:-2] + ("AA" if not url.endswith("AA") else "BB")
    assert (await bare.get(tampered)).status_code == 404
    # a result-export ticket path does not accept a report ticket
    token = url.rsplit("/", 1)[1]
    assert (await bare.get(f"/api/v1/export-downloads/{token}")).status_code == 404
    # the right is checked again when the ticket is used
    await db.execute(
        text("update roles set permissions = :p where tenant_id = :t and name = 'Role U'"),
        {"p": ["report_view"], "t": org.tenant_id},
    )
    await db.commit()
    r = await bare.get(url)
    assert (r.status_code, r.json()["code"]) == (404, "not_found")
    # Subscription expiry is also opaque to a downloader without a session.
    expiring = (await csv_ticket(org.owner, org, report["id"])).json()["url"]
    await db.execute(
        text("update subscriptions set ends_at = now() - interval '1 day' where tenant_id = :t"),
        {"t": org.tenant_id},
    )
    await db.commit()
    assert (await bare.get(expiring)).status_code == 404
    await db.execute(
        text("update subscriptions set ends_at = now() + interval '1 year' where tenant_id = :t"),
        {"t": org.tenant_id},
    )
    await db.commit()
    # and the session: logging out ends a fresh ticket too
    w = await join(api, line, db, org, "W", ["report_view", "export"])
    url = (await csv_ticket(w, org, report["id"])).json()["url"]
    await w.client.post("/api/v1/auth/logout")
    assert (await bare.get(url)).status_code == 404


async def test_ticket_needs_the_secret(api, line, db):
    org = await report_org(api, line, db)
    report = await published(org.owner, org, page(org.card("c_1", dimension=MONTH), period=YEAR))
    r = await csv_ticket(org.owner, org, report["id"])
    assert (r.status_code, r.json()["code"]) == (503, "download_ticket_unavailable")


async def republish(org, report):
    changed = page(org.card("c_1", dimension=MONTH, agg="avg"), period=YEAR)
    saved = await org.owner.client.put(
        f"{R}/{report['id']}",
        json={"revision": report["revision"], "name": "Changed metric", "config": changed},
        headers=org.h,
    )
    assert saved.status_code == 200
    next_report = saved.json()
    answer = await org.owner.client.post(
        f"{R}/{report['id']}/publish", json={"revision": next_report["revision"]}, headers=org.h
    )
    assert answer.status_code == 200
    assert answer.json()["published"]["version"] == 2


async def test_csv_and_ticket_refuse_a_different_screen_version(api, line, db, ticket_secret):
    # FR-REPORT-016: unchanged card IDs must not export a newly published metric under old UI.
    org = await report_org(api, line, db)
    report = await published(org.owner, org, page(org.card("c_1", dimension=MONTH), period=YEAR))
    await republish(org, report)
    r = await export(org.owner, org, report["id"], report_version=1)
    assert r.status_code == 409
    assert r.json()["code"] == "revision_conflict"
    r = await org.owner.client.post(
        f"{R}/{report['id']}/csv/ticket",
        json={"card_id": "c_1", "period": None, "report_version": 1},
        headers=org.h,
    )
    assert (r.status_code, r.json()["code"]) == (409, "revision_conflict")
    assert (await export(org.owner, org, report["id"], report_version=2)).status_code == 200


async def test_ticket_cannot_change_published_version_at_redemption(api, line, db, ticket_secret):
    org = await report_org(api, line, db)
    await formal(db, org, org.owner.user_id, doc(10, "ACME", "2026-03-01"))
    report = await published(org.owner, org, page(org.card("c_1", dimension=MONTH), period=YEAR))
    period = {"from": "2026-03-01", "to": "2026-03-31"}
    url = (await csv_ticket(org.owner, org, report["id"], period=period)).json()["url"]
    bare = client_like(api)
    # New formal rows in the SAME published definition still participate at redemption.
    await formal(db, org, org.owner.user_id, doc(20, "ACME", "2026-03-02"))
    got = await bare.get(url)
    assert got.status_code == 200
    assert parse(got.content)[1] == [["2026-03", "", "THB", "30.00", "2", "2"]]
    await republish(org, report)
    r = await bare.get(url)
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"
    assert "text/csv" not in r.headers["content-type"]
