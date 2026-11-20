"""rebuild-tenant-rbac Task 6: invitations and the member limit (FR-SYS-024, FR-SYS-025)."""

import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import (
    add_member,
    approved_org,
    client_like,
    registered_client,
)

pytestmark = pytest.mark.integration
ACCEPT = "/api/v1/invitations/accept"


def inv_url(org: int) -> str:
    return f"/api/v1/organizations/{org}/invitations"


async def _members(db, org: int) -> int:
    return (
        await db.execute(
            text("select count(*) from memberships where tenant_id=:t and removed_at is null"),
            {"t": org},
        )
    ).scalar_one()


async def _set_limit(admin, value: int) -> None:
    r = await admin.put("/api/v1/admin/settings/org-member-limit-unpaid", json={"value": value})
    assert r.status_code == 200, r.text


async def _invite(owner, org: int) -> str:
    r = await owner.post(inv_url(org))
    assert r.status_code == 201, r.text
    return r.json()["token"]


async def test_invite_and_accept(api, db, line, mail):  # AC-FR-SYS-024-01
    owner, _, org, _ = await approved_org(api, db, line, mail)
    token = await _invite(owner, org)
    cu, u = await registered_client(api, line, mail, "U")
    r = await cu.post(ACCEPT, json={"token": token})
    assert r.status_code == 200 and r.json()["tenant_id"] == org
    mine = [t for t in (await cu.get("/api/v1/me/tenants")).json() if t["tenant_id"] == org]
    assert mine and mine[0]["role"]["name"] == "Member"


async def test_invitation_single_use(api, db, line, mail):  # AC-FR-SYS-024-02
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 5)
    token = await _invite(owner, org)
    cu, _ = await registered_client(api, line, mail, "U")
    cv, _ = await registered_client(api, line, mail, "V")
    assert (await cu.post(ACCEPT, json={"token": token})).status_code == 200
    r = await cv.post(ACCEPT, json={"token": token})
    assert r.status_code == 410 and r.json()["code"] == "invitation_gone"
    assert await _members(db, org) == 2


async def test_expired_and_revoked_410(api, db, line, mail, monkeypatch):  # AC-024-03
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 5)
    revoked = (await owner.post(inv_url(org))).json()
    assert (await owner.delete(f"{inv_url(org)}/{revoked['id']}")).status_code == 204
    old = await _invite(owner, org)
    cu, _ = await registered_client(api, line, mail, "U")
    assert (await cu.post(ACCEPT, json={"token": revoked["token"]})).status_code == 410
    later = utcnow() + timedelta(days=7, seconds=1)
    monkeypatch.setattr("app.services.membership_service.utcnow", lambda: later)
    assert (await cu.post(ACCEPT, json={"token": old})).status_code == 410
    assert await _members(db, org) == 1


async def test_guest_401_unregistered_403_invitation_still_valid(api, db, line, mail):  # 024-04
    owner, _, org, _ = await approved_org(api, db, line, mail)
    token = await _invite(owner, org)
    guest = client_like(api)
    await guest.post("/api/v1/auth/guest")
    assert (await guest.post(ACCEPT, json={"token": token})).status_code == 401
    unreg = client_like(api)
    await login(unreg, line, "NOTREG")
    assert (await unreg.post(ACCEPT, json={"token": token})).status_code == 403
    cu, _ = await registered_client(api, line, mail, "U")
    assert (await cu.post(ACCEPT, json={"token": token})).status_code == 200


async def test_already_member_409(api, db, line, mail):  # AC-FR-SYS-024-05
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 5)
    cu, u = await registered_client(api, line, mail, "U")
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    await add_member(db, org, u, role)
    token = await _invite(owner, org)
    r = await cu.post(ACCEPT, json={"token": token})
    assert r.status_code == 409 and r.json()["code"] == "already_member"
    cv, _ = await registered_client(api, line, mail, "V")
    assert (await cv.post(ACCEPT, json={"token": token})).status_code == 200  # still valid


async def test_no_manage_403_personal_400(api, db, line, mail):  # AC-FR-SYS-024-06
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 5)
    cm, m = await registered_client(api, line, mail, "M")
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    await add_member(db, org, m, role)
    assert (await cm.post(inv_url(org))).status_code == 403
    personal = [t for t in (await cm.get("/api/v1/me/tenants")).json() if t["kind"] == "personal"]
    r = await cm.post(inv_url(personal[0]["tenant_id"]))
    assert r.status_code == 400 and r.json()["fields"] == ["tenant"]
    count = (await db.execute(text("select count(*) from invitations"))).scalar_one()
    assert count == 0


async def test_token_never_stored_or_logged(api, db, line, mail):  # AC-FR-SYS-024-07
    owner, _, org, _ = await approved_org(api, db, line, mail)
    token = await _invite(owner, org)
    listed = (await owner.get(inv_url(org))).json()
    assert len(listed) == 1 and "token" not in listed[0]
    dump = repr((await db.execute(text("select * from invitations"))).all())
    dump += repr((await db.execute(text("select * from audit_log"))).all())
    assert token not in dump


async def test_limit_blocks_invite(api, db, line, mail):  # AC-FR-SYS-025-01
    owner, _, org, _ = await approved_org(api, db, line, mail)
    await _invite(owner, org)
    r = await owner.post(inv_url(org))
    assert r.status_code == 409 and r.json()["code"] == "member_limit_reached"


async def test_revoke_frees_seat(api, db, line, mail):  # AC-FR-SYS-025-02
    owner, _, org, _ = await approved_org(api, db, line, mail)
    first = (await owner.post(inv_url(org))).json()
    await owner.delete(f"{inv_url(org)}/{first['id']}")
    assert (await owner.post(inv_url(org))).status_code == 201


async def test_lowering_limit_keeps_members(api, db, line, mail):  # AC-FR-SYS-025-03
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 3)
    for sub in ["U", "V"]:
        c, _ = await registered_client(api, line, mail, sub)
        assert (await c.post(ACCEPT, json={"token": await _invite(owner, org)})).status_code == 200
    await _set_limit(admin, 2)
    assert await _members(db, org) == 3
    r = await owner.post(inv_url(org))
    assert r.status_code == 409


async def test_concurrent_accept_respects_limit(api, db, line, mail):  # AC-025-04
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 3)
    t1, t2 = await _invite(owner, org), await _invite(owner, org)
    await _set_limit(admin, 2)
    cu, _ = await registered_client(api, line, mail, "U")
    cv, _ = await registered_client(api, line, mail, "V")
    await asyncio.gather(cu.post(ACCEPT, json={"token": t1}), cv.post(ACCEPT, json={"token": t2}))
    assert await _members(db, org) <= 2


async def test_concurrent_accept_same_invitation_once(api, db, line, mail):
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 5)
    token = await _invite(owner, org)
    cu, _ = await registered_client(api, line, mail, "U")
    cv, _ = await registered_client(api, line, mail, "V")
    results = await asyncio.gather(
        cu.post(ACCEPT, json={"token": token}), cv.post(ACCEPT, json={"token": token})
    )
    assert sorted(r.status_code for r in results) == [200, 410]
    assert await _members(db, org) == 2


async def test_admin_sets_member_limit(api, db, line, mail):
    _, _, _, admin = await approved_org(api, db, line, mail)
    await _set_limit(admin, 7)
    r = await admin.get("/api/v1/admin/settings/org-member-limit-unpaid")
    assert r.json() == {"value": 7}
    r = await admin.put("/api/v1/admin/settings/org-member-limit-unpaid", json={"value": 0})
    assert r.status_code == 400


async def test_unknown_token_410(api, db, line, mail):
    cu, _ = await registered_client(api, line, mail, "U")
    assert (await cu.post(ACCEPT, json={"token": "no-such-token"})).status_code == 410
    assert (await cu.post(ACCEPT, json={})).status_code == 400
