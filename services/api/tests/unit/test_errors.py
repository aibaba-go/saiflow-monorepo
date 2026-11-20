async def test_unknown_path_returns_envelope(client):  # AC-FR-PLAT-002-01
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "not_found" and body["message_key"] == "error.not_found"
    assert body["request_id"] == r.headers["X-Request-ID"]


async def test_missing_param_lists_fields(client):  # AC-FR-PLAT-002-02
    r = await client.get("/api/v1/_test/required")
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"
    assert r.json()["message_key"] == "error.validation"
    assert r.json()["fields"] == ["q"]


async def test_unhandled_error_hides_detail(client, caplog):  # AC-FR-PLAT-002-03
    r = await client.get("/api/v1/_test/boom", headers={"X-Request-ID": "req-123"})
    assert r.status_code == 500
    assert r.json() == {
        "code": "internal_error",
        "message_key": "error.internal",
        "request_id": "req-123",
        "fields": None,
    }
    assert "internal detail xyz" not in r.text and "Traceback" not in r.text
    assert r.headers["X-Request-ID"] == "req-123"
    errors = [rec for rec in caplog.records if rec.levelname == "ERROR"]
    assert errors and errors[-1].request_id == "req-123"
    assert "internal detail xyz" in caplog.text


async def test_method_not_allowed_envelope(client):
    r = await client.post("/api/v1/_test/required")
    assert r.status_code == 405
    assert r.json()["code"] == "method_not_allowed"
    assert r.json()["message_key"] == "error.method_not_allowed"


async def test_invalid_request_id_header_is_replaced(client):
    r = await client.get("/api/v1/nope", headers={"X-Request-ID": "bad id!"})
    assert r.headers["X-Request-ID"] != "bad id!" and len(r.headers["X-Request-ID"]) == 32


async def test_validation_error_does_not_echo_input(client):
    r = await client.get("/api/v1/_test/required", params={"other": "secret-input-123"})
    assert r.status_code == 422 and "secret-input-123" not in r.text


def _access_records(caplog):
    return [rec for rec in caplog.records if rec.name == "app.access"]


async def test_404_is_logged_with_request_id(client, caplog):  # FR-PLAT-002 (log side)
    caplog.set_level("INFO")
    r = await client.get("/api/v1/nope", headers={"X-Request-ID": "req-404"})
    records = _access_records(caplog)
    assert r.status_code == 404 and records
    assert records[-1].request_id == "req-404"
    assert "GET /api/v1/nope 404" in records[-1].getMessage()


async def test_422_is_logged_with_request_id(client, caplog):
    caplog.set_level("INFO")
    await client.get("/api/v1/_test/required", headers={"X-Request-ID": "req-422"})
    assert any(
        rec.request_id == "req-422" and " 422 " in rec.getMessage() + " "
        for rec in _access_records(caplog)
    )


async def test_500_is_logged_once_in_access_log(client, caplog):
    caplog.set_level("INFO")
    await client.get("/api/v1/_test/boom", headers={"X-Request-ID": "req-500"})
    hits = [r for r in _access_records(caplog) if r.request_id == "req-500"]
    assert len(hits) == 1 and "GET /api/v1/_test/boom 500" in hits[0].getMessage()


async def test_access_log_omits_query_string(client, caplog):
    caplog.set_level("INFO")
    await client.get("/api/v1/_test/required", params={"q": "secret-query-value"})
    server_logs = [r.getMessage() for r in caplog.records if r.name.startswith("app")]
    assert server_logs and not any("secret-query-value" in m for m in server_logs)


async def test_report_ticket_is_redacted_in_access_logs(client, caplog):
    # FR-REPORT-004: a URL download credential is not a loggable resource identifier.
    caplog.set_level("INFO")
    await client.get("/api/v1/report-downloads/sensitive-report-ticket")
    messages = [r.getMessage() for r in _access_records(caplog)]
    assert messages and all("sensitive-report-ticket" not in m for m in messages)
    assert any("/api/v1/report-downloads/[redacted]" in m for m in messages)


async def test_app_error_details_in_body(client):  # rebuild-plans-metering: quota_exceeded
    r = await client.get("/api/v1/_test/details")
    body = r.json()
    assert r.status_code == 402 and body["code"] == "quota_exceeded"
    assert body["details"] == {"available": 5} and body["fields"] is None
