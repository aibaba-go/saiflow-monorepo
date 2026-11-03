import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.test_registration import _code, register

pytestmark = pytest.mark.integration


async def test_update_profile_ok(api, line, mail):  # AC-FR-SYS-015-01
    await register(api, line, mail)
    r = await api.patch("/api/v1/me", json={"display_name": "New Name", "phone": "081-234-5678"})
    assert r.status_code == 200
    me = (await api.get("/api/v1/me")).json()
    assert me["display_name"] == "New Name" and me["phone"] == "081-234-5678"


async def test_update_only_given_fields(api, line, mail):
    await register(api, line, mail)
    await api.patch("/api/v1/me", json={"phone": "0812345678"})
    await api.patch("/api/v1/me", json={"display_name": "Only Name"})
    me = (await api.get("/api/v1/me")).json()
    assert me["display_name"] == "Only Name" and me["phone"] == "0812345678"


async def test_clear_phone(api, line, mail):  # AC-FR-SYS-015-02
    await register(api, line, mail)
    await api.patch("/api/v1/me", json={"phone": "0812345678"})
    r = await api.patch("/api/v1/me", json={"phone": ""})
    assert r.status_code == 200 and r.json()["phone"] is None


async def test_update_profile_invalid(api, line, mail):  # AC-FR-SYS-015-03
    await register(api, line, mail)
    for body, field in [
        ({"display_name": ""}, "display_name"),
        ({"display_name": "a" * 129}, "display_name"),
        ({"phone": "12"}, "phone"),
    ]:
        r = await api.patch("/api/v1/me", json=body)
        assert r.status_code == 400 and r.json()["fields"] == [field]
    assert (await api.get("/api/v1/me")).json()["display_name"] == "Somchai"


async def test_unregistered_user_cannot_edit_profile(api, line):
    await login(api, line)
    r = await api.patch("/api/v1/me", json={"display_name": "x"})
    assert r.status_code == 403 and r.json()["code"] == "registration_required"


async def _change(api, email: str, code: str):
    return await api.post("/api/v1/me/email", json={"email": email, "code": code})


async def test_change_email_ok(api, line, mail):  # AC-FR-SYS-016-01
    await register(api, line, mail, "U1", "old@example.com")
    await_code = await _code_after_wait(api, mail, "new@example.com")
    r = await _change(api, "new@example.com", await_code)
    assert r.status_code == 200 and r.json()["email"] == "new@example.com"
    api.cookies.clear()
    await register(api, line, mail, "U2", "old@example.com")  # the old address is free again


async def _code_after_wait(api, mail, email):
    # registration already sent one code; the 60 s resend limit is moved out of the way
    db = api.app.state.sessionmaker()
    async with db as s:
        await s.execute(text("update email_codes set sent_at = sent_at - interval '61 seconds'"))
        await s.commit()
    return await _code(api, mail, email)


async def test_change_to_same_email_400(api, line, mail):  # AC-FR-SYS-016-02
    await register(api, line, mail, "U1", "same@example.com")
    r = await _change(api, "Same@Example.com", "123456")
    assert r.status_code == 400 and r.json()["code"] == "email_unchanged"


async def test_change_to_taken_email_409(api, line, mail):  # AC-FR-SYS-016-03
    await register(api, line, mail, "U1", "taken@example.com")
    api.cookies.clear()
    await register(api, line, mail, "U2", "mine@example.com")
    code = await _code_after_wait(api, mail, "taken@example.com")
    r = await _change(api, "taken@example.com", code)
    assert r.status_code == 409 and r.json()["code"] == "email_taken"
    assert (await api.get("/api/v1/me")).json()["email"] == "mine@example.com"


async def test_change_email_code_for_other_address_400(api, line, mail):  # AC-FR-SYS-016-04
    await register(api, line, mail, "U1", "mine@example.com")
    code = await _code_after_wait(api, mail, "x@example.com")
    r = await _change(api, "n@example.com", code)
    assert r.status_code == 400 and r.json()["fields"] == ["code"]
    assert (await api.get("/api/v1/me")).json()["email"] == "mine@example.com"
