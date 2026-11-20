"""rebuild-plans-metering Task 5: renewal and opening applications (FR-SYS-032)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import (
    add_member,
    approved_org,
    client_like,
    registered_client,
    tenant,
)

pytestmark = pytest.mark.integration
APPS = "/api/v1/billing/applications"
ADMIN_APPS = "/api/v1/admin/plan-applications"


async def _default_role(db, org: int) -> int:
    return (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()


async def test_apply_and_approve(api, db, line, mail):  # AC-FR-SYS-032-01
    owner, _, org, admin = await approved_org(api, db, line, mail)
    r = await owner.post(
        APPS,
        json={"plan_code": "starter", "period": "month", "note": "paid by transfer"},
        headers=tenant(org),
    )
    assert r.status_code == 201 and r.json()["status"] == "pending"
    app_id = r.json()["id"]
    r = await admin.post(f"{ADMIN_APPS}/{app_id}/approve")
    assert r.status_code == 200 and r.json()["plan_code"] == "starter"
    usage = (await owner.get("/api/v1/billing/usage", headers=tenant(org))).json()
    assert usage["active"] is True and usage["plan"]["code"] == "starter"
    [mine] = (await owner.get(APPS, headers=tenant(org))).json()
    assert mine["status"] == "approved" and mine["subscription_id"] is not None
    source = (
        await db.execute(
            text("select source, application_id from subscriptions where tenant_id=:t"), {"t": org}
        )
    ).one()
    assert tuple(source) == ("application", app_id)


async def test_application_plan_rules(api, db, line, mail):  # AC-FR-SYS-032-02
    owner, uid, org, admin = await approved_org(api, db, line, mail)
    await admin.put(
        f"/api/v1/admin/tenants/{org}/subscription",
        json={"plan_code": "intermediate", "period": "month"},
    )
    r = await owner.post(
        APPS, json={"plan_code": "starter", "period": "month"}, headers=tenant(org)
    )
    assert r.status_code == 400 and r.json()["fields"] == ["plan_code"]
    r = await owner.post(APPS, json={"plan_code": "starter", "period": "month"})  # personal
    assert r.status_code == 400 and r.json()["fields"] == ["plan_code"]
    count = (await db.execute(text("select count(*) from plan_applications"))).scalar_one()
    assert count == 0


async def test_application_validation(api, db, line, mail):
    owner, _, org, _ = await approved_org(api, db, line, mail)
    for body, field in [
        ({"plan_code": "starter", "period": "week"}, "period"),
        ({"plan_code": "platinum", "period": "month"}, "plan_code"),
        ({"plan_code": "starter", "period": "month", "note": "x" * 513}, "note"),
        ({"plan_code": 5, "period": "month"}, "plan_code"),
    ]:
        r = await owner.post(APPS, json=body, headers=tenant(org))
        assert r.status_code == 400 and field in r.json()["fields"], body


async def test_second_pending_409(api, db, line, mail):  # AC-FR-SYS-032-03
    owner, _, org, _ = await approved_org(api, db, line, mail)
    body = {"plan_code": "starter", "period": "month"}
    assert (await owner.post(APPS, json=body, headers=tenant(org))).status_code == 201
    r = await owner.post(APPS, json=body, headers=tenant(org))
    assert r.status_code == 409 and r.json()["code"] == "application_pending"


async def test_reject_requires_reason_then_resubmit(api, db, line, mail):  # AC-FR-SYS-032-04
    owner, _, org, admin = await approved_org(api, db, line, mail)
    body = {"plan_code": "starter", "period": "month"}
    app_id = (await owner.post(APPS, json=body, headers=tenant(org))).json()["id"]
    r = await admin.post(f"{ADMIN_APPS}/{app_id}/reject", json={})
    assert r.status_code == 400 and r.json()["fields"] == ["reason"]
    r = await admin.post(f"{ADMIN_APPS}/{app_id}/reject", json={"reason": "No payment yet"})
    assert r.status_code == 200
    [mine] = (await owner.get(APPS, headers=tenant(org))).json()
    assert mine["status"] == "rejected" and mine["reject_reason"] == "No payment yet"
    usage = (await owner.get("/api/v1/billing/usage", headers=tenant(org))).json()
    assert usage["plan"] is None
    assert (await owner.post(APPS, json=body, headers=tenant(org))).status_code == 201


async def test_no_permission_403_guest_401(api, db, line, mail):  # AC-FR-SYS-032-05
    _, _, org, _ = await approved_org(api, db, line, mail)
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, await _default_role(db, org))
    body = {"plan_code": "starter", "period": "month"}
    assert (await cm.post(APPS, json=body, headers=tenant(org))).status_code == 403
    guest = client_like(api)
    await guest.post("/api/v1/auth/guest")
    assert (
        await guest.post(APPS, json={"plan_code": "kinder", "period": "month"})
    ).status_code == 401
    count = (await db.execute(text("select count(*) from plan_applications"))).scalar_one()
    assert count == 0


async def test_member_with_plan_apply_can_apply(api, db, line, mail):
    owner, _, org, _ = await approved_org(api, db, line, mail)
    rid = (
        await owner.post(
            f"/api/v1/organizations/{org}/roles",
            json={"name": "Buyer", "permissions": ["plan_apply"]},
        )
    ).json()["id"]
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, rid)
    r = await cm.post(APPS, json={"plan_code": "advance", "period": "year"}, headers=tenant(org))
    assert r.status_code == 201


async def test_personal_renews_kinder(api, db, line, mail):
    c, _ = await registered_client(api, line, mail, "U")
    r = await c.post(APPS, json={"plan_code": "kinder", "period": "year"})
    assert r.status_code == 201 and r.json()["plan_code"] == "kinder"


async def test_decide_twice_409(api, db, line, mail):  # AC-FR-SYS-032-06
    owner, _, org, admin = await approved_org(api, db, line, mail)
    body = {"plan_code": "starter", "period": "month"}
    app_id = (await owner.post(APPS, json=body, headers=tenant(org))).json()["id"]
    assert (await admin.post(f"{ADMIN_APPS}/{app_id}/approve")).status_code == 200
    for path, extra in [("approve", None), ("reject", {"reason": "late"})]:
        r = await admin.post(f"{ADMIN_APPS}/{app_id}/{path}", json=extra)
        assert r.status_code == 409 and r.json()["code"] == "already_decided"
    count = (
        await db.execute(text("select count(*) from subscriptions where tenant_id=:t"), {"t": org})
    ).scalar_one()
    assert count == 1


async def test_approve_with_custom_dates(api, db, line, mail):
    owner, _, org, admin = await approved_org(api, db, line, mail)
    body = {"plan_code": "starter", "period": "month"}
    app_id = (await owner.post(APPS, json=body, headers=tenant(org))).json()["id"]
    start = datetime.now(UTC) + timedelta(days=1)
    end = start + timedelta(days=45)
    r = await admin.post(
        f"{ADMIN_APPS}/{app_id}/approve",
        json={"starts_at": start.isoformat(), "ends_at": end.isoformat()},
    )
    assert r.status_code == 200
    got = datetime.fromisoformat(r.json()["ends_at"])
    assert abs((got - end).total_seconds()) < 1


async def test_admin_lists_pending(api, db, line, mail):
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await owner.post(APPS, json={"plan_code": "starter", "period": "month"}, headers=tenant(org))
    pending = (await admin.get(ADMIN_APPS, params={"status": "pending"})).json()
    assert [p["tenant_id"] for p in pending] == [org]
