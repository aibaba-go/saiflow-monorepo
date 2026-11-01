"""FR-OCR-017 / NFR-REL-001/002: first TextIn call plus at most three retries.

Exercise real OcrWorker._process_inner -> run_extraction -> TextInClient using
only synthetic inputs and MockTransport. Never import app.py or start a worker.
Run in services/api with -B, cacheprovider disabled and basetemp in repo/temp.
"""
from __future__ import annotations

import base64
import builtins
import copy
import importlib
import importlib.util
import json
import smtplib
import socket
import sqlite3
import sys
import threading
import time
from contextlib import nullcontext
from datetime import timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, call

import httpx
import pytest
from sqlalchemy.engine import Engine

API_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = API_DIR.parents[1] / "temp" / "textin-retry"
ENDPOINT = "https://textin-retry.invalid/ai/service/v2/entity_extraction"
CONTENT = b"synthetic OCR regression bytes; not a business document"
FILENAME = "synthetic-retry.pdf"
PARAMS = {"page": 2, "page_count": 3, "field_names": ["unused-synthetic-field"]}
STRUCTURED = {"synthetic_label": "fixture", "synthetic_rows": [{"value": "fixture"}]}


class ForbiddenExternalIO(BaseException):
    """Do not let the worker's broad Exception handler hide an isolation breach."""


@pytest.fixture(autouse=True)
def isolated_io(monkeypatch):
    def forbidden(*args, **kwargs):
        raise ForbiddenExternalIO("TextIn regressions forbid real network/DB/SMTP/worker I/O")

    original_import = builtins.__import__

    def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        # Flask's relative `.app` is unrelated to the repository's app.py.
        if level == 0 and (name == "app" or name.startswith("app.")):
            raise ForbiddenExternalIO("TextIn regressions must not import app.py")
        return original_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", safe_import)
    monkeypatch.setattr(Engine, "connect", forbidden)
    monkeypatch.setattr(Engine, "raw_connection", forbidden)
    monkeypatch.setattr(sqlite3, "connect", forbidden)
    monkeypatch.setattr(threading.Thread, "start", forbidden)
    for name in ("create_connection", "getaddrinfo", "gethostbyname", "gethostbyname_ex"):
        monkeypatch.setattr(socket, name, forbidden)
    for name in ("connect", "connect_ex", "send", "sendall", "sendto"):
        monkeypatch.setattr(socket.socket, name, forbidden)
    for transport in (httpx.HTTPTransport, httpx.AsyncHTTPTransport):
        monkeypatch.setattr(transport, "__init__", forbidden)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbidden)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    original_send = httpx.Client.send

    def mock_transport_only(client, request, *args, **kwargs):
        if not isinstance(client._transport_for_url(request.url), httpx.MockTransport):
            forbidden()
        return original_send(client, request, *args, **kwargs)

    monkeypatch.setattr(httpx.Client, "send", mock_transport_only)
    for smtp_type in (smtplib.SMTP, smtplib.SMTP_SSL):
        for name in (
            "__init__", "connect", "_get_socket", "send", "docmd", "ehlo",
            "starttls", "login", "sendmail", "send_message",
        ):
            monkeypatch.setattr(smtp_type, name, forbidden)
    import dotenv

    monkeypatch.setattr(dotenv, "load_dotenv", forbidden)
    monkeypatch.setattr(dotenv, "dotenv_values", forbidden)
    sleep = Mock(name="fake_sleep")
    monkeypatch.setattr(time, "sleep", sleep)
    return SimpleNamespace(forbidden=forbidden, sleep=sleep)


@pytest.fixture
def implementation(isolated_io, monkeypatch):
    # Import only the provider modules; Settings.model_construct never reads env/files.
    config = importlib.import_module("textin.config")
    monkeypatch.setattr(config, "build_textin_settings", isolated_io.forbidden)
    client = importlib.import_module("textin.client")
    adapter = importlib.import_module("textin.adapter")
    errors = importlib.import_module("textin.errors")
    spec = importlib.util.spec_from_file_location("_isolated_textin_retry_worker", API_DIR / "worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return SimpleNamespace(worker=worker, client=client, adapter=adapter, errors=errors, config=config)


def _module(name, **attributes):
    module = ModuleType(name)
    module.__dict__.update(attributes)
    return module


@pytest.fixture
def harness(implementation, isolated_io, monkeypatch):
    clients = []

    def make(outcomes, *, cancel_after_failure=None, cancel_during_sleep=None, refine=True):
        job = SimpleNamespace(
            id="synthetic-job", file_id="synthetic-file", created_by_user_id=10001,
            status="QUEUED", progress=0, params=copy.deepcopy(PARAMS), capability={},
            error_code="", error_message="", started_at=None, finished_at=None,
            duration_ms=None, page_count=0, table_count=0, field_count=0, missing_pages=[],
        )
        file = SimpleNamespace(
            id=job.file_id, status="READY", page_count=7, original_name=FILENAME,
            storage_path="synthetic/source-only",
        )
        user = SimpleNamespace(id=job.created_by_user_id)
        job_model = type("OcrJob", (), {"query": Mock(name="job_query")})
        file_model = type("File", (), {})
        user_model = type("User", (), {})
        version_model = Mock(name="ResultVersion", side_effect=lambda **kw: SimpleNamespace(**kw))
        raw_model = Mock(name="OcrRawResult", side_effect=lambda **kw: SimpleNamespace(**kw))
        session = Mock(name="session")
        state = SimpleNamespace(
            job=job, file=file, user=user, session=session, requests=[], events=[],
            pending=[], persisted=[], commits=[], version_model=version_model, raw_model=raw_model,
            sleep=isolated_io.sleep, implementation=implementation,
        )

        def claim(values, *, synchronize_session):
            assert synchronize_session is False
            if job.status != "QUEUED":
                return 0
            job.__dict__.update(values)
            return 1

        job_model.query.filter_by.return_value.update.side_effect = claim
        records = {(job_model, job.id): job, (file_model, file.id): file, (user_model, user.id): user}
        session.get.side_effect = lambda model, key, **kwargs: records.get((model, key))
        session.add.side_effect = state.pending.append

        def commit():
            state.persisted.extend(state.pending)
            state.pending.clear()
            state.commits.append((job.status, len(state.persisted)))

        session.commit.side_effect = commit
        session.rollback.side_effect = lambda: state.events.append(("cancel-check", job.status))
        state.storage = _module(
            "storage", exists=Mock(return_value=True), get_bytes=Mock(return_value=CONTENT),
            put_bytes=Mock(name="audit_write"),
        )
        state.notify = Mock(name="notify")
        state.deepseek = _module(
            "deepseek", is_configured=Mock(return_value=refine),
            refine_json=Mock(side_effect=lambda structured, config: copy.deepcopy(structured)),
        )
        # Each named replacement is restored by pytest's monkeypatch fixture, even on failure.
        for name, module in {
            "extensions": _module("extensions", db=SimpleNamespace(session=session)),
            "models": _module(
                "models", OcrJob=job_model, File=file_model, User=user_model, ResultVersion=version_model,
                OcrRawResult=raw_model,
            ),
            "storage": state.storage,
            "auth": _module("auth", notify=state.notify),
            "deepseek": state.deepseek,
        }.items():
            monkeypatch.setitem(sys.modules, name, module)

        def handle(request):
            state.requests.append(request)
            number = len(state.requests)
            state.events.append(("request", number))
            if number > len(outcomes):
                pytest.fail("Unexpected extra TextIn call after success/retry exhaustion/cancellation")
            if cancel_after_failure == number:
                job.status = "CANCEL_REQUESTED"
            outcome = outcomes[number - 1]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        settings = implementation.config.TextInSettings.model_construct(
            textin_app_id="synthetic-app-id", textin_secret_code="synthetic-secret-code",
            textin_endpoint="https://textin-retry.invalid/parse",
            textin_extract_endpoint="https://textin-retry.invalid/extract",
            textin_prompt_endpoint=ENDPOINT,
            ocr_storage_dir=ARTIFACT_DIR / "unused-records",
            ocr_uploads_dir=ARTIFACT_DIR / "unused-uploads",
            timeout_seconds=1.0, prompt_timeout_seconds=1.0, connect_timeout_seconds=1.0,
        )
        state.client = implementation.client.TextInClient(settings, transport=httpx.MockTransport(handle))
        clients.append(state.client)
        app = SimpleNamespace(
            extensions={"textin_client": state.client},
            config={"DEEPSEEK_MODEL": "synthetic-refiner"}, app_context=nullcontext,
        )
        state.worker = implementation.worker.OcrWorker(app)

        def fake_sleep(delay):
            state.events.append(("sleep", delay))
            if cancel_during_sleep == isolated_io.sleep.call_count:
                job.status = "CANCEL_REQUESTED"

        isolated_io.sleep.side_effect = fake_sleep
        state.process = lambda: state.worker._process_inner(job.id)
        return state

    yield make
    for client in clients:
        client.close()


def _success(*, structured=None):
    return httpx.Response(200, json={
        "code": 200, "result": {"llm_json": copy.deepcopy(STRUCTURED if structured is None else structured)},
        "page_count": 3, "duration": 17,
    })


RETRYABLE_KINDS = [
    "http-502-non-json", "http-503-no-code", "http-500-code-200", "http-408", "http-429",
    "http-599-code-200", "business-429", "business-458", "business-459", "business-40306",
    "business-408", "business-30203", "business-500", "business-503", "business-599",
    "read-timeout", "connect-timeout", "write-timeout", "pool-timeout",
    "connect-error", "read-error", "protocol-error", "transport-error",
    "invalid-json", "top-level-list", "top-level-null", "missing-llm-json",
    "invalid-llm-json", "scalar-llm-json", "null-llm-json",
]


def _failure(kind, attempt=1):
    message = f"synthetic failure attempt-{attempt}"
    if kind.startswith("business-"):
        return httpx.Response(200, json={"code": int(kind.removeprefix("business-")), "message": message})
    if kind == "http-502-non-json":
        return httpx.Response(502, text=f"<html>{message}</html>")
    if kind in {"http-500-code-200", "http-599-code-200"}:
        return httpx.Response(int(kind.split("-")[1]), json={
            "code": 200, "message": message, "result": {"llm_json": STRUCTURED},
        })
    if kind in {"http-503-no-code", "http-408", "http-429"}:
        return httpx.Response(int(kind.split("-")[1]), json={"message": message})
    network_errors = {
        "read-timeout": httpx.ReadTimeout, "connect-timeout": httpx.ConnectTimeout,
        "write-timeout": httpx.WriteTimeout, "pool-timeout": httpx.PoolTimeout,
        "connect-error": httpx.ConnectError, "read-error": httpx.ReadError,
        "protocol-error": httpx.RemoteProtocolError, "transport-error": httpx.TransportError,
    }
    if kind in network_errors:
        return network_errors[kind](message)
    if kind == "invalid-json":
        return httpx.Response(200, text=f"invalid JSON {message}")
    if kind == "top-level-list":
        return httpx.Response(200, json=[{"code": 200}])
    if kind == "top-level-null":
        return httpx.Response(200, content=b"null")
    llm_results = {
        "missing-llm-json": {}, "invalid-llm-json": {"llm_json": "not valid JSON"},
        "scalar-llm-json": {"llm_json": "42"}, "null-llm-json": {"llm_json": None},
    }
    return httpx.Response(200, json={"code": 200, "result": llm_results[kind]})


def _expected_error_code(kind):
    if kind.endswith("timeout"):
        return "VENDOR_TIMEOUT"
    if kind.endswith("error"):
        return "VENDOR_TRANSPORT"
    if kind.startswith("business-"):
        return f"TEXTIN_ERROR_{kind.removeprefix('business-')}"
    if kind in {"http-500-code-200", "http-599-code-200"}:
        return f"TEXTIN_ERROR_{kind.split('-')[1]}"
    return "TEXTIN_ERROR_-1"


def _assert_requests(state, count):
    assert len(state.requests) == count
    for request in state.requests:
        assert request.method == "POST"
        assert str(request.url.copy_with(query=None)) == ENDPOINT
        assert dict(request.url.params) == {"file_name": FILENAME, "page_start": "2", "page_count": "3"}
        assert json.loads(request.content) == {
            "file": base64.b64encode(CONTENT).decode("ascii"),
            "prompt": state.implementation.adapter.EXTRACT_PROMPT,
        }
        assert request.headers["x-ti-app-id"] == "synthetic-app-id"
        assert request.headers["x-ti-secret-code"] == "synthetic-secret-code"
        assert request.headers["content-type"].startswith("application/json")
    assert state.job.params == PARAMS
    state.storage.exists.assert_called_once_with(state.file.storage_path)
    state.storage.get_bytes.assert_called_once_with(state.file.storage_path)


def _assert_success(state, count):
    _assert_requests(state, count)
    assert state.job.status == "SUCCEEDED"
    assert state.job.progress == 100
    assert state.job.error_code == state.job.error_message == ""
    state.version_model.assert_called_once_with(
        job_id=state.job.id, version=1, is_current=True, created_by_user_id=None, structured=STRUCTURED,
    )
    # FR-OCR-021：原始结果与 v1 在同一事务中写入（原始结果为 DeepSeek 之前的深拷贝）
    assert len(state.persisted) == 2
    raw, version = state.persisted
    assert state.session.add.call_args_list == [call(raw), call(version)]
    state.raw_model.assert_called_once()
    assert raw.job_id == state.job.id and raw.payload == STRUCTURED and len(raw.id) == 32
    assert version.structured == STRUCTURED
    assert version.is_current is True
    assert [entry for entry in state.commits if entry[0] == "SUCCEEDED"] == [("SUCCEEDED", 2)]
    assert state.job.duration_ms == 17 and state.job.page_count == 3
    assert (state.job.table_count, state.job.field_count) == (1, 1)
    assert state.job.capability == {"vendor": "textin", "field_source": "prompt", "refiner": "synthetic-refiner"}
    state.deepseek.is_configured.assert_called_once()
    state.deepseek.refine_json.assert_called_once_with(STRUCTURED, state.worker.app.config)
    state.storage.put_bytes.assert_called_once()
    directory, filename, content, content_type = state.storage.put_bytes.call_args.args
    assert (directory, filename, content_type) == ("audit", f"{state.job.id}.json", "application/json")
    audit = json.loads(content)
    assert audit["job_id"] == state.job.id
    assert audit["summary"] == {
        "page_count": 3, "table_count": 1, "field_count": 1, "missing_pages": [],
        "duration_ms": 17, "field_source": "prompt", "vendor": "textin",
    }
    # OCR 完成不再发站内通知（通知中心只承载账户变动，FR-SYS-018）
    state.notify.assert_not_called()


def _assert_no_success(state, *, status="FAILED"):
    assert state.job.status == status
    assert state.job.progress != 100
    assert state.job.finished_at is None
    assert not state.persisted and not state.pending
    state.version_model.assert_not_called()
    state.session.add.assert_not_called()
    state.storage.put_bytes.assert_not_called()
    state.notify.assert_not_called()
    state.deepseek.is_configured.assert_not_called()
    state.deepseek.refine_json.assert_not_called()
    assert all(status != "POSTPROCESSING" for status, _ in state.commits)


@pytest.mark.parametrize("failed_calls", range(4))
def test_earliest_success_breaks_without_an_extra_call(harness, failed_calls):
    state = harness([_failure("business-429", n + 1) for n in range(failed_calls)] + [_success()])
    state.process()
    _assert_success(state, failed_calls + 1)
    assert state.sleep.call_args_list == [call(delay) for delay in [2, 4, 8][:failed_calls]]


def test_raw_result_is_a_copy_taken_before_deepseek(harness):
    """FR-OCR-021：DeepSeek 改写 v1 时，原始结果仍是 TextIn llm_json 原样。"""
    state = harness([_success()])
    state.deepseek.refine_json.side_effect = lambda structured, config: {"refined": True}
    state.process()
    raw, version = state.persisted
    assert raw.payload == STRUCTURED
    assert version.structured == {"refined": True}


def test_mapping_enabled_skips_deepseek_and_creates_auto_mapping(harness, monkeypatch):
    """design D6：开关开启时 v1 = 原始结果，不调用 DeepSeek，并在同一事务创建自动映射。"""
    state = harness([_success()])
    state.worker.app.config["TEMPLATE_MAPPING_ENABLED"] = True
    created = []
    service = _module(
        "doc_templates.service",
        create_auto_mapping=Mock(side_effect=lambda job, raw_id, version: created.append((job, raw_id, version))),
    )
    monkeypatch.setitem(sys.modules, "doc_templates.service", service)
    monkeypatch.setitem(sys.modules, "doc_templates", _module("doc_templates", service=service))
    state.process()
    state.deepseek.is_configured.assert_not_called()
    state.deepseek.refine_json.assert_not_called()
    raw, version = state.persisted
    assert raw.payload == STRUCTURED and version.structured == STRUCTURED
    assert created == [(state.job, raw.id, version)]
    state.session.flush.assert_called_once()
    assert state.job.status == "SUCCEEDED"
    assert "refiner" not in state.job.capability


@pytest.mark.parametrize("kind", RETRYABLE_KINDS)
def test_three_failures_then_fourth_call_succeeds(harness, kind):
    state = harness([_failure(kind, n) for n in range(1, 4)] + [_success()])
    state.process()
    _assert_success(state, 4)
    assert state.sleep.call_args_list == [call(2), call(4), call(8)]
    assert [event for event in state.events if event[0] in {"request", "sleep"}] == [
        ("request", 1), ("sleep", 2), ("request", 2), ("sleep", 4),
        ("request", 3), ("sleep", 8), ("request", 4),
    ]


@pytest.mark.parametrize("kind", RETRYABLE_KINDS)
def test_continuous_failure_stops_after_exactly_four_calls(harness, kind):
    state = harness([_failure(kind, n) for n in range(1, 5)])
    state.process()
    _assert_requests(state, 4)
    _assert_no_success(state)
    assert state.sleep.call_args_list == [call(2), call(4), call(8)]
    assert state.job.error_code == _expected_error_code(kind)
    assert state.job.error_message
    if (kind.startswith(("business-", "http-")) and kind != "http-502-non-json") or kind.endswith(("timeout", "error")):
        assert "attempt-4" in state.job.error_message
    assert [entry for entry in state.commits if entry[0] == "FAILED"] == [("FAILED", 0)]


def test_exhaustion_persists_the_last_error_not_the_first(harness):
    state = harness([
        _failure("business-429", 1), _failure("read-timeout", 2),
        _failure("http-502-non-json", 3), _failure("business-40306", 4),
    ])
    state.process()
    _assert_requests(state, 4)
    _assert_no_success(state)
    assert state.job.error_code == "TEXTIN_ERROR_40306"
    assert state.job.error_message == "TextIn API error 40306: synthetic failure attempt-4"
    assert state.sleep.call_args_list == [call(2), call(4), call(8)]


@pytest.mark.parametrize("attempt", [1, 2, 3, 4])
def test_cancellation_immediately_after_failure_prevents_retry(harness, attempt):
    state = harness(
        [_failure("business-429", n) for n in range(1, 5)], cancel_after_failure=attempt,
    )
    state.process()
    _assert_requests(state, attempt)
    _assert_no_success(state, status="CANCELLED")
    assert state.sleep.call_args_list == [call(delay) for delay in [2, 4, 8][:attempt - 1]]
    assert ("cancel-check", "CANCEL_REQUESTED") in state.events
    assert state.job.error_code == state.job.error_message == ""


@pytest.mark.parametrize("sleep_number", [1, 2, 3])
def test_cancellation_during_backoff_is_checked_before_next_vendor_call(harness, sleep_number):
    state = harness(
        [_failure("read-timeout", n) for n in range(1, 5)], cancel_during_sleep=sleep_number,
    )
    state.process()
    _assert_requests(state, sleep_number)
    _assert_no_success(state, status="CANCELLED")
    assert state.sleep.call_args_list == [call(delay) for delay in [2, 4, 8][:sleep_number]]
    assert state.events[-2:] == [("sleep", [2, 4, 8][sleep_number - 1]), ("cancel-check", "CANCEL_REQUESTED")]
    assert state.job.error_code == state.job.error_message == ""


@pytest.mark.parametrize("code", [40003, 40301, 40302, 40001, 40002])
@pytest.mark.parametrize("http_status", [200, 503])
def test_permanent_business_errors_do_not_retry_even_with_rate_message_or_http_503(harness, code, http_status):
    state = harness([httpx.Response(http_status, json={"code": code, "message": "synthetic rate limit text"})])
    state.process()
    _assert_requests(state, 1)
    _assert_no_success(state)
    state.sleep.assert_not_called()
    assert state.job.error_code == f"TEXTIN_ERROR_{code}"
    assert state.job.error_message == f"TextIn API error {code}: synthetic rate limit text"


@pytest.mark.parametrize("http_status", [200, 503])
def test_gbk_balance_error_is_preserved_and_never_retried(harness, http_status):
    message = "余额不足，synthetic rate message"
    content = json.dumps({"code": 40003, "message": message}, ensure_ascii=False).encode("gbk")
    state = harness([httpx.Response(http_status, content=content)])
    state.process()
    _assert_requests(state, 1)
    _assert_no_success(state)
    state.sleep.assert_not_called()
    assert state.job.error_code == "TEXTIN_ERROR_40003"
    assert state.job.error_message == f"TextIn API error 40003: {message}"
    assert "\ufffd" not in state.job.error_message


@pytest.mark.parametrize("http_status", [400, 401, 403])
@pytest.mark.parametrize("body_kind", ["success", "retryable-business", "no-code", "invalid-json", "list"])
def test_non_retryable_http_4xx_cannot_be_overridden_by_body(harness, http_status, body_kind):
    if body_kind == "success":
        response = httpx.Response(http_status, json={"code": 200, "result": {"llm_json": STRUCTURED}})
        expected_code = http_status
    elif body_kind == "retryable-business":
        response = httpx.Response(http_status, json={"code": 429, "message": "synthetic rate"})
        expected_code = 429
    elif body_kind == "no-code":
        response = httpx.Response(http_status, json={"message": "synthetic rate"})
        expected_code = -1
    else:
        response = httpx.Response(http_status, text="not JSON") if body_kind == "invalid-json" else httpx.Response(http_status, json=[])
        expected_code = -1
    state = harness([response])
    state.process()
    _assert_requests(state, 1)
    _assert_no_success(state)
    state.sleep.assert_not_called()
    assert state.job.error_code == f"TEXTIN_ERROR_{expected_code}"


def test_local_value_error_is_not_retried_or_misclassified(harness):
    state = harness([ValueError("synthetic local rate validation failure")])
    state.process()
    _assert_requests(state, 1)
    _assert_no_success(state)
    state.sleep.assert_not_called()
    assert state.job.error_code == "OCR_FAILED"
    assert state.job.error_message == "synthetic local rate validation failure"


@pytest.mark.parametrize("kind,code,status", [
    ("http-502-non-json", -1, 502), ("http-503-no-code", -1, 503),
    ("http-500-code-200", 500, 500), ("invalid-json", -1, 200),
    ("top-level-list", -1, 200), ("top-level-null", -1, 200),
    ("business-500", 500, 200), ("business-40306", 40306, 200),
    ("business-429", 429, 200), ("business-458", 458, 200), ("business-459", 459, 200),
])
def test_parse_preserves_business_code_and_carries_http_status(implementation, kind, code, status):
    with pytest.raises(implementation.errors.TextInAPIError) as raised:
        implementation.client.TextInClient._parse(_failure(kind))
    assert raised.value.code == code
    assert raised.value.http_status == status
    assert implementation.worker._error_code(raised.value) == f"TEXTIN_ERROR_{code}"


@pytest.mark.parametrize("code", [429, "429", -1, 40003])
def test_error_http_status_is_optional_keyword_only_and_preserves_original_fields(implementation, code):
    error_type = implementation.errors.TextInAPIError
    original = error_type(code, "synthetic original message")
    enriched = error_type(code, "synthetic original message", http_status=503)
    assert original.http_status is None
    assert enriched.http_status == 503
    assert original.code == enriched.code == code
    assert original.message == enriched.message == "synthetic original message"
    assert str(original) == str(enriched) == f"TextIn API error {code}: synthetic original message"
    with pytest.raises(TypeError):
        error_type(code, "synthetic", 503)


@pytest.mark.parametrize("code", [-1, 429, 458, 459, 40306, 30203, 408, *range(500, 600)])
def test_retryable_business_allowlist_and_complete_5xx_range(implementation, code):
    for value in (code, str(code)):
        assert implementation.worker._is_retryable(implementation.errors.TextInAPIError(value, "synthetic"))


@pytest.mark.parametrize("code,status,expected", [
    (40003, None, False), (40003, 503, False), (40301, 503, False), (40001, 503, False),
    (40003, 429, False), (40003, 408, False),
    (429, 400, False), (458, 401, False), (459, 403, False), (40306, 403, False),
    (-1, 400, False), (500, 401, False), (499, None, False), (600, None, False),
    (30203, None, True),  # TextIn v2 文档：基础服务故障，请稍后重试。
    (408, 408, True), (429, 429, True), (500, 500, True), (503, 503, True),
    (-1, 502, True), (-1, 200, True), (12345, 503, True),
])
def test_retry_classification_uses_codes_and_http_status_not_message(implementation, code, status, expected):
    for message in ("synthetic", "synthetic rate limit timeout message"):
        error = implementation.errors.TextInAPIError(code, message, http_status=status)
        assert implementation.worker._is_retryable(error) is expected


@pytest.mark.parametrize("error_type,expected", [
    (httpx.ReadTimeout, "VENDOR_TIMEOUT"), (httpx.ConnectTimeout, "VENDOR_TIMEOUT"),
    (httpx.WriteTimeout, "VENDOR_TIMEOUT"), (httpx.PoolTimeout, "VENDOR_TIMEOUT"),
    (httpx.TransportError, "VENDOR_TRANSPORT"), (httpx.ConnectError, "VENDOR_TRANSPORT"),
    (httpx.RemoteProtocolError, "VENDOR_TRANSPORT"), (ValueError, "OCR_FAILED"),
    (RuntimeError, "OCR_FAILED"),
])
def test_network_and_local_error_mapping_stays_compatible(implementation, error_type, expected):
    error = error_type("synthetic rate message")
    assert implementation.worker._error_code(error) == expected
    assert implementation.worker._is_retryable(error) is isinstance(error, httpx.TransportError)


@pytest.mark.parametrize("operation", ["http", "socket", "database", "sqlite", "smtp", "thread", "app-import", "settings-builder"])
def test_isolation_guards_reject_external_io(implementation, operation):
    with pytest.raises(ForbiddenExternalIO):
        if operation == "http":
            httpx.Client(trust_env=False)
        elif operation == "socket":
            socket.create_connection(("synthetic.invalid", 443))
        elif operation == "database":
            Engine.connect(None)
        elif operation == "sqlite":
            sqlite3.connect(":memory:")
        elif operation == "smtp":
            smtplib.SMTP("synthetic.invalid", 25)
        elif operation == "thread":
            threading.Thread(target=lambda: None).start()
        elif operation == "app-import":
            __import__("app")
        else:
            implementation.config.build_textin_settings({})


@pytest.mark.parametrize("terminal", ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"])
def test_other_instance_terminal_during_backoff_stops_calls_without_overwriting(harness, terminal):
    state = harness([_failure("read-timeout", n) for n in range(1, 5)])
    preserved = {}

    def finish_elsewhere(delay):
        assert delay == 2
        state.job.status = terminal
        state.job.error_code = "VENDOR_UNCERTAIN"
        state.job.error_message = "synthetic prior terminal"
        state.job.finished_at = "synthetic-finished-at"
        preserved.update(vars(state.job))

    state.sleep.side_effect = finish_elsewhere
    state.process()
    _assert_requests(state, 1)
    assert vars(state.job) == preserved
    state.version_model.assert_not_called()
    state.storage.put_bytes.assert_not_called()
    state.notify.assert_not_called()
    state.deepseek.is_configured.assert_not_called()
    assert not state.persisted
    assert state.sleep.call_args_list == [call(2)]


@pytest.mark.parametrize("status", ["CANCEL_REQUESTED", "CANCELLED", "FAILED"])
def test_final_persistence_refreshes_and_preserves_concurrent_cancel_or_terminal(harness, status):
    state = harness([_success()])

    def concurrent_finish(structured, config):
        state.job.status = status
        return copy.deepcopy(structured)

    state.deepseek.refine_json.side_effect = concurrent_finish
    state.process()
    _assert_requests(state, 1)
    assert state.job.status == ("CANCELLED" if status == "CANCEL_REQUESTED" else status)
    state.version_model.assert_not_called()
    state.session.add.assert_not_called()
    state.storage.put_bytes.assert_not_called()
    state.notify.assert_not_called()
    locked_reads = [args for args in state.session.get.call_args_list if args.kwargs.get("with_for_update")]
    assert locked_reads and all(args.kwargs.get("populate_existing") for args in locked_reads)


@pytest.mark.parametrize("status", [
    "QUEUED", "PREPROCESSING", "PROCESSING", "POSTPROCESSING",
    "CANCEL_REQUESTED", "CANCELLED", "FAILED", "SUCCEEDED", "PARTIAL_SUCCESS",
])
def test_cancel_check_refreshes_database_state_and_recognizes_all_terminals(harness, status):
    state = harness([])
    state.job.status = status
    assert state.worker._cancel_requested(state.job.id) is (status in {
        "CANCEL_REQUESTED", "CANCELLED", "FAILED", "SUCCEEDED", "PARTIAL_SUCCESS",
    })
    assert state.session.get.call_args.kwargs == {"populate_existing": True}
    state.session.rollback.assert_called_once()
    state.session.commit.assert_not_called()


@pytest.mark.parametrize("status", ["CANCELLED", "FAILED", "SUCCEEDED", "PARTIAL_SUCCESS"])
def test_transition_does_not_overwrite_terminal_and_releases_lock(harness, status):
    state = harness([])
    state.job.status = status
    before = copy.deepcopy(vars(state.job))
    state.worker._transition(state.job.id, "PROCESSING", progress=30, error_code="new")
    assert vars(state.job) == before
    assert state.session.get.call_args.kwargs == {"with_for_update": True, "populate_existing": True}
    state.session.rollback.assert_called_once()
    state.session.commit.assert_not_called()


def test_transition_cannot_erase_pending_cancellation(harness):
    state = harness([])
    state.job.status = "CANCEL_REQUESTED"
    state.worker._transition(state.job.id, "PROCESSING", progress=30)
    assert state.job.status == "CANCELLED"
    assert state.job.progress == 0
    state.session.commit.assert_called_once()


def test_cancel_during_file_read_prevents_even_first_vendor_call(harness):
    state = harness([])

    def read_then_cancel(path):
        state.job.status = "CANCEL_REQUESTED"
        return CONTENT

    state.storage.get_bytes.side_effect = read_then_cancel
    state.process()
    assert not state.requests
    _assert_no_success(state, status="CANCELLED")
    state.sleep.assert_not_called()


def test_stale_recovery_uses_conditional_updates_and_never_requeues_vendor_stages(harness, monkeypatch):
    from datetime import datetime, timedelta

    from sqlalchemy import column

    state = harness([])
    model = sys.modules["models"].OcrJob
    monkeypatch.setattr(model, "status", column("status"), raising=False)
    monkeypatch.setattr(model, "updated_at", column("updated_at"), raising=False)
    pre_vendor = Mock(name="pre_vendor_update")
    uncertain = Mock(name="uncertain_update")
    cancelled = Mock(name="cancel_update")
    model.query.filter.side_effect = [pre_vendor, uncertain]
    model.query.filter_by.return_value = cancelled
    before = datetime.now(timezone.utc).replace(tzinfo=None)
    state.worker._recover_stale_jobs()
    after = datetime.now(timezone.utc).replace(tzinfo=None)

    filters = model.query.filter.call_args_list
    assert len(filters) == 2
    assert filters[0].args[0].compare(model.status == "PREPROCESSING")
    assert filters[1].args[0].compare(model.status.in_(["PROCESSING", "POSTPROCESSING"]))
    for query in filters:
        cutoff = query.args[1].right.value
        assert before - timedelta(minutes=10) <= cutoff <= after - timedelta(minutes=10)
        assert query.args[1].compare(model.updated_at < cutoff)
    pre_vendor.update.assert_called_once_with({"status": "QUEUED", "progress": 0}, synchronize_session=False)
    failure = uncertain.update.call_args.args[0]
    assert failure["status"] == "FAILED"
    assert failure["error_code"] == "VENDOR_UNCERTAIN"
    assert "manual Retry" in failure["error_message"]
    assert before <= failure["finished_at"] <= after
    assert uncertain.update.call_args.kwargs == {"synchronize_session": False}
    model.query.filter_by.assert_called_once_with(status="CANCEL_REQUESTED")
    cancelled.update.assert_called_once_with(
        {"status": "CANCELLED", "finished_at": failure["finished_at"]}, synchronize_session=False,
    )
    state.session.commit.assert_called_once()
    state.session.get.assert_not_called()
    state.version_model.assert_not_called()
    state.notify.assert_not_called()
    assert not state.requests
