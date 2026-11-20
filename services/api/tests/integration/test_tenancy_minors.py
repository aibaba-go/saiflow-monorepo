"""rebuild-plans-metering Task 7: B-2b minors N1-N6, N8, N9."""

import pytest
from sqlalchemy import text

from app.services import membership_service, role_service
from app.services.session_service import Principal
from app.services.tenant_access import resolve_tenant
from tests.integration.tenancy_helpers import (
    add_member,
    approved_org,
    make_role,
    registered_client,
)

pytestmark = pytest.mark.integration
HUGE = "9" * 20


async def _personal(db, uid: int) -> int:
    return (
        await db.execute(
            text("select id from tenants where kind='personal' and owner_user_id=:u"), {"u": uid}
        )
    ).scalar_one()


async def _default_role(db, org: int) -> int:
    return (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()


async def test_non_numeric_and_huge_path_ids_404(api, db, line, mail):  # N1
    owner, _, org, admin = await approved_org(api, db, line, mail)
    for path in [
        "/api/v1/organizations/abc",
        f"/api/v1/organizations/{HUGE}",
        "/api/v1/organizations/0",
        f"/api/v1/organizations/{org}/roles/abc",
        f"/api/v1/organizations/{org}/roles/{HUGE}",
    ]:
        method = "PATCH" if "/roles/" in path else "GET"
        r = await owner.request(method, path, json={"name": "x"} if method == "PATCH" else None)
        assert r.status_code == 404 and r.json()["code"] == "not_found", path
    r = await admin.get(f"/api/v1/admin/organizations/{HUGE}")
    assert r.status_code == 404


async def test_huge_body_ids_400(api, db, line, mail):  # N1
    owner, _, org, _ = await approved_org(api, db, line, mail)
    _, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    r = await owner.put(
        f"/api/v1/organizations/{org}/members/{m}/role", json={"role_id": int(HUGE)}
    )
    assert r.status_code == 400 and r.json()["fields"] == ["role_id"]
    r = await owner.post(f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": int(HUGE)})
    assert r.status_code == 400 and r.json()["fields"] == ["user_id"]


async def test_demoted_manager_cannot_finish_removal(api, db, line, mail):  # N2
    owner, _, org, _ = await approved_org(api, db, line, mail)
    manager_role = await make_role(db, org, "Mgr", ["member_manage"])
    _, a = await registered_client(api, line, mail, "A")
    _, b = await registered_client(api, line, mail, "B")
    await add_member(db, org, a, manager_role)
    await add_member(db, org, b, await _default_role(db, org))
    stale = await resolve_tenant(db, Principal("user", 0, await _personal(db, a), a), org)
    await db.execute(
        text("update memberships set role_id=:r where user_id=:u and tenant_id=:t"),
        {"r": await _default_role(db, org), "u": a, "t": org},
    )
    await db.commit()
    with pytest.raises(Exception) as info:
        await membership_service.remove_member(db, stale, b)
    assert getattr(info.value, "status", None) == 403
    await db.rollback()
    removed = (
        await db.execute(
            text("select removed_at from memberships where user_id=:u and tenant_id=:t"),
            {"u": b, "t": org},
        )
    ).scalar_one()
    assert removed is None


async def test_assign_deleted_role_404(api, db, line, mail):  # N3
    owner, owner_id, org, _ = await approved_org(api, db, line, mail)
    _, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    rid = await make_role(db, org, "Temp", [])
    ctx = await resolve_tenant(
        db, Principal("user", 0, await _personal(db, owner_id), owner_id), org
    )
    await db.execute(text("delete from roles where id=:r"), {"r": rid})
    await db.commit()
    with pytest.raises(Exception) as info:
        await role_service.assign_role(db, ctx, m, rid)
    assert getattr(info.value, "status", None) == 404


async def test_admin_set_closes_pending_application(api, db, line, mail):  # N5
    owner, _, org, admin = await approved_org(api, db, line, mail)
    data = {"legal_name": "L", "tax_id": "0105561234567", "registered_address": "A"}
    assert (
        await owner.post(f"/api/v1/organizations/{org}/verification", json=data)
    ).status_code == 201
    await admin.put(f"/api/v1/admin/organizations/{org}/verification", json={"verified": False})
    pending = (
        await db.execute(
            text("select count(*) from verification_applications where status='pending'")
        )
    ).scalar_one()
    assert pending == 0
    assert (
        await owner.post(f"/api/v1/organizations/{org}/verification", json=data)
    ).status_code == 201


async def test_empty_org_patch_not_audited(api, db, line, mail):  # N6
    owner, _, org, _ = await approved_org(api, db, line, mail)
    for body in [{}, {"name": "Siam Tools"}]:
        assert (await owner.patch(f"/api/v1/organizations/{org}", json=body)).status_code == 200
    count = (
        await db.execute(text("select count(*) from audit_log where action = 'org.update'"))
    ).scalar_one()
    assert count == 0


async def test_settings_body_validation_400(api, db, line, mail):  # N8
    _, _, org, admin = await approved_org(api, db, line, mail)
    for path, body in [
        ("/api/v1/admin/settings/org-member-limit-unpaid", {"value": "5"}),
        ("/api/v1/admin/settings/org-member-limit-unpaid", {}),
        ("/api/v1/admin/settings/free-quota-personal", {"value": True}),
        (f"/api/v1/admin/organizations/{org}/verification", {"verified": "yes"}),
        (f"/api/v1/admin/organizations/{org}/verification", {}),
    ]:
        r = await admin.put(path, json=body)
        assert r.status_code == 400, (path, body, r.status_code)


async def test_openapi_has_response_schemas(api):  # N9
    api.app.openapi_schema = None
    paths = api.app.openapi()["paths"]
    missing = []
    for path, ops in paths.items():
        if not path.startswith(("/api/v1/organizations", "/api/v1/admin/organizations")):
            continue
        for method, op in ops.items():
            ok = [c for c in op["responses"] if c.startswith("2")]
            if not ok:
                missing.append((method, path))
                continue
            resp = op["responses"][ok[0]]
            if ok[0] != "204" and "$ref" not in str(resp.get("content", {})):
                missing.append((method, path))
    assert missing == []
