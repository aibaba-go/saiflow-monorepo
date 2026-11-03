import logging
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.services import admin_service
from tests.integration.db_fixtures import login
from tests.integration.test_registration import _code, _register

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"


@pytest.fixture
async def admin(db):
    admin_id = await admin_service.create_admin(db, "ops", PASSWORD)
    await db.commit()
    return admin_id


async def _login(api, username="ops", password=PASSWORD):
    return await api.post(
        "/api/v1/admin/auth/login", json={"username": username, "password": password}
    )


async def test_admin_login_ok(api, admin):  # AC-FR-SYS-019-01
    r = await _login(api)
    assert r.status_code == 200 and r.json() == {"admin_id": admin, "username": "ops"}
    assert api.cookies.get("saiflow_admin_session")
    assert (await api.get("/api/v1/admin/me")).status_code == 200


async def test_failures_look_identical(api, admin):  # AC-FR-SYS-019-02
    wrong = await _login(api, password="not-the-password")
    unknown = await _login(api, username="nobody")
    assert wrong.status_code == unknown.status_code == 401
    keys = ("code", "message_key", "fields")
    assert [wrong.json()[k] for k in keys] == [unknown.json()[k] for k in keys]
    assert wrong.json()["code"] == "admin_login_failed"


async def test_lock_after_five_failures(api, db, admin):  # AC-FR-SYS-019-03
    for _ in range(4):
        assert (await _login(api, password="wrong-password-x")).status_code == 401
    assert (await _login(api)).status_code == 200  # success resets the counter
    for _ in range(5):
        await _login(api, password="wrong-password-x")
    assert (await _login(api)).status_code == 401
    await db.execute(
        text("update admin_accounts set locked_until = :t"), {"t": utcnow() - timedelta(seconds=1)}
    )
    await db.commit()
    assert (await _login(api)).status_code == 200


async def test_disabled_admin(api, db, admin):  # AC-FR-SYS-019-05
    assert (await _login(api)).status_code == 200
    await admin_service.disable_admin(db, "ops")
    await db.commit()
    assert (await api.get("/api/v1/admin/me")).status_code == 401
    assert (await _login(api)).status_code == 401


async def test_admin_idle_30_minutes(api, db, admin):  # AC-FR-SYS-019-06
    await _login(api)
    await db.execute(
        text("update admin_sessions set last_used_at = :t"),
        {"t": utcnow() - timedelta(minutes=30, seconds=1)},
    )
    await db.commit()
    assert (await api.get("/api/v1/admin/me")).status_code == 401


async def test_admin_use_extends_session(api, db, admin):
    await _login(api)
    await db.execute(
        text("update admin_sessions set last_used_at = :t"), {"t": utcnow() - timedelta(minutes=29)}
    )
    await db.commit()
    assert (await api.get("/api/v1/admin/me")).status_code == 200


async def test_admin_logout(api, admin):
    await _login(api)
    cookie = api.cookies.get("saiflow_admin_session")
    assert (await api.post("/api/v1/admin/auth/logout")).status_code == 204
    api.cookies.set("saiflow_admin_session", cookie, domain="test")
    assert (await api.get("/api/v1/admin/me")).status_code == 401


async def test_sessions_not_interchangeable(api, line, admin):  # AC-FR-SYS-019-07
    await login(api, line)
    assert (await api.get("/api/v1/admin/me")).status_code == 401
    api.cookies.clear()
    await _login(api)
    assert (await api.get("/api/v1/me")).status_code == 401


async def test_admin_audit_failures_and_lock(api, db, admin):  # AC-FR-SYS-003-02
    for _ in range(5):
        await _login(api, password="wrong-password-x")
    rows = (
        await db.execute(
            text("select action, result from audit_log where actor_type <> 'system' order by id")
        )
    ).all()
    assert [tuple(r) for r in rows] == [("admin.login", "failure")] * 5 + [
        ("admin.lock", "success")
    ]


async def test_sensitive_values_not_logged(api, db, line, mail, admin, caplog):  # AC-FR-SYS-003-05
    caplog.set_level(logging.DEBUG)
    await login(api, line, "U1")
    line_token = "tok-U1"
    customer_cookie = api.cookies.get("saiflow_session")
    code = await _code(api, mail)
    assert (await _register(api, code=code)).status_code == 200
    api.cookies.clear()
    await _login(api)
    admin_cookie = api.cookies.get("saiflow_admin_session")
    audit = repr((await db.execute(text("select * from audit_log"))).all())
    for secret in [code, PASSWORD, line_token, customer_cookie, admin_cookie]:
        assert secret not in caplog.text
        assert secret not in audit
