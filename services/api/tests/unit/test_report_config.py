"""Report page configuration: catalog, card validation, limits, period (FR-REPORT-005/006/
008/009/010/012/013/014/017)."""

import copy
from datetime import UTC, date, datetime

import pytest

from app.errors import AppError
from app.services.report_config import (
    MAX_CARDS,
    VersionDef,
    bound_versions,
    catalog,
    empty_config,
    normalize_unit,
    resolve_period,
    storable_errors,
    validate,
)
from tests.report_samples import GROUPS, card, groups_v2, page

V10 = VersionDef(10, 1, 1, GROUPS)
V11 = VersionDef(11, 1, 2, groups_v2())
VERSIONS = {10: V10, 11: V11}


def errors_of(config, versions=VERSIONS, **kw):
    return validate(config, versions, **kw).errors


def paths(errors):
    return [e["path"] for e in errors]


def test_valid_cards_of_every_type():
    cfg = page(
        card("c_bar", type="bar"),
        card(
            "c_line",
            type="line",
            dimension={"kind": "date", "path": "header.doc_date", "time_grain": "month"},
        ),
        card("c_pie", type="pie"),
        card("c_donut", type="donut", agg="count"),
        card("c_metric", type="metric", agg="avg"),
        card(
            "c_table",
            type="table",
            grain="table",
            table_key="lines.items",
            measure="lines.items.amount",
            series="header.vendor",
        ),
    )
    check = validate(cfg, VERSIONS)
    assert check.errors == []
    assert sorted(check.cards) == sorted(c["id"] for c in cfg["cards"])
    table = check.cards["c_table"]
    assert table.measure.source == "column" and table.measure.keys == ("amount",)
    assert table.series.source == "header" and table.series.keys == ("header", "vendor")
    assert table.columns == ("desc", "amount", "line_date")


def test_draft_problems_point_at_the_card():
    bad = card("c_bad")
    bad["data"]["measure"] = {"path": None, "agg": "sum"}
    errs = errors_of(page(card("c_ok"), bad))
    assert errs == [
        {
            "card_id": "c_bad",
            "path": "cards[1].data.measure.path",
            "message": "a field path is required",
        }
    ]


@pytest.mark.parametrize(
    "mutate,path",
    [
        (lambda c: c["data"]["measure"].update(path="header.vendor"), "data.measure.path"),
        (lambda c: c["data"]["measure"].update(path="header.nope"), "data.measure.path"),
        (
            lambda c: c["data"]["measure"].update(path="header.total; drop table x"),
            "data.measure.path",
        ),
        (lambda c: c["data"]["measure"].update(path="lines.items.amount"), "data.measure.path"),
        (lambda c: c["data"]["measure"].update(agg="median"), "data.measure.agg"),
        (lambda c: c["data"].update(grain="cube"), "data.grain"),
        (lambda c: c["data"]["dimension"].update(path="header.total"), "data.dimension.path"),
        (
            lambda c: c["data"].update(
                dimension={"kind": "date", "path": "header.vendor", "time_grain": "month"}
            ),
            "data.dimension.path",
        ),
        (
            lambda c: c["data"].update(
                dimension={"kind": "date", "path": "header.doc_date", "time_grain": "week"}
            ),
            "data.dimension.time_grain",
        ),
        (lambda c: c["data"].update(dimension={"kind": "none"}), "data.dimension.kind"),
        (lambda c: c["data"].update(date_field={"path": "header.vendor"}), "data.date_field.path"),
        (lambda c: c["data"].update(unit=None), "data.unit"),
        (lambda c: c["data"].update(unit={"mode": "fixed", "value": ""}), "data.unit.value"),
        (
            lambda c: c["data"].update(unit={"mode": "field", "path": "header.total"}),
            "data.unit.path",
        ),
        (lambda c: c["data"].update(template_version_ids=[99]), "data.template_version_ids[0]"),
        (lambda c: c["data"].update(template_id=2), "data.template_version_ids[0]"),
        (lambda c: c["data"].update(template_version_ids=[]), "data.template_version_ids"),
        (lambda c: c.update(type="radar"), "type"),
        (lambda c: c.update(id="bad id!"), "id"),
        (lambda c: c.update(title="x" * 201), "title"),
        (lambda c: c["layout"].update(x=8, w=6), "layout.w"),
        (lambda c: c["layout"].update(h=1), "layout.h"),
        (lambda c: c["layout"].update(h=13), "layout.h"),
        (lambda c: c["layout"].update(x=-1), "layout.x"),
        (lambda c: c["layout"].update(y=True), "layout.y"),
        (lambda c: c["style"].update(precision=7), "style.precision"),
        (lambda c: c["style"].update(precision=-1), "style.precision"),
        (lambda c: c["style"].update(colors=["red"]), "style.colors[0]"),
        (lambda c: c["style"].update(legend="yes"), "style.legend"),
    ],
)
def test_card_rules(mutate, path):
    c = card("c_x")
    mutate(c)
    errs = errors_of({"version": 1, "cards": [c]})
    assert any(e["path"] == f"cards[0].{path}" for e in errs), errs


def test_count_and_chart_specific_rules():
    errs = errors_of(page(card("c_1", agg="count", measure="header.total")))
    assert errs == []  # count ignores the measure path given by the helper (it nulls it)
    c = card("c_2", agg="count")
    c["data"]["measure"]["path"] = "header.total"
    assert paths(errors_of(page(c))) == ["cards[0].data.measure.path"]
    pie = card("c_3", type="pie", series="header.currency")
    assert "cards[0].data.series" in paths(errors_of(page(pie)))
    metric = card("c_4", type="metric", dimension={"kind": "category", "path": "header.vendor"})
    assert "cards[0].data.dimension.kind" in paths(errors_of(page(metric)))
    same = card("c_5", series="header.vendor")
    assert "cards[0].data.series.path" in paths(errors_of(page(same)))


def test_table_grain_rules():
    # header amounts are never a per-row measure; headers may group / filter
    hdr = card("c_1", grain="table", table_key="lines.items", measure="header.total")
    assert paths(errors_of(page(hdr))) == ["cards[0].data.measure.path"]
    other = card("c_2", grain="table", table_key="lines.items", measure="lines.fees.fee")
    assert paths(errors_of(page(other))) == ["cards[0].data.measure.path"]
    no_table = card("c_3", grain="table", table_key=None, measure="lines.items.amount")
    assert "cards[0].data.table_key" in paths(errors_of(page(no_table)))
    doc_col = card("c_4", measure="lines.items.amount")
    assert paths(errors_of(page(doc_col))) == ["cards[0].data.measure.path"]
    ok = card(
        "c_5",
        grain="table",
        table_key="lines.items",
        measure="lines.items.amount",
        dimension={"kind": "date", "path": "header.doc_date", "time_grain": "day"},
        date_field="lines.items.line_date",
    )
    assert errors_of(page(ok)) == []


def test_multi_version_needs_same_path_same_type_and_confirmation():
    both = card("c_1", version_ids=[10, 11])
    errs = errors_of(page(both))
    assert {e["message"] for e in errs} == {
        "confirm that header.total means the same in every selected version",
        "confirm that header.vendor means the same in every selected version",
    }
    confirmed = card("c_1", version_ids=[10, 11], confirmed=["header.total", "header.vendor"])
    assert errors_of(page(confirmed)) == []
    retyped = {10: V10, 12: VersionDef(12, 1, 3, groups_v2(total_type="string"))}
    c = card("c_1", version_ids=[10, 12], confirmed=["header.total", "header.vendor"])
    errs = errors_of(page(c), retyped)
    assert errs[0]["message"] == "the field has different types in the selected versions"
    moved = {10: V10, 13: VersionDef(13, 1, 4, groups_v2(move_total=True))}
    c = card("c_1", version_ids=[10, 13], confirmed=["header.total", "header.vendor"])
    errs = errors_of(page(c), moved)
    assert errs[0]["message"] == "the field is not in every selected version"


def test_catalog_compatibility():
    out = catalog(
        [
            V10,
            VersionDef(13, 1, 4, groups_v2(move_total=True)),
        ]
    )
    by_path = {f["path"]: f for f in out["fields"]}
    assert by_path["header.total"]["compatible"] is False
    assert by_path["header.total"]["versions"] == [10]
    assert by_path["totals.total"]["versions"] == [13]
    assert by_path["header.vendor"]["compatible"] is True
    assert by_path["lines.items.amount"] == {
        "path": "lines.items.amount",
        "name": "Amount",
        "names": None,
        "type": "amount",
        "grain": "table",
        "table_key": "lines.items",
        "versions": [10, 13],
        "compatible": True,
    }
    grains = {g.get("table_key"): g for g in out["grains"]}
    assert grains[None]["grain"] == "document"
    assert grains["lines.items"]["compatible"] is True
    retyped = catalog([V10, VersionDef(12, 1, 3, groups_v2(total_type="string"))])
    total = next(f for f in retyped["fields"] if f["path"] == "header.total")
    assert total["compatible"] is False and total["type"] == "string"  # highest version


def test_layout_overlap_and_unique_ids():
    a = card("c_a", layout={"x": 0, "y": 0, "w": 6, "h": 4})
    b = card("c_b", layout={"x": 3, "y": 2, "w": 6, "h": 4})
    errs = errors_of({"version": 1, "cards": [a, b]})
    assert errs == [
        {"card_id": "c_b", "path": "cards[1].layout", "message": "the card overlaps card c_a"}
    ]
    dup = page(card("c_a"), card("c_a"))
    assert paths(errors_of(dup)) == ["cards[1].id"]


def test_thirty_cards_publish_thirty_one_rejected():
    def many(n):
        cards = []
        for i in range(n):
            c = card(f"c_{i}", layout={"x": (i % 2) * 6, "y": (i // 2) * 2, "w": 6, "h": 2})
            cards.append(c)
        return {"version": 1, "cards": cards}

    assert errors_of(many(MAX_CARDS), for_publish=True) == []
    assert storable_errors(many(MAX_CARDS)) == []
    errs = storable_errors(many(MAX_CARDS + 1))
    assert errs == [{"card_id": None, "path": "cards", "message": "a page has at most 30 cards"}]
    assert "cards" in paths(errors_of(many(MAX_CARDS + 1)))


def test_storable_and_publish_rules():
    assert storable_errors([1]) != []
    big = {"version": 1, "cards": [], "pad": "x" * (256 * 1024)}
    assert storable_errors(big)[0]["message"] == "the configuration is larger than 256 KB"
    assert storable_errors(empty_config()) == []
    assert errors_of(empty_config()) == []
    assert paths(errors_of(empty_config(), for_publish=True)) == ["cards"]
    # incomplete drafts are storable
    assert storable_errors({"version": 1, "cards": [{"id": "c_1"}]}) == []


def test_period_rules():
    now = datetime(2026, 12, 31, 18, 0, tzinfo=UTC)  # already 2027-01-01 in Bangkok
    assert resolve_period(empty_config(), None, now) == (date(2027, 1, 1), date(2027, 12, 31))
    now = datetime(2026, 6, 1, tzinfo=UTC)
    assert resolve_period(empty_config(), None, now) == (date(2026, 1, 1), date(2026, 12, 31))
    fixed = {"period": {"mode": "fixed", "from": "2025-02-01", "to": "2025-03-31"}}
    assert resolve_period(fixed, None, now) == (date(2025, 2, 1), date(2025, 3, 31))
    over = {"from": "2026-03-01", "to": "2026-03-01"}
    assert resolve_period(fixed, over, now) == (date(2026, 3, 1), date(2026, 3, 1))
    for bad in (
        {"from": "2026-03-02", "to": "2026-03-01"},
        {"from": "2026-02-30", "to": "2026-03-01"},
        {"from": "2026-01-01"},
        "2026",
    ):
        with pytest.raises(AppError) as exc:
            resolve_period(fixed, bad, now)
        assert exc.value.code == "report_period_invalid"
    inverted = {
        "version": 1,
        "period": {"mode": "fixed", "from": "2026-02-01", "to": "2026-01-01"},
        "cards": [],
    }
    assert paths(errors_of(inverted)) == ["period"]


def test_period_slot_and_bound_versions():
    c = card("c_1", date_field="header.doc_date")
    spec = validate(page(c), VERSIONS).cards["c_1"]
    assert spec.period_slot.path == "header.doc_date"
    d = card("c_2", dimension={"kind": "date", "path": "header.doc_date", "time_grain": "year"})
    assert validate(page(d), VERSIONS).cards["c_2"].period_slot.path == "header.doc_date"
    assert validate(page(card("c_3")), VERSIONS).cards["c_3"].period_slot is None
    cfg = page(card("c_1", version_ids=[10, 11]), card("c_2", template_id=5, version_ids=[7]))
    assert bound_versions(cfg) == {(1, 10), (1, 11), (5, 7)}
    assert bound_versions({"cards": "x"}) == set()


def test_units():
    assert normalize_unit(" thb ") == "THB"
    assert normalize_unit("฿") == "THB"
    assert normalize_unit("บาท") == "THB"
    assert normalize_unit("usd") == "USD"
    assert normalize_unit("  ") is None
    c = card("c_1", unit={"mode": "fixed", "value": "baht", "path": "header.currency"})
    spec = validate(page(c), VERSIONS).cards["c_1"]
    assert spec.unit_value == "THB" and spec.unit.path == "header.currency"


def test_client_flags_and_unknown_keys_do_not_widen_anything():
    c = card("c_1")
    c["data"]["can_browse_all"] = True
    c["data"]["sql"] = "select * from ocr_jobs"
    spec = validate(page(c), VERSIONS).cards["c_1"]
    assert not hasattr(spec, "can_browse_all")
    assert copy.deepcopy(spec) == spec
