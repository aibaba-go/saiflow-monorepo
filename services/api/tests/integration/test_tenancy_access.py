"""rebuild-tenant-rbac Task 2: the tenant access rule (FR-SYS-017)."""

import pytest
from sqlalchemy import text

from app import permissions
from tests.integration.tenancy_helpers import (
    add_member,
    make_org,
    make_role,
    mount_items,
    tenant,
    user_client,
)

pytestmark = pytest.mark.integration


async def test_no_header_uses_personal_tenant(api, db, line):  # AC-FR-SYS-017-01
    mount_items(api)
    me = await user_client(api, line, "U")
    c, uid = me
    org, role = await make_org(db, owner_id=uid)
    r = await c.post("/api/v1/_test/items", params={"label": "mine"})
    personal = (
        await db.execute(
            text("select id from tenants where kind='personal' and owner_user_id=:u"), {"u": uid}
        )
    ).scalar_one()
    assert r.status_code == 200 and r.json()["tenant_id"] == personal != org
    await c.aclose()


async def test_list_usable_tenants(api, db, line):  # AC-FR-SYS-017-02
    c, u = await user_client(api, line, "U")
    _, other = await user_client(api, line, "OTHER")
    o1, r1 = await make_org(db, other, "O1")
    await add_member(db, o1, u, r1)
    o2, _ = await make_org(db, u, "O2")
    o3, r3 = await make_org(db, other, "O3")
    await add_member(db, o3, u, r3)
    await db.execute(
        text("update memberships set removed_at = now() where tenant_id=:t and user_id=:u"),
        {"t": o3, "u": u},
    )
    o4, r4 = await make_org(db, other, "O4")
    await add_member(db, o4, u, r4)
    await db.execute(
        text("update organizations set status='disabled' where tenant_id=:t"), {"t": o4}
    )
    await db.commit()
    body = (await c.get("/api/v1/me/tenants")).json()
    by_id = {t["tenant_id"]: t for t in body}
    kinds = sorted(t["kind"] for t in body)
    assert kinds == ["organization", "organization", "personal"]
    assert set(by_id) - {t["tenant_id"] for t in body if t["kind"] == "personal"} == {o1, o2}
    assert by_id[o1]["role"]["name"] == "Member" and by_id[o1]["is_owner"] is False
    assert by_id[o2]["is_owner"] is True and by_id[o2]["role"] is None
    assert set(by_id[o2]["permissions"]) == {p.value for p in permissions.ALL}
    assert "export" in by_id[o1]["permissions"]
    assert by_id[o1]["name"] == "O1"


async def test_personal_data_not_in_org(api, db, line):  # AC-FR-SYS-017-03
    mount_items(api)
    cu, u = await user_client(api, line, "U")
    assert (await cu.post("/api/v1/_test/items", params={"label": "D"})).status_code == 200
    org, _ = await make_org(db, u)
    cb, b = await user_client(api, line, "B")
    browse = await make_role(db, org, "Browser", ["data_browse"])
    await add_member(db, org, b, browse)
    assert (await cb.get("/api/v1/_test/items", headers=tenant(org))).json() == []
    assert (await cu.get("/api/v1/_test/items")).json() == ["D"]


async def test_non_member_and_unknown_tenant_same_404(api, db, line):  # AC-FR-SYS-017-04
    mount_items(api)
    _, owner = await user_client(api, line, "OWNER")
    org, _ = await make_org(db, owner)
    cv, _ = await user_client(api, line, "V")
    a = await cv.get("/api/v1/_test/items", headers=tenant(org))
    b = await cv.get("/api/v1/_test/items", headers=tenant(999999))
    assert a.status_code == b.status_code == 404
    assert (a.json()["code"], a.json()["message_key"]) == (
        b.json()["code"],
        b.json()["message_key"],
    )


async def test_without_data_browse_sees_own_only(api, db, line):  # AC-FR-SYS-017-05
    mount_items(api)
    _, owner = await user_client(api, line, "OWNER")
    org, default_role = await make_org(db, owner)
    ca, a = await user_client(api, line, "A")
    cb, b = await user_client(api, line, "B")
    await add_member(db, org, a, default_role)
    browse = await make_role(db, org, "Browser", ["data_browse", "upload_ocr"])
    await add_member(db, org, b, browse)
    await ca.post("/api/v1/_test/items", params={"label": "a1"}, headers=tenant(org))
    await cb.post("/api/v1/_test/items", params={"label": "b1"}, headers=tenant(org))
    assert (await ca.get("/api/v1/_test/items", headers=tenant(org))).json() == ["a1"]
    assert (await cb.get("/api/v1/_test/items", headers=tenant(org))).json() == ["a1", "b1"]


async def test_disabled_org_is_404(api, db, line):  # AC-FR-SYS-017-06
    mount_items(api)
    cu, u = await user_client(api, line, "U")
    org, _ = await make_org(db, u)
    await db.execute(
        text("update organizations set status='disabled' where tenant_id=:t"), {"t": org}
    )
    await db.commit()
    assert (await cu.get("/api/v1/_test/items", headers=tenant(org))).status_code == 404
    assert (
        await cu.post("/api/v1/_test/items", params={"label": "x"}, headers=tenant(org))
    ).status_code == 404


async def test_bad_tenant_header_is_404(api, db, line):  # Review Focus 3
    mount_items(api)
    cu, _ = await user_client(api, line, "U")
    _, other = await user_client(api, line, "OTHER")
    other_personal = (
        await db.execute(
            text("select id from tenants where kind='personal' and owner_user_id=:u"), {"u": other}
        )
    ).scalar_one()
    guest = (await api.post("/api/v1/auth/guest")).json()["tenant_id"]
    bodies = []
    for value in [
        "abc",
        "-1",
        "0",
        "9223372036854775808",
        "9" * 5000,
        str(other_personal),
        str(guest),
    ]:
        r = await cu.get("/api/v1/_test/items", headers=tenant(value))
        assert r.status_code == 404, value
        bodies.append((r.json()["code"], r.json()["message_key"]))
    assert len(set(bodies)) == 1


async def test_guest_own_tenant_and_list_tenants_401(api):  # Review Focus 3/4
    mount_items(api)
    guest = (await api.post("/api/v1/auth/guest")).json()["tenant_id"]
    assert (await api.post("/api/v1/_test/items", params={"label": "g"})).json()[
        "tenant_id"
    ] == guest
    assert (await api.get("/api/v1/_test/items", headers=tenant(guest))).json() == ["g"]
    assert (await api.get("/api/v1/me/tenants")).status_code == 401


async def test_tenant_header_declared_in_openapi(api):  # final review: B-3 client needs it
    mount_items(api)
    api.app.openapi_schema = None
    params = api.app.openapi()["paths"]["/api/v1/_test/items"]["get"].get("parameters", [])
    assert any(p["name"] == "X-Tenant-Id" and p["in"] == "header" for p in params)
