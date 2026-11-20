"""LIFF observation only: FR-PLAT-002/003, FR-SYS-040/107, NFR-SEC-007."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from app.liff_diagnostics import HEADER, LiffDiagnostics, parse_diagnostic


def diagnostic(**updates):
    return {
        "v": 1,
        "trace": "a" * 32,
        "event": "xlsx_branch",
        "init": "ready",
        "in_client": False,
        "logged_in": True,
        "os": "ios",
        "ua_line": True,
        "ua_os": "ios",
        "page": "final",
        "loopback": False,
        "api_same_origin": True,
        "liff_id": "2012285576-KbzpK5mY",
        "adapter": "real",
        "branch": "blob",
        "elapsed_ms": 42,
        **updates,
    }


def scope(value, **updates):
    return {
        "type": "http",
        "method": "GET",
        "path": "/api/v1/health",
        "headers": [(HEADER, value.encode("ascii"))],
        **updates,
    }


def test_accepts_only_bounded_observations():
    value = diagnostic()
    assert parse_diagnostic(json.dumps(value).encode()) == value
    assert parse_diagnostic(
        json.dumps(diagnostic(event="init", branch="none", in_client=None)).encode()
    )


@pytest.mark.parametrize(
    "updates",
    [
        {"password": "secret"},
        {"url": "/api/v1/export-downloads/secret"},
        {"user_agent": "raw secret"},
        {"liff_id": "secret\nforged log"},
        {"liff_id": "x" * 5000},
        {"os": "exception with secret"},
        {"page": "/invite?invite=secret"},
        {"trace": "secret"},
        {"in_client": "false"},
        {"logged_in": 1},
        {"v": True},
        {"elapsed_ms": True},
        {"elapsed_ms": -1},
        {"elapsed_ms": 86_400_001},
        {"branch": "ticket", "in_client": False, "ua_line": False},
        {"branch": "blob", "in_client": True},
        {"branch": "blob", "in_client": True, "ua_line": False},
        {"event": "init", "branch": "blob"},
    ],
)
def test_rejects_unknown_sensitive_or_invalid_fields(updates):
    assert parse_diagnostic(json.dumps(diagnostic(**updates)).encode()) is None


@pytest.mark.parametrize(
    "updates",
    [
        # Current client: LINE browser uses server attachments even when isInClient is false.
        {"in_client": False, "ua_line": True, "branch": "ticket"},
        # A cached previous bundle may still report the old blob decision.
        {"in_client": False, "ua_line": True, "branch": "blob"},
        {"in_client": True, "ua_line": False, "branch": "ticket"},
        {"in_client": False, "ua_line": False, "branch": "blob"},
        {"in_client": None, "branch": "error"},
    ],
)
def test_accepts_consistent_download_branches(updates):
    assert parse_diagnostic(json.dumps(diagnostic(**updates)).encode())


@pytest.mark.parametrize("raw", [b"{", b"[]", b"null", b"x" * 1025, b"\xff"])
def test_invalid_header_is_ignored(raw):
    assert parse_diagnostic(raw) is None


def test_duplicate_keys_and_missing_fields_are_rejected():
    raw = json.dumps(diagnostic())[:-1] + ', "in_client": true}'
    assert parse_diagnostic(raw.encode()) is None
    value = diagnostic()
    del value["os"]
    assert parse_diagnostic(json.dumps(value).encode()) is None


def test_logs_only_health_get_and_never_logs_raw_input(caplog):
    caplog.set_level("INFO")
    recorder = LiffDiagnostics()
    value = json.dumps(diagnostic())
    recorder.record(scope(value))
    recorder.record(scope(value, method="POST"))
    recorder.record(scope(value, path="/api/v1/exports/secret/download"))
    recorder.record(scope(json.dumps(diagnostic(password="secret"))))
    recorder.record(scope(value, headers=[(HEADER, value.encode()), (HEADER, value.encode())]))
    records = [r for r in caplog.records if r.name == "app.liff"]
    assert len(records) == 1
    assert records[0].getMessage().startswith("liff_diagnostic ")
    assert "secret" not in caplog.text


def test_rate_limits_are_separate_from_health_and_expire(caplog):
    caplog.set_level("INFO")
    now = datetime(2026, 11, 12, tzinfo=UTC)
    recorder = LiffDiagnostics(clock=lambda: now)
    for _ in range(25):
        recorder.record(scope(json.dumps(diagnostic())))
    assert len([r for r in caplog.records if r.name == "app.liff"]) == 20
    now += timedelta(seconds=61)
    recorder.record(scope(json.dumps(diagnostic())))
    assert len([r for r in caplog.records if r.name == "app.liff"]) == 21


def test_global_limit_bounds_distinct_trace_keys(caplog):
    caplog.set_level("INFO")
    recorder = LiffDiagnostics()
    for i in range(150):
        recorder.record(scope(json.dumps(diagnostic(trace=f"{i:032x}"))))
    assert len([r for r in caplog.records if r.name == "app.liff"]) == 120
    assert len(recorder.per_trace._hits) == 120


async def test_health_contract_and_request_id_unchanged(client_db_ok, caplog):
    caplog.set_level("INFO")
    baseline = await client_db_ok.get("/api/v1/health")
    response = await client_db_ok.get(
        "/api/v1/health?secret-query-value=secret",
        headers={"X-SaiFlow-Liff": json.dumps(diagnostic()), "X-Request-ID": "liff-123"},
    )
    assert response.status_code == baseline.status_code == 200
    assert response.json() == baseline.json()
    records = [r for r in caplog.records if r.name == "app.liff"]
    assert len(records) == 1 and records[0].request_id == "liff-123"
    messages = [r.getMessage() for r in caplog.records if r.name.startswith("app")]
    assert not any("secret-query-value" in message for message in messages)


async def test_bad_diagnostics_do_not_break_health(client_db_ok, caplog):
    caplog.set_level("INFO")
    response = await client_db_ok.get(
        "/api/v1/health", headers={"X-SaiFlow-Liff": json.dumps(diagnostic(url="secret"))}
    )
    assert response.status_code == 200
    assert not [r for r in caplog.records if r.name == "app.liff"]
    assert "secret" not in caplog.text


async def test_recorder_failure_does_not_break_health(client_db_ok, monkeypatch):
    def fail(*args):
        raise RuntimeError("unavailable")

    monkeypatch.setattr(LiffDiagnostics, "record", fail)
    response = await client_db_ok.get("/api/v1/health")
    assert response.status_code == 200
