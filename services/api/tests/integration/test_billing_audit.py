"""rebuild-plans-metering Task 6: billing operations in the operation log (FR-SYS-034-01)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import approved_org, registered_client, tenant

pytestmark = pytest.mark.integration


async def test_billing_operations_audited(api, db, line, mail):  # AC-FR-SYS-034-01
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await admin.patch("/api/v1/admin/plans/starter", json={"monthly_quota": 4500})
    app_id = (
        await owner.post(
            "/api/v1/billing/applications",
            json={"plan_code": "starter", "period": "month"},
            headers=tenant(org),
        )
    ).json()["id"]
    await admin.post(f"/api/v1/admin/plan-applications/{app_id}/approve")
    rows = (
        await db.execute(
            text(
                "select actor_type, actor_id, action, target_type, target_id, result "
                "from audit_log "
                "where action in ('plan.update', 'plan_application.submit', "
                "'plan_application.approve') order by id"
            )
        )
    ).all()
    assert [r.action for r in rows] == [
        "plan.update",
        "plan_application.submit",
        "plan_application.approve",
    ]
    assert [r.actor_type for r in rows] == ["admin", "user", "admin"]
    assert all(r.actor_id and r.target_type and r.target_id and r.result == "success" for r in rows)


async def test_every_billing_action_is_logged(api, db, line, mail):
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await admin.put("/api/v1/admin/settings/free-quota-organization", json={"value": 80})
    first = (
        await owner.post(
            "/api/v1/billing/applications",
            json={"plan_code": "starter", "period": "month"},
            headers=tenant(org),
        )
    ).json()["id"]
    await admin.post(f"/api/v1/admin/plan-applications/{first}/reject", json={"reason": "unpaid"})
    await admin.put(
        f"/api/v1/admin/tenants/{org}/subscription",
        json={"plan_code": "starter", "period": "month"},
    )
    await registered_client(api, line, mail, "OTHER")
    actions = set((await db.execute(text("select action from audit_log"))).scalars())
    expected = {
        "subscription.auto", "subscription.set", "free_quota.grant",
        "plan_application.submit", "plan_application.reject", "setting.update",
    }  # fmt: skip
    assert expected <= actions, expected - actions
