import logging
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.errors import AppError
from app.integrations.email import EmailUnavailable
from app.services import email_code_service
from tests.integration.db_fixtures import login

pytestmark = pytest.mark.integration


async def _send(api, email="e@example.com"):
    return await api.post("/api/v1/me/email-code", json={"email": email})


async def _consume(db, user_id: int, email: str, code: str) -> None:
    await email_code_service.consume_code(db, user_id, email, code)
    await db.commit()


async def test_send_code_ok(api, line, mail):  # AC-FR-SYS-020-01
    await login(api, line)
    r = await _send(api)
    assert r.status_code == 204 and r.content == b""
    assert len(mail.sent) == 1 and mail.sent[0].to == "e@example.com"
    assert len(mail.sent[0].code) == 6


async def test_guest_cannot_request_code(api, mail):
    await api.post("/api/v1/auth/guest")
    assert (await _send(api)).status_code == 401 and mail.sent == []


async def test_resend_within_60s_is_429(api, db, line, mail):  # AC-FR-SYS-020-02
    user = await login(api, line)
    await _send(api)
    r = await _send(api)
    assert r.status_code == 429 and r.json()["code"] == "email_code_too_soon"
    assert len(mail.sent) == 1
    await _consume(db, user["user_id"], "e@example.com", mail.sent[0].code)


async def _age_codes(db, seconds: int) -> None:
    await db.execute(
        text(
            "update email_codes set sent_at = sent_at - make_interval(secs => :s), "
            "expires_at = expires_at - make_interval(secs => :s)"
        ),
        {"s": seconds},
    )
    await db.commit()


async def test_new_code_voids_old(api, db, line, mail):  # AC-FR-SYS-020-03
    user = await login(api, line)
    await _send(api)
    await _age_codes(db, 61)
    assert (await _send(api)).status_code == 204
    first = mail.sent[0].code
    if first == mail.sent[1].code:
        pytest.skip("both random codes were equal")
    with pytest.raises(AppError) as e:
        await _consume(db, user["user_id"], "e@example.com", first)
    assert e.value.code == "email_code_invalid"


async def test_code_expires_after_10_minutes(api, db, line, mail):  # AC-FR-SYS-020-04
    user = await login(api, line)
    await _send(api)
    await _age_codes(db, 10 * 60 + 1)
    with pytest.raises(AppError):
        await _consume(db, user["user_id"], "e@example.com", mail.sent[0].code)


async def test_five_wrong_attempts_void_code(api, db, line, mail):  # AC-FR-SYS-020-05
    user = await login(api, line)
    await _send(api)
    right = mail.sent[0].code
    wrong = "000000" if right != "000000" else "111111"
    for _ in range(5):
        with pytest.raises(AppError):
            await _consume(db, user["user_id"], "e@example.com", wrong)
    with pytest.raises(AppError):
        await _consume(db, user["user_id"], "e@example.com", right)


async def test_code_is_single_use(api, db, line, mail):
    user = await login(api, line)
    await _send(api)
    await _consume(db, user["user_id"], "e@example.com", mail.sent[0].code)
    with pytest.raises(AppError):
        await _consume(db, user["user_id"], "e@example.com", mail.sent[0].code)


async def test_send_failure_is_503_and_no_code(api, db, line, mail):  # AC-FR-SYS-020-06
    await login(api, line)
    mail.fail_with = EmailUnavailable("down")
    r = await _send(api)
    assert r.status_code == 503 and r.json()["code"] == "email_unavailable"
    assert (await db.execute(text("select count(*) from email_codes"))).scalar_one() == 0


async def test_smtp_not_configured_is_503(api, line):  # AC-FR-SYS-020-07
    await login(api, line)
    api.app.state.email_sender = None
    r = await _send(api)
    assert r.status_code == 503 and r.json()["code"] == "email_unavailable"


async def test_code_not_in_logs(api, db, line, mail, caplog):  # AC-FR-SYS-020-08
    caplog.set_level(logging.DEBUG)
    user = await login(api, line)
    await _send(api)
    code = mail.sent[0].code
    wrong = "000000" if code != "000000" else "111111"
    with pytest.raises(AppError):
        await _consume(db, user["user_id"], "e@example.com", wrong)
    assert code not in caplog.text
    rows = (await db.execute(text("select * from audit_log"))).all()
    assert code not in repr(rows)


async def test_malformed_email_is_400(api, line, mail):
    await login(api, line)
    r = await _send(api, "not-an-email")
    assert r.status_code == 400 and r.json()["fields"] == ["email"] and mail.sent == []


async def test_email_is_normalized(api, line, mail):
    await login(api, line)
    assert (await _send(api, "  Mixed@Example.COM ")).status_code == 204
    assert mail.sent[0].to == "mixed@example.com"


async def test_sent_code_lifetime_is_10_minutes(api, db, line, mail):
    await login(api, line)
    await _send(api)
    row = (await db.execute(text("select sent_at, expires_at from email_codes"))).one()
    assert row.expires_at - row.sent_at == timedelta(minutes=10)
    assert utcnow() - row.sent_at < timedelta(minutes=1)
