"""Pure sample data shared by the report unit and integration tests (template-report-management)."""

import copy

GROUPS = [
    {
        "key": "header",
        "name": "Header",
        "items": [
            {"kind": "field", "key": "doc_date", "name": "Date", "type": "date"},
            {"kind": "field", "key": "vendor", "name": "Vendor", "type": "string"},
            {"kind": "field", "key": "currency", "name": "Currency", "type": "string"},
            {"kind": "field", "key": "total", "name": "Total", "type": "amount"},
            {"kind": "field", "key": "qty", "name": "Qty", "type": "integer"},
            {"kind": "field", "key": "rate", "name": "Rate", "type": "decimal"},
        ],
    },
    {
        "key": "lines",
        "name": "Lines",
        "items": [
            {
                "kind": "table",
                "key": "items",
                "name": "Items",
                "columns": [
                    {"key": "desc", "name": "Desc", "type": "string"},
                    {"key": "amount", "name": "Amount", "type": "amount"},
                    {"key": "line_date", "name": "Line date", "type": "date"},
                ],
            },
            {
                "kind": "table",
                "key": "fees",
                "name": "Fees",
                "columns": [{"key": "fee", "name": "Fee", "type": "amount"}],
            },
        ],
    },
]


def groups_v2(total_type: str = "amount", move_total: bool = False, extra: str = "remark") -> list:
    """A second version: same paths plus a remark, optionally total retyped or moved."""
    g = copy.deepcopy(GROUPS)
    items = g[0]["items"]
    items.append({"kind": "field", "key": extra, "name": extra.title(), "type": "string"})
    for item in items:
        if item["key"] == "total":
            item["type"] = total_type
    if move_total:
        items[:] = [i for i in items if i["key"] != "total"]
        g.append(
            {
                "key": "totals",
                "name": "Totals",
                "items": [{"kind": "field", "key": "total", "name": "Total", "type": "amount"}],
            }
        )
    return g


def card(
    cid: str = "c_1",
    *,
    type: str = "bar",
    template_id: int = 1,
    version_ids: list[int] | None = None,
    grain: str = "document",
    table_key: str | None = None,
    measure: str | None = "header.total",
    agg: str = "sum",
    dimension: dict | None = None,
    series: str | None = None,
    date_field: str | None = None,
    unit: dict | None = None,
    confirmed: list[str] | None = None,
    layout: dict | None = None,
    style: dict | None = None,
    title: str = "Card",
) -> dict:
    if dimension is None:
        dimension = (
            {"kind": "none", "path": None, "time_grain": None}
            if type in ("metric", "table")
            else {"kind": "category", "path": "header.vendor", "time_grain": None}
        )
    if unit is None and agg != "count":
        unit = {"mode": "fixed", "value": "THB", "path": None}
    return {
        "id": cid,
        "type": type,
        "title": title,
        "layout": layout or {"x": 0, "y": 0, "w": 6, "h": 4},
        "data": {
            "template_id": template_id,
            "template_version_ids": version_ids or [10],
            "grain": grain,
            "table_key": table_key,
            "measure": {"path": None if agg == "count" else measure, "agg": agg},
            "dimension": dimension,
            "series": {"path": series} if series else None,
            "date_field": {"path": date_field} if date_field else None,
            "unit": unit,
            "confirmed_paths": confirmed or [],
        },
        "style": style or {"precision": 2, "colors": ["#123456"], "legend": True},
    }


def page(*cards: dict, period: dict | None = None) -> dict:
    """Cards are laid out one per grid row so they never overlap."""
    out = []
    for i, c in enumerate(cards):
        c = copy.deepcopy(c)
        c["layout"] = {**c["layout"], "y": i * 4}
        out.append(c)
    return {
        "version": 1,
        "period": period or {"mode": "current_year", "from": None, "to": None},
        "grid": {"cols": 12, "row_height": 80},
        "cards": out,
    }
