"""Rules this repository adds to the moved modules (ocr-scan-flow Task 4, Review Focus 4):
decimal strings from the LLM, dates to YYYY-MM-DD with Buddhist years converted (FR-OCR-016),
keys outside the template dropped, primary fields, and the TextIn prompt call."""

import json
from pathlib import Path

import httpx

from app.ocr.templates import converter, normalize
from app.ocr.templates.llm import parse_json
from app.ocr.templates.schema import canonical_groups, parse_template
from app.ocr.textin.adapter import run_extraction
from app.ocr.textin.client import TextInClient
from app.ocr.textin.config import TextInSettings

SEED = Path(__file__).resolve().parents[3] / "app" / "ocr" / "seed"
GROUPS = canonical_groups(
    parse_template(json.loads((SEED / "tax_invoice.json").read_text(encoding="utf-8")))
)


def test_llm_floats_stay_strings():
    data = parse_json('{"total": 1234.50, "rate": 0.07, "count": 12345678901234567890}')
    assert data == {"total": "1234.50", "rate": "0.07", "count": 12345678901234567890}
    assert normalize.normalize_value("amount", data["total"]) == ("1234.50", None)


def test_dates_to_iso_with_buddhist_years_converted():
    assert normalize.normalize_value("date", "06/11/2569") == ("2026-11-06", None)
    assert normalize.normalize_value("date", "6.11.2026") == ("2026-11-06", None)
    assert normalize.normalize_value("date", "2026-11-06") == ("2026-11-06", None)
    assert normalize.normalize_value("date", "22-02-2569") == ("2026-02-22", None)
    assert normalize.normalize_value("date", None) == (None, None)
    value, warning = normalize.normalize_value("date", "next Tuesday")
    assert (value, warning) == ("next Tuesday", normalize.TYPE_MISMATCH)
    value, warning = normalize.normalize_value("date", "31/02/2026")  # not a real day
    assert warning == normalize.TYPE_MISMATCH


def test_seed_dates_are_date_fields():
    fields = {(g["key"], i["key"]): i.get("type") for g in GROUPS for i in g["items"]}
    assert fields[("document", "invoice_date")] == "date"
    assert fields[("document", "due_date")] == "date"


def test_extra_keys_dropped_with_warning():
    output = {
        "document": {"invoice_no": "IV1", "invoice_date": "01/10/2569", "unknown": "x"},
        "seller": {"name": "A", "tax_id": "1"},
        "buyer": {"name": "B"},
        "summary": {"net_total": "107.00"},
        "stray_group": {"k": "v"},
    }
    structured, warnings, dropped = converter.parse_output(json.dumps(output), GROUPS)
    assert "stray_group" not in structured
    assert "unknown" not in structured["document"]
    assert structured["document"]["invoice_date"] == "2026-10-01"
    assert dropped >= 2


def test_primary_missing_detected():
    """Primary fields (FR-TEMPLATE-006 "是否为主要字段") are their own flag, not "required":
    a tax invoice with no buyer still fits; one without its number or total does not."""
    filled = normalize.fill_structure(
        GROUPS, {"document": {"invoice_no": "IV1"}, "seller": {"name": "A"}}
    )
    assert normalize.primary_missing(GROUPS, filled) == ["summary.net_total"]
    no_buyer = normalize.fill_structure(
        GROUPS, {"document": {"invoice_no": "IV1"}, "summary": {"net_total": "10.00"}}
    )
    assert normalize.primary_missing(GROUPS, no_buyer) == []
    assert "buyer.name" in normalize.required_missing(GROUPS, no_buyer)  # for the confirm gate


def test_primary_falls_back_to_required_without_flags():
    groups = [
        {
            "key": "g",
            "items": [
                {"kind": "field", "key": "a", "required": True},
                {"kind": "field", "key": "b", "required": False},
            ],
        }
    ]
    assert normalize.primary_missing(groups, {"g": {}}) == ["g.a"]


def test_textin_prompt_extraction_parses_llm_json():
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        llm_json = {"invoice_no": "IV1", "items": [{"amount": "10.00"}]}
        return httpx.Response(
            200,
            json={"code": 200, "result": {"llm_json": llm_json, "pages": [{}]}, "duration": 812},
        )

    settings = TextInSettings(textin_app_id="app", textin_secret_code="secret")
    client = TextInClient(settings, transport=httpx.MockTransport(handle))
    result = run_extraction(client, filename="a.png", content=b"\x89PNG", params={})
    assert result["structured"]["invoice_no"] == "IV1"
    assert result["page_count"] == 1
    assert seen[0].headers["x-ti-app-id"] == "app"
    body = json.loads(seen[0].content)
    assert set(body) == {"file", "prompt"}


def test_billing_note_without_its_own_number_fits():
    """A billing note often has no number of its own (e.g. Samsap's ใบวางบิล): its date and
    total are what every billing note carries."""
    import json
    from pathlib import Path

    from app.ocr.templates.schema import canonical_groups, parse_template

    seed = Path(__file__).resolve().parents[3] / "app" / "ocr" / "seed" / "billing_note.json"
    groups = canonical_groups(parse_template(json.loads(seed.read_text(encoding="utf-8"))))
    doc = {"document": {"billing_date": "22.02.2024"}, "summary": {"total_amount": "6666.31"}}
    assert normalize.primary_missing(groups, normalize.fill_structure(groups, doc)) == []
    assert normalize.primary_missing(groups, {"document": {"billing_no": "B1"}}) != []
