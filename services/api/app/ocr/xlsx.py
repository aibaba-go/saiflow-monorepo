"""A confirmed result as XLSX (FR-ENTRY-015, PRD §4.4): grouped header fields as
label | value rows, then each line table with its column headers. Every cell is text
(leading zeros and the amount text kept, exactly as written). Text that Excel would run
as a formula is marked with the quote-prefix style, so it stays text even when edited,
without a visible apostrophe (main `_safe_cell` added one). A hidden sheet `_saiflow`
carries the template
reference in A1: `template:<id>:v<version>` or `generic`."""

import io
import re
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

_PLAIN_NUMBER = re.compile(r"^-?[\d,]+(\.\d+)?$")
LABEL_FILL = PatternFill("solid", fgColor="FFE8EDFF")
BOLD = Font(bold=True)
TITLE = Font(bold=True, size=14)


def safe_cell(value: Any) -> str:
    return "" if value is None else value if isinstance(value, str) else str(value)


def _formula_like(text: str) -> bool:
    return text[:1] in ("=", "+", "-", "@") and not _PLAIN_NUMBER.match(text)


def label(item: dict, language: str) -> str:
    names = item.get("names") or {}
    return names.get(language) or item.get("name") or item.get("key") or ""


def _put(ws, row: int, col: int, value: Any, *, bold: bool = False, fill: bool = False):
    cell = ws.cell(row=row, column=col)
    text = safe_cell(value)
    cell.value = text
    cell.data_type = "s"
    if _formula_like(text):
        cell.quotePrefix = True
    if bold:
        cell.font = BOLD
    if fill:
        cell.fill = LABEL_FILL
    return cell


def _template_sections(groups: list[dict], structured: dict, language: str):
    """(field sections, table sections) in the template's order."""
    data = structured if isinstance(structured, dict) else {}
    fields, tables = [], []
    for group in groups:
        gval = data.get(group["key"]) if isinstance(data.get(group["key"]), dict) else {}
        rows = []
        for item in group["items"]:
            if item["kind"] == "field":
                rows.append((label(item, language), gval.get(item["key"])))
                continue
            cols = item.get("columns") or []
            lines = gval.get(item["key"]) if isinstance(gval.get(item["key"]), list) else []
            tables.append(
                (
                    label(item, language),
                    [label(c, language) for c in cols],
                    [
                        [(r if isinstance(r, dict) else {}).get(c["key"]) for c in cols]
                        for r in lines
                    ],
                )
            )
        if rows:
            fields.append((label(group, language), rows))
    return fields, tables


def _generic_sections(structured: Any):
    """Groups of key/value pairs and tables, in the saved order (FR-OCR-023, A6)."""
    data = structured if isinstance(structured, dict) else {"result": structured}
    fields, tables = [], []
    loose = []
    for key, value in data.items():
        if isinstance(value, dict):
            rows, nested = [], []
            for k, v in value.items():
                if isinstance(v, list) and v and all(isinstance(r, dict) for r in v):
                    nested.append((k, v))
                else:
                    rows.append((k, v if not isinstance(v, (dict, list)) else str(v)))
            if rows:
                fields.append((key, rows))
            for name, lines in nested:
                tables.append(_table(name, lines))
        elif isinstance(value, list) and value and all(isinstance(r, dict) for r in value):
            tables.append(_table(key, value))
        else:
            loose.append((key, value if not isinstance(value, (dict, list)) else str(value)))
    if loose:
        fields.insert(0, (None, loose))
    return fields, tables


def _table(name: str, lines: list[dict]):
    headers: list[str] = []
    for row in lines:
        for k in row:
            if k not in headers:
                headers.append(k)
    return name, headers, [[row.get(h) for h in headers] for row in lines]


def build_xlsx(
    structured: Any,
    template: tuple[str, list[dict]] | None,
    language: str,
    template_ref: tuple[int, int] | None,
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Document"
    if template is not None:
        title, groups = template
        fields, tables = _template_sections(groups, structured, language)
    else:
        title = "Document"
        fields, tables = _generic_sections(structured)
    row = 1
    _put(ws, row, 1, title).font = TITLE
    row += 2
    for section, pairs in fields:
        if section is not None:
            _put(ws, row, 1, section, bold=True)
            row += 1
        for name, value in pairs:
            _put(ws, row, 1, name, bold=True, fill=True)
            _put(ws, row, 2, value)
            row += 1
        row += 1
    for section, headers, lines in tables:
        _put(ws, row, 1, section, bold=True)
        row += 1
        for col, header in enumerate(headers, start=1):
            _put(ws, row, col, header, bold=True, fill=True)
        row += 1
        for line in lines:
            for col, value in enumerate(line, start=1):
                _put(ws, row, col, value)
            row += 1
        row += 1
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 40
    ref = wb.create_sheet("_saiflow")
    ref["A1"] = f"template:{template_ref[0]}:v{template_ref[1]}" if template_ref else "generic"
    ref.sheet_state = "hidden"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
