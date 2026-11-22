import csv
import io

import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.services import data_source_connection, data_source_service
from tests.integration.report_helpers import (
    create_report,
    data,
    join,
    publish,
    published,
    query,
    report_org,
)
from tests.report_samples import card, page

SQL = (
    "SELECT amount, vendor FROM (SELECT 12.00::numeric AS amount, 'ACME' AS vendor "
    "UNION ALL SELECT 12.00::numeric, 'ACME' UNION ALL SELECT NULL::numeric, 'BETA') "
    "AS sales ORDER BY vendor, amount NULLS LAST"
)


def sql_card(source_id, *, type="table", sql=SQL):
    c = card("sql", type=type)
    c["data"] = {
        "source_id": source_id,
        "sql": sql,
        "result_fields": [
            {"key": "amount", "label": "Amount", "type": "decimal"},
            {"key": "vendor", "label": "Vendor", "type": "string"},
        ],
        "display_fields": [
            {"path": "vendor", "label": "Customer"},
            {"path": "amount", "label": "Amount"},
        ],
        "page_size": 5,
    }
    if type != "table":
        c["data"].update(
            measure={"path": "amount", "agg": "sum"},
            dimension={"kind": "category", "path": "vendor", "time_grain": None},
        )
    return c


@pytest.fixture
async def external(api, monkeypatch, migrated_db):
    async def resolve(*args, **kwargs):
        return "8.8.8.8"

    async def rows(settings, source, sql):
        clean = data_source_connection.readonly_sql(sql)
        return await data_source_connection._execute(
            {
                "host": migrated_db.db_host,
                "port": migrated_db.db_port,
                "dbname": migrated_db.db_name,
                "user": "saiflow_v3_reporter",
                "password": "local-reporter",
                "sslmode": "disable",
            },
            clean,
        )

    api.app.state.settings.data_source_key = SecretStr("12" * 32)
    monkeypatch.setattr(data_source_service, "resolve_target", resolve)
    monkeypatch.setattr(data_source_connection, "source_rows", rows)
    monkeypatch.setattr(data_source_service, "source_rows", rows)


async def source(org):
    response = await org.owner.client.post(
        "/api/v1/data-sources",
        headers=org.h,
        json={
            "name": "ERP",
            "host": "erp.example.test",
            "database": "erp",
            "username": "reader",
            "password": "secret",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_published_sql_table_retains_exact_rows_and_exports_selected_fields(
    api, line, db, external
):
    org = await report_org(api, line, db)
    sid = await source(org)
    report = await published(org.owner, org, page(sql_card(sid)))
    result = await data(org.owner, org, report["id"])
    table = result["cards"][0]["table"]
    assert table["total"] == 3
    assert table["rows"] == [
        {"vendor": "ACME", "amount": "12.00"},
        {"vendor": "ACME", "amount": "12.00"},
        {"vendor": "BETA", "amount": None},
    ]
    response = await org.owner.client.get(
        f"/api/v1/reports/{report['id']}/csv?card_id=sql", headers=org.h
    )
    assert response.status_code == 200, response.text
    records = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    start = records.index(["Customer", "Amount"])
    assert records[start + 1 :] == [["ACME", "12.00"], ["ACME", "12.00"], ["BETA", ""]]
    attempted = await query(
        org.owner, org, report["id"], sql="SELECT 999 as secret", source_id="system-pg"
    )
    assert attempted.status_code == 422
    changed = sql_card(sid, sql=SQL.replace("12.00", "999.00"))
    saved = await org.owner.client.put(
        f"/api/v1/reports/{report['id']}",
        headers=org.h,
        json={"revision": report["revision"], "name": "Ops", "config": page(changed)},
    )
    assert saved.status_code == 200
    still = await data(org.owner, org, report["id"])
    assert still["cards"][0]["table"]["rows"] == table["rows"]


async def test_source_delete_blocked_by_draft_and_publication_then_released(
    api, line, db, external
):
    org = await report_org(api, line, db)
    sid = await source(org)
    report = await create_report(org.owner, org, page(sql_card(sid)))
    response = await org.owner.client.delete(f"/api/v1/data-sources/{sid}", headers=org.h)
    assert response.status_code == 409 and response.json()["code"] == "data_source_in_use"
    published_response = await publish(org.owner, org, report)
    assert published_response.status_code == 200, published_response.text
    report = published_response.json()
    saved = await org.owner.client.put(
        f"/api/v1/reports/{report['id']}",
        headers=org.h,
        json={
            "revision": report["revision"],
            "name": "Ops",
            "config": page(org.card(type="metric")),
        },
    )
    assert saved.status_code == 200
    denied = await org.owner.client.delete(f"/api/v1/data-sources/{sid}", headers=org.h)
    assert denied.status_code == 409
    stopped = await org.owner.client.post(
        f"/api/v1/reports/{report['id']}/unpublish",
        headers=org.h,
        json={"revision": saved.json()["revision"]},
    )
    assert stopped.status_code == 200
    deleted = await org.owner.client.delete(f"/api/v1/data-sources/{sid}", headers=org.h)
    assert deleted.status_code == 204, deleted.text


async def test_foreign_and_builtin_sql_source_cannot_be_published(api, line, db, external):
    first = await report_org(api, line, db)
    sid = await source(first)
    other = await report_org(api, line, db, "OTHER")
    for source_id in (sid, "system-pg"):
        report = await create_report(other.owner, other, page(sql_card(source_id)))
        assert any(e["path"].endswith("source_id") for e in report["draft_errors"])
        denied = await publish(other.owner, other, report)
        assert denied.status_code == 422
    assert await db.scalar(text("select count(*) from report_source_refs")) == 0


async def test_sql_source_is_not_exposed_to_members_without_data_browse(api, line, db, external):
    org = await report_org(api, line, db)
    sid = await source(org)
    report = await published(org.owner, org, page(sql_card(sid)))
    member = await join(api, line, db, org, "LIMITED", ["report_view"])
    result = await data(member, org, report["id"])
    assert result["cards"][0]["status"] == "error"
    assert result["cards"][0]["error_code"] == "source_unavailable"
    assert result["cards"][0]["table"] is None and result["cards"][0]["rows"] == []
    manager = await join(api, line, db, org, "MANAGER", ["report_manage"])
    response = await manager.client.post(
        f"/api/v1/data-sources/{sid}/query",
        headers=org.h,
        json={"sql": SQL, "page": 1, "page_size": 5},
    )
    assert response.status_code == 404
    browser = await join(api, line, db, org, "BROWSER", ["report_view", "data_browse"])
    result = await data(browser, org, report["id"])
    assert result["cards"][0]["table"]["total"] == 3


async def test_sql_chart_aggregates_typed_fields_and_filters(api, line, db, external):
    org = await report_org(api, line, db)
    sid = await source(org)
    configured = sql_card(sid, type="bar")
    configured["data"]["filters"] = {
        "match": "and",
        "rules": [{"path": "amount", "op": "gte", "value": "10"}],
    }
    report = await published(org.owner, org, page(configured))
    result = await data(org.owner, org, report["id"])
    assert result["cards"][0]["rows"] == [
        {
            "dimension": "ACME",
            "series": None,
            "unit": None,
            "value": "24.00",
            "count": 2,
            "valid_count": 2,
        }
    ]


@pytest.mark.parametrize("sql_first", [True, False])
async def test_sql_and_template_cards_can_share_one_page(api, line, db, external, sql_first):
    from tests.integration.report_helpers import doc, formal

    org = await report_org(api, line, db)
    sid = await source(org)
    await formal(db, org, org.owner.user_id, doc(37))
    sql = sql_card(sid)
    template = org.card("template", type="metric", agg="sum")
    sql["layout"] = {"x": 0, "y": 0, "w": 6, "h": 4}
    template["layout"] = {"x": 6, "y": 0, "w": 6, "h": 4}
    report = await published(
        org.owner, org, page(*([sql, template] if sql_first else [template, sql]))
    )
    result = await data(org.owner, org, report["id"])
    cards = {c["card_id"]: c for c in result["cards"]}
    assert cards["sql"]["table"]["total"] == 3
    assert cards["template"]["rows"][0]["value"] == "37.00"


@pytest.mark.parametrize(
    "agg,expected",
    [
        ("sum", "2469135780246913578024691357802469135780.24"),
        ("avg", "1234567890123456789012345678901234567890.12"),
    ],
)
async def test_sql_aggregates_preserve_high_precision_numeric(
    api, line, db, external, agg, expected
):
    org = await report_org(api, line, db)
    sid = await source(org)
    c = sql_card(
        sid, type="bar", sql=SQL.replace("12.00", "1234567890123456789012345678901234567890.12")
    )
    c["data"]["measure"]["agg"] = agg
    report = await published(org.owner, org, page(c))
    result = await data(org.owner, org, report["id"])
    assert result["cards"][0]["rows"][0]["value"] == expected


@pytest.mark.parametrize("pg_type", ["date", "timestamp", "timestamptz"])
async def test_sql_date_fields_keep_calendar_date_for_period_and_filters(
    api, line, db, external, pg_type
):
    org = await report_org(api, line, db)
    sid = await source(org)
    literal = "2026-11-22" if pg_type == "date" else "2026-11-22 13:30:00+07"
    c = sql_card(
        sid, type="line", sql=f"SELECT 12.00::numeric AS amount, '{literal}'::{pg_type} AS vendor"
    )
    c["data"]["result_fields"][1]["type"] = "date"
    c["data"]["dimension"] = {"kind": "date", "path": "vendor", "time_grain": "day"}
    c["data"]["filters"] = {
        "match": "and",
        "rules": [{"path": "vendor", "op": "eq", "value": "2026-11-22"}],
    }
    report = await published(org.owner, org, page(c))
    result = await data(
        org.owner, org, report["id"], period={"from": "2026-11-22", "to": "2026-11-22"}
    )
    rows = result["cards"][0]["rows"]
    assert [(r["dimension"], r["value"]) for r in rows] == [("2026-11-22", "12.00")]


async def test_sql_field_change_or_disabled_source_returns_no_stale_results(
    api, line, db, external
):
    org = await report_org(api, line, db)
    sid = await source(org)
    configured = sql_card(sid, sql="SELECT 'ACME' AS vendor")
    report = await published(org.owner, org, page(configured))
    result = await data(org.owner, org, report["id"])
    assert result["cards"][0]["error_code"] == "source_fields_changed"
    await db.execute(text("update data_sources set enabled=false"))
    await db.commit()
    result = await data(org.owner, org, report["id"])
    assert result["cards"][0]["error_code"] == "source_unavailable"
    assert result["cards"][0]["rows"] == [] and result["cards"][0]["table"] is None
