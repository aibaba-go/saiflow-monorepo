"""textin.client 的纯单元测试：通过 httpx.MockTransport 注入同步响应。

对应 task 2.1 的验证：
- `upload_file_sync` 单一入口；legacy `extract_*` / `extract_with_*` 已删除。
- 鉴权头 `x-ti-app-id` / `x-ti-secret-code` 注入到出站请求。
- `workspace_id` 由 settings 自动填入，缺少即报错（-1）。
- `parser_params` 走 query string；`None` 值被剔除。
- 成功路径：返回 `{code:200, msg, result.files[0].data.fields[0], ...}`。
- code != 200 → `TextInAPIError`（读 `msg`）。
- HTTP 429 / 非 200 → `TextInAPIError`（HTTP status code）。
- 非 JSON / GBK 编码 body 走 decode fallback。
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from textin.client import TextInClient
from textin.config import TextInSettings, build_textin_settings
from textin.errors import TextInAPIError


# --- fixtures --------------------------------------------------------------


@pytest.fixture
def settings() -> TextInSettings:
    """Settings with three credentials + DocFlow default endpoint."""
    return build_textin_settings(
        {
            "TEXTIN_APP_ID": "test-app",
            "TEXTIN_SECRET_CODE": "test-secret",
            "TEXTIN_DOCFLOW_WORKSPACE_ID": "test-ws",
        }
    )


def _success_payload(
    *, recognition_status: int = 1, fields=None, items=None, task_id="task-1"
) -> dict[str, Any]:
    return {
        "code": 200,
        "msg": "",
        "result": {
            "files": [
                {
                    "recognition_status": recognition_status,
                    "data": {
                        "fields": fields or [],
                        "items": items or [],
                        "tables": [],
                        "stamps": [],
                        "handwritings": [],
                    },
                    "pages": [{"page": 1, "width": 100, "height": 100, "dpi": 144, "angle": 0}],
                    "duration_ms": 100,
                    "category": "invoice",
                    "task_id": task_id,
                    "batch_number": "batch-1",
                    "failure_causes": [],
                }
            ]
        },
    }


def _make_client(
    settings: TextInSettings, handler
) -> TextInClient:
    return TextInClient(settings, transport=httpx.MockTransport(handler))


# --- 出参 payload 形状 ----------------------------------------------------------


def test_upload_file_sync_returns_full_success_payload(settings: TextInSettings) -> None:
    """成功 200 + code=200：返回整个 payload（含 result.files[0].data.fields[0]）。"""
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        captured["headers"] = dict(req.headers)
        return httpx.Response(
            200,
            json=_success_payload(
                recognition_status=1,
                fields=[{"key": "invoice_no", "value": "INV-1", "position": []}],
            ),
        )

    client = _make_client(settings, handler)
    try:
        out = client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()

    assert out["code"] == 200
    assert out["result"]["files"][0]["recognition_status"] == 1
    assert out["result"]["files"][0]["data"]["fields"][0]["key"] == "invoice_no"
    assert "workspace_id=test-ws" in captured["url"]
    assert captured["headers"]["x-ti-app-id"] == "test-app"
    assert captured["headers"]["x-ti-secret-code"] == "test-secret"


def test_upload_file_sync_sends_multipart_file(settings: TextInSettings) -> None:
    """出站请求是 multipart/form-data；file 字段内容正确。"""
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["content_type"] = req.headers.get("content-type", "")
        captured["body"] = req.content
        return httpx.Response(200, json=_success_payload())

    client = _make_client(settings, handler)
    try:
        client.upload_file_sync(
            "invoice.pdf", b"abc-binary", "application/pdf",
        )
    finally:
        client.close()

    assert "multipart/form-data" in captured["content_type"]
    assert b'name="file"' in captured["body"]
    assert b"invoice.pdf" in captured["body"]
    assert b"abc-binary" in captured["body"]


# --- workspace_id 解析 --------------------------------------------------------


def test_upload_file_sync_missing_workspace_id_raises(settings: TextInSettings) -> None:
    """settings 没 workspace_id 且 parser_params 也没 → 客户端拒绝（不发出请求）。"""
    settings.textin_docflow_workspace_id = ""
    client = TextInClient(settings)
    try:
        with pytest.raises(TextInAPIError) as exc_info:
            client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert exc_info.value.code == -1
    assert "workspace_id" in exc_info.value.msg


def test_upload_file_sync_workspace_id_from_settings(settings: TextInSettings) -> None:
    """缺省时从 settings.textin_docflow_workspace_id 自动填入 query string。"""
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(200, json=_success_payload())

    client = _make_client(settings, handler)
    try:
        client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert "workspace_id=test-ws" in captured["url"]


def test_upload_file_sync_workspace_id_in_parser_params_overrides_settings() -> None:
    """parser_params 显式给的 workspace_id 覆盖 settings 里的同名值。"""
    custom = build_textin_settings(
        {
            "TEXTIN_APP_ID": "x",
            "TEXTIN_SECRET_CODE": "y",
            "TEXTIN_DOCFLOW_WORKSPACE_ID": "from-settings",
        }
    )
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(200, json=_success_payload())

    client = _make_client(custom, handler)
    try:
        client.upload_file_sync(
            "a.pdf",
            b"data",
            "application/pdf",
            parser_params={
                "workspace_id": "from-params",
                "parser_parse_mode": "scan",
                "category": "invoice",
            },
        )
    finally:
        client.close()

    assert "workspace_id=from-params" in captured["url"]
    assert "from-settings" not in captured["url"]
    assert "parser_parse_mode=scan" in captured["url"]
    assert "category=invoice" in captured["url"]


def test_upload_file_sync_drops_none_values_from_query(settings: TextInSettings) -> None:
    """parser_params 中 None 值不进 query（URL 保持干净）。"""
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(200, json=_success_payload())

    client = _make_client(settings, handler)
    try:
        client.upload_file_sync(
            "a.pdf",
            b"data",
            "application/pdf",
            parser_params={"parser_parse_mode": None, "category": "invoice"},
        )
    finally:
        client.close()
    assert "parser_parse_mode" not in captured["url"]
    assert "category=invoice" in captured["url"]


# --- 出错路径 ------------------------------------------------------------------


def test_upload_file_sync_non_200_code_raises_textinapierror(settings: TextInSettings) -> None:
    """code != 200（vendor 业务错误）→ TextInAPIError，msg 来自 `msg` 字段。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 400, "msg": "bad workspace"})

    client = _make_client(settings, handler)
    try:
        with pytest.raises(TextInAPIError) as exc_info:
            client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert exc_info.value.code == 400
    assert exc_info.value.msg == "bad workspace"
    assert exc_info.value.payload == {"code": 400, "msg": "bad workspace"}


def test_upload_file_sync_http_429_raises_textinapierror(settings: TextInSettings) -> None:
    """HTTP 429（限流）→ TextInAPIError，code=429，payload 含原始 body 截断。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="Too Many Requests")

    client = _make_client(settings, handler)
    try:
        with pytest.raises(TextInAPIError) as exc_info:
            client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert exc_info.value.code == 429
    assert "429" in exc_info.value.msg
    assert "Too Many Requests" in exc_info.value.payload["body"]


def test_upload_file_sync_non_json_response_raises(settings: TextInSettings) -> None:
    """非 JSON body（HTML 错误页之类）→ TextInAPIError，不崩。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>oops</html>")

    client = _make_client(settings, handler)
    try:
        with pytest.raises(TextInAPIError) as exc_info:
            client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert exc_info.value.code == -1
    assert "non-JSON" in exc_info.value.msg


def test_upload_file_sync_gbk_encoded_body_decodes_via_fallback(settings: TextInSettings) -> None:
    """GBK 编码的 JSON body（代理误转码）能 fallback 解码出 payload。"""
    gbk_body = json.dumps({"code": 200, "msg": ""}, ensure_ascii=False).encode("gbk")

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=gbk_body)

    client = _make_client(settings, handler)
    try:
        out = client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert out["code"] == 200


def test_upload_file_sync_non_dict_payload_raises(settings: TextInSettings) -> None:
    """Vendor 返回 JSON 但不是对象（如裸数组 / null）→ TextInAPIError。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[1, 2, 3])

    client = _make_client(settings, handler)
    try:
        with pytest.raises(TextInAPIError) as exc_info:
            client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert exc_info.value.code == -1
    assert "not a JSON object" in exc_info.value.msg


# --- endpoint 可覆盖 -----------------------------------------------------------


def test_upload_file_sync_endpoint_overridable_via_settings() -> None:
    """Endpoint 默认走 DocFlow；可通过 TEXTIN_ENDPOINT 覆盖。"""
    custom = build_textin_settings(
        {
            "TEXTIN_APP_ID": "x",
            "TEXTIN_SECRET_CODE": "y",
            "TEXTIN_DOCFLOW_WORKSPACE_ID": "ws",
            "TEXTIN_ENDPOINT": "https://example.test/upload/sync",
        }
    )
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(200, json=_success_payload())

    client = _make_client(custom, handler)
    try:
        client.upload_file_sync("a.pdf", b"data", "application/pdf")
    finally:
        client.close()
    assert captured["url"].startswith("https://example.test/upload/sync?")


def test_default_endpoint_points_to_docflow() -> None:
    """默认 endpoint 必须是 DocFlow 的 /upload/sync URL（vendor 切换已完成）。"""
    settings = build_textin_settings(
        {
            "TEXTIN_APP_ID": "x",
            "TEXTIN_SECRET_CODE": "y",
            "TEXTIN_DOCFLOW_WORKSPACE_ID": "ws",
        }
    )
    assert (
        settings.textin_endpoint
        == "https://docflow.textin.ai/api/app-api/sip/platform/v2/file/upload/sync"
    )


# --- 旧 vendor 方法已删除 ------------------------------------------------------


def test_client_exposes_only_docflow_methods() -> None:
    """Legacy extract_* / extract_with_* 方法全部删除（不留 deprecated branch）。"""
    method_names = set(dir(TextInClient))
    assert "upload_file_sync" in method_names
    assert "close" in method_names
    for legacy in (
        "extract_file",
        "extract_url",
        "extract_with_schema",
        "extract_with_prompt",
    ):
        assert legacy not in method_names, f"legacy method {legacy} should be removed"
