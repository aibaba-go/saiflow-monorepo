import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import login

pytestmark = pytest.mark.integration


async def _code(api, mail, email="e@example.com") -> str:
    assert (await api.post("/api/v1/me/email-code", json={"email": email})).status_code == 204
    return mail.sent[-1].code


async def _register(api, **fields):
    body = {"email": "e@example.com", "display_name": "Somchai", **fields}
    return await api.post("/api/v1/me/registration", json=body)


async def register(api, line, mail, sub="U1", email="e@example.com") -> dict:
    await login(api, line, sub)
    code = await _code(api, mail, email)
    r = await _register(api, email=email, code=code)
    assert r.status_code == 200, r.text
    return r.json()


async def test_register_ok(api, db, line, mail):  # AC-FR-SYS-014-01
    user = await login(api, line)
    code = await _code(api, mail)
    r = await _register(api, code=code, phone="+66 81 234 5678")
    assert r.status_code == 200
    body = r.json()
    assert body["registered"] is True and body["email"] == "e@example.com"
    assert body["phone"] == "+66 81 234 5678" and body["display_name"] == "Somchai"
    row = (
        await db.execute(
            text("select registered_at, line_user_id from users where id = :u"),
            {"u": user["user_id"]},
        )
    ).one()
    assert row.registered_at is not None and row.line_user_id == "U1"
    used = (await db.execute(text("select used_at from email_codes"))).scalar_one()
    assert used is not None


async def test_register_bad_code(api, db, line, mail):  # AC-FR-SYS-014-02
    await login(api, line)
    code = await _code(api, mail)
    wrong = "000000" if code != "000000" else "111111"
    for fields in [{}, {"code": wrong}]:
        r = await _register(api, **fields)
        assert r.status_code == 400 and r.json()["fields"] == ["code"]
    r = await _register(api, code=code, email="other@example.com")
    assert r.status_code == 400 and r.json()["fields"] == ["code"]
    await db.execute(text("update email_codes set expires_at = now() - interval '1 second'"))
    await db.commit()
    assert (await _register(api, code=code)).status_code == 400
    assert (await api.get("/api/v1/me")).json()["registered"] is False


async def test_used_code_cannot_register_again(api, db, line, mail):  # AC-FR-SYS-014-02 (used)
    await register(api, line, mail, "U1", "a@example.com")
    api.cookies.clear()
    await login(api, line, "U2")
    code = await _code(api, mail, "b@example.com")
    await db.execute(text("update email_codes set used_at = now() where email = 'b@example.com'"))
    await db.commit()
    r = await _register(api, email="b@example.com", code=code)
    assert r.status_code == 400 and r.json()["fields"] == ["code"]


async def test_register_field_errors(api, line, mail):  # AC-FR-SYS-014-03
    await login(api, line)
    code = await _code(api, mail)
    r = await _register(api, code=code, email="bad", display_name="a" * 129, phone="12")
    assert r.status_code == 400
    assert set(r.json()["fields"]) == {"email", "display_name", "phone"}
    r = await _register(api, code=code, display_name="   ")
    assert r.status_code == 400 and r.json()["fields"] == ["display_name"]
    assert (await api.get("/api/v1/me")).json()["registered"] is False


async def test_register_twice_409(api, line, mail):  # AC-FR-SYS-014-04
    await register(api, line, mail)
    r = await _register(api, code="123456", display_name="Changed")
    assert r.status_code == 409 and r.json()["code"] == "already_registered"
    assert (await api.get("/api/v1/me")).json()["display_name"] == "Somchai"


async def test_register_email_taken_409(api, line, mail):  # AC-FR-SYS-014-05
    await register(api, line, mail, "U1", "taken@example.com")
    api.cookies.clear()
    await login(api, line, "U2")
    code = await _code(api, mail, "taken@example.com")
    r = await _register(api, email="taken@example.com", code=code)
    assert r.status_code == 409 and r.json()["code"] == "email_taken"
    assert (await api.get("/api/v1/me")).json()["registered"] is False


async def test_email_taken_is_case_insensitive(api, line, mail):  # Review Focus 2
    await register(api, line, mail, "U1", "a@x.com")
    api.cookies.clear()
    await login(api, line, "U2")
    code = await _code(api, mail, " A@X.com ")
    r = await _register(api, email=" A@X.com ", code=code)
    assert r.status_code == 409 and r.json()["fields"] == ["email"]


async def test_guest_cannot_register_or_edit(api, db, mail):  # AC-FR-SYS-010-06
    await api.post("/api/v1/auth/guest")
    calls = [
        api.post("/api/v1/me/registration", json={"email": "e@example.com", "display_name": "x"}),
        api.patch("/api/v1/me", json={"display_name": "x"}),
        api.post("/api/v1/me/email", json={"email": "e@example.com", "code": "123456"}),
    ]
    for call in calls:
        assert (await call).status_code == 401
    assert (await db.execute(text("select count(*) from users"))).scalar_one() == 0
