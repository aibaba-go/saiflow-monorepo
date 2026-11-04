"""harden-identity: fixes for the issues left by the rebuild-identity final review."""

import pytest
from sqlalchemy import text

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


_ = text  # used by later tasks in this file
