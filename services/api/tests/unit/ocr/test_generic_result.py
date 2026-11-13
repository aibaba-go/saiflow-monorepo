"""New generic result boundary and readable fallback (FR-OCR-025/026)."""

import copy
import json

import httpx
import pytest

from app.ocr import worker

RAW = {
    "pages": [
        {"fullTextAnnotation": {"text": "ใบกำกับภาษี\n中文 Invoice 12345678901234567890"}},
        {"fullTextAnnotation": {"text": ""}},
        {"fullTextAnnotation": {"text": "Total 123456789012.30\n"}},
    ],
    "vendor_metadata": {"retained": True},
}
FALLBACK = {
    "ocr_text": {
        "page_1": RAW["pages"][0]["fullTextAnnotation"]["text"],
        "page_2": "",
        "page_3": RAW["pages"][2]["fullTextAnnotation"]["text"],
    }
}
CONFIG = {"DEEPSEEK_API_KEY": "fake", "DEEPSEEK_BASE_URL": "https://llm.invalid"}


def response(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


async def test_valid_groups_tables_and_exact_integer_boundary():
    """AC-FR-OCR-025-01/03/05: protect digits before browser JSON decoding."""
    source = {
        "invoice_no": "IV1",
        "large": 12345678901234567890,
        "seller": {"name": "A", "negative": -12345678901234567890, "missing": None},
        "items": [{"amount": "123456789012.30", "quantity": 9007199254740992}],
        "summary": {
            "zero": 0,
            "paid": False,
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "below_minimum": -9007199254740992,
            "lines": [],
        },
    }
    original = copy.deepcopy(source)
    transport = httpx.MockTransport(lambda _r: response(json.dumps(source)))
    result = await worker._generic(RAW, CONFIG, transport)
    assert result["large"] == "12345678901234567890"
    assert result["seller"]["negative"] == "-12345678901234567890"
    assert result["items"][0]["quantity"] == "9007199254740992"
    assert result["items"][0]["amount"] == "123456789012.30"
    assert result["summary"] == {
        **source["summary"],
        "below_minimum": "-9007199254740992",
    }
    assert type(result["summary"]["maximum"]) is int
    assert type(result["summary"]["paid"]) is bool
    assert source == original


@pytest.mark.parametrize(
    "content",
    [
        "null",
        '"scalar"',
        "12",
        "false",
        "[]",
        "{}",
        '{"group":{"empty":"  ","nil":null,"table":[]}}',
        '{"items":[{"name":"A"},"bad row"]}',
        '{"group":{"nested":{"name":"A"}}}',
        '{"items":[{"nested":{"name":"A"}}]}',
        '{"items":[{"nested":["A"]}]}',
        '{"number":NaN}',
        "not json",
    ],
)
async def test_invalid_generic_is_readable_original_not_successful_extraction(content):
    """AC-FR-OCR-025-02, 026-01/02: JSON parse success alone is insufficient."""
    raw = copy.deepcopy(RAW)
    assert (
        await worker._generic(raw, CONFIG, httpx.MockTransport(lambda _r: response(content)))
        == FALLBACK
    )
    assert raw == RAW


@pytest.mark.parametrize(
    "source",
    [
        {"zero": 0},
        {"paid": False},
        {"group": {"zero": 0, "lines": []}},
        {"group": {"lines": [{"amount": "10.00"}]}},
        {"items": [{"zero": 0}]},
        {"group": {"lines": [{"paid": False}]}},
    ],
)
async def test_zero_or_false_alone_is_useful(source):
    result = await worker._generic(
        RAW, CONFIG, httpx.MockTransport(lambda _r: response(json.dumps(source)))
    )
    assert result == source


@pytest.mark.parametrize(
    "source", [{"items": [{}]}, {"group": {"lines": [{"empty": "", "optional": None}]}}]
)
async def test_empty_table_rows_alone_are_not_extraction(source):
    result = await worker._generic(
        RAW, CONFIG, httpx.MockTransport(lambda _r: response(json.dumps(source)))
    )
    assert result == FALLBACK


async def test_decimal_tokens_are_exact_text():
    result = await worker._generic(
        RAW, CONFIG, httpx.MockTransport(lambda _r: response('{"total":123456789012.30}'))
    )
    assert result == {"total": "123456789012.30"}


async def test_unconfigured_llm_preserves_pages_without_call():
    def unexpected(_request):
        raise AssertionError("unconfigured LLM must not be called")

    assert await worker._generic(RAW, {}, httpx.MockTransport(unexpected)) == FALLBACK


@pytest.mark.parametrize("failure", ["timeout", "http", "shape"])
async def test_llm_failures_use_original(failure):
    def handle(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("fake timeout", request=request)
        if failure == "http":
            return httpx.Response(503)
        return httpx.Response(200, json={"choices": []})

    assert await worker._generic(RAW, CONFIG, httpx.MockTransport(handle)) == FALLBACK


def test_page_extraction_is_defensive_and_keeps_empty_pages():
    raw = {
        "pages": [
            None,
            "bad",
            {},
            {"fullTextAnnotation": []},
            {"fullTextAnnotation": {"text": 12}},
            {"fullTextAnnotation": {"text": "  原文\n"}},
        ]
    }
    assert worker._page_texts(raw) == {"pages": ["", "", "", "", "", "  原文\n"]}
    assert worker._page_texts({"pages": "not an array"}) == {"pages": []}
    assert worker._page_texts(None) == {"pages": []}


async def test_no_readable_pages_still_returns_explicit_fallback():
    assert await worker._generic({"pages": [{}, {}]}, {}, None) == {
        "ocr_text": {"page_1": "", "page_2": ""}
    }
    assert await worker._generic({}, {}, None) == {"ocr_text": {}}


async def test_llm_input_contains_actual_pages_not_coordinates():
    seen = []

    def handle(request):
        body = json.loads(request.content)
        seen.append(body["messages"][1]["content"])
        assert "response_format" not in body
        return response('{"invoice_no":"IV1"}')

    assert await worker._generic(RAW, CONFIG, httpx.MockTransport(handle)) == {"invoice_no": "IV1"}
    assert json.loads(seen[0].split("\n\n", 1)[1]) == worker._page_texts(RAW)
