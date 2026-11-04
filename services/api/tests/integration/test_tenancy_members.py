"""rebuild-tenant-rbac Task 7: member removal, leaving, owner transfer (FR-SYS-026, 029)."""

import asyncio

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import (
    add_member,
    approved_org,
    make_role,
    mount_items,
    registered_client,
    tenant,
)

pytestmark = pytest.mark.integration


def members_url(org: int) -> str:
    return f"/api/v1/organizations/{org}/members"


async def _default_role(db, tid: int) -> int:
    return (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": tid})
    ).scalar_one()


async def _owners(db, org: int) -> list[int]:
    return list(
        (
            await db.execute(
                text(
                    "select user_id from memberships where tenant_id=:t and is_owner "
                    "and removed_at is null"
                ),
                {"t": org},
            )
        ).scalars()
    )


async def _active(db, org: int) -> set[int]:
    return set(
        (
            await db.execute(
                text("select user_id from memberships where tenant_id=:t and removed_at is null"),
                {"t": org},
            )
        ).scalars()
    )


async def _org_with(api, db, line, mail, subs: list[str]):
    owner, owner_id, org, admin = await approved_org(api, db, line, mail)
    default = await _default_role(db, org)
    members = []
    for sub in subs:
        c, uid = await registered_client(api, line, mail, sub)
        await add_member(db, org, uid, default)
        members.append((c, uid))
    return owner, owner_id, org, admin, members


async def test_remove_member_keeps_data(api, db, line, mail):  # AC-FR-SYS-026-01
    mount_items(api)
    owner, _, org, _, [(cm, m)] = await _org_with(api, db, line, mail, ["M"])
    await cm.post("/api/v1/_test/items", params={"label": "by-m"}, headers=tenant(org))
    assert (await owner.delete(f"{members_url(org)}/{m}")).status_code == 204
    assert (await cm.get("/api/v1/_test/items", headers=tenant(org))).status_code == 404
    assert (await owner.get("/api/v1/_test/items", headers=tenant(org))).json() == ["by-m"]


async def test_leave(api, db, line, mail):  # AC-FR-SYS-026-02
    owner, owner_id, org, _, [(cm, m)] = await _org_with(api, db, line, mail, ["M"])
    assert (await cm.post(f"/api/v1/organizations/{org}/leave")).status_code == 204
    assert await _active(db, org) == {owner_id}
    detail = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert detail["member_count"] == 1


async def test_owner_cannot_be_removed_or_leave(api, db, line, mail):  # AC-FR-SYS-026-03
    owner, owner_id, org, _, [(ca, a)] = await _org_with(api, db, line, mail, ["A"])
    manager = await make_role(db, org, "Mgr", ["member_manage"])
    await db.execute(
        text("update memberships set role_id=:r where user_id=:u"), {"r": manager, "u": a}
    )
    await db.commit()
    r = await ca.delete(f"{members_url(org)}/{owner_id}")
    assert r.status_code == 409 and r.json()["code"] == "owner_protected"
    r = await owner.post(f"/api/v1/organizations/{org}/leave")
    assert r.status_code == 409 and r.json()["code"] == "owner_protected"
    assert await _owners(db, org) == [owner_id]


async def test_reinvite_after_removal(api, db, line, mail):  # AC-FR-SYS-026-04
    owner, _, org, _, [(cm, m)] = await _org_with(api, db, line, mail, ["M"])
    await owner.delete(f"{members_url(org)}/{m}")
    token = (await owner.post(f"/api/v1/organizations/{org}/invitations")).json()["token"]
    assert (await cm.post("/api/v1/invitations/accept", json={"token": token})).status_code == 200
    mine = [t for t in (await cm.get("/api/v1/me/tenants")).json() if t["tenant_id"] == org]
    assert mine[0]["role"]["name"] == "Member"


async def test_transfer_owner(api, db, line, mail):  # AC-FR-SYS-029-01
    owner, owner_id, org, _, [(cm, m)] = await _org_with(api, db, line, mail, ["M"])
    r = await owner.post(f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": m})
    assert r.status_code == 200
    assert await _owners(db, org) == [m]
    mine = [t for t in (await cm.get("/api/v1/me/tenants")).json() if t["tenant_id"] == org][0]
    assert mine["is_owner"] is True and len(mine["permissions"]) == 13
    old = [t for t in (await owner.get("/api/v1/me/tenants")).json() if t["tenant_id"] == org][0]
    assert old["is_owner"] is False and old["role"]["name"] == "Member"


async def test_old_owner_can_leave_after_transfer(api, db, line, mail):  # AC-FR-SYS-029-02
    owner, owner_id, org, _, [(_, m)] = await _org_with(api, db, line, mail, ["M"])
    await owner.post(f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": m})
    assert (await owner.post(f"/api/v1/organizations/{org}/leave")).status_code == 204
    assert await _active(db, org) == {m} and await _owners(db, org) == [m]


async def test_transfer_target_must_be_other_member(api, db, line, mail):  # AC-FR-SYS-029-03
    owner, owner_id, org, _, [(_, r_id)] = await _org_with(api, db, line, mail, ["R"])
    await owner.delete(f"{members_url(org)}/{r_id}")
    _, v = await registered_client(api, line, mail, "V")
    for target in [v, r_id, owner_id]:
        r = await owner.post(
            f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": target}
        )
        assert r.status_code == 400 and r.json()["fields"] == ["user_id"], target
    assert await _owners(db, org) == [owner_id]


async def test_only_owner_transfers(api, db, line, mail):  # AC-FR-SYS-029-04
    owner, owner_id, org, _, [(cb, b), (_, c)] = await _org_with(api, db, line, mail, ["B", "C"])
    power = await make_role(db, org, "Power", ["member_manage", "role_manage"])
    await db.execute(
        text("update memberships set role_id=:r where user_id=:u"), {"r": power, "u": b}
    )
    await db.commit()
    for target in [b, c]:
        r = await cb.post(f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": target})
        assert r.status_code == 403
    assert await _owners(db, org) == [owner_id]


async def test_concurrent_transfers_one_owner(api, db, line, mail):  # Review Focus 1
    owner, _, org, _, [(_, a), (_, b)] = await _org_with(api, db, line, mail, ["A", "B"])
    url = f"/api/v1/organizations/{org}/owner-transfer"
    await asyncio.gather(owner.post(url, json={"user_id": a}), owner.post(url, json={"user_id": b}))
    assert len(await _owners(db, org)) == 1


async def test_list_members(api, db, line, mail):
    owner, owner_id, org, _, [(cm, m)] = await _org_with(api, db, line, mail, ["M"])
    body = (await cm.get(members_url(org))).json()
    by_id = {x["user_id"]: x for x in body}
    assert by_id[owner_id]["is_owner"] is True and by_id[owner_id]["role"] is None
    assert by_id[m]["role"]["name"] == "Member"


async def test_remove_requires_member_manage(api, db, line, mail):
    _, owner_id, org, _, [(ca, _), (_, b)] = await _org_with(api, db, line, mail, ["A", "B"])
    assert (await ca.delete(f"{members_url(org)}/{b}")).status_code == 403
    assert b in await _active(db, org)
