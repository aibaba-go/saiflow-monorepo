"""Regression tests for the final whole-branch review of rebuild-identity."""

import asyncio
import time

import pytest
from sqlalchemy import text

from app.services import admin_service
from tests.integration.db_fixtures import login
from tests.integration.test_registration import register

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"


def _max_age(response, name: str) -> int | None:
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{name}="):
            for part in header.split(";"):
                if part.strip().lower().startswith("max-age="):
                    return int(part.split("=", 1)[1])
    return None


async def test_customer_cookie_refreshed_on_use(api, line):  # review 1 (AC-FR-SYS-001-07)
    await login(api, line)
    r = await api.get("/api/v1/me")
    assert r.status_code == 200
    assert _max_age(r, "saiflow_session") == 30 * 24 * 3600


async def test_admin_cookie_refreshed_on_use(api, db):  # review 1 (A1)
    await admin_service.create_admin(db, "ops", PASSWORD)
    await db.commit()
    await api.post("/api/v1/admin/auth/login", json={"username": "ops", "password": PASSWORD})
    r = await api.get("/api/v1/admin/me")
    assert r.status_code == 200 and _max_age(r, "saiflow_admin_session") == 30 * 60


async def test_logout_still_clears_cookie(api, line):  # review 1: refresh must not undo logout
    await login(api, line)
    r = await api.post("/api/v1/auth/logout")
    assert _max_age(r, "saiflow_session") in (0, None)
    assert not api.cookies.get("saiflow_session")


async def test_parallel_wrong_passwords_still_lock(api, db):  # review 2
    await admin_service.create_admin(db, "ops", PASSWORD)
    await db.commit()
    await asyncio.gather(
        *[
            api.post(
                "/api/v1/admin/auth/login", json={"username": "ops", "password": "wrong-pw-xx"}
            )
            for _ in range(10)
        ]
    )
    ok = await api.post("/api/v1/admin/auth/login", json={"username": "ops", "password": PASSWORD})
    assert ok.status_code == 401
    locks = (
        await db.execute(text("select count(*) from audit_log where action = 'admin.lock'"))
    ).scalar_one()
    assert locks == 1


async def test_password_check_does_not_block_event_loop(api, db, monkeypatch):  # review 3
    await admin_service.create_admin(db, "ops", PASSWORD)
    await db.commit()
    real = admin_service._hasher

    class SlowHasher:
        def verify(self, hash_, password):
            time.sleep(0.5)
            return real.verify(hash_, password)

        def hash(self, password):
            return real.hash(password)

    monkeypatch.setattr(admin_service, "_hasher", SlowHasher())
    gaps: list[float] = []
    done = False

    async def ticker():
        last = time.monotonic()
        while not done:
            await asyncio.sleep(0.01)
            now = time.monotonic()
            gaps.append(now - last)
            last = now

    tick = asyncio.create_task(ticker())
    r = await api.post("/api/v1/admin/auth/login", json={"username": "ops", "password": PASSWORD})
    done = True
    await tick
    assert r.status_code == 200
    assert max(gaps) < 0.3  # the loop kept running during the 0.5 s password check


async def test_double_tap_send_code_sends_once(api, line, mail, monkeypatch):  # review 4
    await login(api, line)
    real_send = mail.send

    async def slow_send(to, subject, body):
        await asyncio.sleep(0.3)
        await real_send(to, subject, body)

    monkeypatch.setattr(mail, "send", slow_send)
    results = await asyncio.gather(
        api.post("/api/v1/me/email-code", json={"email": "e@example.com"}),
        api.post("/api/v1/me/email-code", json={"email": "e@example.com"}),
    )
    assert sorted(r.status_code for r in results) == [204, 429]
    assert len(mail.sent) == 1


async def test_registered_user_resubmitting_bad_body_gets_409(api, line, mail):  # review 5
    await register(api, line, mail)
    r = await api.post("/api/v1/me/registration", json={"email": "bad", "display_name": ""})
    assert r.status_code == 409 and r.json()["code"] == "already_registered"


async def test_unknown_admin_username_not_stored(api, db):  # review 6
    typed = "this-is-my-real-password-by-mistake"
    r = await api.post("/api/v1/admin/auth/login", json={"username": typed, "password": "x"})
    assert r.status_code == 401
    audit = repr((await db.execute(text("select * from audit_log"))).all())
    assert typed not in audit
    assert "admin.login" in audit
