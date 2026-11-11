"""Report page configuration (template-report-management, contract §5): the field catalog
derived from template versions (FR-REPORT-006) and the validation of a page and its cards
(FR-REPORT-005/008/009/010/012/013/014/017). Pure functions: no database, no clock.

Paths: "<group>.<item>" is a header field, "<group>.<table>.<column>" a column of a table;
a table is named by "<group>.<table>". A field is compatible across the selected versions
only when every version has the same path with the same type (no same-name guessing).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from app.errors import AppError

CARD_TYPES = ("bar", "line", "pie", "donut", "metric", "table")
AGGS = ("sum", "avg", "min", "max", "count")
GRAINS = ("document", "table")
DIM_KINDS = ("date", "category", "none")
TIME_GRAINS = ("day", "month", "year")
FIELD_TYPES = ("string", "integer", "decimal", "amount", "date")
NUMERIC_TYPES = frozenset({"integer", "decimal", "amount"})
PROPORTION_TYPES = frozenset({"pie", "donut"})

MAX_CARDS = 30
MAX_CONFIG_BYTES = 256 * 1024
MAX_VERSIONS_PER_CARD = 20
MAX_TITLE = 200
MAX_NAME = 120
MAX_UNIT = 16
MAX_COLORS = 20
GRID_COLS = 12
MAX_Y = 1000
MIN_H, MAX_H = 2, 12
MIN_PRECISION, MAX_PRECISION = 0, 6
DEFAULT_PRECISION = 2

CARD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
ISO_DATE_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_PART_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# Thailand has no daylight saving time: Asia/Bangkok is always UTC+7
BANGKOK = timedelta(hours=7)
THB_ALIASES = ("฿", "บาท", "THB", "BAHT")


def empty_config() -> dict:
    return {
        "version": 1,
        "period": {"mode": "current_year", "from": None, "to": None},
        "grid": {"cols": GRID_COLS, "row_height": 80},
        "cards": [],
    }


def normalize_unit(value: str | None) -> str | None:
    """The unit label as compared and shown: trimmed, upper case, THB markers as "THB"."""
    if value is None:
        return None
    text = value.strip().upper()
    if not text:
        return None
    return "THB" if text in THB_ALIASES else text


# ---------------------------------------------------------------- catalog


@dataclass(frozen=True)
class FieldDef:
    path: str
    name: str
    names: dict | None
    type: str
    grain: str  # "document" | "table"
    table_key: str | None


@dataclass(frozen=True)
class TableDef:
    table_key: str
    name: str
    names: dict | None
    columns: tuple[str, ...]


def version_fields(groups: Any) -> tuple[dict[str, FieldDef], dict[str, TableDef]]:
    """Header fields and table columns of one template version, by path."""
    fields: dict[str, FieldDef] = {}
    tables: dict[str, TableDef] = {}
    for group in groups if isinstance(groups, list) else []:
        if not isinstance(group, dict) or not isinstance(group.get("key"), str):
            continue
        gkey = group["key"]
        for item in group.get("items") or []:
            if not isinstance(item, dict) or not isinstance(item.get("key"), str):
                continue
            ikey = item["key"]
            if item.get("kind") == "table":
                tkey = f"{gkey}.{ikey}"
                cols = []
                for col in item.get("columns") or []:
                    if not isinstance(col, dict) or not isinstance(col.get("key"), str):
                        continue
                    cols.append(col["key"])
                    path = f"{tkey}.{col['key']}"
                    fields[path] = FieldDef(
                        path,
                        str(col.get("name") or col["key"]),
                        col.get("names") if isinstance(col.get("names"), dict) else None,
                        str(col.get("type") or "string"),
                        "table",
                        tkey,
                    )
                tables[tkey] = TableDef(
                    tkey,
                    str(item.get("name") or ikey),
                    item.get("names") if isinstance(item.get("names"), dict) else None,
                    tuple(cols),
                )
            else:
                path = f"{gkey}.{ikey}"
                fields[path] = FieldDef(
                    path,
                    str(item.get("name") or ikey),
                    item.get("names") if isinstance(item.get("names"), dict) else None,
                    str(item.get("type") or "string"),
                    "document",
                    None,
                )
    return fields, tables


@dataclass(frozen=True)
class VersionDef:
    id: int
    template_id: int
    version: int
    groups: Any


def catalog(versions: list[VersionDef]) -> dict:
    """The grains and fields of the selected versions; names come from the highest version,
    `compatible` = present in every selected version with the same type."""
    ordered = sorted(versions, key=lambda v: v.version, reverse=True)  # highest first
    parsed = [(v.id, *version_fields(v.groups)) for v in ordered]
    all_ids = sorted(v.id for v in versions)
    fields_out: dict[str, dict] = {}
    types: dict[str, set[str]] = {}
    tables_out: dict[str, dict] = {}
    for vid, fields, tables in parsed:
        for path, f in fields.items():
            entry = fields_out.setdefault(
                path,
                {
                    "path": path,
                    "name": f.name,
                    "names": f.names,
                    "type": f.type,
                    "grain": f.grain,
                    "table_key": f.table_key,
                    "versions": [],
                },
            )
            entry["versions"].append(vid)
            types.setdefault(path, set()).add(f.type)
        for tkey, t in tables.items():
            entry = tables_out.setdefault(
                tkey,
                {
                    "grain": "table",
                    "table_key": tkey,
                    "name": t.name,
                    "names": t.names,
                    "versions": [],
                },
            )
            entry["versions"].append(vid)
    out_fields = []
    for path, entry in fields_out.items():
        entry["versions"] = sorted(entry["versions"])
        entry["compatible"] = entry["versions"] == all_ids and len(types[path]) == 1
        out_fields.append(entry)
    grains: list[dict] = [{"grain": "document", "versions": all_ids, "compatible": True}]
    for entry in tables_out.values():
        entry["versions"] = sorted(entry["versions"])
        entry["compatible"] = entry["versions"] == all_ids
        grains.append(entry)
    return {"grains": grains, "fields": out_fields}


# ---------------------------------------------------------------- card specification


@dataclass(frozen=True)
class Slot:
    """One template value a card reads: a header field (keys = (group, item), read with
    `doc #> keys`) or a column of the selected table (keys = (column,), read from the row)."""

    path: str
    source: str  # "header" | "column"
    keys: tuple[str, ...]
    type: str


@dataclass(frozen=True)
class CardSpec:
    id: str
    type: str
    title: str
    template_id: int
    version_ids: tuple[int, ...]
    grain: str
    table: tuple[str, str] | None
    columns: tuple[str, ...]  # every column of the selected table in the selected versions
    agg: str
    measure: Slot | None
    dim_kind: str
    dim: Slot | None
    time_grain: str | None
    series: Slot | None
    date_field: Slot | None
    unit_mode: str | None  # None for count
    unit_value: str | None
    unit: Slot | None
    precision: int

    @property
    def period_slot(self) -> Slot | None:
        """The date the page period filters on: the date field, else the date axis."""
        if self.date_field is not None:
            return self.date_field
        return self.dim if self.dim_kind == "date" else None

    @property
    def table_key(self) -> str | None:
        return ".".join(self.table) if self.table else None


class _Errors:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, card_id: str | None, path: str, message: str) -> None:
        self.items.append({"card_id": card_id, "path": path, "message": message})


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _parse_iso(v: Any) -> date | None:
    if not isinstance(v, str) or not ISO_DATE_RE.match(v):
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _validate_period(period: Any, errs: _Errors) -> None:
    if period is None:
        return
    if not isinstance(period, dict):
        errs.add(None, "period", "period must be an object")
        return
    mode = period.get("mode", "current_year")
    if mode == "current_year":
        for k in ("from", "to"):
            if period.get(k) is not None:
                errs.add(None, f"period.{k}", "current_year takes no fixed dates")
        return
    if mode != "fixed":
        errs.add(None, "period.mode", "period mode must be current_year or fixed")
        return
    start, end = _parse_iso(period.get("from")), _parse_iso(period.get("to"))
    if start is None:
        errs.add(None, "period.from", "a fixed period needs a valid from date (YYYY-MM-DD)")
    if end is None:
        errs.add(None, "period.to", "a fixed period needs a valid to date (YYYY-MM-DD)")
    if start is not None and end is not None and start > end:
        errs.add(None, "period", "the period ends before it starts")


def _validate_grid(grid: Any, errs: _Errors) -> None:
    if grid is None:
        return
    if not isinstance(grid, dict):
        errs.add(None, "grid", "grid must be an object")
        return
    if grid.get("cols", GRID_COLS) != GRID_COLS:
        errs.add(None, "grid.cols", "the grid has 12 columns")
    rh = grid.get("row_height", 80)
    if not _is_int(rh) or not 20 <= rh <= 400:
        errs.add(None, "grid.row_height", "row height must be an integer from 20 to 400")


def _layout(card: dict, p: str, cid: str | None, errs: _Errors) -> tuple[int, int, int, int] | None:
    layout = card.get("layout")
    if not isinstance(layout, dict):
        errs.add(cid, f"{p}.layout", "layout must be an object")
        return None
    vals = {k: layout.get(k) for k in ("x", "y", "w", "h")}
    bad = [k for k, v in vals.items() if not _is_int(v)]
    for k in bad:
        errs.add(cid, f"{p}.layout.{k}", "must be an integer")
    if bad:
        return None
    x, y, w, h = vals["x"], vals["y"], vals["w"], vals["h"]
    ok = True
    if x < 0 or x >= GRID_COLS:
        errs.add(cid, f"{p}.layout.x", "x must be from 0 to 11")
        ok = False
    if y < 0 or y > MAX_Y:
        errs.add(cid, f"{p}.layout.y", f"y must be from 0 to {MAX_Y}")
        ok = False
    if w < 1 or x + w > GRID_COLS:
        errs.add(cid, f"{p}.layout.w", "the card must fit the 12 grid columns")
        ok = False
    if not MIN_H <= h <= MAX_H:
        errs.add(cid, f"{p}.layout.h", "h must be from 2 to 12")
        ok = False
    return (x, y, w, h) if ok else None


def _style(card: dict, p: str, cid: str | None, errs: _Errors) -> int:
    style = card.get("style")
    if style is None:
        return DEFAULT_PRECISION
    if not isinstance(style, dict):
        errs.add(cid, f"{p}.style", "style must be an object")
        return DEFAULT_PRECISION
    precision = style.get("precision", DEFAULT_PRECISION)
    if not _is_int(precision) or not MIN_PRECISION <= precision <= MAX_PRECISION:
        errs.add(cid, f"{p}.style.precision", "precision must be an integer from 0 to 6")
        precision = DEFAULT_PRECISION
    colors = style.get("colors", [])
    if not isinstance(colors, list) or len(colors) > MAX_COLORS:
        errs.add(cid, f"{p}.style.colors", "colors must be a list of at most 20 colors")
    else:
        for i, c in enumerate(colors):
            if not isinstance(c, str) or not COLOR_RE.match(c):
                errs.add(cid, f"{p}.style.colors[{i}]", "a color is #RRGGBB")
    for k in ("legend", "labels", "stacked"):
        if k in style and not isinstance(style[k], bool):
            errs.add(cid, f"{p}.style.{k}", "must be true or false")
    axis = style.get("axis")
    if axis is not None:
        if not isinstance(axis, dict):
            errs.add(cid, f"{p}.style.axis", "axis must be an object")
        else:
            for k in ("show_x", "show_y"):
                if k in axis and not isinstance(axis[k], bool):
                    errs.add(cid, f"{p}.style.axis.{k}", "must be true or false")
            for k in ("x_title", "y_title"):
                v = axis.get(k)
                if v is not None and (not isinstance(v, str) or len(v) > MAX_TITLE):
                    errs.add(cid, f"{p}.style.axis.{k}", "must be text up to 200 characters")
    return precision


class _Fields:
    """The selected versions of one card: a path is usable only when every version has it
    with the same type."""

    def __init__(self, versions: list[VersionDef]):
        self.parsed = [version_fields(v.groups) for v in versions]

    def table_columns(self, tkey: str) -> tuple[str, ...] | None:
        cols: list[str] = []
        for _, tables in self.parsed:
            t = tables.get(tkey)
            if t is None:
                return None
            cols.extend(c for c in t.columns if c not in cols)
        return tuple(cols)

    def type_of(self, path: str) -> tuple[str | None, str | None]:
        """(type, error message)."""
        found = [fields.get(path) for fields, _ in self.parsed]
        if all(f is None for f in found):
            return None, "the field does not exist in the selected template versions"
        if any(f is None for f in found):
            return None, "the field is not in every selected version"
        kinds = {f.type for f in found if f is not None}
        if len(kinds) != 1:
            return None, "the field has different types in the selected versions"
        return kinds.pop(), None


def _slot(
    raw: Any,
    p: str,
    cid: str | None,
    errs: _Errors,
    fields: _Fields | None,
    *,
    grain: str | None,
    table: tuple[str, str] | None,
    types: set[str] | frozenset[str],
    column_only: bool = False,
    used: list[str],
) -> Slot | None:
    if not isinstance(raw, str):
        errs.add(cid, p, "a field path is required")
        return None
    parts = raw.split(".")
    if len(parts) not in (2, 3) or not all(_PART_RE.match(x) for x in parts):
        errs.add(cid, p, "a field path is group.item or group.table.column")
        return None
    if len(parts) == 3:
        if grain != "table" or table is None or tuple(parts[:2]) != table:
            errs.add(cid, p, "a column can only be used from the selected table (table grain)")
            return None
        source, keys = "column", (parts[2],)
    else:
        if column_only:
            errs.add(cid, p, "a table grain measure must be a column of the selected table")
            return None
        source, keys = "header", (parts[0], parts[1])
    if fields is None:
        return None
    ftype, msg = fields.type_of(raw)
    if msg:
        errs.add(cid, p, msg)
        return None
    if ftype not in types:
        errs.add(cid, p, f"a field of type {ftype} cannot be used here")
        return None
    used.append(raw)
    return Slot(raw, source, keys, ftype)  # type: ignore[arg-type]


def _card(
    card: Any,
    i: int,
    versions: Mapping[int, VersionDef],
    errs: _Errors,
    seen_ids: set[str],
    boxes: list[tuple[str, tuple[int, int, int, int]]],
) -> CardSpec | None:
    p = f"cards[{i}]"
    if not isinstance(card, dict):
        errs.add(None, p, "a card must be an object")
        return None
    before = len(errs.items)
    raw_id = card.get("id")
    cid: str | None = raw_id if isinstance(raw_id, str) and CARD_ID_RE.match(raw_id) else None
    if cid is None:
        errs.add(None, f"{p}.id", "a card id is 1-64 letters, digits, _ or -")
    elif cid in seen_ids:
        errs.add(cid, f"{p}.id", "card ids must be unique in the page")
    else:
        seen_ids.add(cid)
    ctype = card.get("type")
    if ctype not in CARD_TYPES:
        errs.add(cid, f"{p}.type", "type must be one of " + ", ".join(CARD_TYPES))
        ctype = None
    title = card.get("title", "")
    if not isinstance(title, str) or len(title) > MAX_TITLE:
        errs.add(cid, f"{p}.title", "title must be text up to 200 characters")
        title = ""
    box = _layout(card, p, cid, errs)
    if box is not None:
        x, y, w, h = box
        for other_id, (ox, oy, ow, oh) in boxes:
            if x < ox + ow and ox < x + w and y < oy + oh and oy < y + h:
                errs.add(cid, f"{p}.layout", f"the card overlaps card {other_id}")
                break
        boxes.append((cid or p, box))
    precision = _style(card, p, cid, errs)

    data = card.get("data")
    dp = f"{p}.data"
    if not isinstance(data, dict):
        errs.add(cid, dp, "data must be an object")
        return None
    used: list[str] = []

    template_id = data.get("template_id")
    if not _is_int(template_id) or template_id <= 0:
        errs.add(cid, f"{dp}.template_id", "a template is required")
        template_id = None
    vids = data.get("template_version_ids")
    selected: list[VersionDef] = []
    if (
        not isinstance(vids, list)
        or not 1 <= len(vids) <= MAX_VERSIONS_PER_CARD
        or not all(_is_int(v) and v > 0 for v in vids)
        or len(set(vids)) != len(vids)
    ):
        errs.add(cid, f"{dp}.template_version_ids", "choose 1-20 distinct template versions")
        vids = []
    for j, vid in enumerate(vids):
        v = versions.get(vid)
        if v is None:
            errs.add(cid, f"{dp}.template_version_ids[{j}]", "the version is not available")
        elif template_id is not None and v.template_id != template_id:
            errs.add(cid, f"{dp}.template_version_ids[{j}]", "the version is of another template")
        else:
            selected.append(v)
    fields = _Fields(selected) if selected and len(selected) == len(vids) else None

    grain = data.get("grain")
    if grain not in GRAINS:
        errs.add(cid, f"{dp}.grain", "grain must be document or table")
        grain = None
    table: tuple[str, str] | None = None
    columns: tuple[str, ...] = ()
    tkey = data.get("table_key")
    if grain == "table":
        parts = tkey.split(".") if isinstance(tkey, str) else []
        if len(parts) != 2 or not all(_PART_RE.match(x) for x in parts):
            errs.add(cid, f"{dp}.table_key", "a table grain needs a table (group.table)")
        else:
            table = (parts[0], parts[1])
            if fields is not None:
                cols = fields.table_columns(tkey)
                if cols is None:
                    errs.add(cid, f"{dp}.table_key", "the table is not in every selected version")
                    table = None
                else:
                    columns = cols
                    used.append(tkey)
    elif grain == "document" and tkey is not None:
        errs.add(cid, f"{dp}.table_key", "a document grain takes no table")
    slot_grain = grain if (grain != "table" or table is not None) else None

    def slot(raw, path, types, **kw):
        return _slot(
            raw,
            path,
            cid,
            errs,
            fields,
            grain=slot_grain,
            table=table,
            types=types,
            used=used,
            **kw,
        )

    measure_raw = data.get("measure")
    agg, measure = None, None
    if not isinstance(measure_raw, dict):
        errs.add(cid, f"{dp}.measure", "a measure is required")
    else:
        agg = measure_raw.get("agg")
        if agg not in AGGS:
            errs.add(cid, f"{dp}.measure.agg", "agg must be one of " + ", ".join(AGGS))
            agg = None
        elif agg == "count":
            if measure_raw.get("path") is not None:
                errs.add(cid, f"{dp}.measure.path", "count takes no field")
        else:
            measure = slot(
                measure_raw.get("path"),
                f"{dp}.measure.path",
                NUMERIC_TYPES,
                column_only=grain == "table",
            )

    dim_raw = data.get("dimension")
    dim_kind, dim, time_grain = "none", None, None
    if dim_raw is None:
        dim_raw = {"kind": "none"}
    if not isinstance(dim_raw, dict):
        errs.add(cid, f"{dp}.dimension", "dimension must be an object")
    else:
        dim_kind = dim_raw.get("kind", "none")
        if dim_kind not in DIM_KINDS:
            errs.add(cid, f"{dp}.dimension.kind", "kind must be date, category or none")
            dim_kind = "none"
        elif dim_kind == "none":
            if dim_raw.get("path") is not None:
                errs.add(cid, f"{dp}.dimension.path", "no dimension takes no field")
        elif dim_kind == "date":
            dim = slot(dim_raw.get("path"), f"{dp}.dimension.path", {"date"})
            time_grain = dim_raw.get("time_grain")
            if time_grain not in TIME_GRAINS:
                errs.add(cid, f"{dp}.dimension.time_grain", "time grain must be day, month or year")
                time_grain = None
        else:
            dim = slot(dim_raw.get("path"), f"{dp}.dimension.path", {"string"})
        if dim_kind != "date" and dim_raw.get("time_grain") is not None:
            errs.add(cid, f"{dp}.dimension.time_grain", "only a date dimension has a time grain")
    if ctype == "metric" and dim_kind != "none":
        errs.add(cid, f"{dp}.dimension.kind", "a metric card has no dimension")
    if ctype in ("bar", "line", "pie", "donut") and dim_kind == "none":
        errs.add(cid, f"{dp}.dimension.kind", "this chart needs a date or category dimension")

    series = None
    series_raw = data.get("series")
    if series_raw is not None:
        if ctype in ("metric", "pie", "donut"):
            errs.add(cid, f"{dp}.series", "this chart has no series")
        elif not isinstance(series_raw, dict):
            errs.add(cid, f"{dp}.series", "series must be an object or null")
        else:
            series = slot(series_raw.get("path"), f"{dp}.series.path", {"string"})
            if series is not None and dim is not None and series.path == dim.path:
                errs.add(cid, f"{dp}.series.path", "the series must differ from the dimension")
                series = None

    date_field = None
    df_raw = data.get("date_field")
    if df_raw is not None:
        if not isinstance(df_raw, dict):
            errs.add(cid, f"{dp}.date_field", "date_field must be an object or null")
        else:
            date_field = slot(df_raw.get("path"), f"{dp}.date_field.path", {"date"})

    unit_mode, unit_value, unit = None, None, None
    unit_raw = data.get("unit")
    if agg is not None and agg != "count":
        if not isinstance(unit_raw, dict):
            errs.add(cid, f"{dp}.unit", "the measure needs a currency or unit")
        else:
            unit_mode = unit_raw.get("mode")
            if unit_mode == "fixed":
                value = unit_raw.get("value")
                if not isinstance(value, str) or not 1 <= len(value.strip()) <= MAX_UNIT:
                    errs.add(cid, f"{dp}.unit.value", "a fixed unit is 1-16 characters")
                else:
                    unit_value = normalize_unit(value)
                if unit_raw.get("path") is not None:  # a unit field the fixed label must match
                    unit = slot(unit_raw.get("path"), f"{dp}.unit.path", {"string"})
            elif unit_mode == "field":
                unit = slot(unit_raw.get("path"), f"{dp}.unit.path", {"string"})
            else:
                errs.add(cid, f"{dp}.unit.mode", "unit mode must be fixed or field")
                unit_mode = None

    confirmed = data.get("confirmed_paths", [])
    if not isinstance(confirmed, list) or not all(isinstance(c, str) for c in confirmed):
        errs.add(cid, f"{dp}.confirmed_paths", "confirmed_paths must be a list of paths")
        confirmed = []
    if len(vids) > 1:
        for path in dict.fromkeys(used):
            if path not in confirmed:
                errs.add(
                    cid,
                    f"{dp}.confirmed_paths",
                    f"confirm that {path} means the same in every selected version",
                )

    if len(errs.items) != before or fields is None:
        return None
    return CardSpec(
        id=cid,  # type: ignore[arg-type]
        type=ctype,  # type: ignore[arg-type]
        title=title,
        template_id=template_id,  # type: ignore[arg-type]
        version_ids=tuple(sorted(vids)),
        grain=grain,  # type: ignore[arg-type]
        table=table,
        columns=columns,
        agg=agg,  # type: ignore[arg-type]
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
    )


@dataclass
class Validation:
    cards: dict[str, CardSpec]  # valid cards by id
    entries: list[tuple[str | None, CardSpec | None]]  # every card in page order
    errors: list[dict]

    @property
    def card_ids(self) -> list[str | None]:
        return [cid for cid, _ in self.entries]

    def card_errors(self, card_id: str) -> list[dict]:
        return [e for e in self.errors if e["card_id"] == card_id]


def validate(
    config: Any, versions: Mapping[int, VersionDef], *, for_publish: bool = False
) -> Validation:
    """Every problem of the page at once ({card_id, path, message}); `versions` are the
    template versions the caller may bind (anything else is "not available")."""
    errs = _Errors()
    out: dict[str, CardSpec] = {}
    ids: list[tuple[str | None, CardSpec | None]] = []
    if not isinstance(config, dict):
        errs.add(None, "", "the configuration must be an object")
        return Validation(out, ids, errs.items)
    if config.get("version", 1) != 1:
        errs.add(None, "version", "configuration version must be 1")
    _validate_period(config.get("period"), errs)
    _validate_grid(config.get("grid"), errs)
    cards = config.get("cards", [])
    if not isinstance(cards, list):
        errs.add(None, "cards", "cards must be a list")
        cards = []
    if len(cards) > MAX_CARDS:
        errs.add(None, "cards", f"a page has at most {MAX_CARDS} cards")
    if for_publish and not cards:
        errs.add(None, "cards", "add at least one card before publishing")
    seen: set[str] = set()
    boxes: list = []
    for i, card in enumerate(cards):
        spec = _card(card, i, versions, errs, seen, boxes)
        raw_id = card.get("id") if isinstance(card, dict) else None
        ids.append((raw_id if isinstance(raw_id, str) else None, spec))
        if spec is not None:
            out[spec.id] = spec
    return Validation(out, ids, errs.items)


def storable_errors(config: Any) -> list[dict]:
    """What makes a draft impossible to keep at all (everything else is a draft problem)."""
    if not isinstance(config, dict):
        return [{"card_id": None, "path": "", "message": "the configuration must be an object"}]
    size = len(json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode())
    if size > MAX_CONFIG_BYTES:
        return [{"card_id": None, "path": "", "message": "the configuration is larger than 256 KB"}]
    cards = config.get("cards")
    if isinstance(cards, list) and len(cards) > MAX_CARDS:
        return [
            {"card_id": None, "path": "cards", "message": f"a page has at most {MAX_CARDS} cards"}
        ]
    return []


def bound_versions(config: Any) -> set[tuple[int, int]]:
    """(template_id, version_id) pairs the config names, valid or not (for the refs)."""
    out: set[tuple[int, int]] = set()
    cards = config.get("cards") if isinstance(config, dict) else None
    for card in cards if isinstance(cards, list) else []:
        data = card.get("data") if isinstance(card, dict) else None
        if not isinstance(data, dict):
            continue
        tid, vids = data.get("template_id"), data.get("template_version_ids")
        if not _is_int(tid) or not isinstance(vids, list):
            continue
        out.update((tid, v) for v in vids if _is_int(v) and v > 0)
    return out


# ---------------------------------------------------------------- period


def bangkok_today(now: datetime) -> date:
    return (now + BANGKOK).date() if now.tzinfo else now.date()


def period_invalid(fields: list[str] | None = None) -> AppError:
    return AppError(422, "report_period_invalid", "error.report_period_invalid", fields=fields)


def resolve_period(config: Any, override: Any, now: datetime) -> tuple[date, date]:
    """The inclusive period every card with a date uses: a page override (both ends), else
    the configured fixed period, else the current year in Thailand."""
    if override is not None:
        if not isinstance(override, dict):
            raise period_invalid(["period"])
        start, end = _parse_iso(override.get("from")), _parse_iso(override.get("to"))
        if start is None or end is None:
            raise period_invalid([k for k, v in (("from", start), ("to", end)) if v is None])
        if start > end:
            raise period_invalid(["from", "to"])
        return start, end
    period = config.get("period") if isinstance(config, dict) else None
    if isinstance(period, dict) and period.get("mode") == "fixed":
        start, end = _parse_iso(period.get("from")), _parse_iso(period.get("to"))
        if start is not None and end is not None and start <= end:
            return start, end
    year = bangkok_today(now).year
    return date(year, 1, 1), date(year, 12, 31)
