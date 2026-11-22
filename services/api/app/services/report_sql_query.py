from datetime import date, datetime
from decimal import Decimal, InvalidOperation, localcontext

from app.config import Settings
from app.errors import AppError
from app.services import data_source_connection
from app.services.report_config import CardSpec, normalize_unit


def _date(value):
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        try:
            return datetime.fromisoformat(value).date()
        except (ValueError, TypeError):
            return None


def _number(value):
    try:
        result = Decimal(value) if value is not None else None
        return result if result is not None and result.is_finite() else None
    except (InvalidOperation, TypeError):
        return None


def _matches(row, rule):
    value = row.get(rule.slot.path)
    empty = value is None or value.strip() == ""
    if rule.op in ("empty", "not_empty"):
        return empty if rule.op == "empty" else not empty
    if empty:
        return False
    if rule.slot.type in ("integer", "decimal"):
        left = _number(value)
        right = [_number(v) for v in rule.values]
    elif rule.slot.type == "date":
        left = _date(value)
        right = [_date(v) for v in rule.values]
    else:
        left, right = value.strip(), list(rule.values)
    if left is None:
        return False
    op = rule.op
    if op == "contains":
        return right[0].lower() in left.lower()
    if op in ("in", "not_in"):
        return (left in right) if op == "in" else (left not in right)
    if op == "between":
        return right[0] <= left <= right[1]
    if op == "eq":
        return left == right[0]
    if op == "neq":
        return left != right[0]
    if op == "gt":
        return left > right[0]
    if op == "gte":
        return left >= right[0]
    if op == "lt":
        return left < right[0]
    return left <= right[0]


def render(
    spec: CardSpec, columns: list[dict], raw: list[dict], period, page: int, export_all: bool
):
    from app.services.report_query_service import _card, _fill, format_value, zero_diagnostics

    applied = spec.period_slot is not None
    expected = {f.slot.path: f.slot.type for f in spec.sql_fields}
    actual = {c["key"]: c["type"] for c in columns}
    if expected != actual:
        return _card(spec.id, "error", "source_fields_changed", applied)
    rows = [{k: data_source_connection.value_text(v) for k, v in row.items()} for row in raw]
    diag = zero_diagnostics()
    selected = []
    for row in rows:
        if any(
            not (all if g.match == "and" else any)(_matches(row, r) for r in g.rules)
            for g in spec.filters
        ):
            continue
        if applied:
            value = row.get(spec.period_slot.path)
            parsed = _date(value)
            if parsed is None:
                diag["excluded"]["missing_date" if not value else "invalid_date"] += 1
                continue
            if not period[0] <= parsed <= period[1]:
                continue
        selected.append(row)
    diag["items"] = len(selected)
    if spec.type == "table":
        total = len(selected)
        start = 0 if export_all else (page - 1) * spec.page_size
        result = _card(
            spec.id,
            "empty" if not total else ("ok" if applied else "not_applicable"),
            None,
            applied,
            diag=diag,
        )
        result["table"] = {
            "columns": [
                {"key": f.slot.path, "label": f.label, "type": f.slot.type}
                for f in spec.display_fields
            ],
            "rows": [
                {f.slot.path: row.get(f.slot.path) for f in spec.display_fields}
                for row in selected[start : None if export_all else start + spec.page_size]
            ],
            "page": page,
            "page_size": spec.page_size,
            "total": total,
        }
        return result
    groups = {}
    units = set()
    negative = False
    for row in selected:
        dim = row.get(spec.dim.path) if spec.dim else None
        if spec.dim_kind == "date":
            parsed = _date(dim)
            if parsed is None:
                diag["excluded"]["missing_date" if not dim else "invalid_date"] += 1
                continue
            dim = parsed.isoformat()[: {"day": 10, "month": 7, "year": 4}[spec.time_grain]]
        series = row.get(spec.series.path) if spec.series else None
        unit = (
            spec.unit_value
            if spec.unit_mode == "fixed"
            else normalize_unit(row.get(spec.unit.path))
            if spec.unit
            else None
        )
        units.add(unit)
        key = (dim, series, unit)
        group = groups.setdefault(key, {"count": 0, "values": []})
        group["count"] += 1
        value = _number(row.get(spec.measure.path)) if spec.measure else None
        if value is not None:
            group["values"].append(value)
            negative |= value < 0
        elif spec.agg != "count":
            diag["excluded"][
                "missing" if row.get(spec.measure.path) is None else "invalid_number"
            ] += 1
    if len(groups) > 1000:
        return _card(spec.id, "error", "group_limit", applied, diag=diag)
    if spec.type in ("pie", "donut") and spec.unit_mode == "field" and len(units) > 1:
        return _card(spec.id, "error", "mixed_units", applied, diag=diag)
    if spec.type in ("pie", "donut") and negative:
        return _card(spec.id, "error", "negative_in_pie", applied, diag=diag)
    output = []
    for (dim, series, unit), group in sorted(
        groups.items(), key=lambda item: tuple((v is None, v or "") for v in item[0])
    ):
        values = group["values"]
        if spec.agg == "count":
            value = group["count"]
        elif not values:
            value = None
        elif spec.agg in ("sum", "avg"):
            with localcontext() as context:
                scale = min(v.as_tuple().exponent for v in values)
                context.prec = (
                    max(28, max(v.adjusted() for v in values) - scale + 1)
                    + len(str(len(values)))
                    + 28
                )
                value = sum(values)
                if spec.agg == "avg":
                    value /= len(values)
        elif spec.agg == "min":
            value = min(values)
        else:
            value = max(values)
        output.append(
            {
                "dimension": dim,
                "series": series,
                "unit": unit,
                "value": format_value(value, spec.agg, spec.measure.type if spec.measure else None),
                "count": group["count"],
                "valid_count": group["count"] if spec.agg == "count" else len(values),
            }
        )
    if not output:
        return _card(spec.id, "empty", None, applied, diag=diag)
    if applied:
        output = _fill(spec, output, period)
    return _card(spec.id, "ok" if applied else "not_applicable", None, applied, output, diag)


async def run(
    db,
    spec: CardSpec,
    *,
    settings: Settings | None,
    tenant_id,
    scope_user_id,
    period,
    page,
    export_all,
):
    from app.services.data_source_service import get_source
    from app.services.report_query_service import _card

    applied = spec.period_slot is not None
    if settings is None or scope_user_id is not None:
        return _card(spec.id, "error", "source_unavailable", applied)
    try:
        try:
            source = await get_source(db, tenant_id, spec.source_id)
            db.expunge(source)
        finally:
            await db.rollback()
        if not source.enabled:
            return _card(spec.id, "error", "source_unavailable", applied)
        columns, rows = await data_source_connection.source_rows(settings, source, spec.sql)
    except AppError as exc:
        code = {
            "data_source_query_timeout": "query_timeout",
            "data_source_row_limit": "row_limit",
            "data_source_columns_invalid": "source_fields_changed",
        }.get(exc.code, "source_unavailable")
        return _card(spec.id, "error", code, applied)
    return render(spec, columns, rows, period, page, export_all)
