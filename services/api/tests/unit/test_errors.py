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
