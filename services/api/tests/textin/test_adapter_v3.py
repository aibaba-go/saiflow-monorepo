"""TDD: 第二轮 — adapter.run_extraction_v3 与 normalize_v3_to_ir 契约。"""

from __future__ import annotations

from typing import Any

import pytest

from textin import adapter


class _FakeClient:
    """最小可配置 fake — 不走 HTTP,记录调用、返回预设响应。"""

    def __init__(self, parse_resp: dict | None = None, extract_resp: dict | None = None) -> None:
        self.parse_calls: list[dict[str, Any]] = []
        self.extract_calls: list[dict[str, Any]] = []
        self._parse_resp = parse_resp or {
            "pages": [{"page_number": 1, "markdown": "x"}],
            "duration": 100,
            "page_count": 1,
        }
        self._extract_resp = extract_resp or {"code": 200, "extracted": {"k": "v"}, "duration": 50}

    def parse_sync(self, *, filename: str, content: bytes, params: dict | None = None) -> dict:
        self.parse_calls.append({"filename": filename, "content_size": len(content), "params": params})
        return self._parse_resp

    def extract_v3_from_ocr_json(self, *, parse_json: dict, params: dict | None = None) -> dict:
        self.extract_calls.append({"parse_json_keys": sorted(parse_json.keys()), "params": params})
        return self._extract_resp


def test_run_extraction_v3_chains_parse_then_extract():
    """run_extraction_v3 先调 parse_sync,再把 OCR JSON 喂给 extract_v3,返回统一的 {vendor, structured,...} 形状。"""
    fake = _FakeClient(
        parse_resp={"pages": [{"page_number": 1}], "duration": 100, "page_count": 1},
        extract_resp={"code": 200, "extracted": {"invoice_number": "INV-1"}, "duration": 50, "page_count": 1},
    )

    result = adapter.run_extraction_v3(
        fake,
        filename="a.png",
        content=b"binary",
        params={},
    )

    assert len(fake.parse_calls) == 1
    assert fake.parse_calls[0]["filename"] == "a.png"
    assert len(fake.extract_calls) == 1
    assert fake.extract_calls[0]["parse_json_keys"] == ["duration", "page_count", "pages"]
    assert result["vendor"] == "textin"
    assert result["structured"] == {"invoice_number": "INV-1"}
    assert result["field_source"] == "extract_v3"
    assert result["field_count"] == 1
    assert result["table_count"] == 0
