"""XLSX layout of a confirmed result (FR-ENTRY-015, PRD §4.4)."""

import io
import json
from pathlib import Path

from openpyxl import load_workbook

from app.ocr.templates.schema import canonical_groups, parse_template
from app.ocr.xlsx import build_xlsx

SEED = Path(__file__).resolve().parents[3] / "app" / "ocr" / "seed"
GROUPS = canonical_groups(
    parse_template(json.loads((SEED / "tax_invoice.json").read_text(encoding="utf-8")))
)
STRUCTURED = {
    "document": {"invoice_no": "007123", "invoice_date": "2026-10-01"},
    "seller": {"name": '=HYPERLINK("x")', "tax_id": "0105500000001"},
    "goods": {
        "line_items": [{"seq": 1, "description": "A", "quantity": "3", "amount": "15000.00"}]
    },
    "summary": {"net_total": "16050.40"},
}


def _cells(data: bytes) -> tuple[list[list], dict]:
    wb = load_workbook(io.BytesIO(data))
    main = wb.worksheets[0]
    rows = [[c.value for c in row] for row in main.iter_rows()]
    hidden = {ws.title: ws for ws in wb.worksheets[1:]}
    return rows, hidden, main


def test_template_layout_strings_and_hidden_ref():
    data = build_xlsx(STRUCTURED, ("Tax Invoice", GROUPS), "th", (12, 3))
    rows, hidden, main = _cells(data)
    flat = [v for row in rows for v in row if v is not None]
    assert "เลขที่ใบกำกับภาษี" in flat  # Thai field label
    assert "007123" in flat  # leading zeros kept
    number_cells = [c for row in main.iter_rows() for c in row if c.value == "007123"]
    assert number_cells[0].data_type == "s"
    assert '\'=HYPERLINK("x")' in flat  # a formula never runs
    # header groups before the line table
    label_row = next(i for i, r in enumerate(rows) if "เลขที่ใบกำกับภาษี" in r)
    table_row = next(i for i, r in enumerate(rows) if "15000.00" in r)
    assert label_row < table_row
    ref = hidden["_saiflow"]
    assert ref.sheet_state == "hidden"
    assert ref["A1"].value == "template:12:v3"


def test_chinese_and_english_labels():
    rows_zh, _, _ = _cells(build_xlsx(STRUCTURED, ("Tax Invoice", GROUPS), "zh", (12, 3)))
    assert "税务发票号" in [v for r in rows_zh for v in r]
    rows_en, _, _ = _cells(build_xlsx(STRUCTURED, ("Tax Invoice", GROUPS), "en", (12, 3)))
    assert "Tax Invoice No." in [v for r in rows_en for v in r]


def test_generic_keeps_saved_order():
    generic = {"buyer": {"name": "B", "phone": "081"}, "items": [{"x": "1", "y": "2"}]}
    rows, hidden, _ = _cells(build_xlsx(generic, None, "en", None))
    flat = [v for r in rows for v in r if v is not None]
    assert flat.index("buyer") < flat.index("name") < flat.index("phone") < flat.index("items")
    assert hidden["_saiflow"]["A1"].value == "generic"
