"""Report statistics on real formal data: the exact formal base set, grains, aggregations,
periods, value conversions, units, negative values, dynamic data and query limits
(FR-REPORT-007..012/015/017; template-report-management contract §6)."""

from datetime import UTC, datetime

from sqlalchemy import text

from app.repositories import report_query
from tests.integration.report_helpers import (
    YEAR,
    cards,
    create_report,
    data,
    doc,
    formal,
    new_version,
    preview,
    published,
    query,
    report_audits,
    report_org,
    values,
)
from tests.report_samples import groups_v2, page

MONTH = {"kind": "date", "path": "header.doc_date", "time_grain": "month"}
VENDOR = {"kind": "category", "path": "header.vendor", "time_grain": None}
ITEMS = {"grain": "table", "table_key": "lines.items"}


def row(desc, amount, line_date="2026-03-15"):
    return {"desc": desc, "amount": amount, "line_date": line_date}


async def run(org, *card_list, period=YEAR, override=None) -> dict:
    """Publish a page of these cards and query it once; card id → card result."""
    report = await published(org.owner, org, page(*card_list, period=period))
    return cards(await data(org.owner, org, report["id"], override))


async def test_only_formal_results_of_the_job_itself(api, line, db):
    # AC-FR-REPORT-007-01 / 007-02
    org = await report_org(api, line, db)
    u = org.owner.user_id
    a = await formal(db, org, u, doc(1))
    await formal(db, org, u, doc(10), review="PENDING_L1", official=False)
    draft = await formal(db, org, u, doc(100), review="EDITED", official=False)
    await db.execute(
        text(
            "update ocr_jobs set confirmed_version_id = null, confirmed_at = null, "
            "confirmed_by_user_id = null where id = :j"
        ),
        {"j": draft.id},
    )
    wrong_result = await formal(db, org, u, doc(1000))
    await db.execute(
        text("update ocr_jobs set confirmed_version_id = :rv where id = :j"),
        {"rv": a.result_id, "j": wrong_result.id},
    )
    wrong_mapping = await formal(db, org, u, doc(10000))
    await db.execute(
        text("update result_versions set mapping_id = :m where id = :rv"),
        {"m": a.mapping_id, "rv": wrong_mapping.result_id},
    )
    v2 = await new_version(org.owner.client, org.tenant_id, org.template_id, groups_v2())
    switched = await formal(db, org, u, doc(100000))
    await db.execute(
        text(
            "insert into template_mappings (id, job_id, raw_result_id, template_id, "
            "template_version_id, source, status) "
            "select gen_random_uuid(), job_id, raw_result_id, template_id, :v, 'MANUAL', 'READY' "
            "from template_mappings where id = :m"
        ),
        {"v": v2, "m": switched.mapping_id},
    )
    await db.execute(
        text(
            "update ocr_jobs set current_mapping_id = (select id from template_mappings "
            "where job_id = :j and template_version_id = :v) where id = :j"
        ),
        {"j": switched.id, "v": v2},
    )
    await db.commit()
    got = await run(
        org,
        org.card("v1", type="metric"),
        org.card("v2", type="metric", version_ids=[v2]),
    )
    assert got["v1"]["rows"][0]["value"] == "100001.00"
    assert got["v1"]["diagnostics"]["documents"] == 2
    assert got["v2"]["status"] == "empty" and got["v2"]["rows"] == []


async def test_document_and_table_grain_do_not_double_count(api, line, db):
    # AC-FR-REPORT-008-01
    org = await report_org(api, line, db)
    lines = [row("x", "600"), row("y", "400")]
    for _ in range(2):  # identical documents: no DISTINCT may drop one
        await formal(db, org, org.owner.user_id, doc(1000, items=lines))
    got = await run(
        org,
        org.card("doc", type="metric"),
        org.card("rows", type="metric", measure="lines.items.amount", **ITEMS),
        org.card("by_vendor", measure="lines.items.amount", dimension=VENDOR, **ITEMS),
    )
    assert got["doc"]["rows"][0]["value"] == "2000.00"
    assert got["rows"]["rows"][0]["value"] == "2000.00"
    assert got["rows"]["diagnostics"]["items"] == 4
    assert values(got["by_vendor"]) == {"ACME": "2000.00"}
    report = await create_report(org.owner, org, page(org.card("t", type="metric", **ITEMS)))
    assert [e["path"] for e in report["draft_errors"]] == ["cards[0].data.measure.path"]


async def test_broken_and_empty_tables_are_diagnosed(api, line, db):
    # AC-FR-REPORT-008-02
    org = await report_org(api, line, db)
    u = org.owner.user_id
    second = [{"fee": "999"}]
    await formal(db, org, u, doc(1, items=[], fees=second))
    await formal(db, org, u, doc(1, items="not a table", fees=second))
    await formal(
        db,
        org,
        u,
        doc(1, items=["text", {"desc": " ", "amount": None}, row("ok", "5")], fees=second),
    )
    got = await run(
        org,
        org.card("sum", type="metric", measure="lines.items.amount", **ITEMS),
        org.card("count", type="metric", agg="count", **ITEMS),
    )
    for cid, value in (("sum", "5.00"), ("count", "1")):
        assert got[cid]["rows"][0]["value"] == value
        diag = got[cid]["diagnostics"]
        assert diag["items"] == 1 and diag["documents"] == 1
        assert diag["excluded"]["invalid_structure"] == 2  # the string table and the text row
        assert diag["excluded"]["empty_row"] == 1


async def test_structure_diagnostics_follow_the_header_period(api, line, db):
    # AC-FR-REPORT-008-02 / 011-02: even a non-array table must not leak outside the period.
    org = await report_org(api, line, db)
    for day in ("2025-06-01", "2026-06-01"):
        await formal(db, org, org.owner.user_id, doc(1, doc_date=day, items="bad table"))
        await formal(db, org, org.owner.user_id, doc(1, doc_date=day, items=["bad row"]))
    got = await run(
        org,
        org.card(
            "rows",
            type="metric",
            measure="lines.items.amount",
            date_field="header.doc_date",
            **ITEMS,
        ),
    )
    assert got["rows"]["diagnostics"]["excluded"]["invalid_structure"] == 2
    assert got["rows"]["diagnostics"]["documents"] == 0


async def test_aggregations_and_counts(api, line, db):
    # AC-FR-REPORT-009-01
    org = await report_org(api, line, db)
    u = org.owner.user_id
    await formal(db, org, u, doc(10, items=[row("a", "1"), row("b", "2"), {"desc": ""}]))
    for total in (20, None, "about ten"):
        await formal(db, org, u, doc(total))
    got = await run(
        org,
        *[org.card(agg, type="metric", agg=agg) for agg in ("sum", "avg", "min", "max", "count")],
        org.card("rows", type="metric", agg="count", **ITEMS),
    )
    assert {k: got[k]["rows"][0]["value"] for k in ("sum", "avg", "min", "max", "count")} == {
        "sum": "30.00",
        "avg": "15.00",
        "min": "10.00",
        "max": "20.00",
        "count": "4",
    }
    assert got["avg"]["rows"][0]["valid_count"] == 2 and got["avg"]["rows"][0]["count"] == 4
    excluded = got["sum"]["diagnostics"]["excluded"]
    assert excluded["invalid_number"] == 1 and excluded["missing"] == 1
    assert got["count"]["diagnostics"]["excluded"]["invalid_number"] == 0
    assert got["rows"]["rows"][0]["value"] == "2"
    assert got["rows"]["diagnostics"]["excluded"]["empty_row"] == 1


async def test_series_by_one_category_and_type_checks(api, line, db):
    # AC-FR-REPORT-009-02
    org = await report_org(api, line, db)
    u = org.owner.user_id
    for total, vendor, day in ((10, "ACME", "2026-03-15"), (20, "BETA", "2026-03-20")):
        await formal(db, org, u, doc(total, vendor, day))
    await formal(db, org, u, doc(5, "ACME", "2026-04-01"))
    got = await run(org, org.card("s", dimension=MONTH, series="header.vendor"))
    assert values(got["s"]) == {
        ("2026-03", "ACME"): "10.00",
        ("2026-03", "BETA"): "20.00",
        ("2026-04", "ACME"): "5.00",
    }
    text_sum = org.card("t", measure="header.vendor", dimension=MONTH)
    two = org.card("u", dimension=MONTH)
    two["data"]["measure"] = [two["data"]["measure"], {"path": "header.qty", "agg": "sum"}]
    report = await create_report(org.owner, org, page(text_sum, two))
    assert [e["path"] for e in report["draft_errors"]] == [
        "cards[0].data.measure.path",
        "cards[1].data.measure",
    ]


async def test_period_boundaries_default_year_and_override(api, line, db, monkeypatch):
    # AC-FR-REPORT-010-01 / 010-02
    org = await report_org(api, line, db)
    u = org.owner.user_id
    for total, day in ((1, "2025-12-31"), (2, "2026-01-01"), (4, "2026-12-31"), (8, "2027-01-01")):
        await formal(
            db, org, u, doc(total, doc_date=day, items=[row("i", str(total), line_date=day)])
        )
    year = {"kind": "date", "path": "header.doc_date", "time_grain": "year"}
    got = await run(org, org.card("y", dimension=year))
    assert values(got["y"]) == {"2026": "6.00"} and got["y"]["status"] == "ok"
    # the default is the current year in Thailand (UTC+7): 2025-12-31T17:30Z is 2026 there
    monkeypatch.setattr(
        "app.services.report_service.utcnow", lambda: datetime(2025, 12, 31, 17, 30, tzinfo=UTC)
    )
    report = await published(org.owner, org, page(org.card("y", dimension=year)))
    result = await data(org.owner, org, report["id"])
    assert result["period"] == {"from": "2026-01-01", "to": "2026-12-31"}
    assert values(cards(result)["y"]) == {"2026": "6.00"}
    # one page period for every card with a date; a card without a date is not applicable
    by_field = org.card("field", type="metric", date_field="header.doc_date")
    by_column = org.card(
        "column",
        measure="lines.items.amount",
        dimension={"kind": "date", "path": "lines.items.line_date", "time_grain": "day"},
        **ITEMS,
    )
    undated = org.card("none", type="metric")
    report = await published(org.owner, org, page(by_field, by_column, undated, period=YEAR))
    result = await data(org.owner, org, report["id"], {"from": "2026-12-31", "to": "2027-01-01"})
    assert result["period"] == {"from": "2026-12-31", "to": "2027-01-01"}
    got = cards(result)
    assert got["field"]["rows"][0]["value"] == "12.00" and got["field"]["period_applied"]
    assert values(got["column"]) == {"2026-12-31": "4.00", "2027-01-01": "8.00"}
    assert got["none"]["status"] == "not_applicable" and not got["none"]["period_applied"]
    assert got["none"]["rows"][0]["value"] == "15.00"
    r = await query(org.owner, org, report["id"], {"from": "2026-05-01", "to": "2026-04-01"})
    assert (r.status_code, r.json()["code"]) == (422, "report_period_invalid")
    inverted = {"mode": "fixed", "from": "2026-05-01", "to": "2026-04-01"}
    report = await create_report(org.owner, org, page(undated, period=inverted))
    assert [e["path"] for e in report["draft_errors"]] == ["period"]


async def test_exact_amounts_and_historic_formats(api, line, db):
    # AC-FR-REPORT-011-01
    org = await report_org(api, line, db)
    u = org.owner.user_id
    totals = ("0.10", 0.2, "฿ 1,234.50", "THB 2,000.00", "บาท 10.00")
    jobs = [await formal(db, org, u, doc(t)) for t in totals[:-1]]
    original = doc(totals[-1], doc_date="01/10/2569")
    jobs.append(await formal(db, org, u, original))
    got = await run(org, org.card("sum", type="metric"), org.card("month", dimension=MONTH))
    assert got["sum"]["rows"][0]["value"] == "3244.80"
    assert got["sum"]["diagnostics"]["excluded"] == {
        k: 0 for k in got["sum"]["diagnostics"]["excluded"]
    }
    month = values(got["month"])
    assert month["2026-10"] == "10.00" and month["2026-03"] == "3234.80"
    stored = await db.execute(
        text("select structured from result_versions where id = :rv"), {"rv": jobs[-1].result_id}
    )
    assert stored.scalar_one() == original  # history is never rewritten


async def test_excluded_values_and_valid_average(api, line, db):
    # AC-FR-REPORT-011-02
    org = await report_org(api, line, db)
    u = org.owner.user_id
    for total in ("10.00", None, "12.345", "ประมาณ 10000"):
        await formal(db, org, u, doc(total))
    await formal(db, org, u, doc("10.00", doc_date="31/02/2026"))
    got = await run(
        org, org.card("avg", type="metric", agg="avg"), org.card("month", dimension=MONTH)
    )
    avg = got["avg"]
    assert avg["rows"][0]["value"] == "10.00" and avg["rows"][0]["valid_count"] == 2
    assert {k: v for k, v in avg["diagnostics"]["excluded"].items() if v} == {
        "too_precise": 1,
        "invalid_number": 1,
        "missing": 1,
    }
    month = got["month"]
    assert month["diagnostics"]["excluded"]["invalid_date"] == 1
    assert values(month)["2026-03"] == "10.00"


async def test_unknown_category_and_empty_buckets(api, line, db):
    # AC-FR-REPORT-011-03
    org = await report_org(api, line, db)
    u = org.owner.user_id
    await formal(db, org, u, doc(10, "ACME", "2026-01-10"))
    await formal(db, org, u, doc(5, None, "2026-03-10"))
    await formal(db, org, u, doc(1, "  ", "2026-03-11"))
    spring = {"mode": "fixed", "from": "2026-01-01", "to": "2026-04-30"}
    got = await run(
        org, org.card("cat", dimension=VENDOR), org.card("month", dimension=MONTH), period=spring
    )
    assert [(r["dimension"], r["value"]) for r in got["cat"]["rows"]] == [
        ("ACME", "10.00"),
        (None, "6.00"),
    ]
    months = {r["dimension"]: (r["value"], r["count"]) for r in got["month"]["rows"]}
    assert months == {
        "2026-01": ("10.00", 1),
        "2026-02": (None, 0),
        "2026-03": ("6.00", 2),
        "2026-04": (None, 0),
    }


async def test_mixed_units_are_refused_unless_grouped(api, line, db):
    # AC-FR-REPORT-012-01
    org = await report_org(api, line, db)
    u = org.owner.user_id
    await formal(db, org, u, doc(100, currency="THB"))
    await formal(db, org, u, doc(20, currency="฿"))
    await formal(db, org, u, doc(50, currency="USD"))
    labelled = {"mode": "fixed", "value": "THB", "path": "header.currency"}
    by_field = {"mode": "field", "value": None, "path": "header.currency"}
    got = await run(
        org,
        org.card("fixed", type="metric", unit=labelled),
        org.card("split", dimension=VENDOR, unit=by_field),
        org.card("pie", type="pie", dimension=VENDOR, unit=by_field),
    )
    assert (got["fixed"]["status"], got["fixed"]["error_code"]) == ("error", "mixed_units")
    assert got["fixed"]["rows"] == []
    assert [(r["dimension"], r["unit"], r["value"]) for r in got["split"]["rows"]] == [
        ("ACME", "THB", "120.00"),
        ("ACME", "USD", "50.00"),
    ]
    assert got["pie"]["error_code"] == "mixed_units"
    thb_only = await report_org(api, line, db, sub="OWNER2")
    await formal(db, thb_only, thb_only.owner.user_id, doc(7, currency="thb"))
    got = await run(thb_only, thb_only.card("fixed", type="metric", unit=labelled))
    assert got["fixed"]["rows"][0]["value"] == "7.00"


async def test_negative_values_in_pie_charts(api, line, db):
    # AC-FR-REPORT-012-02
    org = await report_org(api, line, db)
    u = org.owner.user_id
    await formal(db, org, u, doc(100, "ACME"))
    pie = org.card("pie", type="pie", dimension=VENDOR)
    donut = org.card("donut", type="donut", dimension=VENDOR)
    bar = org.card("bar", dimension=VENDOR)
    report = await published(org.owner, org, page(pie, donut, bar, period=YEAR))
    first = cards(await data(org.owner, org, report["id"]))["pie"]
    assert first["error_code"] is None and values(first) == {"ACME": "100.00"}
    await formal(db, org, u, doc("-20.00", "BETA"))
    got = cards(await data(org.owner, org, report["id"]))
    for cid in ("pie", "donut"):
        assert (got[cid]["status"], got[cid]["error_code"]) == ("error", "negative_in_pie")
        assert got[cid]["rows"] == []
    assert values(got["bar"]) == {"ACME": "100.00", "BETA": "-20.00"}
    r = await preview(org.owner, org, report["id"], page(pie, period=YEAR))
    assert r.status_code == 200 and r.json()["cards"][0]["error_code"] == "negative_in_pie"
    # A positive value in the same category must not hide a formal negative value.
    await formal(db, org, u, doc("100.00", "BETA"))
    got = cards(await data(org.owner, org, report["id"]))
    assert values(got["bar"]) == {"ACME": "100.00", "BETA": "80.00"}
    for cid in ("pie", "donut"):
        assert got[cid]["error_code"] == "negative_in_pie" and got[cid]["rows"] == []


async def test_published_pages_query_current_formal_data(api, line, db):
    # AC-FR-REPORT-015-01
    org = await report_org(api, line, db)
    u = org.owner.user_id
    await formal(db, org, u, doc(10))
    await formal(db, org, u, doc(20))
    pending = await formal(db, org, u, doc(30), review="PENDING_L2", official=False)
    report = await published(org.owner, org, page(org.card("c", type="metric"), period=YEAR))
    assert cards(await data(org.owner, org, report["id"]))["c"]["rows"][0]["value"] == "30.00"
    await db.execute(
        text("update ocr_jobs set review_status = 'CONFIRMED', official_at = now() where id = :j"),
        {"j": pending.id},
    )
    await db.commit()
    got = cards(await data(org.owner, org, report["id"], refresh=True))
    assert got["c"]["rows"][0]["value"] == "60.00"
    assert [a for a in await report_audits(db) if a[0] == "report.refresh"]


async def test_group_limit_is_exact(api, line, db):
    # AC-FR-REPORT-017-01
    by_desc = {"kind": "category", "path": "lines.items.desc", "time_grain": None}
    for n in (1000, 1001):
        org = await report_org(api, line, db, sub=f"OWNER{n}")
        lines = [row(f"d{i:04d}", "1") for i in range(n)]
        await formal(db, org, org.owner.user_id, doc(1, items=lines))
        g = org.card("g", measure="lines.items.amount", dimension=by_desc, **ITEMS)
        got = (await run(org, g))["g"]
        if n == 1000:
            assert got["error_code"] is None and len(got["rows"]) == 1000
        else:  # never truncated to a "complete" 1000
            assert (got["status"], got["error_code"], got["rows"]) == ("error", "group_limit", [])


async def test_a_slow_statement_times_out_and_is_audited(api, line, db, monkeypatch):
    # AC-FR-REPORT-017-02 / 015-02
    org = await report_org(api, line, db)
    await formal(db, org, org.owner.user_id, doc(10))
    report = await published(org.owner, org, page(org.card("c", type="metric"), period=YEAR))
    fast = report_query.build

    def slow(*args, **kw):
        q = fast(*args, **kw)
        sql = f"SELECT s.* FROM ({q.sql}) AS s CROSS JOIN (SELECT pg_sleep(0.5)) AS slow"
        return report_query.CardQuery(sql, q.params)

    monkeypatch.setattr(report_query, "build", slow)
    monkeypatch.setattr(report_query, "STATEMENT_TIMEOUT_MS", 100)
    r = await query(org.owner, org, report["id"], refresh=True)
    assert r.status_code == 200, r.text
    card = r.json()["cards"][0]
    assert (card["status"], card["error_code"], card["rows"]) == ("error", "query_timeout", [])
    action, _, target, result = (await report_audits(db))[-1]
    assert (action, result) == ("report.refresh", "failure") and target.endswith("query_timeout")
    monkeypatch.setattr(report_query, "build", fast)
    monkeypatch.setattr(report_query, "STATEMENT_TIMEOUT_MS", 10_000)
    got = cards(await data(org.owner, org, report["id"], refresh=True))
    assert got["c"]["rows"][0]["value"] == "10.00"
