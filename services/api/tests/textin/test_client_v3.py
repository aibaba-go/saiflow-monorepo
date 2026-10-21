"""TDD: 第一轮 — parse_sync 与 extract_v3_from_ocr_json 的客户端契约。"""

from __future__ import annotations

import httpx
import pytest

from textin.client import TextInClient
from textin.config import TextInSettings
from textin.errors import TextInAPIError


def _settings(**overrides) -> TextInSettings:
    base = dict(
        textin_app_id="test-id",
        textin_secret_code="test-secret",
        textin_endpoint="https://example.test/parse/sync",
        textin_extract_endpoint="https://example.test/extract/sync",
        textin_prompt_endpoint="https://example.test/prompt",
        textin_extract_v3_endpoint="https://example.test/extract/v3",
        timeout_seconds=10,
        connect_timeout_seconds=5,
    )
    base.update(overrides)
    return TextInSettings(**base)


def test_parse_sync_returns_ocr_json_on_200():
    """parse_sync 上传文件到 parse/sync, 200 响应把 data 提到顶层返回。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "code": 200,
                "data": {"pages": [{"page_number": 1}], "markdown": "# hi"},
                "message": "ok",
            },
        )

    transport = httpx.MockTransport(handler)
    client = TextInClient(_settings(), transport=transport)

    result = client.parse_sync(filename="doc.png", content=b"binary", params={})

    assert captured["url"].startswith("https://example.test/parse/sync")
    assert result["code"] == 200
    assert "pages" in result
    assert result["markdown"] == "# hi"


def test_extract_v3_from_ocr_json_raises_on_vendor_error():
    """extract-v3 返回非 200 code → 抛 TextInAPIError；端点走 textin_extract_v3_endpoint。"""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = request.content
        return httpx.Response(
            200,
            json={"code": 40003, "message": "schema not configured"},
        )

    settings = _settings(textin_extract_v3_endpoint="https://example.test/extract/v3")
    client = TextInClient(settings, transport=httpx.MockTransport(handler))

    with pytest.raises(TextInAPIError):
        client.extract_v3_from_ocr_json(
            parse_json={"pages": [{"page_number": 1}]},
            params={},
        )

    assert captured["url"].startswith("https://example.test/extract/v3")


def test_extract_v3_returns_kv_dict_on_200():
    """200 响应走 _parse: data 提升到顶层;调用方可拿 result['extracted'] 这种 KV。"""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "code": 200,
                "data": {
                    "extracted": {
                        "invoice_number": "INV-001",
                        "supplier_name": "ACME",
                    },
                },
                "message": "ok",
            },
        )

    settings = _settings(textin_extract_v3_endpoint="https://example.test/extract/v3")
    client = TextInClient(settings, transport=httpx.MockTransport(handler))

    result = client.extract_v3_from_ocr_json(
        parse_json={"pages": [{"page_number": 1}], "markdown": "..."},
        params={},
    )

    assert result["code"] == 200
    assert result["extracted"]["invoice_number"] == "INV-001"
    assert result["extracted"]["supplier_name"] == "ACME"
