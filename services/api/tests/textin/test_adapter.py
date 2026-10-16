"""adapter 测试：Prompt 模式结构化结果 + 旧版逐页归一化。"""

from __future__ import annotations

import pytest

from textin.adapter import normalize_response, run_extraction
from textin.errors import TextInAPIError


def test_text_elements_grouped_by_page() -> None:
    response = {
        "metadata": {"page_count": 2},
        "elements": [
            {"type": "TableCaption", "page_number": 1, "text": "**SAIFLOW TEST INVOICE**"},
            {"type": "Table", "page_number": 1, "text": "<table>...</table>"},
            {"type": "NarrativeText", "page_number": 2, "text": "Page two note"},
            {"type": "NarrativeText", "page_number": 2, "text": "Total due 536.50 THB"},
        ],
    }
    out = normalize_response(response, fields=[])
    texts = {p["page_number"]: p["text"] for p in out["pages"]}
    assert texts[1] == "SAIFLOW TEST INVOICE"  # ** 标记已去除，Table 的 HTML 不混入
    assert texts[2] == "Page two note\nTotal due 536.50 THB"
    assert out["page_count"] == 2


def test_text_elements_type_text_still_works() -> None:
    response = {
        "elements": [
            {"type": "text", "page_number": 1, "text": "legacy text element"},
        ],
    }
    out = normalize_response(response, fields=[])
    assert out["pages"][0]["text"] == "legacy text element"


class _PromptClient:
    def __init__(self, response: dict) -> None:
        self.response = response

    def extract_with_prompt(self, **_kwargs):
        return self.response


def test_run_extraction_keeps_only_llm_json() -> None:
    llm_json = {
        "seller": {"name": "A Co.", "phone": ["02-1", "02-2"]},
        "invoice_no": "IV-1",
        "items": [{"seq": "1", "amount": "10"}, {"seq": "2", "amount": "20"}],
    }
    out = run_extraction(
        _PromptClient({"code": 200, "page_count": 3, "duration": 1200,
                       "result": {"llm_json": llm_json, "raw_json": {"x": 1}}}),
        filename="a.pdf", content=b"%PDF", params={},
    )
    assert out["structured"] == llm_json
    assert out["page_count"] == 3
    assert out["table_count"] == 1
    assert out["field_count"] == 4  # name + 2 phones + invoice_no
    assert out["field_source"] == "prompt"


def test_run_extraction_parses_fenced_string() -> None:
    out = run_extraction(
        _PromptClient({"code": 200, "result": {"llm_json": '```json\n{"a": "1"}\n```'}}),
        filename="a.png", content=b"x", params={},
    )
    assert out["structured"] == {"a": "1"}


def test_run_extraction_missing_llm_json_raises() -> None:
    with pytest.raises(TextInAPIError):
        run_extraction(_PromptClient({"code": 200, "result": {}}), filename="a.png", content=b"x", params={})
