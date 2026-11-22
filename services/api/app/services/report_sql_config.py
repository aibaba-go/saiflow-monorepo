import re

from app.errors import AppError
from app.services.data_source_security import readonly_sql, relation_select
from app.services.report_filters import parse_group

SQL_TYPES = frozenset({"string", "integer", "decimal", "date", "boolean"})
SOURCE_ID = re.compile(r"^postgres:([1-9][0-9]{0,18})$")


def validate_card(card, path, error, precision, page_filter):
    from app.services.report_config import AGGS, TIME_GRAINS, CardSpec, DisplayField, Slot

    cid, kind, data = card["id"], card["type"], card["data"]
    source_id = data.get("source_id")
    match = SOURCE_ID.fullmatch(source_id) if isinstance(source_id, str) else None
    if not match or int(match[1]) >= 2**63:
        error(f"{path}.source_id", "choose an organization PostgreSQL source")
    sql = data.get("sql")
    try:
        sql = readonly_sql(sql) if isinstance(sql, str) else readonly_sql("")
    except AppError:
        error(f"{path}.sql", "a single read-only SELECT is required")
    mode = data.get("query_mode", "sql")
    if mode not in ("sql", "table"):
        error(f"{path}.query_mode", "choose table or SQL mode")
    if mode == "table":
        relation = data.get("relation")
        if not isinstance(relation, dict) or any(
            not isinstance(relation.get(k), str) for k in ("schema", "name")
        ):
            error(f"{path}.relation", "choose a table or view")
        else:
            try:
                expected = readonly_sql(relation_select(relation["schema"], relation["name"]))
                if sql != expected:
                    error(f"{path}.sql", "table mode must query the selected relation")
            except AppError:
                error(f"{path}.relation", "choose a valid table or view")
    for key in ("template_id", "template_version_ids", "grain", "table_key"):
        if data.get(key) is not None:
            error(f"{path}.{key}", "SQL cards bind result fields, not template grains")
    fields = {}
    raw = data.get("result_fields")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 100:
        error(f"{path}.result_fields", "discover 1-100 result fields")
        raw = []
    for i, entry in enumerate(raw):
        p = f"{path}.result_fields[{i}]"
        if not isinstance(entry, dict):
            error(p, "a result field is an object")
            continue
        key, label, ftype = entry.get("key"), entry.get("label"), entry.get("type")
        if not isinstance(key, str) or not 1 <= len(key) <= 200 or "\x00" in key or key in fields:
            error(p, "result keys must be distinct nonempty text")
            continue
        if (
            not isinstance(label, str)
            or not 1 <= len(label.strip()) <= 100
            or not isinstance(ftype, str)
            or ftype not in SQL_TYPES
        ):
            error(p, "a result field needs a label and supported type")
            continue
        fields[key] = DisplayField(Slot(key, "sql", (key,), ftype), label.strip())

    def slot(key, p, types):
        field = fields.get(key) if isinstance(key, str) else None
        if field is None or field.slot.type not in types:
            error(p, "choose a compatible discovered result field")
            return None
        return field.slot

    display = []
    size = data.get("page_size", 20)
    if not isinstance(size, int) or isinstance(size, bool) or not 5 <= size <= 100:
        error(f"{path}.page_size", "page size is an integer from 5 to 100")
    agg, measure, dim, series, unit = "count", None, None, None, None
    dim_kind, time_grain, unit_mode, unit_value = "none", None, None, None
    if kind == "table":
        selected = data.get(
            "display_fields", [{"path": f.slot.path, "label": f.label} for f in fields.values()]
        )
        if not isinstance(selected, list) or not 1 <= len(selected) <= 50:
            error(f"{path}.display_fields", "choose 1-50 display fields")
            selected = []
        seen = set()
        for i, entry in enumerate(selected):
            p = f"{path}.display_fields[{i}]"
            if not isinstance(entry, dict):
                error(p, "a display field is an object")
                continue
            field = slot(entry.get("path"), p, SQL_TYPES)
            label = entry.get("label")
            if not isinstance(label, str) or not 1 <= len(label.strip()) <= 100:
                error(p, "a label is 1-100 characters")
            elif field:
                if field.path in seen:
                    error(p, "display fields must be distinct")
                seen.add(field.path)
                display.append(DisplayField(field, label.strip()))
    else:
        m = data.get("measure")
        if not isinstance(m, dict) or m.get("agg") not in AGGS:
            error(f"{path}.measure.agg", "choose a supported aggregation")
            m = {}
        agg = m.get("agg", "count")
        if agg != "count":
            measure = slot(m.get("path"), f"{path}.measure.path", {"integer", "decimal"})
        d = data.get("dimension") or {"kind": "none"}
        if not isinstance(d, dict):
            error(f"{path}.dimension", "dimension must be an object")
            d = {}
        dim_kind = d.get("kind", "none")
        if (
            dim_kind not in ("none", "category", "date")
            or (kind == "metric" and dim_kind != "none")
            or (kind != "metric" and dim_kind == "none")
        ):
            error(f"{path}.dimension.kind", "choose an appropriate dimension")
        if dim_kind != "none":
            dim = slot(
                d.get("path"),
                f"{path}.dimension.path",
                {"date"} if dim_kind == "date" else {"string", "integer", "decimal", "boolean"},
            )
        if dim_kind == "date":
            time_grain = d.get("time_grain")
            if time_grain not in TIME_GRAINS:
                error(f"{path}.dimension.time_grain", "choose day, month or year")
        s = data.get("series")
        if s is not None:
            if kind not in ("bar", "line") or not isinstance(s, dict):
                error(f"{path}.series", "only bar and line cards accept a series")
            else:
                series = slot(
                    s.get("path"),
                    f"{path}.series.path",
                    {"string", "integer", "decimal", "boolean"},
                )
        u = data.get("unit")
        if agg != "count" and u is not None:
            if not isinstance(u, dict) or u.get("mode") not in ("fixed", "field"):
                error(f"{path}.unit", "choose fixed or field units")
            elif u["mode"] == "fixed":
                from app.services.report_config import normalize_unit

                unit_mode = "fixed"
                v = u.get("value")
                unit_value = normalize_unit(v) if isinstance(v, str) else None
                if not unit_value or len(unit_value) > 16:
                    error(f"{path}.unit.value", "a unit is 1-16 characters")
            else:
                unit_mode = "field"
                unit = slot(u.get("path"), f"{path}.unit.path", {"string"})
    date_field = None
    date_raw = data.get("date_field")
    if date_raw is not None:
        date_field = slot(
            date_raw.get("path") if isinstance(date_raw, dict) else None,
            f"{path}.date_field.path",
            {"date"},
        )
    filters = []
    for raw_group, p in (
        (data.get("filters"), f"{path}.filters"),
        (page_filter, "filters.targets"),
    ):
        group = parse_group(raw_group, p, slot, error)
        if group:
            filters.append(group)
    return CardSpec(
        id=cid,
        type=kind,
        title=card.get("title", ""),
        template_id=0,
        version_ids=(),
        grain="document",
        table=None,
        columns=(),
        agg=agg,
        measure=measure,
        dim_kind=dim_kind,
        dim=dim,
        time_grain=time_grain,
        series=series,
        date_field=date_field,
        unit_mode=unit_mode,
        unit_value=unit_value,
        unit=unit,
        precision=precision,
        filters=tuple(filters),
        display_fields=tuple(display),
        page_size=size,
        source_id=source_id,
        sql=sql,
        sql_fields=tuple(fields.values()),
    )
