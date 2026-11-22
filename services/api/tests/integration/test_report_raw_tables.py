import csv
import io

import pytest

from tests.integration.report_helpers import YEAR, data, doc, formal, join, published, report_org
from tests.report_samples import page


def raw_card(org, *, grain="document", fields=None, date_field=None):
    card = org.card(
        "raw", type="table", grain=grain, table_key="lines.items" if grain == "table" else None
    )
    card["data"] = {
        "template_id": org.template_id,
        "template_version_ids": [org.version_id],
        "grain": grain,
        "table_key": "lines.items" if grain == "table" else None,
        "display_fields": fields
        or [
            {"path": "header.vendor", "label": "Vendor"},
            {"path": "header.total", "label": "Amount"},
        ],
        "page_size": 5,
        "date_field": {"path": date_field} if date_field else None,
    }
    return card


async def test_raw_document_table_paginates_twelve_records_and_exports_all(api, line, db):
    org = await report_org(api, line, db)
    for _ in range(11):
        await formal(db, org, org.owner.user_id, doc("12.00", vendor="=formula"))
    await formal(db, org, org.owner.user_id, doc(None, vendor="null"))
    report = await published(org.owner, org, page(raw_card(org), period=YEAR))
    all_rows = []
    for number, count in ((1, 5), (2, 5), (3, 2)):
        result = await data(org.owner, org, report["id"], pages={"raw": number})
        table = result["cards"][0]["table"]
        assert table["page"] == number and table["page_size"] == 5 and table["total"] == 12
        assert len(table["rows"]) == count
        assert [c["key"] for c in table["columns"]] == ["header.vendor", "header.total"]
        assert result["cards"][0]["rows"] == []
        all_rows.extend(table["rows"])
    assert all_rows.count({"header.vendor": "=formula", "header.total": "12.00"}) == 11
    assert all_rows.count({"header.vendor": "null", "header.total": None}) == 1
    repeated = await data(org.owner, org, report["id"], pages={"raw": 2})
    assert repeated["cards"][0]["table"]["rows"] == all_rows[5:10]
    response = await org.owner.client.get(
        f"/api/v1/reports/{report['id']}/csv?card_id=raw", headers=org.h
    )
    assert response.status_code == 200, response.text
    records = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    index = records.index(["Vendor", "Amount"])
    assert len(records[index + 1 :]) == 12
    assert records[index + 1 :].count(["'=formula", "12.00"]) == 11
    assert ["null", ""] in records[index + 1 :]


async def test_raw_lines_keep_same_row_fields_filters_and_period(api, line, db):
    org = await report_org(api, line, db)
    await formal(
        db,
        org,
        org.owner.user_id,
        doc(
            0,
            items=[
                {"desc": "a", "amount": "12.00"},
                {"desc": "a", "amount": "12.00"},
                {"desc": "a", "amount": None},
                {"desc": "b", "amount": "999.00"},
            ],
        ),
    )
    await formal(
        db,
        org,
        org.owner.user_id,
        doc(0, doc_date="2025-01-01", items=[{"desc": "a", "amount": "9999.00"}]),
    )
    card = raw_card(
        org,
        grain="table",
        date_field="header.doc_date",
        fields=[
            {"path": "lines.items.desc", "label": "Description"},
            {"path": "lines.items.amount", "label": "Amount"},
        ],
    )
    card["data"]["filters"] = {
        "match": "and",
        "rules": [{"path": "lines.items.desc", "op": "eq", "value": "a"}],
    }
    report = await published(org.owner, org, page(card, period=YEAR))
    result = await data(org.owner, org, report["id"])
    table = result["cards"][0]["table"]
    assert table["total"] == 3
    assert table["rows"] == [
        {"lines.items.desc": "a", "lines.items.amount": "12.00"},
        {"lines.items.desc": "a", "lines.items.amount": "12.00"},
        {"lines.items.desc": "a", "lines.items.amount": None},
    ]


@pytest.mark.parametrize("kind", ["rows", "bytes"])
async def test_raw_csv_rejects_oversized_result_instead_of_truncating(api, line, db, kind):
    org = await report_org(api, line, db)
    entries = (
        [{"desc": "a", "amount": "1"}] * 50001
        if kind == "rows"
        else [{"desc": "x" * (8 * 1024 * 1024 + 1), "amount": "1"}]
    )
    await formal(db, org, org.owner.user_id, doc(0, items=entries))
    report = await published(
        org.owner,
        org,
        page(
            raw_card(
                org, grain="table", fields=[{"path": "lines.items.desc", "label": "Description"}]
            ),
            period=YEAR,
        ),
    )
    response = await org.owner.client.get(
        f"/api/v1/reports/{report['id']}/csv?card_id=raw", headers=org.h
    )
    assert response.status_code == 409, response.text[:200]
    assert response.json()["code"] == "report_export_failed"
    assert response.json()["details"]["error_code"] == "row_limit"
    assert response.headers["content-type"].startswith("application/json")


async def test_raw_out_of_range_page_preserves_total_and_empty_cells(api, line, db):
    org = await report_org(api, line, db)
    await formal(db, org, org.owner.user_id, doc(None))
    report = await published(org.owner, org, page(raw_card(org), period=YEAR))
    result = await data(org.owner, org, report["id"], pages={"raw": 100})
    table = result["cards"][0]["table"]
    assert table["total"] == 1 and table["rows"] == [] and table["page"] == 100


async def test_raw_table_member_scope_is_applied_before_total_and_page(api, line, db):
    org = await report_org(api, line, db)
    member = await join(api, line, db, org, "READER", ["report_view"])
    await formal(db, org, org.owner.user_id, doc("999.00"))
    await formal(db, org, member.user_id, doc("1.00"))
    report = await published(org.owner, org, page(raw_card(org), period=YEAR))
    result = await data(member, org, report["id"])
    assert result["scope"] == "own"
    assert result["cards"][0]["table"]["total"] == 1
    assert result["cards"][0]["table"]["rows"] == [
        {"header.vendor": "ACME", "header.total": "1.00"}
    ]
