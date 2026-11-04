"""rebuild-tenant-rbac Task 3: organization applications and approval (FR-SYS-021, 022-01)."""

import asyncio

import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import (
    ORG,
    admin_client,
    approved_org,
    client_like,
    mount_items,
    registered_client,
    tenant,
)

pytestmark = pytest.mark.integration
APPLY = "/api/v1/organization-applications"
ADMIN_APPS = "/api/v1/admin/organization-applications"


async def _count(db, table: str) -> int:
    return (await db.execute(text(f"select count(*) from {table}"))).scalar_one()


async def _one(db, sql: str, **params):
    return (await db.execute(text(sql), params)).one()


async def test_apply_ok(api, db, line, mail):  # AC-FR-SYS-021-01
    c, _ = await registered_client(api, line, mail, "U")
    r = await c.post(APPLY, json=ORG)
    assert r.status_code == 201 and r.json()["status"] == "pending"
    assert await _count(db, "organizations") == 0


async def test_apply_validation(api, db, line, mail):  # AC-FR-SYS-021-02
    c, _ = await registered_client(api, line, mail, "U")
    for body, field in [
        ({"contact_phone": "0812345678"}, "name"),
        ({"name": "x" * 129, "contact_phone": "0812345678"}, "name"),
        ({"name": "Org"}, "contact_phone"),
        ({"name": "Org", "contact_phone": "abc"}, "contact_phone"),
        ({"name": "Org", "contact_phone": "0812345678", "address": "a" * 513}, "address"),
    ]:
        r = await c.post(APPLY, json=body)
        assert r.status_code == 400 and field in r.json()["fields"], body
    assert await _count(db, "organization_applications") == 0


async def test_second_pending_is_409(api, db, line, mail):  # AC-FR-SYS-021-03
    c, _ = await registered_client(api, line, mail, "U")
    assert (await c.post(APPLY, json=ORG)).status_code == 201
    r = await c.post(APPLY, json=ORG)
    assert r.status_code == 409 and r.json()["code"] == "application_pending"
    assert await _count(db, "organization_applications") == 1


async def test_guest_401_unregistered_403(api, db, line):  # AC-FR-SYS-021-04
    await api.post("/api/v1/auth/guest")
    assert (await api.post(APPLY, json=ORG)).status_code == 401
    c = client_like(api)
    await login(c, line, "NOTREG")
    assert (await c.post(APPLY, json=ORG)).status_code == 403
    assert await _count(db, "organization_applications") == 0


async def test_approve_creates_org_owner_default_role(api, db, line, mail):  # AC-021-05
    c, uid, tid, _ = await approved_org(api, db, line, mail)
    org = await _one(
        db,
        "select name, contact_phone, address, status from organizations where tenant_id=:t",
        t=tid,
    )
    assert tuple(org) == ("Siam Tools", "081 234 5678", "Bangkok", "active")
    owner = await _one(
        db, "select user_id, is_owner, role_id from memberships where tenant_id=:t", t=tid
    )
    assert tuple(owner) == (uid, True, None)
    role = await _one(
        db, "select name, permissions, is_default from roles where tenant_id=:t", t=tid
    )
    assert role[0] == "Member" and sorted(role[1]) == ["export", "upload_ocr", "verify_own"]
    assert role[2] is True
    mine = (await c.get("/api/v1/me/organization-applications")).json()
    assert mine[0]["status"] == "approved" and mine[0]["tenant_id"] == tid
    assert tid in [t["tenant_id"] for t in (await c.get("/api/v1/me/tenants")).json()]


async def test_reject_then_reapply(api, db, line, mail):  # AC-FR-SYS-021-06
    c, _ = await registered_client(api, line, mail, "U")
    app_id = (await c.post(APPLY, json=ORG)).json()["id"]
    admin = await admin_client(api, db)
    r = await admin.post(f"{ADMIN_APPS}/{app_id}/reject", json={"reason": "Phone unreachable"})
    assert r.status_code == 200
    mine = (await c.get("/api/v1/me/organization-applications")).json()
    assert mine[0]["status"] == "rejected" and mine[0]["reject_reason"] == "Phone unreachable"
    assert await _count(db, "organizations") == 0
    r = await c.post(APPLY, json=ORG)
    assert r.status_code == 201 and r.json()["status"] == "pending"


async def test_reject_requires_reason(api, db, line, mail):  # AC-FR-SYS-021-07
    c, _ = await registered_client(api, line, mail, "U")
    app_id = (await c.post(APPLY, json=ORG)).json()["id"]
    admin = await admin_client(api, db)
    for body in [{}, {"reason": "   "}]:
        r = await admin.post(f"{ADMIN_APPS}/{app_id}/reject", json=body)
        assert r.status_code == 400 and r.json()["fields"] == ["reason"]
    status = (await db.execute(text("select status from organization_applications"))).scalar_one()
    assert status == "pending"


async def test_decide_twice_409(api, db, line, mail):  # AC-FR-SYS-021-08
    c, _ = await registered_client(api, line, mail, "U")
    app_id = (await c.post(APPLY, json=ORG)).json()["id"]
    admin = await admin_client(api, db)
    assert (await admin.post(f"{ADMIN_APPS}/{app_id}/approve")).status_code == 200
    for path, body in [("approve", None), ("reject", {"reason": "late"})]:
        r = await admin.post(f"{ADMIN_APPS}/{app_id}/{path}", json=body)
        assert r.status_code == 409 and r.json()["code"] == "already_decided"
    assert await _count(db, "organizations") == 1


async def test_user_owns_two_orgs_isolated(api, db, line, mail):  # AC-FR-SYS-021-09
    mount_items(api)
    c, uid, o1, admin = await approved_org(api, db, line, mail)
    app_id = (await c.post(APPLY, json={**ORG, "name": "Second"})).json()["id"]
    o2 = (await admin.post(f"{ADMIN_APPS}/{app_id}/approve")).json()["tenant_id"]
    owned = (
        await db.execute(
            text("select tenant_id from memberships where user_id=:u and is_owner order by 1"),
            {"u": uid},
        )
    ).scalars()
    assert list(owned) == [o1, o2]
    await c.post("/api/v1/_test/items", params={"label": "in-o1"}, headers=tenant(o1))
    assert (await c.get("/api/v1/_test/items", headers=tenant(o2))).json() == []


async def test_admin_lists_pending_only(api, db, line, mail):  # AC-FR-SYS-022-01
    admin = await admin_client(api, db)
    ids = []
    for sub in ["A", "B", "C"]:
        c, _ = await registered_client(api, line, mail, sub)
        ids.append((await c.post(APPLY, json={**ORG, "name": sub})).json()["id"])
    await admin.post(f"{ADMIN_APPS}/{ids[0]}/approve")
    await admin.post(f"{ADMIN_APPS}/{ids[1]}/reject", json={"reason": "no"})
    pending = (await admin.get(ADMIN_APPS, params={"status": "pending"})).json()
    assert [p["id"] for p in pending] == [ids[2]]
    assert pending[0]["name"] == "C" and pending[0]["applicant_user_id"] > 0


async def test_concurrent_approve_once(api, db, line, mail):
    c, _ = await registered_client(api, line, mail, "U")
    app_id = (await c.post(APPLY, json=ORG)).json()["id"]
    admin = await admin_client(api, db)
    results = await asyncio.gather(
        admin.post(f"{ADMIN_APPS}/{app_id}/approve"),
        admin.post(f"{ADMIN_APPS}/{app_id}/approve"),
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    assert await _count(db, "organizations") == 1
