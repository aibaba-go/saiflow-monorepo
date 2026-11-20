from app.errors import AppError


async def test_app_error_renders_error_response(client):
    async def taken() -> dict:
        raise AppError(409, "email_taken", "error.email_taken", ["email"])

    client._transport.app.add_api_route("/api/v1/_test/taken", taken, methods=["GET"])
    r = await client.get("/api/v1/_test/taken")
    assert r.status_code == 409
    body = r.json()
    assert body["code"] == "email_taken"
    assert body["message_key"] == "error.email_taken"
    assert body["fields"] == ["email"]
    assert body["request_id"] == r.headers["X-Request-ID"]
