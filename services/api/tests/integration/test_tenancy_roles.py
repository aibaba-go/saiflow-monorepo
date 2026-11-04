"""rebuild-tenant-rbac Task 5: roles and permission points (FR-SYS-002)."""

from typing import Annotated

import pytest
from fastapi import Depends
from sqlalchemy import text

from app.dependencies import get_tenant_context
from app.permissions import Permission
from app.services.tenant_access import TenantContext, require
from tests.integration.tenancy_helpers import add_member, approved_org, registered_client, tenant

pytestmark = pytest.mark.integration


def mount_export(api) -> None:
    if getattr(api.app.state, "export_mounted", False):
        return
    api.app.state.export_mounted = True

    async def export(ctx: Annotated[TenantContext, Depends(get_tenant_context)]) -> dict:
        require(ctx, Permission.EXPORT)
        return {"ok": True}

    api.app.add_api_route("/api/v1/_test/export", export, methods=["POST"])


async def _default_role(db, tid: int) -> int:
    return (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": tid})
    ).scalar_one()


async def _org_with_member(api, db, line, mail, perms: list[str] | None = None):
    owner, owner_id, org, _ = await approved_org(api, db, line, mail)
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    return owner, owner_id, org, cm, m


def roles_url(org: int) -> str:
    return f"/api/v1/organizations/{org}/roles"


async def _role_of(db, org: int, user_id: int) -> int | None:
    return (
        await db.execute(
            text(
                "select role_id from memberships where tenant_id=:t and user_id=:u "
                "and removed_at is null"
            ),
            {"t": org, "u": user_id},
        )
    ).scalar_one()


async def test_permission_enforced(api, db, line, mail):  # AC-FR-SYS-002-01
    mount_export(api)
    owner, _, org, cm, _ = await _org_with_member(api, db, line, mail)
    none = (await owner.post(roles_url(org), json={"name": "Nothing", "permissions": []})).json()
    cv, v = await registered_client(api, line, mail, "V")
    await add_member(db, org, v, none["id"])
    r = await cv.post("/api/v1/_test/export", headers=tenant(org))
    assert r.status_code == 403 and r.json()["code"] == "permission_denied"
    assert (await cm.post("/api/v1/_test/export", headers=tenant(org))).status_code == 200


async def test_new_org_default_role(api, db, line, mail):  # AC-FR-SYS-002-02
    owner, _, org, _ = await approved_org(api, db, line, mail)
    roles = (await owner.get(roles_url(org))).json()
    assert len(roles) == 1 and roles[0]["is_default"] is True
    assert sorted(roles[0]["permissions"]) == ["export", "upload_ocr", "verify_own"]


async def test_custom_role_assign(api, db, line, mail):  # AC-FR-SYS-002-03
    owner, _, org, cm, m = await _org_with_member(api, db, line, mail)
    r = await owner.post(
        roles_url(org), json={"name": "复核员", "permissions": ["review_l1", "data_browse"]}
    )
    assert r.status_code == 201
    rid = r.json()["id"]
    r = await owner.put(f"/api/v1/organizations/{org}/members/{m}/role", json={"role_id": rid})
    assert r.status_code == 200
    mine = [t for t in (await cm.get("/api/v1/me/tenants")).json() if t["tenant_id"] == org][0]
    assert sorted(mine["permissions"]) == ["data_browse", "review_l1"]


async def test_role_validation(api, db, line, mail):  # AC-FR-SYS-002-04
    owner, _, org, _ = await approved_org(api, db, line, mail)
    await owner.post(roles_url(org), json={"name": "复核员", "permissions": []})
    r = await owner.post(roles_url(org), json={"name": "复核员", "permissions": []})
    assert r.status_code == 409 and r.json()["code"] == "role_name_taken"
    r = await owner.post(roles_url(org), json={"name": "x" * 65, "permissions": []})
    assert r.status_code == 400 and r.json()["fields"] == ["name"]
    r = await owner.post(roles_url(org), json={"name": "Bad", "permissions": ["fly"]})
    assert r.status_code == 400 and r.json()["fields"] == ["permissions"]
    count = (
        await db.execute(text("select count(*) from roles where tenant_id=:t"), {"t": org})
    ).scalar_one()
    assert count == 2


async def test_editing_default_role_takes_effect_next_request(api, db, line, mail):  # 002-05
    mount_export(api)
    owner, _, org, cm, _ = await _org_with_member(api, db, line, mail)
    assert (await cm.post("/api/v1/_test/export", headers=tenant(org))).status_code == 200
    default = await _default_role(db, org)
    r = await owner.patch(
        f"{roles_url(org)}/{default}", json={"permissions": ["upload_ocr", "verify_own"]}
    )
    assert r.status_code == 200
    assert (await cm.post("/api/v1/_test/export", headers=tenant(org))).status_code == 403


async def test_delete_role_moves_holders_default_protected(api, db, line, mail):  # 002-06
    owner, _, org, _, m = await _org_with_member(api, db, line, mail)
    rid = (await owner.post(roles_url(org), json={"name": "R", "permissions": []})).json()["id"]
    await owner.put(f"/api/v1/organizations/{org}/members/{m}/role", json={"role_id": rid})
    assert (await owner.delete(f"{roles_url(org)}/{rid}")).status_code == 204
    default = await _default_role(db, org)
    assert await _role_of(db, org, m) == default
    r = await owner.delete(f"{roles_url(org)}/{default}")
    assert r.status_code == 409 and r.json()["code"] == "default_role_protected"


async def test_owner_and_own_role_protected(api, db, line, mail):  # AC-FR-SYS-002-07
    owner, owner_id, org, _, _ = await _org_with_member(api, db, line, mail)
    manager = (
        await owner.post(roles_url(org), json={"name": "Mgr", "permissions": ["role_manage"]})
    ).json()["id"]
    other = (await owner.post(roles_url(org), json={"name": "Other", "permissions": []})).json()
    ca, a = await registered_client(api, line, mail, "A")
    await add_member(db, org, a, manager)
    for method, path, body in [
        ("PUT", f"/api/v1/organizations/{org}/members/{owner_id}/role", {"role_id": other["id"]}),
        ("PUT", f"/api/v1/organizations/{org}/members/{a}/role", {"role_id": other["id"]}),
        (
            "PATCH",
            f"{roles_url(org)}/{manager}",
            {"permissions": sorted(p.value for p in Permission)},
        ),
    ]:
        r = await ca.request(method, path, json=body)
        assert r.status_code == 403, path
    assert await _role_of(db, org, a) == manager
    perms = (
        await db.execute(text("select permissions from roles where id=:r"), {"r": manager})
    ).scalar_one()
    assert perms == ["role_manage"]


async def test_review_and_report_grantable(api, db, line, mail):  # AC-FR-SYS-002-08
    owner, _, org, cm, m = await _org_with_member(api, db, line, mail)
    rid = (
        await owner.post(
            roles_url(org),
            json={"name": "Rev", "permissions": ["review_l1", "review_l2", "report_view"]},
        )
    ).json()["id"]
    await owner.put(f"/api/v1/organizations/{org}/members/{m}/role", json={"role_id": rid})
    mine = [t for t in (await cm.get("/api/v1/me/tenants")).json() if t["tenant_id"] == org][0]
    assert sorted(mine["permissions"]) == ["report_view", "review_l1", "review_l2"]


async def test_without_role_manage_403(api, db, line, mail):  # AC-FR-SYS-002-09
    owner, owner_id, org, cm, m = await _org_with_member(api, db, line, mail)
    assert (await cm.post(roles_url(org), json={"name": "X", "permissions": []})).status_code == 403
    default = await _default_role(db, org)
    r = await cm.put(f"/api/v1/organizations/{org}/members/{m}/role", json={"role_id": default})
    assert r.status_code == 403
    count = (
        await db.execute(text("select count(*) from roles where tenant_id=:t"), {"t": org})
    ).scalar_one()
    assert count == 1


async def test_role_from_other_org_rejected(api, db, line, mail):
    owner, _, org, admin = await approved_org(api, db, line, mail)
    _, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    _, _, other_org, _ = await approved_org(api, db, line, mail, sub="OTHER", admin=admin)
    foreign = await _default_role(db, other_org)
    r = await owner.put(f"/api/v1/organizations/{org}/members/{m}/role", json={"role_id": foreign})
    assert r.status_code == 404
    assert await _role_of(db, org, m) == await _default_role(db, org)
