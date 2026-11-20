"""Restricted dev login against a real disposable database (NFR-DEV-002).

The fixtures only use loopback saiflow_test_* databases (NFR-DEV-003), which are never a
dev target, so the per-request target check is replaced here; everything after it (users,
tenants, plans, registration, sessions, audit) is the real code."""

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.services import dev_login_service
from app.services.dev_login_service import DEV_EMAIL, DEV_LINE_USER_ID, DEV_LOGIN_TOKEN

pytestmark = pytest.mark.integration


@pytest.fixture
def dev_enabled(monkeypatch):
    monkeypatch.setattr(dev_login_service, "dev_login_active", lambda settings: True)


async def _count(db, sql: str, **params) -> int:
    return (await db.execute(text(f"select count(*) from {sql}"), params)).scalar_one()


async def test_seed_is_idempotent_and_registers_the_dev_user(db):  # AC-NFR-DEV-002-01
    first = await dev_login_service.seed(db, utcnow())
    second = await dev_login_service.seed(db, utcnow())
    assert first == second
    user = (
        await db.execute(text("select line_user_id, email, display_name, registered_at from users"))
    ).one()
    assert user.line_user_id == DEV_LINE_USER_ID and user.email == DEV_EMAIL
    assert user.display_name == "SaiFlow Dev" and user.registered_at is not None
    assert await _count(db, "tenants where kind = 'personal'") == 1
    assert await _count(db, "subscriptions where ends_at > now()") == 1
    assert await _count(db, "free_quotas") == 1
    assert await _count(db, "admin_accounts") == 0  # never an admin


# a browser on this machine (NFR-DEV-002); the fixture's https://test Host is not one
LOCAL = {"Host": "localhost:5173"}


async def test_reserved_token_logs_in_the_dev_user(api, db, line, dev_enabled):  # AC-NFR-DEV-002-01
    user_id, tenant_id = await dev_login_service.seed(db, utcnow())
    r = await api.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN}, headers=LOCAL)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["user_id"], body["tenant_id"], body["registered"]) == (user_id, tenant_id, True)
    assert (await api.get("/api/v1/me")).json()["user_id"] == user_id
    assert line.tokens == {}  # nothing was verified with LINE
    assert (
        await _count(
            db, "audit_log where action = 'customer.login' and actor_id = :u", u=str(user_id)
        )
        == 1
    )
    # the session is real: logout revokes it
    assert (await api.post("/api/v1/auth/logout")).status_code == 204
    assert (await api.get("/api/v1/me")).status_code == 401


async def test_web_code_form_logs_in_the_same_user(api, db, dev_enabled):
    a = await api.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN}, headers=LOCAL)
    api.cookies.clear()
    b = await api.post(
        "/api/v1/auth/line",
        json={"code": DEV_LOGIN_TOKEN, "redirect_uri": "http://localhost:5174/login"},
        headers=LOCAL,
    )
    assert a.status_code == b.status_code == 200
    assert a.json()["user_id"] == b.json()["user_id"]
    assert await _count(db, "users") == 1


async def test_other_tokens_create_nothing(api, db, dev_enabled):  # AC-NFR-DEV-002-03
    r = await api.post("/api/v1/auth/line", json={"id_token": "forged", "sub": DEV_LINE_USER_ID})
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert await _count(db, "users") == 0 and await _count(db, "customer_sessions") == 0


# AC-NFR-DEV-002-03
async def test_reserved_token_from_another_host_is_invalid(api, db, dev_enabled):
    r = await api.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})  # Host: test
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert await _count(db, "users") == 0 and await _count(db, "customer_sessions") == 0


async def test_switched_off_reserved_token_is_invalid(api, db):  # AC-NFR-DEV-001-01
    r = await api.post("/api/v1/auth/line", json={"id_token": DEV_LOGIN_TOKEN})
    assert r.status_code == 401 and r.json()["code"] == "line_token_invalid"
    assert await _count(db, "users") == 0
