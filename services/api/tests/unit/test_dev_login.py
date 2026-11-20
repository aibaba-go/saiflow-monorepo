"""Restricted dev login on POST /api/v1/auth/line (NFR-DEV-002), without a database:
AC-NFR-DEV-001-01, AC-NFR-DEV-002-01/02/03."""

import httpx
import pytest
from pydantic import SecretStr

from app import cli
from app.config import Settings
from app.integrations.line import LineIdentity, LineInvalidToken
from app.main import create_app
from app.schemas.auth import MeResponse
from app.services import auth_service, dev_login_service, me_service
from app.services.dev_login_service import (
    DEV_IDENTITY,
    DEV_LINE_USER_ID,
    DEV_LOGIN_TOKEN,
    is_loopback_client,
)
from app.services.session_service import CUSTOMER_COOKIE, Principal

CSRF = {"X-Requested-With": "SaiFlow"}
PRINCIPAL = Principal(kind="user", session_id=11, tenant_id=22, user_id=33)


def _settings(**fields) -> Settings:
    base = {
        "db_host": "127.0.0.1",
        "db_name": "saiflow_dev",
        "db_user": "u",
        "db_password": SecretStr("p"),
        "app_env": "development",
        "dev_login_enabled": True,
    }
    return Settings(**{**base, **fields})


class FakeLine:
    """Records what reaches LINE verification; every token is invalid there."""

    def __init__(self) -> None:
        self.verified: list[str] = []
        self.exchanged: list[str] = []

    async def verify_id_token(self, id_token: str) -> LineIdentity:
        self.verified.append(id_token)
        raise LineInvalidToken()

    async def exchange_code(self, code: str, redirect_uri: str) -> str:
        self.exchanged.append(code)
        raise LineInvalidToken()


class FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def commit(self):
        pass


@pytest.fixture
def logins(monkeypatch):
    """Identities that reached the real session-opening code (patched: no database)."""
    got: list[LineIdentity] = []

    async def fake_login(db, identity, current):
        got.append(identity)
        return "session-token-value", PRINCIPAL

    async def fake_me(db, principal):
        return MeResponse(
            kind="user", tenant_id=principal.tenant_id, user_id=principal.user_id, registered=True
        )

    monkeypatch.setattr(auth_service, "login_with_identity", fake_login)
    monkeypatch.setattr(me_service, "me", fake_me)
    return got


def _client(settings: Settings, line: FakeLine | None, peer: str = "127.0.0.1"):
    app = create_app(settings)
    app.state.sessionmaker = lambda: FakeSession()
    app.state.line_client = line
    app.state.line_web_client = line
    transport = httpx.ASGITransport(app=app, client=(peer, 50000), raise_app_exceptions=False)
    # the Host a browser on this machine sends through the Vite proxy
    return httpx.AsyncClient(transport=transport, base_url="http://localhost:5173", headers=CSRF)


@pytest.mark.parametrize(
    "body",
    [
        {"id_token": DEV_LOGIN_TOKEN},  # line-mini (LIFF)
        {"code": DEV_LOGIN_TOKEN, "redirect_uri": "http://localhost:5174/login"},  # web-pc
    ],
)
async def test_reserved_token_opens_session_for_fixed_identity(logins, body):  # AC-NFR-DEV-002-01
    line = FakeLine()
    async with _client(_settings(), line) as c:
        r = await c.post("/api/v1/auth/line", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] == PRINCIPAL.user_id
    assert logins == [DEV_IDENTITY] and DEV_IDENTITY.sub == DEV_LINE_USER_ID
    assert r.cookies.get(CUSTOMER_COOKIE) == "session-token-value"
    assert line.verified == [] and line.exchanged == []  # LINE is never contacted


async def test_works_without_any_line_channel_configured(logins):
    async with _client(_settings(), None) as c:
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})
    assert r.status_code == 200 and logins == [DEV_IDENTITY]


async def test_request_cannot_choose_the_user(logins):  # AC-NFR-DEV-002-03
    body = {
        "id_token": DEV_LOGIN_TOKEN,
        "sub": "U0123456789abcdef0123456789abcdef",
        "line_user_id": "Uexisting",
        "user_id": 1,
        "dev_id": "u1",
    }
    async with _client(_settings(), FakeLine()) as c:
        r = await c.post("/api/v1/auth/line", json=body)
    assert r.status_code == 200 and logins == [DEV_IDENTITY]


@pytest.mark.parametrize(
    "body",
    [
        {"id_token": "forged-token"},
        {"id_token": DEV_LOGIN_TOKEN.upper()},
        {"id_token": DEV_LOGIN_TOKEN + " "},
        {"id_token": "Udev-saiflow-local-0001"},
    ],
)
async def test_other_tokens_go_through_line_verification(logins, body):  # AC-NFR-DEV-002-03
    line = FakeLine()
    async with _client(_settings(), line) as c:
        r = await c.post("/api/v1/auth/line", json=body)
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert line.verified == [body["id_token"]] and logins == []


async def test_both_token_kinds_at_once_is_not_dev_login(logins):
    body = {"id_token": DEV_LOGIN_TOKEN, "code": DEV_LOGIN_TOKEN, "redirect_uri": "x"}
    async with _client(_settings(), FakeLine()) as c:
        r = await c.post("/api/v1/auth/line", json=body)
    assert r.status_code == 400 and r.json()["code"] == "line_token_required" and logins == []


@pytest.mark.parametrize("peer", ["10.0.0.5", "192.168.1.20", "81.68.72.120", "::ffff:10.0.0.1"])
async def test_non_loopback_client_rejected(logins, peer):  # AC-NFR-DEV-002-02
    line = FakeLine()
    async with _client(_settings(), line, peer=peer) as c:
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert CUSTOMER_COOKIE not in r.cookies
    assert logins == [] and line.verified == []  # not even sent to LINE


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "192.168.1.20:5173"},  # a LAN device through `vite --host` (peer is the proxy)
        {"Host": "rebind.attacker.example:5173"},  # DNS rebinding onto 127.0.0.1
        {"Host": "localhost:5173", "Origin": "http://192.168.1.20:5173"},
        {"Host": "localhost:5173", "Origin": "https://evil.example"},
        {"Host": "localhost:5173", "Origin": "null"},
        {"Host": ""},
    ],
)
async def test_browser_not_on_this_machine_rejected(logins, headers):  # AC-NFR-DEV-002-02
    line = FakeLine()
    async with _client(_settings(), line) as c:
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN}, headers=headers)
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert CUSTOMER_COOKIE not in r.cookies
    assert logins == [] and line.verified == []


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "localhost:5173", "Origin": "http://localhost:5173"},
        {"Host": "127.0.0.1:8010"},
        {"Host": "[::1]:5174", "Origin": "http://[::1]:5174"},
    ],
)
async def test_browser_on_this_machine_allowed(logins, headers):  # AC-NFR-DEV-002-01
    async with _client(_settings(), FakeLine()) as c:
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN}, headers=headers)
    assert r.status_code == 200 and logins == [DEV_IDENTITY]


async def test_csrf_header_still_required(logins):
    async with _client(_settings(), FakeLine()) as c:
        r = await c.post(
            "/api/v1/auth/line",
            json={"id_token": DEV_LOGIN_TOKEN},
            headers={"X-Requested-With": ""},
        )
    assert r.status_code == 403 and r.json()["code"] == "csrf_header_missing" and logins == []


@pytest.mark.parametrize(
    "fields",
    [
        {"dev_login_enabled": False},  # the default
        {"dev_login_enabled": False, "app_env": "production"},
    ],
)
async def test_switched_off_reserved_token_is_an_ordinary_token(
    logins, fields
):  # AC-NFR-DEV-001-01
    line = FakeLine()
    async with _client(_settings(**fields), line) as c:
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert line.verified == [DEV_LOGIN_TOKEN] and logins == []


async def test_switched_off_without_line_is_unavailable_as_before(logins):
    async with _client(_settings(dev_login_enabled=False), None) as c:
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})
    assert r.status_code == 503 and r.json()["code"] == "line_unavailable" and logins == []


async def test_unsafe_target_changed_after_startup_is_still_refused(logins):
    """Defence in depth: the per-request check repeats the startup check."""
    settings = _settings()
    line = FakeLine()
    async with _client(settings, line) as c:
        c._transport.app.state.settings = settings.model_copy(update={"db_name": "saiflow"})  # type: ignore[attr-defined]
        r = await c.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})
    assert r.status_code == 401 and logins == [] and line.verified == [DEV_LOGIN_TOKEN]


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("127.0.0.1", True),
        ("127.0.0.2", True),
        ("::1", True),
        ("::ffff:127.0.0.1", True),
        ("10.0.0.1", False),
        ("81.68.72.120", False),
        ("localhost", False),  # a name, not the TCP peer address
        ("testclient", False),
        ("", False),
        (None, False),
    ],
)
def test_loopback_client(host, expected):
    assert is_loopback_client(host) is expected


def test_dev_identity_is_not_a_real_line_id():
    assert not (len(DEV_LINE_USER_ID) == 33 and DEV_LINE_USER_ID[1:].isalnum())


@pytest.mark.parametrize(
    "env",
    [
        {"DB_HOST": "81.68.72.120", "DB_NAME": "saiflow_dev", "APP_ENV": "development"},
        {"DB_HOST": "127.0.0.1", "DB_NAME": "saiflow", "APP_ENV": "development"},
        {"DB_HOST": "127.0.0.1", "DB_NAME": "saiflow_test_x", "APP_ENV": "development"},
        {"DB_HOST": "127.0.0.1", "DB_NAME": "saiflow_dev"},  # APP_ENV missing
    ],
)
def test_dev_seed_refuses_unsafe_target_before_connecting(monkeypatch, capsys, env):
    for key in ["APP_ENV", "DEV_LOGIN_ENABLED"]:
        monkeypatch.delenv(key, raising=False)
    for key, value in {"DB_USER": "u", "DB_PASSWORD": "p", **env}.items():
        monkeypatch.setenv(key, value)

    def no_engine(settings):
        raise AssertionError("dev-seed connected to an unsafe target")

    monkeypatch.setattr(cli, "create_engine", no_engine)
    assert cli.main(["dev-seed"]) == 1
    assert "dev-seed refused" in capsys.readouterr().out


def test_dev_seed_runs_on_isolated_target(monkeypatch, capsys):
    for key, value in {
        "DB_HOST": "127.0.0.1",
        "DB_NAME": "saiflow_dev",
        "DB_USER": "u",
        "DB_PASSWORD": "p",
        "APP_ENV": "development",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("DEV_LOGIN_ENABLED", raising=False)

    class FakeEngine:
        async def dispose(self):
            pass

    async def fake_seed(db, now):
        return 5, 6

    monkeypatch.setattr(cli, "create_engine", lambda settings: FakeEngine())
    monkeypatch.setattr(cli, "create_sessionmaker", lambda engine: FakeSession)
    monkeypatch.setattr(dev_login_service, "seed", fake_seed)
    assert cli.main(["dev-seed"]) == 0
    assert "dev-seed OK: user 5, personal tenant 6" in capsys.readouterr().out
