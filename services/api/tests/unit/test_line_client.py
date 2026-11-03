from urllib.parse import parse_qs

import httpx
import pytest

from app.integrations.line import LineClient, LineIdentity, LineInvalidToken, LineUnavailable

CHANNEL = "2011688528"
GOOD = {
    "iss": "https://access.line.me",
    "aud": CHANNEL,
    "sub": "U123",
    "name": "Somchai",
    "picture": "https://profile.line-scdn.net/x",
    "email": "s@example.com",
}


class Sleep:
    def __init__(self):
        self.delays: list[float] = []

    async def __call__(self, d: float) -> None:
        self.delays.append(d)


def make(handler, secret: str | None = "s3cr3t"):
    calls: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    sleep = Sleep()
    http = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
    return LineClient(CHANNEL, secret, http, sleep=sleep), calls, sleep


async def test_verify_ok_returns_identity():
    client, calls, _ = make(lambda r: httpx.Response(200, json=GOOD))
    identity = await client.verify_id_token("tok")
    assert identity == LineIdentity("U123", "Somchai", GOOD["picture"], "s@example.com")
    assert str(calls[0].url) == "https://api.line.me/oauth2/v2.1/verify"
    assert parse_qs(calls[0].content.decode()) == {"id_token": ["tok"], "client_id": [CHANNEL]}


@pytest.mark.parametrize("field,value", [("aud", "999"), ("iss", "https://evil.example")])
async def test_verify_rejects_wrong_audience_or_issuer(field, value):
    client, _, _ = make(lambda r: httpx.Response(200, json={**GOOD, field: value}))
    with pytest.raises(LineInvalidToken):
        await client.verify_id_token("tok")


async def test_verify_400_is_invalid_without_retry():
    client, calls, _ = make(lambda r: httpx.Response(400, json={"error": "invalid_request"}))
    with pytest.raises(LineInvalidToken):
        await client.verify_id_token("tok")
    assert len(calls) == 1


async def test_verify_retries_5xx_then_unavailable():
    client, calls, sleep = make(lambda r: httpx.Response(503))
    with pytest.raises(LineUnavailable):
        await client.verify_id_token("tok")
    assert len(calls) == 4 and sleep.delays == [0.5, 1.0, 2.0]


async def test_verify_timeout_is_transient():
    def boom(request):
        raise httpx.ReadTimeout("slow", request=request)

    client, calls, _ = make(boom)
    with pytest.raises(LineUnavailable):
        await client.verify_id_token("tok")
    assert len(calls) == 4


async def test_verify_429_is_transient():
    client, calls, _ = make(lambda r: httpx.Response(429))
    with pytest.raises(LineUnavailable):
        await client.verify_id_token("tok")
    assert len(calls) == 4


async def test_exchange_code_returns_id_token():
    client, calls, _ = make(
        lambda r: httpx.Response(200, json={"id_token": "idt", "access_token": "a"})
    )
    assert await client.exchange_code("c0de", "https://saiflow-app.aibaba.asia/login") == "idt"
    form = parse_qs(calls[0].content.decode())
    assert str(calls[0].url) == "https://api.line.me/oauth2/v2.1/token"
    assert form["grant_type"] == ["authorization_code"] and form["client_secret"] == ["s3cr3t"]
    assert form["redirect_uri"] == ["https://saiflow-app.aibaba.asia/login"]


async def test_exchange_code_without_secret_is_unavailable():
    client, calls, _ = make(lambda r: httpx.Response(200, json={"id_token": "x"}), secret=None)
    with pytest.raises(LineUnavailable):
        await client.exchange_code("c", "https://x")
    assert calls == []
