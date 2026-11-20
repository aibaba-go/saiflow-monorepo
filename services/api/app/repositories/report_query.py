"""The statistics query of one report card (FR-REPORT-007/008/009/011/012/017, D6/D7).

Only fixed SQL fragments are put together here: aggregation, grain, time bucket and the
value conversions come from enums; every value (tenant, scope, versions, period, JSON
paths as text[], keys, patterns) is a bound parameter. The formal base set is exactly:
CONFIRMED + official_at, the confirmed result of the job itself, the mapping of that
result of the job itself, at one of the card's template versions — never the current
result. Conversions mirror `app/ocr/templates/normalize.py` in SQL (THB markers, thousands
separators, Thai digits, Buddhist-era and day-first dates, amount precision) so values are
aggregated as numeric, never as floats, and history is never rewritten.

Diagnostics and groups come from one statement (the conversion chain is evaluated once) in
a REPEATABLE READ READ ONLY transaction under `SET LOCAL statement_timeout`."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.report_config import THB_ALIASES, CardSpec, Slot

STATEMENT_TIMEOUT_MS = 10_000  # FR-REPORT-017; tests lower it to provoke a real timeout
GROUP_LIMIT = 1000  # groups of one card, series combinations included
MAX_NUMBER_TEXT = 200  # longer cleaned number texts are not numbers
MAX_SAFE_INT = 2**53 - 1
QUERY_CANCELED = "57014"

_WS = "[\\s\u00a0\u200b]"
PATTERNS = {
    "re_currency": "฿|บาท|thb",
    "re_space": _WS + "+",
    "re_trim": f"^{_WS}+|{_WS}+$",
    "re_int": "^-?[0-9]+(\\.0+)?$",
    "re_dec": "^-?[0-9]+(\\.[0-9]+)?$",
    "re_iso": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    "re_ymd": "^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$",
    "re_dmy": "^([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4})$",
    "thai_digits": "๐๑๒๓๔๕๖๗๘๙",
    "ascii_digits": "0123456789",
}

AGG_SQL = {
    "sum": "sum(t.m_num)",
    "avg": "avg(t.m_num)",
    "min": "min(t.m_num)",
    "max": "max(t.m_num)",
    "count": "count(*)",
}
BUCKET_FORMAT = {"day": "'YYYY-MM-DD'", "month": "'YYYY-MM'", "year": "'YYYY'"}
INCLUDED = "('ok', 'invalid_number', 'too_precise', 'missing')"


class QueryTimeout(Exception):
    pass


@dataclass(frozen=True)
class CardQuery:
    sql: str
    params: dict[str, Any]


DIAG_COLUMNS = (
    "documents",
    "items",
    "invalid_number",
    "too_precise",
    "invalid_date",
    "missing_date",
    "empty_row",
    "invalid_structure",
    "missing",
    "units",
    "unit_mismatch",
    "min_value",
)
GROUP_COLUMNS = ("dimension", "series", "unit", "value", "cnt", "valid")


def _trim(expr: str) -> str:
    return f"regexp_replace({expr}, :re_trim, '', 'g')"


def _null(v: str) -> str:
    return f"({v} IS NULL OR jsonb_typeof({v}) = 'null')"


def _num_text(v: str) -> str:
    """The cleaned number text: NULL = missing, '#' = not a scalar (bool/object/array)."""
    raw = f"({v} #>> '{{}}')"
    clean = (
        f"translate(replace(regexp_replace(regexp_replace({raw}, :re_currency, '', 'gi'), "
        f":re_space, '', 'g'), ',', ''), :thai_digits, :ascii_digits)"
    )
    return (
        f"CASE WHEN {_null(v)} THEN NULL "
        f"WHEN jsonb_typeof({v}) NOT IN ('string', 'number') THEN '#' "
        f"WHEN jsonb_typeof({v}) = 'number' THEN {raw} "
        f"WHEN length({raw}) <= {MAX_NUMBER_TEXT} AND {raw} ~ :re_dec THEN {raw} "
        f"WHEN regexp_replace({raw}, :re_space, '', 'g') = '' THEN NULL "
        f"ELSE {clean} END"
    )


def _date_text(v: str) -> str:
    raw = f"({v} #>> '{{}}')"
    return (
        f"CASE WHEN {_null(v)} THEN NULL "
        f"WHEN jsonb_typeof({v}) NOT IN ('string', 'number') THEN '#' "
        f"WHEN {raw} ~ :re_iso THEN {raw} "
        f"ELSE NULLIF(translate({_trim(raw)}, :thai_digits, :ascii_digits), '') END"
    )


def _cat_text(v: str) -> str:
    """A category / unit label: trimmed text, NULL when missing or blank (the unknown
    bucket); other JSON values as their text, like normalize.py."""
    raw = f"({v} #>> '{{}}')"
    return (
        f"CASE WHEN {_null(v)} THEN NULL "
        f"WHEN jsonb_typeof({v}) = 'string' THEN NULLIF({_trim(raw)}, '') "
        f"ELSE CAST({v} AS text) END"
    )


def _unit_norm(expr: str) -> str:
    up = f"upper({expr})"
    return (
        f"CASE WHEN {up} = ANY(CAST(:thb_aliases AS text[])) THEN CAST(:thb AS text) ELSE {up} END"
    )


def _number_state(txt: str, ftype: str) -> str:
    regex = ":re_int" if ftype == "integer" else ":re_dec"
    parts = [
        f"CASE WHEN {txt} IS NULL THEN 'missing'",
        f"WHEN length({txt}) > {MAX_NUMBER_TEXT} OR {txt} !~ {regex} THEN 'invalid'",
    ]
    if ftype == "integer":
        parts.append(
            f"WHEN abs(CAST(split_part({txt}, '.', 1) AS numeric)) > {MAX_SAFE_INT} THEN 'invalid'"
        )
    if ftype == "amount":
        parts.append(f"WHEN length(split_part({txt}, '.', 2)) > 2 THEN 'too_precise'")
    parts.append("ELSE 'ok' END")
    return " ".join(parts)


def _number_value(txt: str, ftype: str) -> str:
    if ftype == "integer":
        return f"CAST(split_part({txt}, '.', 1) AS numeric)"
    if ftype == "amount":
        return f"round(CAST({txt} AS numeric), 2)"
    return f"CAST({txt} AS numeric)"


def _date_parts(txt: str) -> str:
    # Boolean shape checks avoid allocating regex capture arrays. Split only after checking
    # the exact accepted formats, so all subsequent integer casts are guarded.
    return (
        f"CASE WHEN {txt} ~ :re_iso AND left({txt}, 4) COLLATE \"C\" BETWEEN '0001' AND '2399' "
        f"THEN ARRAY[{txt}] "
        f"WHEN {txt} ~ :re_ymd OR {txt} ~ :re_dmy "
        f"THEN string_to_array(translate({txt}, '/.', '--'), '-') END"
    )


def _iso(parts: str) -> str:
    def make(y: str, m: str, d: str) -> str:
        year = f"CAST({y} AS int)"
        return (
            f"lpad(CAST(CASE WHEN {year} >= 2400 THEN {year} - 543 ELSE {year} END AS text), "
            f"4, '0') || '-' || lpad({m}, 2, '0') || '-' || lpad({d}, 2, '0')"
        )

    return (
        f"CASE WHEN array_length({parts}, 1) = 1 THEN {parts}[1] "
        f"WHEN length({parts}[1]) = 4 "
        f"THEN {make(f'{parts}[1]', f'{parts}[2]', f'{parts}[3]')} "
        f"WHEN {parts} IS NOT NULL THEN {make(f'{parts}[3]', f'{parts}[2]', f'{parts}[1]')} END"
    )


def _filter_ctes(spec: CardSpec, params: dict[str, Any]) -> list[str]:
    if not spec.filters:
        return []
    rules = [r for group in spec.filters for r in group.rules]
    raw, cleaned, states, dates, values = [], [], [], [], []
    predicates = []
    for i, rule in enumerate(rules):
        name = f"f{i}"
        slot = rule.slot
        if slot.source == "header":
            params[f"{name}_path"] = list(slot.keys)
            source = f"i.doc #> CAST(:{name}_path AS text[])"
        else:
            params[f"{name}_col"] = slot.keys[0]
            source = f"i.row -> CAST(:{name}_col AS text)"
        raw.append(f"{source} AS {name}")
        cleaned.append(f"{_cat_text(f'f.{name}')} AS {name}_empty")
        txt = f"f.{name}_txt"
        if slot.type == "string":
            clean = (
                f"CASE WHEN jsonb_typeof(f.{name}) IN ('string', 'number') "
                f"THEN {_cat_text(f'f.{name}')} END"
            )
            val = txt
        elif slot.type == "date":
            clean = _date_text(f"f.{name}")
            states.append(f"{_date_parts(txt)} AS {name}_parts")
            dates.append(f"{_iso(f'f.{name}_parts')} AS {name}_iso")
            val = (
                f"CASE WHEN pg_input_is_valid(f.{name}_iso, 'date') "
                f"THEN CAST(f.{name}_iso AS date) END"
            )
        else:
            clean = _num_text(f"f.{name}")
            states.append(f"{_number_state(txt, slot.type)} AS {name}_state")
            val = f"CASE WHEN f.{name}_state = 'ok' THEN {_number_value(txt, slot.type)} END"
        cleaned.append(f"{clean} AS {name}_txt")
        values.append(f"{val} AS {name}_value")
        expr = f"f.{name}_value"
        sqltype = "text" if slot.type == "string" else "date" if slot.type == "date" else "numeric"
        op = rule.op
        if op in ("empty", "not_empty"):
            predicates.append(f"f.{name}_empty IS {'NOT ' if op == 'not_empty' else ''}NULL")
            continue
        typed = [
            date.fromisoformat(v)
            if sqltype == "date"
            else Decimal(v)
            if sqltype == "numeric"
            else v
            for v in rule.values
        ]
        if op in ("in", "not_in"):
            params[f"{name}_values"] = typed
            cmp = "= ANY" if op == "in" else "<> ALL"
            predicates.append(f"{expr} {cmp}(CAST(:{name}_values AS {sqltype}[]))")
            continue
        for j, value in enumerate(typed):
            params[f"{name}_v{j}"] = value
        right = f"CAST(:{name}_v0 AS {sqltype})"
        if op == "between":
            pred = f"{expr} BETWEEN {right} AND CAST(:{name}_v1 AS {sqltype})"
        elif op == "contains":
            pred = f"strpos(lower({expr}), lower({right})) > 0"
        else:
            operator = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            pred = f"{expr} {operator} {right}"
        predicates.append(pred)
    conditions, start = [], 0
    for group in spec.filters:
        end = start + len(group.rules)
        conditions.append(
            "(" + (" AND " if group.match == "and" else " OR ").join(predicates[start:end]) + ")"
        )
        start = end

    def stage(name, source, projections):
        extra = ", " + ", ".join(projections) if projections else ""
        return f"{name} AS (SELECT f.*{extra} FROM {source} f OFFSET 0)"

    return [
        "filter_raw AS (SELECT i.*, " + ", ".join(raw) + " FROM items i OFFSET 0)",
        stage("filter_text", "filter_raw", cleaned),
        stage("filter_state", "filter_text", states),
        stage("filter_dates", "filter_state", dates),
        stage("filter_values", "filter_dates", values),
        "filtered_items AS (SELECT f.job_id, f.doc, f.row, f.kind FROM filter_values f WHERE "
        + " AND ".join(conditions)
        + " OFFSET 0)",
    ]


def build(
    spec: CardSpec,
    *,
    tenant_id: int,
    scope_user_id: int | None,
    period: tuple[date, date] | None,
) -> CardQuery:
    """`period` None = the card has no date to filter on (not applicable)."""
    params: dict[str, Any] = dict(PATTERNS)
    params["thb_aliases"] = list(THB_ALIASES)
    params["thb"] = "THB"
    params["tenant_id"] = tenant_id
    params["version_ids"] = list(spec.version_ids)
    scope = ""
    if scope_user_id is not None:
        scope = " AND j.created_by_user_id = :scope_user_id"
        params["scope_user_id"] = scope_user_id

    # Expand only after the exact document joins for table grain: the row-count
    # underestimate otherwise makes the planner repeat index joins per document.
    base_fence = "MATERIALIZED " if spec.grain == "table" else ""
    base = (
        f"base AS {base_fence}(SELECT j.id AS job_id, CAST(r.structured AS jsonb) AS doc "
        "FROM ocr_jobs j "
        "JOIN result_versions r ON r.id = j.confirmed_version_id AND r.job_id = j.id "
        "JOIN template_mappings m ON m.id = r.mapping_id AND m.job_id = j.id "
        "WHERE j.tenant_id = :tenant_id AND j.review_status = 'CONFIRMED' "
        "AND j.official_at IS NOT NULL "
        f"AND m.template_version_id = ANY(CAST(:version_ids AS bigint[])){scope})"
    )
    if spec.grain == "table":
        assert spec.table is not None
        params["table_path"] = list(spec.table)
        params["columns"] = list(spec.columns)
        cell = "e.value -> c.k"
        non_empty = (
            f"NOT ({cell} IS NULL OR jsonb_typeof({cell}) = 'null' OR "
            f"(jsonb_typeof({cell}) = 'string' AND {_trim('e.value ->> c.k')} = ''))"
        )
        # a table value that is neither an array nor missing / null yields one 'bad_table' row,
        # so it is counted in the same pass; the row kind is fenced (OFFSET 0) so its column
        # check runs once per row and is not copied into every later reference
        items = (
            "items AS (SELECT b.job_id, b.doc, "
            "CASE WHEN k.kind = 'row' THEN e.value END AS row, k.kind "
            "FROM base b "
            "CROSS JOIN LATERAL (SELECT b.doc #> CAST(:table_path AS text[]) AS arr OFFSET 0) a "
            "CROSS JOIN LATERAL jsonb_array_elements("
            "CASE WHEN jsonb_typeof(a.arr) = 'array' THEN a.arr "
            "WHEN jsonb_typeof(a.arr) <> 'null' THEN CAST('[null]' AS jsonb) "
            "ELSE CAST('[]' AS jsonb) END) AS e(value) "
            "CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(a.arr) <> 'array' THEN 'bad_table' "
            "WHEN jsonb_typeof(e.value) <> 'object' THEN 'bad_row' "
            "WHEN NOT EXISTS (SELECT 1 FROM unnest(CAST(:columns AS text[])) AS c(k) "
            f"WHERE {non_empty}) THEN 'empty_row' ELSE 'row' END AS kind OFFSET 0) k)"
        )
    else:
        items = (
            "items AS (SELECT b.job_id, b.doc, CAST(NULL AS jsonb) AS row, 'row' AS kind "
            "FROM base b)"
        )

    def raw(name: str, slot: Slot | None) -> str:
        if slot is None:
            return f"CAST(NULL AS jsonb) AS {name}"
        if slot.source == "header":
            params[f"{name}_path"] = list(slot.keys)
            return f"i.doc #> CAST(:{name}_path AS text[]) AS {name}"
        params[f"{name}_col"] = slot.keys[0]
        return f"i.row -> CAST(:{name}_col AS text) AS {name}"  # NULL unless kind = 'row'

    period_slot = spec.period_slot if period is not None else None
    date_dim = spec.dim if spec.dim_kind == "date" else None
    cat_dim = spec.dim if spec.dim_kind == "category" else None
    # the period usually filters on the date the card is bucketed by: convert it once
    p = "d" if period_slot is not None and period_slot == date_dim else "p"
    own_period = period_slot if p == "p" else None
    # OFFSET 0 is a projection boundary, like MATERIALIZED, without storing all expanded
    # line rows at each stage. Only t is reused by groups/diagnostics and must be materialized.
    fence = "" if spec.grain == "table" else "MATERIALIZED "
    offset = " OFFSET 0" if spec.grain == "table" else ""
    filter_ctes = _filter_ctes(spec, params)
    source_items = "filtered_items" if filter_ctes else "items"
    x = (
        f"x AS {fence}(SELECT i.job_id, i.kind, "
        + ", ".join(
            [
                raw("m_raw", spec.measure),
                raw("d_raw", spec.dim),
                raw("s_raw", spec.series),
                raw("p_raw", own_period),
                raw("u_raw", spec.unit),
            ]
        )
        + f" FROM {source_items} i{offset})"
    )
    y = (
        f"y AS {fence}(SELECT x.job_id, x.kind, "
        f"{_num_text('x.m_raw') if spec.measure else 'CAST(NULL AS text)'} AS m_txt, "
        f"{_date_text('x.d_raw') if date_dim else 'CAST(NULL AS text)'} AS d_txt, "
        f"{_cat_text('x.d_raw') if cat_dim else 'CAST(NULL AS text)'} AS d_cat, "
        f"{_cat_text('x.s_raw') if spec.series else 'CAST(NULL AS text)'} AS s_cat, "
        f"{_date_text('x.p_raw') if own_period else 'CAST(NULL AS text)'} AS p_txt, "
        f"{_cat_text('x.u_raw') if spec.unit else 'CAST(NULL AS text)'} AS u_txt FROM x{offset})"
    )
    mtype = spec.measure.type if spec.measure else "decimal"
    z = (
        f"z AS {fence}(SELECT y.job_id, y.kind, y.m_txt, y.d_cat, y.s_cat, y.u_txt, "
        "y.d_txt IS NULL AS d_missing, y.p_txt IS NULL AS p_missing, "
        f"{_date_parts('y.d_txt') if date_dim else 'CAST(NULL AS text[])'} AS d_parts, "
        f"{_date_parts('y.p_txt') if own_period else 'CAST(NULL AS text[])'} AS p_parts, "
        f"{_number_state('y.m_txt', mtype)} AS m_state FROM y{offset})"
    )
    w = (
        f"w AS {fence}(SELECT z.job_id, z.kind, z.m_txt, z.m_state, z.d_cat, z.s_cat, "
        "z.u_txt, z.d_missing, z.p_missing, "
        f"{_iso('z.d_parts') if date_dim else 'CAST(NULL AS text)'} AS d_iso, "
        f"{_iso('z.p_parts') if own_period else 'CAST(NULL AS text)'} AS p_iso FROM z{offset})"
    )

    # Calendar validity is checked once per configured date (not again for each state,
    # cast and matching period). Fast ISO candidates still pass this exact calendar guard.
    d_valid = "pg_input_is_valid(w.d_iso, 'date')" if date_dim else "false"
    p_valid = "pg_input_is_valid(w.p_iso, 'date')" if own_period else "false"
    calendar = (
        f"calendar AS {fence}(SELECT w.*, {d_valid} AS d_valid, {p_valid} AS p_valid "
        f"FROM w{offset})"
    )

    def date_state(prefix: str) -> str:
        return (
            f"CASE WHEN w.{prefix}_missing THEN 'missing' "
            f"WHEN w.{prefix}_iso IS NULL OR NOT w.{prefix}_valid "
            "THEN 'invalid' ELSE 'ok' END"
        )

    def date_value(prefix: str) -> str:
        return (
            f"CASE WHEN w.{prefix}_iso IS NOT NULL AND w.{prefix}_valid "
            f"THEN CAST(w.{prefix}_iso AS date) END"
        )

    if spec.agg == "count" or spec.unit_mode is None:
        unit_sql, mismatch_sql = "CAST(NULL AS text)", "false"
    elif spec.unit_mode == "fixed":
        params["unit_value"] = spec.unit_value
        unit_sql = "CAST(:unit_value AS text)"
        if spec.unit is not None:
            mismatch_sql = (
                f"(w.u_txt IS NOT NULL AND {_unit_norm('w.u_txt')} <> CAST(:unit_value AS text))"
            )
        else:
            mismatch_sql = "false"
    else:
        unit_sql = f"CASE WHEN w.u_txt IS NOT NULL THEN {_unit_norm('w.u_txt')} END"
        mismatch_sql = "false"

    v = (
        f"v AS {fence}(SELECT w.job_id, w.kind, w.m_state, "
        f"CASE WHEN w.m_state = 'ok' THEN {_number_value('w.m_txt', mtype)} END AS m_num, "
        f"{date_state('d')} AS d_state, {date_value('d')} AS d_date, "
        f"{date_state(p)} AS p_state, {date_value(p)} AS p_date, "
        f"w.d_cat, w.s_cat, {unit_sql} AS u, {mismatch_sql} AS u_mismatch FROM calendar w{offset})"
    )

    reasons = []
    if period_slot is not None:
        assert period is not None
        params["period_from"], params["period_to"] = period
        in_period = "v.p_date BETWEEN CAST(:period_from AS date) AND CAST(:period_to AS date)"
        if period_slot.source == "header":
            struct_scope = f"(v.p_state = 'ok' AND {in_period})"
        else:  # a column date cannot place an empty / broken row in time
            struct_scope = "true"
    else:
        struct_scope = "true"
    reasons.append(
        f"WHEN v.kind = 'empty_row' THEN CASE WHEN {struct_scope} THEN 'empty_row' ELSE 'out' END"
    )
    reasons.append(
        f"WHEN v.kind = 'bad_row' THEN CASE WHEN {struct_scope} THEN 'invalid_structure' "
        "ELSE 'out' END"
    )
    reasons.append(
        f"WHEN v.kind = 'bad_table' THEN CASE WHEN {struct_scope} THEN 'invalid_structure' "
        "ELSE 'out' END"
    )
    if period_slot is not None:
        reasons += [
            "WHEN v.p_state = 'invalid' THEN 'invalid_date'",
            "WHEN v.p_state = 'missing' THEN 'missing_date'",
            f"WHEN NOT ({in_period}) THEN 'out'",
        ]
    if date_dim is not None:
        reasons += [
            "WHEN v.d_state = 'invalid' THEN 'invalid_date'",
            "WHEN v.d_state = 'missing' THEN 'missing_date'",
        ]
    if spec.agg != "count":
        reasons += [
            "WHEN v.m_state = 'invalid' THEN 'invalid_number'",
            "WHEN v.m_state = 'too_precise' THEN 'too_precise'",
            "WHEN v.m_state = 'missing' THEN 'missing'",
        ]
    t = (
        "t AS MATERIALIZED (SELECT v.*, CASE "
        + " ".join(reasons)
        + " ELSE 'ok' END AS reason FROM v)"
    )

    if date_dim is not None:
        dim_sql = f"to_char(t.d_date, {BUCKET_FORMAT[spec.time_grain or 'day']})"
    elif cat_dim is not None:
        dim_sql = "t.d_cat"
    else:
        dim_sql = "CAST(NULL AS text)"
    series_sql = "t.s_cat" if spec.series is not None else "CAST(NULL AS text)"
    order = (
        'g.dimension COLLATE "C" NULLS LAST, g.series COLLATE "C" NULLS LAST, '
        'g.unit COLLATE "C" NULLS LAST'
    )
    d = (
        "d AS (SELECT "
        f"count(DISTINCT t.job_id) FILTER (WHERE t.reason IN {INCLUDED}) AS documents, "
        f"count(*) FILTER (WHERE t.reason IN {INCLUDED}) AS items, "
        "count(*) FILTER (WHERE t.reason = 'invalid_number') AS invalid_number, "
        "count(*) FILTER (WHERE t.reason = 'too_precise') AS too_precise, "
        "count(*) FILTER (WHERE t.reason = 'invalid_date') AS invalid_date, "
        "count(*) FILTER (WHERE t.reason = 'missing_date') AS missing_date, "
        "count(*) FILTER (WHERE t.reason = 'empty_row') AS empty_row, "
        "count(*) FILTER (WHERE t.reason = 'invalid_structure') AS invalid_structure, "
        "count(*) FILTER (WHERE t.reason = 'missing') AS missing, "
        f"count(DISTINCT t.u) FILTER (WHERE t.reason IN {INCLUDED}) AS units, "
        f"count(*) FILTER (WHERE t.reason IN {INCLUDED} AND t.u_mismatch) AS unit_mismatch, "
        f"min(t.m_num) FILTER (WHERE t.reason IN {INCLUDED}) AS min_value "
        "FROM t)"
    )
    g = (
        f"g AS (SELECT g.* FROM (SELECT {dim_sql} AS dimension, {series_sql} AS series, "
        f"t.u AS unit, {AGG_SQL[spec.agg]} AS value, count(*) AS cnt, count(t.m_num) AS valid "
        f"FROM t WHERE t.reason IN {INCLUDED} GROUP BY 1, 2, 3) AS g "
        f"ORDER BY {order} LIMIT {GROUP_LIMIT + 1})"
    )

    # One statement per card: the conversion chain is evaluated once and feeds both the
    # diagnostics (d, exactly one row) and the groups (g, joined onto it; `grp` false = no
    # group). Every conversion projection has a boundary: document stages MATERIALIZED,
    # expanded table stages OFFSET 0 to avoid repeated disk spills. Inlining would copy
    # the whole chain into each reference. The shared terminal t is always MATERIALIZED
    # (FR-REPORT-017, plan Q11).
    sql = (
        "WITH "
        + ",\n".join([base, items, *filter_ctes, x, y, z, w, calendar, v, t, d, g])
        + "\nSELECT d.*, g.dimension, g.series, g.unit, g.value, g.cnt, g.valid, "
        "g.cnt IS NOT NULL AS grp FROM d LEFT JOIN g ON true "
        f"ORDER BY {order}"
    )
    return CardQuery(sql, params)


def is_timeout(exc: BaseException) -> bool:
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        for attr in ("sqlstate", "pgcode"):
            if getattr(cur, attr, None) == QUERY_CANCELED:
                return True
        cur = getattr(cur, "orig", None) or cur.__cause__
    return False


async def run(db: AsyncSession, query: CardQuery) -> tuple[dict, list[dict]]:
    """Diagnostics and groups of one statement, in a read-only snapshot under the statement
    timeout; the transaction is always rolled back, so the connection goes back to the pool
    clean."""
    try:
        await db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        await db.execute(
            text("SELECT set_config('statement_timeout', :v, true)"),
            {"v": f"{int(STATEMENT_TIMEOUT_MS)}ms"},
        )
        result = [dict(r) for r in (await db.execute(text(query.sql), query.params)).mappings()]
    except DBAPIError as exc:
        await db.rollback()
        if is_timeout(exc):
            raise QueryTimeout() from exc
        raise
    await db.rollback()
    diag = {k: result[0][k] for k in DIAG_COLUMNS}  # d always yields exactly one row
    rows = [{k: r[k] for k in GROUP_COLUMNS} for r in result if r["grp"]]
    return diag, rows
