"""An admin enters web-pc as a registered user (admin-impersonate-user: FR-SYS-145, 148)."""

import hashlib

import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import (
    admin_client,
    client_like,
    mount_items,
    registered_client,
    user_client,
)

pytestmark = pytest.mark.integration

ORIGIN = "https://pc.test"
REDEEM = "/api/v1/auth/impersonation"


def configure(api, origin: str | None = ORIGIN) -> None:
    api.app.state.settings = api.app.state.settings.model_copy(update={"web_pc_origin": origin})


async def issue(admin, user_id: int) -> str:
    r = await admin.post(f"/api/v1/admin/users/{user_id}/impersonation")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expires_in"] == 60
    assert body["url"].startswith(f"{ORIGIN}/impersonate#")
    return body["url"].split("#", 1)[1]


async def enter(api, ticket: str):
    c = client_like(api)
    r = await c.post(REDEEM, json={"ticket": ticket})
    assert r.status_code == 200, r.text
    return c, r


async def audit(db, action: str) -> list[tuple]:
    await db.rollback()
    return (
        await db.execute(
            text(
                "select actor_type, actor_id, target_type, target_id, result from audit_log "
                "where action = :a order by id"
            ),
            {"a": action},
        )
    ).all()


async def admin_id(db, username: str = "ops") -> str:
    await db.rollback()
    q = text("select id from admin_accounts where username = :u")
    return str((await db.execute(q, {"u": username})).scalar_one())


async def test_issue_and_enter(api, db, line, mail):  # AC-FR-SYS-145-01
    configure(api)
    user, uid = await registered_client(api, line, mail, "SOMCHAI")
    own = (await user.get("/api/v1/me")).json()
    admin = await admin_client(api, db)
    ticket = await issue(admin, uid)
    browser, r = await enter(api, ticket)
    body = r.json()
    assert (body["user_id"], body["tenant_id"]) == (uid, own["tenant_id"])
    assert body["registered"] is True and body["impersonated"] is True
    cookie = r.headers["set-cookie"]
    assert "saiflow_session=" in cookie and "Max-Age=1800" in cookie
    me = await browser.get("/api/v1/me")
    assert me.status_code == 200 and me.json()["user_id"] == uid
    assert "Max-Age=1800" in me.headers["set-cookie"]  # the cookie slides by 30 minutes only
    await db.rollback()
    rows = (await db.execute(text("select token_hash, used_at from impersonation_tickets"))).all()
    assert len(rows) == 1 and rows[0].used_at is not None
    assert rows[0].token_hash == hashlib.sha256(ticket.encode()).digest()  # no plaintext
    oid = await admin_id(db)
    for action in ("admin.impersonate.issue", "admin.impersonate.start"):
        assert await audit(db, action) == [("admin", oid, "user", str(uid), "success")]
    session = (
        await db.execute(
            text(
                "select impersonated_by_admin_id from customer_sessions "
                "where impersonated_by_admin_id is not null"
            )
        )
    ).scalar_one()
    assert str(session) == oid


async def test_ticket_is_single_use_and_expires(api, db, line, mail):  # AC-FR-SYS-145-02
    configure(api)
    _, uid = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    used = await issue(admin, uid)
    await enter(api, used)
    old = await issue(admin, uid)
    await db.execute(
        text(
            "update impersonation_tickets set expires_at = now() - interval '1 second' "
            "where token_hash = :h"
        ),
        {"h": hashlib.sha256(old.encode()).digest()},
    )
    await db.commit()
    # a browser that already has its own session keeps it
    other, other_id = await user_client(api, line, "OTHER")
    for ticket in (used, old, "not-a-ticket", "x" * 500):
        r = await other.post(REDEEM, json={"ticket": ticket})
        assert r.status_code == 401 and r.json()["code"] == "impersonation_invalid"
        me = await other.get("/api/v1/me")
        assert me.status_code == 200 and me.json()["user_id"] == other_id
        assert me.json()["impersonated"] is False
    for body in ({}, {"ticket": 5}):
        assert (await other.post(REDEEM, json=body)).status_code == 401
    failures = await audit(db, "admin.impersonate.start")
    oid = await admin_id(db)
    assert failures[0] == ("admin", oid, "user", str(uid), "success")
    assert failures[1:3] == [("admin", oid, "user", str(uid), "failure")] * 2
    assert failures[3:] == [("admin", None, "user", None, "failure")] * 4


async def test_only_registered_users(api, db, line, mail):  # AC-FR-SYS-145-03
    configure(api)
    _, unregistered = await user_client(api, line, "NEWBIE")
    customer, _ = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    r = await admin.post(f"/api/v1/admin/users/{unregistered}/impersonation")
    assert r.status_code == 409 and r.json()["code"] == "user_not_registered"
    assert (await admin.post("/api/v1/admin/users/999999/impersonation")).status_code == 404
    assert (await admin.post("/api/v1/admin/users/0/impersonation")).status_code == 404
    r = await customer.post(f"/api/v1/admin/users/{unregistered}/impersonation")
    assert r.status_code == 401
    await db.rollback()
    assert (await db.execute(text("select count(*) from impersonation_tickets"))).scalar() == 0


async def test_unconfigured_origin_is_503(api, db, line, mail):
    configure(api, None)
    _, uid = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    r = await admin.post(f"/api/v1/admin/users/{uid}/impersonation")
    assert r.status_code == 503 and r.json()["code"] == "impersonation_unavailable"


async def test_issue_needs_csrf_header(api, db, line, mail):
    configure(api)
    _, uid = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    r = await admin.post(
        f"/api/v1/admin/users/{uid}/impersonation", headers={"X-Requested-With": ""}
    )
    assert r.status_code == 403


async def test_me_marks_impersonation(api, db, line, mail):  # AC-FR-SYS-148-01
    configure(api)
    user, uid = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    browser, _ = await enter(api, await issue(admin, uid))
    assert (await browser.get("/api/v1/me")).json()["impersonated"] is True
    assert (await user.get("/api/v1/me")).json()["impersonated"] is False


@pytest.mark.parametrize(
    "expire",
    [
        "update customer_sessions set last_used_at = now() - interval '31 minutes' "
        "where impersonated_by_admin_id is not null",
        "update customer_sessions set created_at = now() - interval '121 minutes', "
        "last_used_at = now() where impersonated_by_admin_id is not null",
        "update admin_accounts set disabled_at = now()",
    ],
    ids=["idle-30-minutes", "two-hours", "admin-disabled"],
)
async def test_impersonated_session_limits(api, db, line, mail, expire):  # AC-FR-SYS-148-02
    configure(api)
    user, uid = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    browser, _ = await enter(api, await issue(admin, uid))
    assert (await browser.get("/api/v1/me")).status_code == 200
    # the user's own session idles past 30 minutes too, and stays valid
    await db.execute(
        text(
            "update customer_sessions set last_used_at = now() - interval '31 minutes', "
            "created_at = now() - interval '3 hours' where impersonated_by_admin_id is null"
        )
    )
    await db.execute(text(expire))
    await db.commit()
    assert (await browser.get("/api/v1/me")).status_code == 401
    assert (await user.get("/api/v1/me")).status_code == 200


async def test_replaces_guest_without_claiming(api, db, line, mail):  # AC-FR-SYS-148-03
    configure(api)
    mount_items(api)
    user, uid = await registered_client(api, line, mail, "SOMCHAI")
    personal = (await user.get("/api/v1/me")).json()["tenant_id"]
    admin = await admin_client(api, db)
    browser = client_like(api)
    guest = (await browser.post("/api/v1/auth/guest")).json()
    assert (await browser.post("/api/v1/_test/items?label=guest-scan")).status_code == 200
    r = await browser.post(REDEEM, json={"ticket": await issue(admin, uid)})
    assert r.status_code == 200 and r.json()["user_id"] == uid
    await db.rollback()
    revoked = (
        await db.execute(
            text("select revoked_at from customer_sessions where tenant_id = :t"),
            {"t": guest["tenant_id"]},
        )
    ).scalar_one()
    assert revoked is not None
    items = (
        await db.execute(text("select tenant_id from test_tenant_items order by id"))
    ).scalars()
    assert list(items) == [guest["tenant_id"]]  # still the guest's, not moved to the user
    assert (await browser.get("/api/v1/_test/items")).json() == []
    assert personal != guest["tenant_id"]
    me = await user.get("/api/v1/me")
    assert me.status_code == 200 and me.json()["impersonated"] is False


async def test_line_login_after_impersonation_is_a_normal_session(api, db, line, mail):
    """Logging in with LINE in that browser replaces the impersonated session (AC-001-09)."""
    configure(api)
    _, uid = await registered_client(api, line, mail, "SOMCHAI")
    admin = await admin_client(api, db)
    browser, _ = await enter(api, await issue(admin, uid))
    me = await login(browser, line, "SOMCHAI")
    assert me["impersonated"] is False
    assert (await browser.get("/api/v1/me")).json()["impersonated"] is False
