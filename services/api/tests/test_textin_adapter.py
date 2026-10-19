"""textin.adapter 的纯单元测试（adapter 与 client 解耦：注入 httpx.MockTransport 模拟 vendor）。

对应 task 2.2 的验证：
- 三档 status 映射：1 → SUCCEEDED（fields/items 双非空）/ PARTIAL_SUCCESS；2 → FAILED + DOCFLOW_RECOGNITION_FAILED；其它 → FAILED + DOCFLOW_UNEXPECTED_STATUS。
- failure_causes 多条 / 超长 → 截断到合理长度。
- 空 items[][] 不被算 SUCCEEDED。
- `structured` 原样保留 result.files[0]（data.pages.position / task_id / 任意元字段）。
- parser_params 走白名单（passthrough）。
- vendor 标识符 = "textin-docflow"。
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from textin.adapter import (
    ALLOWED_PARSER_KEYS,
    VENDOR,
    build_parser_params,
    run_extraction,
)
from textin.client import TextInClient
from textin.config import TextInSettings, build_textin_settings
from textin.errors import TextInAPIError


# --- fixtures / helpers ----------------------------------------------------


@pytest.fixture
def settings() -> TextInSettings:
    return build_textin_settings(
        {
            "TEXTIN_APP_ID": "test-app",
            "TEXTIN_SECRET_CODE": "test-secret",
            "TEXTIN_DOCFLOW_WORKSPACE_ID": "test-ws",
        }
    )


def _vendor_response(
    *,
    recognition_status: int = 1,
    fields: list[dict[str, Any]] | None = None,
    items: list[list[dict[str, Any]]] | None = None,
    failure_causes: list[dict[str, Any]] | None = None,
    task_id: str = "task-1",
    batch_number: str = "batch-1",
    category: str = "invoice",
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    file_entry: dict[str, Any] = {
        "recognition_status": recognition_status,
        "data": {
            "fields": fields if fields is not None else [],
            "items": items if items is not None else [],
            "tables": [],
            "stamps": [],
            "handwritings": [],
        },
        "pages": [
            {"page": 1, "width": 100, "height": 100, "dpi": 144, "angle": 0}
        ],
        "duration_ms": 250,
        "task_id": task_id,
        "batch_number": batch_number,
        "category": category,
        "failure_causes": failure_causes if failure_causes is not None else [],
    }
    if extras:
        file_entry.update(extras)
    return {"code": 200, "msg": "", "result": {"files": [file_entry]}}


def _make_client(settings: TextInSettings, handler) -> TextInClient:
    return TextInClient(settings, transport=httpx.MockTransport(handler))


# --- run_extraction: recognition_status 三档 ------------------------------


def test_run_extraction_status_succeeded_when_both_fields_and_items_populated(
    settings: TextInSettings,
) -> None:
    """recognition_status=1 + fields+items 双非空 → SUCCEEDED。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(
                recognition_status=1,
                fields=[{"key": "invoice_no", "value": "X"}],
                items=[[{"key": "amount", "value": "100"}]],
            ),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client,
            filename="a.pdf",
            content=b"data",
            content_type="application/pdf",
            params={"parser_parse_mode": "scan"},
        )
    finally:
        client.close()

    assert out["status"] == "SUCCEEDED"
    assert out["error_code"] is None
    assert out["vendor"] == "textin-docflow"
    assert out["structured"]["recognition_status"] == 1
    assert out["task_id"] == "task-1"
    assert out["batch_number"] == "batch-1"
    assert out["category"] == "invoice"


def test_run_extraction_status_partial_when_items_empty(settings: TextInSettings) -> None:
    """recognition_status=1 但 items[][] 为空 → PARTIAL_SUCCESS。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(
                recognition_status=1,
                fields=[{"key": "k", "value": "v"}],
                items=[],
            ),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["status"] == "PARTIAL_SUCCESS"
    assert out["error_code"] is None


def test_run_extraction_status_partial_when_items_rows_all_empty(
    settings: TextInSettings,
) -> None:
    """items 看似有行但每行 cell 都空 → 仍然 PARTIAL_SUCCESS。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(
                recognition_status=1,
                fields=[{"key": "k", "value": "v"}],
                items=[[], []],
            ),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["status"] == "PARTIAL_SUCCESS"


def test_run_extraction_status_partial_when_fields_empty(settings: TextInSettings) -> None:
    """recognition_status=1 但 fields 空 → PARTIAL_SUCCESS。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(
                recognition_status=1,
                fields=[],
                items=[[{"key": "k", "value": "v"}]],
            ),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["status"] == "PARTIAL_SUCCESS"


def test_run_extraction_status_failed_for_recognition_status_2(
    settings: TextInSettings,
) -> None:
    """recognition_status=2 → FAILED + DOCFLOW_RECOGNITION_FAILED；failure_causes 摊平到 error_message。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(
                recognition_status=2,
                failure_causes=[{"code": "low_conf", "msg": "OCR borked"}],
            ),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["status"] == "FAILED"
    assert out["error_code"] == "DOCFLOW_RECOGNITION_FAILED"
    assert "OCR borked" in (out["error_message"] or "")
    assert "[low_conf]" in (out["error_message"] or "")


@pytest.mark.parametrize("recognition_status", [0, 3, 4, 5, 6, 7, 10, 20, -1])
def test_run_extraction_status_failed_for_unexpected_status(
    settings: TextInSettings, recognition_status: int,
) -> None:
    """非 1/2 的 recognition_status → FAILED + DOCFLOW_UNEXPECTED_STATUS。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(recognition_status=recognition_status),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["status"] == "FAILED"
    assert out["error_code"] == "DOCFLOW_UNEXPECTED_STATUS"


# --- failure_causes 截断 -----------------------------------------------------


def test_run_extraction_failure_causes_truncated_to_first_n(
    settings: TextInSettings,
) -> None:
    """failure_causes 多于 5 条 → 只取前 5 条进 error_message。"""
    causes = [{"code": f"c{i}", "msg": f"reason {i}"} for i in range(20)]

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(recognition_status=2, failure_causes=causes),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["error_message"] is not None
    # reason 0..4 present, reason 5..19 dropped
    for i in range(5):
        assert f"reason {i}" in out["error_message"]
    for i in range(5, 20):
        assert f"reason {i}" not in out["error_message"]


def test_run_extraction_failure_causes_overall_length_capped(
    settings: TextInSettings,
) -> None:
    """每条 cause 的 msg 超长 → 整体 error_message 不超过 512 字符。"""
    long_msg = "x" * 1000
    causes = [{"code": f"c{i}", "msg": long_msg} for i in range(10)]

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_response(recognition_status=2, failure_causes=causes),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["error_message"] is not None
    assert len(out["error_message"]) <= 512


def test_run_extraction_no_failure_causes_yields_none_message(
    settings: TextInSettings,
) -> None:
    """failure_causes 空列表 → error_message 为 None（不要假装有错）。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json=_vendor_response(recognition_status=1, fields=[{"k": "v"}], items=[[{"k": "v"}]]),
        )

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["error_message"] is None


# --- structured 字段原样保留（vendor 官方形状 + 位置/页元数据）--------------


def test_run_extraction_structured_preserves_full_files_entry(
    settings: TextInSettings,
) -> None:
    """structured 字段 = result.files[0] 整段：data.pages / 自定义元数据 / 位置坐标全保留。"""
    response_body: dict[str, Any] = {
        "code": 200,
        "msg": "",
        "result": {
            "files": [
                {
                    "recognition_status": 1,
                    "data": {
                        "fields": [
                            {
                                "key": "k",
                                "value": "v",
                                "position": [{"page": 1, "vertices": [0, 0, 1, 0, 1, 1, 0, 1]}],
                            }
                        ],
                        "items": [[{"key": "k", "value": "v", "position": []}]],
                    },
                    "pages": [
                        {"page": 1, "width": 100, "height": 100, "dpi": 144, "angle": 0}
                    ],
                    "duration_ms": 250,
                    "task_id": "task-99",
                    "batch_number": "BN-99",
                    "category": "invoice",
                    "failure_causes": [],
                    "custom_meta_field": "kept-verbatim",
                }
            ]
        },
    }

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=response_body)

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()

    assert out["structured"]["task_id"] == "task-99"
    assert out["structured"]["custom_meta_field"] == "kept-verbatim"
    verts = out["structured"]["data"]["fields"][0]["position"][0]["vertices"]
    assert verts == [0, 0, 1, 0, 1, 1, 0, 1]
    assert out["structured"]["pages"][0]["page"] == 1


# --- parser_params 白名单 ----------------------------------------------------


def test_build_parser_params_filters_to_allowed_keys() -> None:
    """build_parser_params 只放出 ALLOWED_PARSER_KEYS 中的键，其它键忽略。"""
    out = build_parser_params(
        {
            "parser_parse_mode": "vlm",
            "parser_formula_level": 1,
            "parser_crop_dewarp": True,
            "parser_dpi": 216,
            "parser_apply_merge": False,
            "category": "invoice",
            "batch_number": "BN-1",
            "target_process": "extract",
            "ignored_key": "drop me",
            "parser_unknown": "drop me too",
        }
    )
    assert out == {
        "parser_parse_mode": "vlm",
        "parser_formula_level": 1,
        "parser_crop_dewarp": True,
        "parser_dpi": 216,
        "parser_apply_merge": False,
        "category": "invoice",
        "batch_number": "BN-1",
        "target_process": "extract",
    }


def test_build_parser_params_drops_none_values() -> None:
    """None 值不进 query（与 client.upload_file_sync 行为一致）。"""
    out = build_parser_params(
        {
            "parser_parse_mode": None,
            "category": "invoice",
        }
    )
    assert out == {"category": "invoice"}


def test_build_parser_params_empty_input() -> None:
    """空输入 → 空输出。"""
    assert build_parser_params({}) == {}


def test_allowed_parser_keys_is_frozenset_for_safety() -> None:
    """ALLOWED_PARSER_KEYS 必须是 frozenset，避免被外部 mutate。"""
    assert isinstance(ALLOWED_PARSER_KEYS, frozenset)


def test_run_extraction_passes_parser_params_to_query(
    settings: TextInSettings,
) -> None:
    """params 中的 DocFlow 字段确实落到请求的 query string。"""
    captured: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured["url"] = str(req.url)
        return httpx.Response(200, json=_vendor_response())

    client = _make_client(settings, handler)
    try:
        run_extraction(
            client,
            filename="a.pdf",
            content=b"data",
            content_type="application/pdf",
            params={
                "parser_parse_mode": "vlm",
                "parser_formula_level": 1,
                "parser_crop_dewarp": True,
                "parser_dpi": 216,
                "parser_apply_merge": False,
                "category": "invoice",
                "batch_number": "BN-1",
                "target_process": "extract",
                "evil_field": "drop",
            },
        )
    finally:
        client.close()

    url = captured["url"]
    assert "parser_parse_mode=vlm" in url
    assert "parser_formula_level=1" in url
    assert "parser_crop_dewarp=True" in url or "parser_crop_dewarp=true" in url
    assert "parser_dpi=216" in url
    assert "parser_apply_merge=False" in url or "parser_apply_merge=false" in url
    assert "category=invoice" in url
    assert "batch_number=BN-1" in url
    assert "target_process=extract" in url
    assert "evil_field" not in url
    assert "workspace_id=test-ws" in url


# --- vendor 标识 ------------------------------------------------------------


def test_vendor_identifier_is_textin_docflow() -> None:
    """Vendor 字面稳定 = `textin-docflow`（worker / routes / 前端按此字符串引用）。"""
    assert VENDOR == "textin-docflow"


# --- 异常 / 边界 -------------------------------------------------------------


def test_run_extraction_propagates_textinapierror(settings: TextInSettings) -> None:
    """Vendor 返回 code != 200 → TextInAPIError 直通到调用方（adapter 不吞错）。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"code": 429, "msg": "rate limit"})

    client = _make_client(settings, handler)
    try:
        with pytest.raises(TextInAPIError) as exc_info:
            run_extraction(
                client, filename="a.pdf", content=b"data", params=None,
            )
    finally:
        client.close()
    assert exc_info.value.code == 429


@pytest.mark.parametrize(
    "payload",
    [
        {"code": 200, "result": {}},
        {"code": 200, "result": {"files": []}},
        {"code": 200, "result": {"files": [None]}},
        {"code": 200, "result": {"files": ["not a dict"]}},
    ],
)
def test_run_extraction_handles_missing_or_malformed_files(
    settings: TextInSettings, payload: dict[str, Any],
) -> None:
    """result.files 缺失 / 空 / 元素不是 dict → 优雅退到 structured={} + 失败侧通道。"""

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    client = _make_client(settings, handler)
    try:
        out = run_extraction(
            client, filename="a.pdf", content=b"data", params=None,
        )
    finally:
        client.close()
    assert out["structured"] == {}
    assert out["status"] in {"PARTIAL_SUCCESS", "FAILED"}
    assert out["task_id"] is None
    assert out["batch_number"] is None
    assert out["category"] is None
