import asyncio

import pytest
from sqlalchemy import text

from app.integrations.line import LineUnavailable
from tests.integration.db_fixtures import WEB_REDIRECT

pytestmark = pytest.mark.integration


async def _count(db, sql: str) -> int:
    return (await db.execute(text(f"select count(*) from {sql}"))).scalar_one()


async def _counts(db) -> tuple[int, int, int]:
    return (
        await _count(db, "users"),
        await _count(db, "tenants"),
        await _count(db, "customer_sessions"),
    )


async def test_first_login_creates_user_and_personal_tenant(api, db, line):  # AC-FR-SYS-001-01
    line.add("tok", "U1", name="Somchai", picture="https://p/1", email="s@example.com")
    r = await api.post("/api/v1/auth/line", json={"id_token": "tok"})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "user" and body["registered"] is False
    assert body["display_name"] == "Somchai" and body["email_suggestion"] == "s@example.com"
    assert body["email"] is None
    owner = (
        await db.execute(
            text("select owner_user_id from tenants where id = :t"), {"t": body["tenant_id"]}
        )
    ).scalar_one()
    assert owner == body["user_id"]
    assert (await api.get("/api/v1/me")).json()["user_id"] == body["user_id"]


async def test_second_login_same_user(api, db, line):  # AC-FR-SYS-001-02
    line.add("tok", "U1")
    line.codes["c0de"] = "tok"
    a = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()
    api.cookies.clear()
    b = await api.post("/api/v1/auth/line", json={"code": "c0de", "redirect_uri": WEB_REDIRECT})
    assert b.status_code == 200 and b.json()["user_id"] == a["user_id"]
    assert await _count(db, "users") == 1
    assert await _count(db, "tenants where kind = 'personal'") == 1


async def test_redirect_uri_must_be_allowed(api, line):
    line.codes["c0de"] = "tok"
    r = await api.post(
        "/api/v1/auth/line", json={"code": "c0de", "redirect_uri": "https://evil.example/cb"}
    )
    assert r.status_code == 400 and r.json()["fields"] == ["redirect_uri"]


async def test_invalid_token_401_creates_nothing(api, db):  # AC-FR-SYS-001-03
    r = await api.post("/api/v1/auth/line", json={"id_token": "forged"})
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert await _counts(db) == (0, 0, 0)


async def test_dev_identity_rejected(api, db):  # AC-FR-SYS-001-04
    r = await api.post("/api/v1/auth/line", json={"dev_id": "u1"})
    assert r.status_code == 400 and r.json()["code"] == "line_token_required"
    assert await _counts(db) == (0, 0, 0)


async def test_line_unavailable_503(api, db, line):  # AC-FR-SYS-001-05
    line.fail_with = LineUnavailable("down")
    r = await api.post("/api/v1/auth/line", json={"id_token": "tok"})
    assert r.status_code == 503 and r.json()["code"] == "line_unavailable"
    assert await _counts(db) == (0, 0, 0)


async def test_relogin_keeps_saved_profile(api, db, line):  # AC-FR-SYS-014-06
    line.add("tok", "U1", name="Old LINE name")
    uid = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()["user_id"]
    await db.execute(
        text(
            "update users set display_name = 'Saved', email = 'saved@example.com', "
            "phone = '0812345678', registered_at = now() where id = :u"
        ),
        {"u": uid},
    )
    await db.commit()
    line.add("tok", "U1", name="New LINE name", email="line@example.com")
    body = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()
    assert body["display_name"] == "Saved" and body["email"] == "saved@example.com"
    assert body["phone"] == "0812345678"


async def test_concurrent_first_login_creates_one_user(api, db, line):  # Review Focus 1
    line.add("tok", "U1")
    results = await asyncio.gather(
        api.post("/api/v1/auth/line", json={"id_token": "tok"}),
        api.post("/api/v1/auth/line", json={"id_token": "tok"}),
    )
    assert [r.status_code for r in results] == [200, 200]
    assert await _count(db, "users") == 1
    assert await _count(db, "tenants where kind = 'personal'") == 1


async def test_login_without_optional_claims(api, line):  # Review Focus 5
    line.add("tok", "U1", name=None, picture=None, email=None)
    r = await api.post("/api/v1/auth/line", json={"id_token": "tok"})
    assert r.status_code == 200
    assert r.json()["display_name"] is None and r.json()["email_suggestion"] is None


async def test_login_writes_audit(api, db, line):
    line.add("tok", "U1")
    uid = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()["user_id"]
    row = (
        await db.execute(
            text(
                "select actor_type, actor_id, action, result from audit_log "
                "where action not like 'subscription.%'"
            )
        )
    ).one()
    assert tuple(row) == ("user", str(uid), "customer.login", "success")


async def test_web_login_uses_its_own_channel(api, db, line):
    """web-pc logs in through a separate LINE Login channel of the same provider (a LINE
    MINI App channel has no callback URL); the mini app keeps its channel."""
    from tests.integration.fake_line import FakeLineClient

    web = FakeLineClient()
    api.app.state.line_web_client = web
    line.add("mini-tok", "U1")
    web.add("web-tok", "U1")  # same provider: the same LINE user ID
    web.codes["c0de"] = "web-tok"
    a = await api.post("/api/v1/auth/line", json={"id_token": "mini-tok"})
    assert a.status_code == 200
    line.codes["c0de"] = "mini-tok"  # must not be used for the web code
    b = await api.post("/api/v1/auth/line", json={"code": "c0de", "redirect_uri": WEB_REDIRECT})
    assert b.status_code == 200 and b.json()["user_id"] == a.json()["user_id"]
    web.codes.clear()
    c = await api.post("/api/v1/auth/line", json={"code": "c0de", "redirect_uri": WEB_REDIRECT})
    assert c.status_code == 401  # the mini app channel's codes are not accepted


def test_web_client_built_from_settings(app_settings):
    from pydantic import SecretStr

    from app.main import build_line_clients

    s = app_settings.model_copy(
        update={
            "line_channel_id": "2012285576",
            "line_channel_secret": SecretStr("mini"),
            "line_web_channel_id": "2012428743",
            "line_web_channel_secret": SecretStr("web"),
        }
    )
    mini, web = build_line_clients(s, http=None)
    assert (mini.channel_id, web.channel_id) == ("2012285576", "2012428743")
    old = s.model_copy(update={"line_web_channel_id": None, "line_web_channel_secret": None})
    mini, web = build_line_clients(old, http=None)
    assert web is mini  # no web channel configured: as before, one channel
