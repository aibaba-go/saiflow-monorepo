"""TDD: 第三轮 — worker 中 cfg 决策逻辑与 capability.extractor 写入契约。"""

from __future__ import annotations

import pytest

import worker


@pytest.mark.parametrize(
    "params,global_flag,expected",
    [
        ({"extract_v3": True}, False, "extract_v3"),
        ({"extract_v3": True}, True, "extract_v3"),
        ({"extract_v3": False}, True, "prompt"),
        ({"extract_v3": False}, False, "prompt"),
        ({}, True, "extract_v3"),
        ({}, False, "prompt"),
        ({"page": 1, "page_count": 2}, True, "extract_v3"),
    ],
)
def test_select_extractor_decides_by_job_then_global(params, global_flag, expected):
    app_config = {"EXTRACT_V3_ENABLED": global_flag}
    assert worker._select_extractor(app_config, params) == expected


def test_classify_fallback_vendor_error():
    """vendor 抛 TextInAPIError → 'vendor_error'"""
    from textin.errors import TextInAPIError

    exc = TextInAPIError(40003, "schema not configured")
    assert worker._classify_fallback(exc) == "vendor_error"


def test_classify_fallback_normalize_size():
    """归一器以 TextInAPIError('shape_invalid') 抛 → 'normalize_failed'"""
    from textin.errors import TextInAPIError

    exc = TextInAPIError(-1, "shape_invalid")
    assert worker._classify_fallback(exc) == "normalize_failed"


def test_classify_fallback_empty_or_invalid():
    """response 为空 dict → 'empty_or_invalid'"""
    exc = ValueError("empty KV")
    assert worker._classify_fallback(exc) == "empty_or_invalid"


@pytest.fixture
def fake_extract_dispatch(monkeypatch):
    """替换 textin.adapter 的两个提取函数为可追踪 fake。"""
    calls: list[tuple[str, dict]] = []

    def fake_run_extraction_v3(client, **kwargs):
        calls.append(("v3", kwargs))
        return {
            "vendor": "textin",
            "structured": {"invoice_number": "INV-9"},
            "field_source": "extract_v3",
            "page_count": 1,
            "duration_ms": 0,
            "missing_pages": [],
            "table_count": 0,
            "field_count": 1,
        }

    def fake_run_extraction(client, **kwargs):
        calls.append(("prompt", kwargs))
        return {
            "vendor": "textin",
            "structured": {"llm_key": "llm_val"},
            "field_source": "prompt",
            "page_count": 1,
            "duration_ms": 0,
            "missing_pages": [],
            "table_count": 0,
            "field_count": 1,
        }

    monkeypatch.setattr("textin.adapter.run_extraction_v3", fake_run_extraction_v3, raising=False)
    monkeypatch.setattr("textin.adapter.run_extraction", fake_run_extraction, raising=False)

    monkeypatch.setattr(worker, "MAX_VENDOR_RETRIES", 1)
    monkeypatch.setattr(worker, "_is_retryable", lambda e: False)
    return calls


def test_run_extraction_pipeline_uses_v3_when_enabled(fake_extract_dispatch):
    """cfg='extract_v3' → 调 run_extraction_v3,fallback_reason=None。"""
    result, actual_extractor, fallback_reason = worker._run_extraction_pipeline(
        client=None,
        app_config={"EXTRACT_V3_ENABLED": True},
        params={},
        filename="a.png",
        content=b"x",
    )

    assert [name for name, _ in fake_extract_dispatch] == ["v3"]
    assert actual_extractor == "extract_v3"
    assert fallback_reason is None
    assert result["structured"] == {"invoice_number": "INV-9"}


def test_run_extraction_pipeline_uses_prompt_when_disabled(fake_extract_dispatch):
    """cfg='prompt' → 调 run_extraction,不回退。"""
    result, actual_extractor, fallback_reason = worker._run_extraction_pipeline(
        client=None,
        app_config={"EXTRACT_V3_ENABLED": False},
        params={"extract_v3": False},
        filename="a.png",
        content=b"x",
    )

    assert [name for name, _ in fake_extract_dispatch] == ["prompt"]
    assert actual_extractor == "prompt"
    assert fallback_reason is None
    assert result["structured"] == {"llm_key": "llm_val"}


def test_run_extraction_pipeline_v3_failure_falls_back_to_prompt(monkeypatch, fake_extract_dispatch):
    """v3 抛错 → 回退 prompt;actual_extractor='prompt_fallback',fallback_reason 非空。"""
    from textin.errors import TextInAPIError

    def v3_fail(client, **kwargs):
        fake_extract_dispatch.append(("v3", kwargs))
        raise TextInAPIError(40003, "schema not configured")

    monkeypatch.setattr("textin.adapter.run_extraction_v3", v3_fail, raising=False)
    monkeypatch.setattr(worker, "_is_retryable", lambda e: False)

    result, actual_extractor, fallback_reason = worker._run_extraction_pipeline(
        client=None,
        app_config={"EXTRACT_V3_ENABLED": True},
        params={},
        filename="a.png",
        content=b"x",
    )

    assert [name for name, _ in fake_extract_dispatch] == ["v3", "prompt"]
    assert actual_extractor == "prompt_fallback"
    assert fallback_reason == "vendor_error"
    assert result["structured"] == {"llm_key": "llm_val"}


def test_run_extraction_pipeline_v3_normalize_failure(monkeypatch, fake_extract_dispatch):
    """v3 内部归一器抛 TextInAPIError(-1, 'shape_invalid') → fallback_reason='normalize_failed'。"""
    from textin.errors import TextInAPIError

    def v3_fail(client, **kwargs):
        fake_extract_dispatch.append(("v3", kwargs))
        raise TextInAPIError(-1, "shape_invalid")

    monkeypatch.setattr("textin.adapter.run_extraction_v3", v3_fail, raising=False)
    monkeypatch.setattr(worker, "_is_retryable", lambda e: False)

    _, actual_extractor, fallback_reason = worker._run_extraction_pipeline(
        client=None,
        app_config={"EXTRACT_V3_ENABLED": True},
        params={},
        filename="a.png",
        content=b"x",
    )

    assert actual_extractor == "prompt_fallback"
    assert fallback_reason == "normalize_failed"


def test_run_extraction_pipeline_both_paths_fail_raises_last_error(monkeypatch):
    """v3 失败且 prompt 也失败 → 抛最后一次异常，供调用方按 _error_code 落 FAILED。"""
    from textin.errors import TextInAPIError

    def v3_fail(client, **kwargs):
        raise TextInAPIError(-1, "shape_invalid")

    def prompt_fail(client, **kwargs):
        raise TextInAPIError(40003, "vendor down")

    monkeypatch.setattr("textin.adapter.run_extraction_v3", v3_fail, raising=False)
    monkeypatch.setattr("textin.adapter.run_extraction", prompt_fail, raising=False)
    monkeypatch.setattr(worker, "_is_retryable", lambda e: False)

    with pytest.raises(TextInAPIError) as excinfo:
        worker._run_extraction_pipeline(
            client=None,
            app_config={"EXTRACT_V3_ENABLED": True},
            params={},
            filename="a.png",
            content=b"x",
        )
    assert excinfo.value.code == 40003


def test_run_extraction_pipeline_aborts_on_cancel_before_retry(monkeypatch):
    """可重试错误退避期间收到取消 → 立刻抛 _ExtractionCancelled，不再重试也不回退。"""
    from textin.errors import TextInAPIError

    calls: list[str] = []

    def v3_fail(client, **kwargs):
        calls.append("v3")
        raise TextInAPIError(429, "rate limited")

    monkeypatch.setattr("textin.adapter.run_extraction_v3", v3_fail, raising=False)
    monkeypatch.setattr("textin.adapter.run_extraction",
                        lambda c, **k: calls.append("prompt"), raising=False)
    monkeypatch.setattr(worker, "_is_retryable", lambda e: True)

    with pytest.raises(worker._ExtractionCancelled):
        worker._run_extraction_pipeline(
            client=None,
            app_config={"EXTRACT_V3_ENABLED": True},
            params={},
            filename="a.png",
            content=b"x",
            cancelled=lambda: True,
        )
    assert calls == ["v3"]
