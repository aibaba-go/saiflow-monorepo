"""Email + password login, email-code login and password reset (customer-email-login:
FR-SYS-001, 010, 014, 020, 149, 150, 151, 152, 156, 157)."""

from datetime import timedelta

import httpx
import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.rate_limit import SlidingWindowLimiter
from tests.integration.db_fixtures import login
from tests.integration.test_hardening import fresh_client
from tests.integration.test_registration import PASSWORD, register

pytestmark = pytest.mark.integration

EMAIL = "e@example.com"
NEW_PASSWORD = "newpass99"


async def _registered(api, line, mail, sub="U1", email=EMAIL) -> int:
    me = await register(api, line, mail, sub=sub, email=email)
    return me["user_id"]


async def _send(client, email=EMAIL, purpose="login"):
    return await client.post("/api/v1/auth/email-code", json={"email": email, "purpose": purpose})


async def _code_for(client, mail, email=EMAIL, purpose="login") -> str:
    r = await _send(client, email, purpose)
    assert r.status_code == 204, r.text
    return mail.sent[-1].code


async def _allow_resend(db):
    """Move every sent code back 61 s, so the next send passes the 60 s rule."""
    await db.execute(text("update email_codes set sent_at = sent_at - interval '61 seconds'"))
    await db.commit()


async def _password_login(client, email=EMAIL, password=PASSWORD):
    return await client.post("/api/v1/auth/password", json={"email": email, "password": password})


async def _code_login(client, email, code):
    return await client.post("/api/v1/auth/email-login", json={"email": email, "code": code})


async def _reset(client, email, code, password=NEW_PASSWORD):
    return await client.post(
        "/api/v1/auth/password-reset", json={"email": email, "code": code, "password": password}
    )


async def _actions(db) -> list[tuple[str, str]]:
    rows = await db.execute(text("select action, result from audit_log order by id"))
    return [(r.action, r.result) for r in rows]


# ---- FR-SYS-149 email + password login ---------------------------------------------------


async def test_password_login_ok(api, db, line, mail):  # AC-149-01, AC-001-11
    user_id = await _registered(api, line, mail)
    async with fresh_client(api) as other:
        r = await _password_login(other, " E@Example.COM ")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kind"] == "user" and body["user_id"] == user_id and body["registered"]
        assert body["email"] == EMAIL
        assert (await other.get("/api/v1/me")).json()["user_id"] == user_id
        assert (await other.get("/api/v1/me/tenants")).status_code == 200
    # the same user through LINE and through email (AC-001-11)
    assert (await login(api, line, "U1"))["user_id"] == user_id
    assert ("customer.login_password", "success") in await _actions(db)


async def test_password_login_unregistered(api, db, line, mail):  # AC-149-02
    await _registered(api, line, mail)
    await login(api, line, "U2", email="line-only@example.com")  # not registered
    async with fresh_client(api) as other:
        for email in ["nobody@example.com", "line-only@example.com"]:
            r = await _password_login(other, email)
            assert r.status_code == 404 and r.json()["code"] == "email_not_registered"
            assert r.json()["fields"] == ["email"]
        assert (await other.get("/api/v1/me")).status_code == 401


async def test_password_login_wrong(api, db, line, mail):  # AC-149-03
    user_id = await _registered(api, line, mail)
    async with fresh_client(api) as other:
        r = await _password_login(other, password="wrongpass1")
        assert r.status_code == 401 and r.json()["code"] == "password_invalid"
        assert r.json()["fields"] == ["password"]
        assert "saiflow_session" not in other.cookies
    count = (
        await db.execute(
            text("select password_failed_attempts from users where id = :u"), {"u": user_id}
        )
    ).scalar_one()
    assert count == 1
    assert ("customer.login_password", "failure") in await _actions(db)


async def test_password_not_set(api, db, line, mail):  # AC-149-04
    user_id = await _registered(api, line, mail)
    await db.execute(text("update users set password_hash = null where id = :u"), {"u": user_id})
    await db.commit()
    async with fresh_client(api) as other:
        r = await _password_login(other)
        assert r.status_code == 400 and r.json()["code"] == "password_not_set"
        assert r.json()["fields"] == ["password"]
    count = (
        await db.execute(
            text("select password_failed_attempts from users where id = :u"), {"u": user_id}
        )
    ).scalar_one()
    assert count == 0


async def test_password_login_bad_input(api, line, mail):
    await _registered(api, line, mail)
    async with fresh_client(api) as other:
        r = await other.post("/api/v1/auth/password", json={"email": "bad", "password": "x"})
        assert r.status_code == 400 and r.json()["fields"] == ["email"]
        r = await other.post("/api/v1/auth/password", json={"email": EMAIL, "password": ""})
        assert r.status_code == 400 and r.json()["fields"] == ["password"]
        r = await other.post("/api/v1/auth/password", json={"email": EMAIL, "password": 5})
        assert r.status_code == 400 and r.json()["fields"] == ["password"]


async def test_password_login_needs_csrf_header(api, line, mail):
    await _registered(api, line, mail)
    async with fresh_client(api) as other:
        del other.headers["X-Requested-With"]
        r = await _password_login(other)
        assert r.status_code == 403


# ---- FR-SYS-010 claiming a guest's data at email login -----------------------------------


async def test_email_login_claims_guest(api, db, line, mail):  # AC-010-08
    user_id = await _registered(api, line, mail)
    async with fresh_client(api) as other:
        guest = (await other.post("/api/v1/auth/guest")).json()
        r = await _password_login(other)
        assert r.status_code == 200
    revoked = (
        await db.execute(
            text("select revoked_at from customer_sessions where tenant_id = :t"),
            {"t": guest["tenant_id"]},
        )
    ).scalar_one()
    assert revoked is not None  # the guest session ended
    status = (
        await db.execute(
            text("select status from tenants where id = :t"), {"t": guest["tenant_id"]}
        )
    ).scalar_one()
    assert status == "claimed" and user_id
    assert ("guest.claim", "success") in await _actions(db)


# ---- FR-SYS-156 lock after 5 wrong passwords -----------------------------------------------


async def test_lock_after_five(api, db, line, mail):  # AC-156-01
    user_id = await _registered(api, line, mail)
    async with fresh_client(api) as other:
        for _ in range(5):
            r = await _password_login(other, password="wrongpass1")
            assert r.status_code == 401
        r = await _password_login(other)
        assert r.status_code == 423 and r.json()["code"] == "account_locked"
        assert ("customer.password_lock", "success") in await _actions(db)
        locked_until = (
            await db.execute(
                text("select password_locked_until from users where id = :u"), {"u": user_id}
            )
        ).scalar_one()
        remaining = locked_until - utcnow()
        assert timedelta(minutes=4) < remaining <= timedelta(minutes=5)  # locked for 5 minutes
        await db.execute(
            text("update users set password_locked_until = :t where id = :u"),
            {"t": utcnow() - timedelta(seconds=1), "u": user_id},
        )
        await db.commit()
        assert (await _password_login(other)).status_code == 200


async def test_locked_still_code_login(api, db, line, mail):  # AC-156-02
    await _registered(api, line, mail)
    await _allow_resend(db)
    async with fresh_client(api) as other:
        for _ in range(5):
            await _password_login(other, password="wrongpass1")
        code = await _code_for(other, mail)
        r = await _code_login(other, EMAIL, code)
        assert r.status_code == 200, r.text
        assert (await _password_login(other)).status_code == 423


async def test_success_clears_count(api, line, mail):  # AC-156-03
    await _registered(api, line, mail)
    async with fresh_client(api) as other:
        for _ in range(4):
            assert (await _password_login(other, password="wrongpass1")).status_code == 401
        assert (await _password_login(other)).status_code == 200
        for _ in range(4):
            assert (await _password_login(other, password="wrongpass1")).status_code == 401
        assert (await _password_login(other)).status_code == 200


# ---- FR-SYS-020 codes without a session ---------------------------------------------------


async def test_send_login_and_reset_codes(api, db, line, mail):  # AC-020-10
    await _registered(api, line, mail)
    await _allow_resend(db)
    async with fresh_client(api) as other:
        first = await _code_for(other, mail, purpose="login")
        login_mail = mail.sent[-1]
        await _allow_resend(db)
        second = await _code_for(other, mail, purpose="reset")
        reset_mail = mail.sent[-1]
        assert login_mail.subject != reset_mail.subject
        assert "log in" in login_mail.body.lower() and "reset" in reset_mail.body.lower()
        assert (await _code_login(other, EMAIL, first)).status_code == 400  # voided
        assert (await _reset(other, EMAIL, second)).status_code == 200


async def test_send_code_unregistered(api, line, mail):  # AC-020-11
    await _registered(api, line, mail)
    sent = len(mail.sent)
    async with fresh_client(api) as other:
        for purpose in ["login", "reset"]:
            r = await _send(other, "nobody@example.com", purpose)
            assert r.status_code == 404 and r.json()["code"] == "email_not_registered"
            assert r.json()["fields"] == ["email"]
    assert len(mail.sent) == sent


async def test_send_code_bad_purpose(api, line, mail):
    await _registered(api, line, mail)
    async with fresh_client(api) as other:
        for purpose in ["verify", "x", None]:
            r = await _send(other, EMAIL, purpose)
            assert r.status_code == 400 and r.json()["fields"] == ["purpose"]


async def test_send_code_too_soon(api, line, mail):  # FR-SYS-020: 60 s per owner, any purpose
    await _registered(api, line, mail)  # registration sent a code just now
    async with fresh_client(api) as other:
        r = await _send(other)
        assert r.status_code == 429 and r.json()["code"] == "email_code_too_soon"


async def test_code_only_for_its_purpose(api, db, line, mail):  # AC-020-12, AC-150-03
    await _registered(api, line, mail)
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail, purpose="login")
        r = await _reset(other, EMAIL, code)
        assert r.status_code == 400 and r.json()["fields"] == ["code"]
    # a login code cannot change the email of the signed-in user either
    r = await api.post("/api/v1/me/email", json={"email": "new@example.com", "code": code})
    assert r.status_code == 400 and r.json()["fields"] == ["code"]
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail, purpose="reset")
        r = await _code_login(other, EMAIL, code)
        assert r.status_code == 400 and r.json()["code"] == "email_code_invalid"
    assert (await _password_login(fresh_client(api))).status_code == 200


# ---- FR-SYS-150 email-code login ----------------------------------------------------------


async def test_code_login_ok(api, db, line, mail):  # AC-150-01
    user_id = await _registered(api, line, mail)
    await db.execute(text("update users set password_hash = null"))
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail)
        r = await _code_login(other, " e@example.com", code)
        assert r.status_code == 200 and r.json()["user_id"] == user_id
        assert (await other.get("/api/v1/me")).json()["user_id"] == user_id
        assert (await _code_login(other, EMAIL, code)).status_code == 400
    assert ("customer.login_email_code", "success") in await _actions(db)


async def test_code_login_wrong(api, db, line, mail):  # AC-150-02
    await _registered(api, line, mail)
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail)
        wrong = "000000" if code != "000000" else "111111"
        r = await _code_login(other, EMAIL, wrong)
        assert r.status_code == 400 and r.json()["code"] == "email_code_invalid"
        assert r.json()["fields"] == ["code"]
        assert "saiflow_session" not in other.cookies
    failed = (
        await db.execute(
            text(
                "select failed_attempts from email_codes"
                " where used_at is null and voided_at is null"
            )
        )
    ).scalar_one()
    assert failed == 1
    assert ("customer.login_email_code", "failure") in await _actions(db)


async def test_code_login_unregistered(api, line, mail):  # AC-150-04
    async with fresh_client(api) as other:
        r = await _code_login(other, "nobody@example.com", "123456")
        assert r.status_code == 404 and r.json()["code"] == "email_not_registered"


async def test_code_login_does_not_touch_lock(api, db, line, mail):  # FR-SYS-150
    user_id = await _registered(api, line, mail)
    async with fresh_client(api) as other:
        for _ in range(3):
            await _password_login(other, password="wrongpass1")
        await _allow_resend(db)
        code = await _code_for(other, mail)
        assert (await _code_login(other, EMAIL, code)).status_code == 200
    count = (
        await db.execute(
            text("select password_failed_attempts from users where id = :u"), {"u": user_id}
        )
    ).scalar_one()
    assert count == 3


# ---- FR-SYS-151 password reset ------------------------------------------------------------


async def test_reset_ok(api, db, line, mail):  # AC-151-01
    user_id = await _registered(api, line, mail)
    device_a = api.cookies.get("saiflow_session")
    async with fresh_client(api) as b:
        assert (await _password_login(b)).status_code == 200
        for _ in range(5):
            await _password_login(fresh_client(api), password="wrongpass1")
        await _allow_resend(db)
        async with fresh_client(api) as c:
            code = await _code_for(c, mail, purpose="reset")
            r = await _reset(c, EMAIL, code)
            assert r.status_code == 200, r.text
            assert r.json()["user_id"] == user_id
            assert (await c.get("/api/v1/me")).json()["user_id"] == user_id
        assert (await b.get("/api/v1/me")).status_code == 401
    async with fresh_client(api, device_a) as a:
        assert (await a.get("/api/v1/me")).status_code == 401
    async with fresh_client(api) as d:
        assert (await _password_login(d, password=NEW_PASSWORD)).status_code == 200
        assert (await _password_login(d)).status_code == 401
    assert ("customer.password_reset", "success") in await _actions(db)


async def test_reset_bad_password_keeps_code(api, db, line, mail):  # AC-151-02
    await _registered(api, line, mail)
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail, purpose="reset")
        for bad in ["abc1234", "abcdefgh"]:
            r = await _reset(other, EMAIL, code, bad)
            assert r.status_code == 400 and r.json()["fields"] == ["password"]
        assert (await _password_login(other)).status_code == 200  # unchanged
        assert (await _reset(other, EMAIL, code)).status_code == 200  # code still valid


async def test_reset_bad_code(api, db, line, mail):  # AC-151-03
    await _registered(api, line, mail)
    device_a = api.cookies.get("saiflow_session")
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail, purpose="login")
        r = await _reset(other, EMAIL, code)
        assert r.status_code == 400 and r.json()["code"] == "email_code_invalid"
        assert r.json()["fields"] == ["code"]
        assert (await _password_login(other)).status_code == 200
    async with fresh_client(api, device_a) as a:
        assert (await a.get("/api/v1/me")).status_code == 200


async def test_reset_sets_first_password(api, db, line, mail):  # AC-151-04
    await _registered(api, line, mail)
    await db.execute(text("update users set password_hash = null"))
    await _allow_resend(db)
    async with fresh_client(api) as other:
        code = await _code_for(other, mail, purpose="reset")
        assert (await _reset(other, EMAIL, code)).status_code == 200
        assert (await _password_login(fresh_client(api), password=NEW_PASSWORD)).status_code == 200


async def test_reset_unregistered(api, line, mail):  # AC-151-05
    async with fresh_client(api) as other:
        r = await _reset(other, "nobody@example.com", "123456")
        assert r.status_code == 404 and r.json()["code"] == "email_not_registered"


# ---- FR-SYS-152 no plaintext --------------------------------------------------------------


async def test_password_never_stored(api, db, line, mail, caplog):  # AC-152-03, AC-014-07
    await _registered(api, line, mail)
    async with fresh_client(api) as other:
        await _password_login(other, password="wrongpass1")
        await _allow_resend(db)
        code = await _code_for(other, mail, purpose="reset")
        await _reset(other, EMAIL, code)
    dump = repr((await db.execute(text("select * from users"))).all())
    dump += repr((await db.execute(text("select * from audit_log"))).all())
    for secret in [PASSWORD, "wrongpass1", NEW_PASSWORD]:
        assert secret not in dump and secret not in caplog.text


# ---- FR-SYS-157 source IP limit -----------------------------------------------------------


async def test_ip_limit(api, line, mail):  # AC-157-01
    await _registered(api, line, mail)
    api.app.state.auth_limiter = SlidingWindowLimiter(3, timedelta(minutes=10))
    async with fresh_client(api) as other:
        assert (await _send(other, "nobody@example.com")).status_code == 404
        assert (await _code_login(other, "nobody@example.com", "1")).status_code == 404
        assert (await _reset(other, "nobody@example.com", "1")).status_code == 404
        r = await _password_login(other)
        assert r.status_code == 429 and r.json()["code"] == "auth_too_many"
        assert "saiflow_session" not in other.cookies
    transport = httpx.ASGITransport(app=api._transport.app, client=("203.0.113.9", 1234))
    async with httpx.AsyncClient(
        transport=transport, base_url="https://test", headers=dict(api.headers)
    ) as elsewhere:
        assert (await _password_login(elsewhere)).status_code == 200
