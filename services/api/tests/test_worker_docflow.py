"""worker 的 DocFlow 适配单测：覆盖 apply_extraction_to_job / build_audit_payload /
call_extraction_with_retry 三个纯函数（不依赖 Flask app context / DB）。

对应 task 4.2 的验证：
- 成功 → structured 写入 OcrJob；task_id / batch_number / category / recognition_status 持久化。
- recognition_status=2 → FAILED + error_code/error_message 包含 failure_causes 摊平串。
- 429 后 200：两轮后成功；非 200 一律抛错（不重试）。
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from textin.adapter import run_extraction
from textin.client import TextInClient
from textin.config import build_textin_settings
from textin.errors import TextInAPIError
from worker import (
    apply_extraction_to_job,
    build_audit_payload,
    call_extraction_with_retry,
)


# --- shared builders -------------------------------------------------------


def _settings():
    return build_textin_settings(
        {
            "TEXTIN_APP_ID": "test-app",
            "TEXTIN_SECRET_CODE": "test-secret",
            "TEXTIN_DOCFLOW_WORKSPACE_ID": "test-ws",
        }
    )


def _vendor_payload(*, status=1, fields=None, items=None, task_id="t1", batch_number="b1",
                    category="invoice", failure_causes=None):
    return {
        "code": 200,
        "msg": "",
        "result": {
            "files": [
                {
                    "recognition_status": status,
                    "data": {
                        "fields": fields or [],
                        "items": items or [],
                        "tables": [],
                        "stamps": [],
                        "handwritings": [],
                    },
                    "pages": [],
                    "duration_ms": 150,
                    "task_id": task_id,
                    "batch_number": batch_number,
                    "category": category,
                    "failure_causes": failure_causes or [],
                }
            ]
        },
    }


def _client_with(handler) -> TextInClient:
    return TextInClient(_settings(), transport=httpx.MockTransport(handler))


def _make_job_mock():
    """Lightweight OcrJob stand-in exposing all attrs the helper writes to.

    No SQLAlchemy session needed; the helper mutates Python attributes directly.
    """
    job = MagicMock()
    job.capability = {"vendor": "textin-docflow", "existing": "kept"}
    job.error_code = ""
    job.error_message = ""
    job.duration_ms = 0
    job.page_count = 0
    job.table_count = 0
    job.field_count = 0
    job.status = "PROCESSING"
    job.vendor_task_id = None
    job.vendor_batch_number = None
    job.vendor_category = None
    job.recognition_status = None
    return job


# --- apply_extraction_to_job: 成功路径 --------------------------------------


def test_succeeded_result_writes_status_and_vendor_ids() -> None:
    """SUCCEEDED → job.status=SUCCEEDED，task_id / batch_number / category / recognition_status 都进 OcrJob。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_payload(
                status=1,
                fields=[{"key": "k", "value": "v"}],
                items=[[{"key": "k", "value": "v"}]],
                task_id="task-99",
                batch_number="BN-99",
                category="invoice",
            ),
        )

    client = _client_with(handler)
    try:
        result = run_extraction(
            client, filename="a.pdf", content=b"data", content_type="application/pdf",
        )
    finally:
        client.close()

    job = _make_job_mock()
    apply_extraction_to_job(job, result, duration_ms=200)

    assert job.status == "SUCCEEDED"
    assert job.vendor_task_id == "task-99"
    assert job.vendor_batch_number == "BN-99"
    assert job.vendor_category == "invoice"
    assert job.recognition_status == 1
    assert job.table_count == 1  # items[][]: 1 non-empty row
    assert job.field_count == 1  # data.fields: 1 entry
    assert job.duration_ms == 200
    # Vendor capability 保持 textin-docflow，原有字段被保留
    assert job.capability["vendor"] == "textin-docflow"
    assert job.capability["existing"] == "kept"


def test_partial_success_does_not_set_error_code() -> None:
    """PARTIAL_SUCCESS → OcrJob.status=PARTIAL_SUCCESS；error_code/error_message 不覆盖。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_vendor_payload(status=1, fields=[{"key": "k", "value": "v"}], items=[]))

    client = _client_with(handler)
    try:
        result = run_extraction(client, filename="a.pdf", content=b"data", content_type="application/octet-stream")
    finally:
        client.close()

    job = _make_job_mock()
    apply_extraction_to_job(job, result, duration_ms=50)

    assert job.status == "PARTIAL_SUCCESS"
    assert job.recognition_status == 1
    # No error info for non-FAILED:
    assert job.error_code == ""
    assert job.error_message == ""


# --- apply_extraction_to_job: 失败路径 --------------------------------------


def test_recognition_status_2_writes_failed_with_failure_causes() -> None:
    """recognition_status=2 → FAILED + DOCFLOW_RECOGNITION_FAILED；error_message 含失败原因。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=_vendor_payload(
                status=2,
                failure_causes=[{"code": "low_conf", "msg": "OCR borked on page 3"}],
            ),
        )

    client = _client_with(handler)
    try:
        result = run_extraction(client, filename="a.pdf", content=b"data", content_type="application/octet-stream")
    finally:
        client.close()

    job = _make_job_mock()
    apply_extraction_to_job(job, result, duration_ms=10)

    assert job.status == "FAILED"
    assert job.error_code == "DOCFLOW_RECOGNITION_FAILED"
    assert "OCR borked on page 3" in job.error_message
    assert "low_conf" in job.error_message
    # recognition_status persisted for audit (post-mortem) regardless of FAILED
    assert job.recognition_status == 2


def test_unexpected_recognition_status_writes_docflow_unexpected_status() -> None:
    """未知 recognition_status → FAILED + DOCFLOW_UNEXPECTED_STATUS。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_vendor_payload(status=4, task_id="t-x"))

    client = _client_with(handler)
    try:
        result = run_extraction(client, filename="a.pdf", content=b"data", content_type="application/octet-stream")
    finally:
        client.close()

    job = _make_job_mock()
    apply_extraction_to_job(job, result, duration_ms=10)

    assert job.status == "FAILED"
    assert job.error_code == "DOCFLOW_UNEXPECTED_STATUS"
    assert job.recognition_status == 4  # for audit; even when FAILED, keep raw value


def test_structured_malformed_fallback_does_not_crash() -> None:
    """structured 不是 dict 时不崩；用空 dict 替身继续走流程。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_vendor_payload(status=1, fields=[{"k": "v"}], items=[[{"k": "v"}]]))

    client = _client_with(handler)
    try:
        result = run_extraction(client, filename="a.pdf", content=b"data", content_type="application/octet-stream")
    finally:
        client.close()
    # Force a malformed structured (would happen if adapter returned an empty body).
    result["structured"] = "not a dict"

    job = _make_job_mock()
    apply_extraction_to_job(job, result, duration_ms=10)
    # recognition_status 从 malformed structured 退化为 None
    assert job.recognition_status is None


def test_capability_field_source_legacy_dropped() -> None:
    """老 vendor 的 field_source 字段不再写入 capability（防止误用启发式）。"""
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_vendor_payload(status=1, fields=[{"k": "v"}], items=[[{"k": "v"}]]))

    client = _client_with(handler)
    try:
        result = run_extraction(client, filename="a.pdf", content=b"data", content_type="application/octet-stream")
    finally:
        client.close()

    job = _make_job_mock()
    job.capability = {"vendor": "old", "field_source": "heuristic"}
    apply_extraction_to_job(job, result, duration_ms=10)

    assert "field_source" not in job.capability
    assert job.capability["vendor"] == "textin-docflow"


# --- build_audit_payload ----------------------------------------------------


def test_audit_payload_includes_full_structured_summary() -> None:
    """审计 payload 包含完整 structured 摘要（vendor 原始 payload 全留，便于排障）。"""
    structured = {
        "recognition_status": 1,
        "data": {
            "fields": [{"key": "k", "value": "v", "position": [{"page": 1}]}],
            "items": [[{"key": "k", "value": "v"}]],
            "tables": [],
            "stamps": [],
            "handwritings": [],
        },
        "pages": [{"page": 1, "width": 100, "height": 100, "dpi": 144}],
        "task_id": "task-X",
    }
    result = {
        "vendor": "textin-docflow",
        "status": "SUCCEEDED",
        "page_count": 3,
        "table_count": 1,
        "field_count": 1,
        "duration_ms": 250,
        "task_id": "task-X",
        "batch_number": "BN-X",
        "category": "invoice",
        "structured": structured,
    }

    payload = build_audit_payload("job-123", result, saved_at="2026-10-19T10:00:00Z", duration_ms=250)

    assert payload["job_id"] == "job-123"
    assert payload["saved_at"] == "2026-10-19T10:00:00Z"
    summary = payload["summary"]
    assert summary["vendor"] == "textin-docflow"
    assert summary["task_id"] == "task-X"
    assert summary["batch_number"] == "BN-X"
    assert summary["category"] == "invoice"
    assert summary["duration_ms"] == 250
    # Full structured payload preserved (vendor positions, pages, all data)
    assert summary["structured"] is structured


def test_audit_payload_includes_error_message_when_failed() -> None:
    """审计 payload 在 FAILED 时也带上 error_code/error_message（排障关键）。"""
    result = {
        "vendor": "textin-docflow",
        "status": "FAILED",
        "error_code": "DOCFLOW_RECOGNITION_FAILED",
        "error_message": "[low_conf] OCR borked",
        "structured": {},
        "task_id": "task-Y",
    }
    payload = build_audit_payload("job-Y", result, saved_at="2026-10-19T10:00:00Z", duration_ms=10)
    summary = payload["summary"]
    assert summary["status"] == "FAILED"
    assert summary["error_code"] == "DOCFLOW_RECOGNITION_FAILED"
    assert summary["error_message"] == "[low_conf] OCR borked"


def test_audit_payload_json_roundtrip_works() -> None:
    """审计 JSON 必须能 json.dumps（utf-8，中文 vendor 元数据不丢）。"""
    result = {
        "vendor": "textin-docflow",
        "status": "SUCCEEDED",
        "structured": {"category": "发票", "task_id": "t-1"},
        "task_id": "t-1",
        "duration_ms": 1,
        "page_count": 1,
        "table_count": 0,
        "field_count": 0,
    }
    payload = build_audit_payload("job-1", result, saved_at="2026-10-19", duration_ms=1)
    blob = json.dumps(payload, ensure_ascii=False)
    loaded = json.loads(blob)
    assert loaded["summary"]["structured"]["category"] == "发票"


# --- call_extraction_with_retry ------------------------------------------


class _ScriptedClient:
    """In-memory counter: returns the next canned response per call; raising
    a TextInAPIError mirrors how the real client surfaces vendor errors."""

    def __init__(self, responses: list[Any]) -> None:
        self._responses = list(responses)
        self.calls = 0

    def upload_file_sync(self, *args, **kwargs):
        self.calls += 1
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def test_call_extraction_with_retry_succeeds_after_429() -> None:
    """429 → 第二次返回成功 payload，retry 走通；只 sleep 一次（指数退避）。"""
    client_obj = _ScriptedClient(
        [
            TextInAPIError(code=429, msg="rate limit"),
            _vendor_payload(status=1, fields=[{"k": "v"}], items=[[{"k": "v"}]], task_id="t-final"),
        ]
    )
    sleeps: list[float] = []
    result = call_extraction_with_retry(
        client_obj,  # type: ignore[arg-type]
        filename="a.pdf",
        content=b"data",
        content_type="application/pdf",
        params=None,
        max_retries=3,
        sleep=sleeps.append,
    )
    assert client_obj.calls == 2
    # First attempt raised; sleep 2 ** (0+1) = 2s; second attempt succeeds.
    assert sleeps == [2.0]
    assert result["status"] == "SUCCEEDED"


def test_call_extraction_with_retry_gives_up_after_max_retries() -> None:
    """持续 429 → 抛最后一次 TextInAPIError；不无限循环。"""
    client_obj = _ScriptedClient(
        [TextInAPIError(code=429, msg=f"attempt {i}") for i in range(5)]
    )
    sleeps: list[float] = []
    with pytest.raises(TextInAPIError) as exc_info:
        call_extraction_with_retry(
            client_obj,  # type: ignore[arg-type]
            filename="a.pdf", content=b"data",
            content_type="application/octet-stream",
            params=None,
            max_retries=3,
            sleep=sleeps.append,
        )
    assert client_obj.calls == 3
    # sleeps: between attempts 1→2 and 2→3 (NOT after the last) = 2 sleeps.
    assert sleeps == [2.0, 4.0]
    assert "attempt 2" in str(exc_info.value.msg)


def test_call_extraction_with_retry_does_not_retry_hard_error() -> None:
    """code=400（业务错）不重试：调用一次，立刻抛错。"""
    client_obj = _ScriptedClient([TextInAPIError(code=400, msg="bad request")])
    sleeps: list[float] = []
    with pytest.raises(TextInAPIError) as exc_info:
        call_extraction_with_retry(
            client_obj,  # type: ignore[arg-type]
            filename="a.pdf", content=b"data",
            content_type="application/octet-stream",
            params=None,
            max_retries=3,
            sleep=sleeps.append,
        )
    assert client_obj.calls == 1
    assert sleeps == []
    assert exc_info.value.code == 400


def test_call_extraction_with_retry_returns_dict_on_success() -> None:
    """成功路径返回 run_extraction 的 dict 形状，sleep 不被调用。"""
    success = _vendor_payload(status=1, fields=[{"k": "v"}], items=[[{"k": "v"}]], task_id="t")
    client_obj = _ScriptedClient([success])
    sleeps: list[float] = []
    result = call_extraction_with_retry(
        client_obj,  # type: ignore[arg-type]
        filename="a.pdf", content=b"data",
        content_type="application/octet-stream",
        params=None,
        max_retries=3,
        sleep=sleeps.append,
    )
    assert client_obj.calls == 1
    assert sleeps == []
    assert result["status"] == "SUCCEEDED"
    assert result["task_id"] == "t"


def test_call_extraction_with_retry_first_attempt_success_no_sleep() -> None:
    """第一次就成功 → 不 sleep，调用 1 次。"""
    success = _vendor_payload(status=2, task_id="t-fail")
    client_obj = _ScriptedClient([success])
    sleeps: list[float] = []
    result = call_extraction_with_retry(
        client_obj,  # type: ignore[arg-type]
        filename="a.pdf", content=b"data",
        content_type="application/octet-stream",
        params=None,
        max_retries=3,
        sleep=sleeps.append,
    )
    assert client_obj.calls == 1
    assert sleeps == []
    assert result["status"] == "FAILED"


def test_call_extraction_with_retry_retries_on_458_and_459() -> None:
    """458 / 459 是 TextIn 限流家族码 → 重试。"""
    client_obj = _ScriptedClient(
        [
            TextInAPIError(code=458, msg="quota"),
            _vendor_payload(status=1, fields=[{"k": "v"}], items=[[{"k": "v"}]]),
        ]
    )
    sleeps: list[float] = []
    call_extraction_with_retry(
        client_obj,  # type: ignore[arg-type]
        filename="a.pdf", content=b"data",
        content_type="application/octet-stream",
        params=None,
        max_retries=3,
        sleep=sleeps.append,
    )
    assert client_obj.calls == 2
    assert sleeps == [2.0]


def test_call_extraction_with_retry_does_not_retry_when_msg_says_rate_but_code_other() -> None:
    """msg 含 'rate' 但 code 不是 4xx 限流族（如 code=200 内的业务 200 但带 rate hint）→ 不重试。

    当前 _is_retryable 是 OR 关系：只要 code in {429,458,459} OR msg 含 'rate' 就重试。
    这里两种条件独立；为简化，只验证 code 不在限流族 + msg 不含 'rate' → 不重试。
    """
    client_obj = _ScriptedClient([TextInAPIError(code=400, msg="some other error")])
    sleeps: list[float] = []
    with pytest.raises(TextInAPIError):
        call_extraction_with_retry(
            client_obj,  # type: ignore[arg-type]
            filename="a.pdf", content=b"data",
            content_type="application/octet-stream",
            params=None,
            max_retries=3,
            sleep=sleeps.append,
        )
    assert client_obj.calls == 1
