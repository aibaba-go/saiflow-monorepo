"""rebuild-tenant-rbac Task 9: organization operations in the operation log (FR-SYS-028)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import ORG, admin_client, registered_client

pytestmark = pytest.mark.integration


async def test_org_operations_audited(api, db, line, mail):  # AC-FR-SYS-028-01
    owner, _ = await registered_client(api, line, mail, "OWNER")
    app_id = (await owner.post("/api/v1/organization-applications", json=ORG)).json()["id"]
    admin = await admin_client(api, db)
    org = (await admin.post(f"/api/v1/admin/organization-applications/{app_id}/approve")).json()[
        "tenant_id"
    ]
    token = (await owner.post(f"/api/v1/organizations/{org}/invitations")).json()["token"]
    cm, m = await registered_client(api, line, mail, "M")
    assert (await cm.post("/api/v1/invitations/accept", json={"token": token})).status_code == 200
    assert (await owner.delete(f"/api/v1/organizations/{org}/members/{m}")).status_code == 204
    rows = (
        await db.execute(
            text(
                "select actor_type, actor_id, action, target_type, target_id, result "
                "from audit_log where action in ('org.apply', 'org.approve', "
                "'invitation.create', 'invitation.accept', 'member.remove') order by id"
            )
        )
    ).all()
    assert [r.action for r in rows] == [
        "org.apply",
        "org.approve",
        "invitation.create",
        "invitation.accept",
        "member.remove",
    ]
    assert all(r.actor_id and r.target_type and r.target_id and r.result == "success" for r in rows)
    assert [r.actor_type for r in rows] == ["user", "admin", "user", "user", "user"]
    dump = repr((await db.execute(text("select * from audit_log"))).all())
    assert token not in dump


async def test_every_tenancy_action_is_logged(api, db, line, mail):
    """Each kind of change in FR-SYS-028 leaves its own action in the log."""
    owner, owner_id = await registered_client(api, line, mail, "OWNER")
    app_id = (await owner.post("/api/v1/organization-applications", json=ORG)).json()["id"]
    admin = await admin_client(api, db)
    org = (await admin.post(f"/api/v1/admin/organization-applications/{app_id}/approve")).json()[
        "tenant_id"
    ]
    base = f"/api/v1/organizations/{org}"
    await admin.put("/api/v1/admin/settings/org-member-limit-unpaid", json={"value": 5})
    await owner.patch(base, json={"name": "Renamed"})
    rid = (await owner.post(f"{base}/roles", json={"name": "R", "permissions": []})).json()["id"]
    await owner.patch(f"{base}/roles/{rid}", json={"permissions": ["export"]})
    inv = (await owner.post(f"{base}/invitations")).json()
    await owner.delete(f"{base}/invitations/{inv['id']}")
    token = (await owner.post(f"{base}/invitations")).json()["token"]
    cm, m = await registered_client(api, line, mail, "M")
    await cm.post("/api/v1/invitations/accept", json={"token": token})
    await owner.put(f"{base}/members/{m}/role", json={"role_id": rid})
    await owner.delete(f"{base}/roles/{rid}")
    await owner.post(f"{base}/owner-transfer", json={"user_id": m})
    await owner.post(f"{base}/leave")
    await cm.post(
        f"{base}/verification",
        json={"legal_name": "L", "tax_id": "0105561234567", "registered_address": "A"},
    )
    vid = (await admin.get("/api/v1/admin/verification-applications")).json()[0]["id"]
    await admin.post(f"/api/v1/admin/verification-applications/{vid}/approve")
    await admin.put(f"/api/v1/admin/organizations/{org}/verification", json={"verified": False})
    await admin.post(f"/api/v1/admin/organizations/{org}/disable")
    await admin.post(f"/api/v1/admin/organizations/{org}/enable")
    actions = set((await db.execute(text("select action from audit_log"))).scalars())
    expected = {
        "org.apply", "org.approve", "org.update", "org.disable", "org.enable",
        "org.owner_transfer", "role.create", "role.update", "role.delete",
        "member.role_assign", "invitation.create", "invitation.revoke", "invitation.accept",
        "member.leave", "verification.submit", "verification.approve", "verification.unset",
        "setting.update",
    }  # fmt: skip
    assert expected <= actions, expected - actions


async def test_api_runs_as_app_role(api):  # M6
    async with api.app.state.engine.connect() as conn:
        assert (await conn.execute(text("select current_user"))).scalar_one() == "saiflow_v3_app"
