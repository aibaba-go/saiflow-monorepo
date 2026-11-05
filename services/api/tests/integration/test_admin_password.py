"""web-admin-console Task 1: an admin changes their own password (FR-SYS-019 modified)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import ADMIN_PASSWORD, admin_client, client_like

pytestmark = pytest.mark.integration

URL = "/api/v1/admin/me/password"
NEW = "brand-new-passphrase"


async def _login(api, password: str):
    c = client_like(api)
    r = await c.post("/api/v1/admin/auth/login", json={"username": "ops", "password": password})
    return c, r


async def test_change_password_ok(api, db):  # AC-FR-SYS-019-09
    me = await admin_client(api, db)
    other, r = await _login(api, ADMIN_PASSWORD)
    assert r.status_code == 200
    r = await me.post(URL, json={"current_password": ADMIN_PASSWORD, "new_password": NEW})
    assert r.status_code == 204, r.text
    assert (await me.get("/api/v1/admin/me")).status_code == 200
    assert (await other.get("/api/v1/admin/me")).status_code == 401
    assert (await _login(api, ADMIN_PASSWORD))[1].status_code == 401
    assert (await _login(api, NEW))[1].status_code == 200
    count = (
        await db.execute(
            text("select count(*) from audit_log where action = 'admin.change_password'")
        )
    ).scalar_one()
    assert count == 1


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"current_password": "wrong-password-123", "new_password": NEW}, "current_password"),
        ({"current_password": ADMIN_PASSWORD, "new_password": "a" * 11}, "new_password"),
        ({"current_password": ADMIN_PASSWORD, "new_password": ADMIN_PASSWORD}, "new_password"),
        ({"current_password": ADMIN_PASSWORD}, "new_password"),
        ({"new_password": NEW}, "current_password"),
    ],
)
async def test_change_password_validation(api, db, body, field):  # AC-FR-SYS-019-10
    me = await admin_client(api, db)
    r = await me.post(URL, json=body)
    assert r.status_code == 400 and r.json()["fields"] == [field], r.text
    assert (await _login(api, ADMIN_PASSWORD))[1].status_code == 200


async def test_wrong_current_counts_and_locks(api, db):  # Review Focus 2
    me = await admin_client(api, db)
    for _ in range(5):
        r = await me.post(URL, json={"current_password": "wrong-password-123", "new_password": NEW})
        assert r.status_code == 400
    assert (await _login(api, ADMIN_PASSWORD))[1].status_code == 401
    locks = (
        await db.execute(text("select count(*) from audit_log where action = 'admin.lock'"))
    ).scalar_one()
    assert locks == 1


async def test_change_password_needs_admin_session(api):
    r = await client_like(api).post(URL, json={"current_password": "x", "new_password": NEW})
    assert r.status_code == 401
