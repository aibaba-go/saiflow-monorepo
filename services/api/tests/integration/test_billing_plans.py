"""rebuild-plans-metering Task 2: the plan catalog (FR-SYS-030)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import admin_client, registered_client

pytestmark = pytest.mark.integration
PLANS = "/api/v1/admin/plans"


async def test_admin_lists_catalog(api, db):  # AC-FR-SYS-030-01
    admin = await admin_client(api, db)
    body = (await admin.get(PLANS)).json()
    assert [(p["code"], p["monthly_quota"], p["member_limit"], p["tenant_kind"]) for p in body] == [
        ("kinder", 1000, 1, "personal"),
        ("starter", 5000, 2, "organization"),
        ("intermediate", 10000, 5, "organization"),
        ("advance", 100000, None, "organization"),
    ]


async def test_admin_edits_quota_and_limit(api, db):
    admin = await admin_client(api, db)
    r = await admin.patch(f"{PLANS}/starter", json={"monthly_quota": 4500})
    assert r.status_code == 200 and r.json()["monthly_quota"] == 4500
    assert r.json()["member_limit"] == 2  # absent field unchanged
    r = await admin.patch(f"{PLANS}/intermediate", json={"member_limit": None})
    assert r.status_code == 200 and r.json()["member_limit"] is None  # null = unlimited
    r = await admin.patch(f"{PLANS}/advance", json={"member_limit": 50})
    assert r.json()["member_limit"] == 50
    listed = {p["code"]: p for p in (await admin.get(PLANS)).json()}
    assert listed["starter"]["monthly_quota"] == 4500


async def test_kinder_member_limit_fixed(api, db):  # AC-FR-SYS-030-03
    admin = await admin_client(api, db)
    for value in [3, None, 1]:
        r = await admin.patch(f"{PLANS}/kinder", json={"member_limit": value})
        assert r.status_code == 400 and r.json()["fields"] == ["member_limit"], value
    r = await admin.patch(f"{PLANS}/kinder", json={"monthly_quota": 1200})
    assert r.status_code == 200
    row = (await db.execute(text("select member_limit from plans where code='kinder'"))).one()
    assert row[0] == 1


async def test_plan_validation(api, db):  # AC-FR-SYS-030-04
    admin = await admin_client(api, db)
    for body, field in [
        ({"monthly_quota": 0}, "monthly_quota"),
        ({"monthly_quota": -1}, "monthly_quota"),
        ({"monthly_quota": "5"}, "monthly_quota"),
        ({"monthly_quota": 1.5}, "monthly_quota"),
        ({"monthly_quota": True}, "monthly_quota"),
        ({"member_limit": 0}, "member_limit"),
    ]:
        r = await admin.patch(f"{PLANS}/starter", json=body)
        assert r.status_code == 400 and field in r.json()["fields"], body
    quota = (
        await db.execute(text("select monthly_quota from plans where code='starter'"))
    ).scalar_one()
    assert quota == 5000


async def test_plan_admin_only(api, db, line, mail):  # AC-FR-SYS-030-05
    customer, _ = await registered_client(api, line, mail, "U")
    r = await customer.patch(f"{PLANS}/starter", json={"monthly_quota": 1})
    assert r.status_code in (401, 403)
    assert (await customer.get(PLANS)).status_code in (401, 403)


async def test_unknown_plan_404(api, db):
    admin = await admin_client(api, db)
    assert (await admin.patch(f"{PLANS}/platinum", json={"monthly_quota": 9})).status_code == 404


async def test_plan_update_audited(api, db):
    admin = await admin_client(api, db)
    await admin.patch(f"{PLANS}/starter", json={"monthly_quota": 4500})
    actions = (await db.execute(text("select action, target_id from audit_log"))).all()
    assert ("plan.update", "starter") in [tuple(a) for a in actions]
