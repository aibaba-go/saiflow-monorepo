"""rebuild-tenant-rbac Task 4: admin organization management and profile edit
(FR-SYS-022, FR-SYS-023)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import (
    add_member,
    approved_org,
    mount_items,
    registered_client,
    tenant,
)

pytestmark = pytest.mark.integration


async def _default_role(db, tid: int) -> int:
    return (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": tid})
    ).scalar_one()


async def test_disable_and_enable(api, db, line, mail):  # AC-FR-SYS-022-02
    mount_items(api)
    _, _, org, admin = await approved_org(api, db, line, mail)
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    await cm.post("/api/v1/_test/items", params={"label": "x"}, headers=tenant(org))
    assert (await admin.post(f"/api/v1/admin/organizations/{org}/disable")).status_code == 200
    assert (await cm.get("/api/v1/_test/items", headers=tenant(org))).status_code == 404
    assert (await cm.get(f"/api/v1/organizations/{org}")).status_code == 404
    assert (await admin.post(f"/api/v1/admin/organizations/{org}/enable")).status_code == 200
    assert (await cm.get("/api/v1/_test/items", headers=tenant(org))).json() == ["x"]
    detail = (await admin.get(f"/api/v1/admin/organizations/{org}")).json()
    assert detail["status"] == "active" and detail["member_count"] == 2


async def test_admin_edits_profile(api, db, line, mail):  # AC-FR-SYS-022-03
    _, _, org, admin = await approved_org(api, db, line, mail)
    r = await admin.patch(f"/api/v1/admin/organizations/{org}", json={"contact_phone": "abc"})
    assert r.status_code == 400 and r.json()["fields"] == ["contact_phone"]
    r = await admin.patch(f"/api/v1/admin/organizations/{org}", json={"name": "New Name"})
    assert r.status_code == 200 and r.json()["name"] == "New Name"
    listed = (await admin.get("/api/v1/admin/organizations")).json()
    assert [o["name"] for o in listed] == ["New Name"]


async def test_admin_endpoints_reject_customer_session(api, db, line, mail):  # AC-022-04
    owner, _, org, _ = await approved_org(api, db, line, mail)
    for method, path, body in [
        ("post", f"/api/v1/admin/organizations/{org}/disable", None),
        ("patch", f"/api/v1/admin/organizations/{org}", {"name": "Hijack"}),
        ("get", "/api/v1/admin/organizations", None),
    ]:
        r = await owner.request(method.upper(), path, json=body)
        assert r.status_code in (401, 403), path
    row = (
        await db.execute(
            text("select name, status from organizations where tenant_id=:t"), {"t": org}
        )
    ).one()
    assert tuple(row) == ("Siam Tools", "active")


async def test_owner_edits_profile(api, db, line, mail):  # AC-FR-SYS-023-01
    owner, _, org, _ = await approved_org(api, db, line, mail)
    r = await owner.patch(
        f"/api/v1/organizations/{org}", json={"name": "Renamed", "contact_phone": "0899999999"}
    )
    assert r.status_code == 200
    body = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert (body["name"], body["contact_phone"], body["status"]) == (
        "Renamed",
        "0899999999",
        "active",
    )


async def test_member_without_manage_cannot_edit(api, db, line, mail):  # AC-FR-SYS-023-02
    _, _, org, _ = await approved_org(api, db, line, mail)
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    r = await cm.patch(f"/api/v1/organizations/{org}", json={"name": "Nope"})
    assert r.status_code == 403
    name = (
        await db.execute(text("select name from organizations where tenant_id=:t"), {"t": org})
    ).scalar_one()
    assert name == "Siam Tools"


async def test_customer_get_org(api, db, line, mail):
    owner, _, org, _ = await approved_org(api, db, line, mail)
    body = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert body["tenant_id"] == org and body["member_count"] == 1
    assert body["verification_status"] == "none" and body["address"] == "Bangkok"
    cv, _ = await registered_client(api, line, mail, "V")
    assert (await cv.get(f"/api/v1/organizations/{org}")).status_code == 404
