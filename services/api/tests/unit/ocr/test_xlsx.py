"""XLSX layout of a confirmed result (FR-ENTRY-015, PRD §4.4)."""

import io
import json
from pathlib import Path

import pytest
from openpyxl import load_workbook

from app.ocr.templates.schema import canonical_groups, parse_template
from app.ocr.xlsx import build_xlsx

SEED = Path(__file__).resolve().parents[3] / "app" / "ocr" / "seed"
GROUPS = canonical_groups(
    parse_template(json.loads((SEED / "tax_invoice.json").read_text(encoding="utf-8")))
)
STRUCTURED = {
    "document": {"invoice_no": "007123", "invoice_date": "2026-10-01"},
    "seller": {"name": '=HYPERLINK("x")', "tax_id": "0105500000001", "phone": "+66 81 234 5678"},
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
    # a formula never runs, and no visible apostrophe is added (final review 7)
    formula = [c for row in main.iter_rows() for c in row if c.value == '=HYPERLINK("x")']
    assert formula and formula[0].data_type == "s" and formula[0].quotePrefix
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


def test_text_kept_as_written():
    rows, _, _ = _cells(build_xlsx(STRUCTURED, ("Tax Invoice", GROUPS), "en", (12, 3)))
    flat = [v for r in rows for v in r if v is not None]
    assert "+66 81 234 5678" in flat  # not "'+66 ..."


@pytest.mark.parametrize("language", ["zh", "en", "th"])
@pytest.mark.parametrize("location", ["root", "group", "root-table", "group-table"])
def test_generic_big_integer_digits_are_text_in_every_location(language, location):
    # AC-FR-OCR-025-05: the worker has converted unsafe integers to exact decimal strings.
    values = {
        "big": "12345678901234567890",
        "negative": "-12345678901234567890",
        "above_max": "9007199254740992",
        "below_min": "-9007199254740992",
        "safe_max": 9007199254740991,
        "safe_min": -9007199254740991,
        "zero": 0,
        "flag": False,
        "amount": "123456789012.30",
        "optional": None,
    }
    generic = {
        "root": values,
        "group": {"seller": values},
        "root-table": {"items": [values]},
        "group-table": {"goods": {"items": [values]}},
    }[location]
    _, hidden, sheet = _cells(build_xlsx(generic, None, language, None))
    cells = [cell for row in sheet.iter_rows() for cell in row]
    for value in values.values():
        if value is None:
            continue
        text_value = str(value)
        matches = [c for c in cells if c.value == text_value]
        assert len(matches) == 1, (text_value, [c.value for c in cells])
        assert matches[0].data_type == "s"  # Excel must not round 20-digit values.
        if text_value.startswith("-"):
            assert not matches[0].quotePrefix  # a negative number is not a formula.
    assert hidden["_saiflow"]["A1"].value == "generic"
    assert values["flag"] is False and type(values["safe_max"]) is int


@pytest.mark.parametrize("language", ["zh", "en", "th"])
def test_ocr_text_fallback_keeps_languages_newlines_and_empty_page(language):
    # AC-FR-OCR-026-02/03: multiline values are not stripped or turned into business fields.
    original = "  ภาษาไทย\n中文原文 English\n12345678901234567890\n-12345678901234567890\n"
    fallback = {"ocr_text": {"page_1": original, "page_2": ""}}
    rows, hidden, sheet = _cells(build_xlsx(fallback, None, language, None))
    first = next(row for row in sheet.iter_rows() if row[0].value == "page_1")
    second = next(row for row in sheet.iter_rows() if row[0].value == "page_2")
    assert first[1].value == original and first[1].data_type == "s"
    assert second[1].value in (None, "")
    flat = [v for row in rows for v in row if v is not None]
    assert flat.index("page_1") < flat.index("page_2")
    assert "invoice_no" not in flat and "amount" not in flat
    assert hidden["_saiflow"]["A1"].value == "generic"
    assert fallback == {"ocr_text": {"page_1": original, "page_2": ""}}


def test_generic_empty_tables_do_not_create_line_items():
    # AC-FR-OCR-025-03: empty root/group tables stay empty; there are no fabricated rows.
    generic = {"items": [], "summary": {"net_total": "0.00", "lines": []}}
    rows, _, _ = _cells(build_xlsx(generic, None, "en", None))
    flat = [v for row in rows for v in row if v is not None]
    assert "0.00" in flat
    assert "description" not in flat and "seq" not in flat and "None" not in flat
    assert generic["items"] == [] and generic["summary"]["lines"] == []
