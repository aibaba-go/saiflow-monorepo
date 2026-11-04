"""harden-identity: fixes for the issues left by the rebuild-identity final review."""

import httpx
import pytest

from tests.integration.db_fixtures import login
from tests.integration.test_registration import register

pytestmark = pytest.mark.integration

PASSWORD = "correct-horse-battery"


# Task 1: non-string field values (AC-FR-SYS-014-03, AC-FR-SYS-015-03)


async def test_non_string_profile_field_is_400(api, line, mail):
    before = await register(api, line, mail)
    r = await api.patch("/api/v1/me", json={"display_name": 123})
    assert r.status_code == 400 and r.json()["fields"] == ["display_name"]
    assert (await api.get("/api/v1/me")).json()["display_name"] == before["display_name"]


async def test_object_value_is_400(api, line):
    await login(api, line)
    r = await api.post("/api/v1/me/email-code", json={"email": {"a": 1}})
    assert r.status_code == 400 and r.json()["fields"] == ["email"]


async def test_admin_login_non_string_is_400(api):
    r = await api.post("/api/v1/admin/auth/login", json={"username": ["ops"], "password": "x"})
    assert r.status_code == 400 and r.json()["fields"] == ["username"]


async def test_registered_user_with_non_string_still_409(api, line, mail):
    await register(api, line, mail)
    r = await api.post("/api/v1/me/registration", json={"display_name": 5})
    assert r.status_code == 409 and r.json()["code"] == "already_registered"


async def test_unregistered_non_string_listed_with_other_errors(api, line):
    await login(api, line)
    r = await api.post(
        "/api/v1/me/registration", json={"email": "bad", "display_name": 5, "code": "1"}
    )
    fields = r.json()["fields"]
    assert r.status_code == 400 and set(fields) >= {"email", "display_name"}
    assert len(fields) == len(set(fields))
    assert (await api.get("/api/v1/me")).json()["registered"] is False


async def test_line_login_non_string_is_400(api):
    r = await api.post("/api/v1/auth/line", json={"id_token": 42})
    assert r.status_code == 400 and r.json()["fields"] == ["id_token"]


def fresh_client(api, cookie: str | None = None) -> httpx.AsyncClient:
    """Another browser/device on the same app: its own cookie jar."""
    client = httpx.AsyncClient(
        transport=api._transport, base_url="https://test", headers=dict(api.headers)
    )
    if cookie is not None:
        client.cookies.set("saiflow_session", cookie)
    return client


def cleared(response, name="saiflow_session") -> bool:
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{name}=") and "max-age=0" in header.lower():
            return True
    return False


# Task 2: re-login and logout (AC-FR-SYS-001-09, AC-FR-SYS-001-10)


async def test_relogin_revokes_carried_session(api, line):
    await login(api, line)
    s1 = api.cookies.get("saiflow_session")
    async with fresh_client(api) as device_b:
        await login(device_b, line)
        s2 = device_b.cookies.get("saiflow_session")
    await login(api, line)  # device A again, carrying S1
    s3 = api.cookies.get("saiflow_session")
    assert len({s1, s2, s3}) == 3
    for cookie, expected in [(s1, 401), (s2, 200), (s3, 200)]:
        async with fresh_client(api, cookie) as c:
            assert (await c.get("/api/v1/me")).status_code == expected


async def test_logout_with_dead_session_succeeds(api, line):
    await login(api, line)
    dead = api.cookies.get("saiflow_session")
    assert (await api.post("/api/v1/auth/logout")).status_code == 204
    for cookie in ["not-a-real-session", dead, None]:
        async with fresh_client(api, cookie) as c:
            r = await c.post("/api/v1/auth/logout")
            assert r.status_code == 204 and cleared(r), (cookie, r.status_code)
