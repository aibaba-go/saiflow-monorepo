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
    filled = normalize.fill_structure(
        GROUPS, {"document": {"invoice_no": "IV1"}, "seller": {"name": "A"}}
    )
    missing = normalize.primary_missing(GROUPS, filled)
    assert "document.invoice_date" in missing
    assert "seller.tax_id" in missing
    assert "document.invoice_no" not in missing
    assert all("[" not in path for path in missing)  # table cells are not primary fields


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
