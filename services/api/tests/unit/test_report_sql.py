"""The card query is built from fixed fragments only; every value is bound (FR-REPORT-007/
008/017, D6/D7)."""

from datetime import date

import pytest

from app.repositories import report_query
from app.repositories.report_query import (
    GROUP_LIMIT,
    PATTERNS,
    STATEMENT_TIMEOUT_MS,
    build,
    is_timeout,
)
from app.services.report_config import VersionDef, validate
from tests.report_samples import GROUPS, card, page

V10 = VersionDef(10, 1, 1, GROUPS)
PERIOD = (date(2026, 1, 1), date(2026, 12, 31))


def spec_of(c):
    check = validate(page(c), {10: V10})
    assert check.errors == [], check.errors
    return check.cards[c["id"]]


def both(q):
    return q.sql


def test_formal_base_set_is_exact_and_bound():
    q = build(spec_of(card()), tenant_id=4242, scope_user_id=None, period=PERIOD)
    sql = both(q)
    for frag in (
        "JOIN result_versions r ON r.id = j.confirmed_version_id AND r.job_id = j.id",
        "JOIN template_mappings m ON m.id = r.mapping_id AND m.job_id = j.id",
        "j.tenant_id = :tenant_id",
        "j.review_status = 'CONFIRMED'",
        "j.official_at IS NOT NULL",
        "m.template_version_id = ANY(CAST(:version_ids AS bigint[]))",
    ):
        assert frag in sql
    assert "is_current" not in sql  # never the current result
    assert "4242" not in sql
    assert q.params["tenant_id"] == 4242
    assert q.params["version_ids"] == [10]
    assert "scope_user_id" not in q.params
    assert "created_by_user_id" not in sql


def test_conversion_steps_are_computed_once_per_row():
    # Q11: inlined, each step would repeat the previous step's expressions in every reference
    # and push them into the base scan; 20,000 documents then took ~44 s for one card
    q = build(
        spec_of(card(date_field="header.doc_date")), tenant_id=1, scope_user_id=None, period=PERIOD
    )
    for name in ("x", "y", "z", "w", "v", "t"):
        assert f"{name} AS MATERIALIZED (SELECT" in q.sql, name
    assert "base AS (SELECT" in q.sql  # the base set itself stays inlined
    # one statement: diagnostics and groups share the chain instead of evaluating it twice
    assert q.sql.count("base AS (SELECT") == 1
    assert "FROM d LEFT JOIN g ON true" in q.sql


def test_scope_is_a_bound_parameter():
    q = build(spec_of(card()), tenant_id=1, scope_user_id=777, period=PERIOD)
    assert "j.created_by_user_id = :scope_user_id" in q.sql
    assert q.params["scope_user_id"] == 777
    assert "777" not in both(q)


def test_plain_values_take_a_guarded_fast_path():
    q = build(
        spec_of(card(date_field="header.doc_date")), tenant_id=1, scope_user_id=None, period=PERIOD
    )
    assert "WHEN jsonb_typeof(x.m_raw) = 'number' THEN" in q.sql
    assert ":re_iso" in q.sql and "2399" in q.sql
    assert "calendar AS MATERIALIZED" in q.sql
    assert q.sql.count("pg_input_is_valid(") == 1


def test_intermediate_rows_drop_consumed_conversion_columns():
    # Q11: carrying the regex arrays and original text into every CTE spills to disk on
    # 60,000 line items; keep only the inputs needed at the next step.
    q = build(spec_of(card()), tenant_id=1, scope_user_id=None, period=PERIOD)
    assert "SELECT y.*" not in q.sql
    assert "SELECT z.*" not in q.sql


def test_only_configured_dates_are_parsed():
    q = build(spec_of(card()), tenant_id=1, scope_user_id=None, period=None)
    assert "regexp_match(" not in q.sql
    q = build(
        spec_of(
            card(
                type="line",
                dimension={"kind": "date", "path": "header.doc_date", "time_grain": "day"},
            )
        ),
        tenant_id=1,
        scope_user_id=None,
        period=PERIOD,
    )
    # The dimension and period are the same date: one shape validation / split.
    assert q.sql.count(":re_ymd") == 1
    assert q.sql.count(":re_dmy") == 1
    assert "regexp_match(" not in q.sql
    assert "string_to_array(" in q.sql


def test_paths_keys_patterns_and_period_are_bound():
    c = card(
        type="bar",
        measure="header.total",
        dimension={"kind": "category", "path": "header.vendor", "time_grain": None},
        date_field="header.doc_date",
        unit={"mode": "fixed", "value": "THB", "path": "header.currency"},
    )
    q = build(spec_of(c), tenant_id=1, scope_user_id=None, period=PERIOD)
    sql = both(q)
    assert q.params["m_raw_path"] == ["header", "total"]
    assert q.params["d_raw_path"] == ["header", "vendor"]
    assert q.params["p_raw_path"] == ["header", "doc_date"]
    assert q.params["u_raw_path"] == ["header", "currency"]
    assert q.params["unit_value"] == "THB"
    assert q.params["period_from"] == date(2026, 1, 1)
    assert "CAST(:m_raw_path AS text[])" in sql
    for word in ("header", "total", "vendor", "doc_date", "'currency'", "'THB'", "2026", "฿"):
        assert word not in sql, word
    for name, value in PATTERNS.items():
        assert q.params[name] == value
        if name != "re_int":  # only for integer measures
            assert f":{name}" in sql, name


def test_document_grain_never_unnests():
    q = build(spec_of(card()), tenant_id=1, scope_user_id=None, period=PERIOD)
    sql = both(q)
    assert "jsonb_array_elements" not in sql
    assert "unnest" not in sql


def test_table_grain_has_one_guarded_lateral():
    c = card(
        grain="table",
        table_key="lines.items",
        measure="lines.items.amount",
        dimension={"kind": "category", "path": "lines.items.desc", "time_grain": None},
        date_field="header.doc_date",
    )
    q = build(spec_of(c), tenant_id=1, scope_user_id=None, period=PERIOD)
    assert q.sql.count("jsonb_array_elements(") == 1
    assert q.sql.count("CAST(:table_path AS text[])") == 1  # read once per document
    assert "CASE WHEN jsonb_typeof(a.arr) = 'array' THEN a.arr" in q.sql
    assert "THEN 'bad_table'" in q.sql  # a non-array table is counted in the same pass
    assert q.params["table_path"] == ["lines", "items"]
    assert q.params["columns"] == ["desc", "amount", "line_date"]
    assert q.params["m_raw_col"] == "amount"
    assert q.params["d_raw_col"] == "desc"
    assert q.params["p_raw_path"] == ["header", "doc_date"]  # header field as filter only
    assert "'empty_row'" in q.sql
    # Fence the exact formal document joins before expansion; otherwise PostgreSQL's
    # correlated row estimate can turn the base into three per-document index scans.
    assert "base AS MATERIALIZED (SELECT" in q.sql


def test_table_conversion_streams_without_repeating_expressions():
    # Q11: expanded line rows must not spill every conversion stage to temporary files.
    c = card(grain="table", table_key="lines.items", measure="lines.items.amount")
    q = build(spec_of(c), tenant_id=1, scope_user_id=None, period=PERIOD)
    for name in ("x", "y", "z", "w", "calendar", "v"):
        assert f"{name} AS (SELECT" in q.sql, name
    assert q.sql.count("OFFSET 0)") >= 6  # prevent flattening/repeated guarded conversions
    assert "t AS MATERIALIZED (SELECT" in q.sql  # groups/diagnostics still share one snapshot


@pytest.mark.parametrize("agg", ["sum", "avg", "min", "max", "count"])
def test_aggregation_fragment_comes_from_the_enum(agg):
    c = card(type="metric", agg=agg)
    q = build(spec_of(c), tenant_id=1, scope_user_id=None, period=PERIOD)
    assert report_query.AGG_SQL[agg] in q.sql


@pytest.mark.parametrize(
    ("grain", "fmt"), [("day", "'YYYY-MM-DD'"), ("month", "'YYYY-MM'"), ("year", "'YYYY'")]
)
def test_time_bucket_fragment(grain, fmt):
    c = card(
        type="line", dimension={"kind": "date", "path": "header.doc_date", "time_grain": grain}
    )
    q = build(spec_of(c), tenant_id=1, scope_user_id=None, period=PERIOD)
    assert f"to_char(t.d_date, {fmt})" in q.sql
    # the date axis is the period: converted once, filtered on the same value
    assert q.params["d_raw_path"] == ["header", "doc_date"]
    assert "p_raw_path" not in q.params
    assert "v.p_date BETWEEN CAST(:period_from AS date)" in q.sql
    assert "CAST(w.d_iso AS date) END AS p_date" in q.sql


def test_no_period_without_a_date():
    q = build(spec_of(card()), tenant_id=1, scope_user_id=None, period=None)
    assert "period_from" not in q.params
    assert ":period_from" not in both(q)


def test_group_query_fetches_one_more_than_the_limit():
    q = build(spec_of(card()), tenant_id=1, scope_user_id=None, period=PERIOD)
    assert GROUP_LIMIT == 1000
    assert f"LIMIT {GROUP_LIMIT + 1})" in q.sql
    assert q.sql.count("LIMIT") == 1


def test_statement_timeout_is_ten_seconds():
    assert STATEMENT_TIMEOUT_MS == 10_000


def test_count_has_no_unit_and_no_measure_reasons():
    q = build(
        spec_of(card(type="metric", agg="count")), tenant_id=1, scope_user_id=None, period=PERIOD
    )
    assert "unit_value" not in q.params
    assert "'invalid_number'" not in q.sql.split("t AS MATERIALIZED (")[1].split("d AS (")[0]


class _Orig(Exception):
    def __init__(self, sqlstate):
        super().__init__("x")
        self.sqlstate = sqlstate


class _Wrapped(Exception):
    def __init__(self, orig):
        super().__init__("wrapped")
        self.orig = orig


def test_is_timeout_walks_the_chain():
    assert is_timeout(_Wrapped(_Orig("57014")))
    assert not is_timeout(_Wrapped(_Orig("23505")))
    try:
        try:
            raise _Orig("57014")
        except _Orig as inner:
            raise RuntimeError("outer") from inner
    except RuntimeError as exc:
        assert is_timeout(exc)
    assert not is_timeout(ValueError("x"))
