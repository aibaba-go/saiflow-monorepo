"""Amount checks from template roles (FR-OCR-013): flagged, never corrected; values that do
not parse are skipped (Review Focus 3)."""

import json
from pathlib import Path

import pytest

from app.ocr import amounts
from app.ocr.templates.schema import canonical_groups, parse_template

SEED = Path(__file__).resolve().parents[3] / "app" / "ocr" / "seed"


def groups(name: str) -> list[dict]:
    return canonical_groups(
        parse_template(json.loads((SEED / f"{name}.json").read_text(encoding="utf-8")))
    )


TAX = groups("tax_invoice")
BILL = groups("billing_note")


def tax(lines, summary=None):
    return {"goods": {"line_items": lines}, "summary": summary or {}}


def test_row_mismatch():  # AC-FR-OCR-013-01
    doc = tax([{"quantity": "3", "unit_price": "100.00", "amount": "310.00"}])
    assert amounts.check(TAX, doc) == [
        {"path": "goods.line_items[0].amount", "computed": "300.00", "recognised": "310.00"}
    ]


def test_total_mismatch():  # AC-FR-OCR-013-02
    doc = tax(
        [{"amount": "600.00"}, {"amount": "400.00"}],
        {"vat_amount": "70.00", "net_total": "1075.00"},
    )
    assert amounts.check(TAX, doc) == [
        {"path": "summary.net_total", "computed": "1070.00", "recognised": "1075.00"}
    ]


def test_chain_with_subtotal_discount_and_base():
    doc = tax(
        [{"quantity": "2", "unit_price": "500", "amount": "1,000.00"}],
        {
            "sub_total": "1000.00",
            "discount_amount": "100.00",
            "total_before_vat": "900.00",
            "vat_amount": "63.00",
            "net_total": "963.00",
        },
    )
    assert amounts.check(TAX, doc) == []
    doc["summary"]["total_before_vat"] = "950.00"
    issues = amounts.check(TAX, doc)
    assert {
        "path": "summary.total_before_vat",
        "computed": "900.00",
        "recognised": "950.00",
    } in issues


def test_within_tolerance():
    doc = tax([{"quantity": "3", "unit_price": "100.00", "amount": "300.01"}])
    assert amounts.check(TAX, doc) == []


def test_line_discount_skips_row_product():
    doc = tax([{"quantity": "3", "unit_price": "100", "discount": "10%", "amount": "270.00"}])
    assert amounts.check(TAX, doc) == []


@pytest.mark.parametrize("value", [" 100 ", "-", "", None, "฿ 70", "ราว 70", "abc", "1e3"])
def test_messy_values_never_raise(value):  # Review Focus 3
    doc = tax(
        [{"quantity": value, "unit_price": "10", "amount": "100.00"}],
        {"vat_amount": value, "discount_amount": "-10", "net_total": value},
    )
    amounts.check(TAX, doc)  # no exception


def test_unparseable_inputs_skip_their_checks():
    doc = tax([{"quantity": "-", "unit_price": "10", "amount": "999.00"}], {"net_total": "abc"})
    assert amounts.check(TAX, doc) == []


def test_row_without_quantity_skipped():
    doc = tax([{"unit_price": "10", "amount": "100.00"}])
    assert amounts.check(TAX, doc) == []


def test_billing_note_lines_and_total():
    doc = {
        "invoices": {
            "items": [
                {
                    "amount_before_vat": "6230.20",
                    "vat_amount": "436.11",
                    "total_amount": "6,666.31",
                },
                {"amount_before_vat": "100.00", "vat_amount": "7.00", "total_amount": "108.00"},
            ]
        },
        "summary": {"total_amount": "6774.31"},
    }
    assert amounts.check(BILL, doc) == [
        {"path": "invoices.items[1].total_amount", "computed": "107.00", "recognised": "108.00"}
    ]


def test_generic_or_garbage_structure():
    assert amounts.check(TAX, None) == []
    assert amounts.check(TAX, {"goods": "x", "summary": []}) == []


@pytest.mark.parametrize(
    ("discount", "vat", "issue"),
    [
        ("-100.00", "63.00", False),  # a discount printed negative is still a discount
        ("10%", "63.00", False),  # not a number: the checks that need it are skipped
        ("100.00", "VAT 7%", False),
        ("100.00", "63.00", False),
        ("100.00", "70.00", True),  # a real mismatch is still found
    ],
)
def test_discount_and_tax_forms(discount, vat, issue):  # final review 2
    doc = tax(
        [{"amount": "1000.00"}],
        {
            "sub_total": "1000.00",
            "discount_amount": discount,
            "total_before_vat": "900.00",
            "vat_amount": vat,
            "net_total": "963.00",
        },
    )
    assert bool(amounts.check(TAX, doc)) is issue
