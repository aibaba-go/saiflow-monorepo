"""rebuild-plans-metering Task 3: subscriptions (FR-SYS-012) and the plan-based member
limit (FR-SYS-025 modified)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, approved_org, registered_client

pytestmark = pytest.mark.integration


def sub_url(tid: int) -> str:
    return f"/api/v1/admin/tenants/{tid}/subscription"


async def _subs(db, tid: int) -> list:
    return (
        await db.execute(
            text(
                "select plan_code, period, starts_at, ends_at, source from subscriptions "
                "where tenant_id = :t order by starts_at, id"
            ),
            {"t": tid},
        )
    ).all()


def _approx(a: datetime, b: datetime) -> bool:
    return abs((a - b).total_seconds()) < 120


async def test_personal_and_guest_auto_kinder(api, db, line):  # AC-FR-SYS-012-01
    me = await login(api, line, "U")
    now = datetime.now(UTC)
    [personal] = await _subs(db, me["tenant_id"])
    assert (personal.plan_code, personal.period, personal.source) == ("kinder", "month", "auto")
    assert _approx(personal.starts_at, now) and personal.ends_at > now + timedelta(days=27)
    api.cookies.clear()
    guest = (await api.post("/api/v1/auth/guest")).json()
    [g] = await _subs(db, guest["tenant_id"])
    assert (g.plan_code, g.source) == ("kinder", "auto")


async def test_org_has_no_subscription(api, db, line, mail):  # AC-FR-SYS-012-02
    _, _, org, _ = await approved_org(api, db, line, mail)
    assert await _subs(db, org) == []


async def test_admin_sets_org_subscription(api, db, line, mail):  # AC-FR-SYS-012-03
    _, _, org, admin = await approved_org(api, db, line, mail)
    r = await admin.put(sub_url(org), json={"plan_code": "starter", "period": "year"})
    assert r.status_code == 200, r.text
    [s] = await _subs(db, org)
    assert (s.plan_code, s.period, s.source) == ("starter", "year", "admin")
    assert _approx(s.starts_at, datetime.now(UTC))
    assert s.ends_at.year == s.starts_at.year + 1


async def test_same_plan_renewal_extends(api, db, line, mail):  # AC-FR-SYS-012-04
    _, _, org, admin = await approved_org(api, db, line, mail)
    now = datetime.now(UTC)
    end = now + timedelta(days=10)
    await admin.put(
        sub_url(org),
        json={
            "plan_code": "starter",
            "period": "month",
            "starts_at": (now - timedelta(days=20)).isoformat(),
            "ends_at": end.isoformat(),
        },
    )
    r = await admin.put(sub_url(org), json={"plan_code": "starter", "period": "month"})
    assert r.status_code == 200
    latest = (await _subs(db, org))[-1]
    assert _approx(latest.starts_at, end)
    from app.billing_time import add_months

    assert _approx(latest.ends_at, add_months(latest.starts_at, 1))


async def test_plan_rules(api, db, line, mail):  # AC-FR-SYS-012-05
    owner, uid, o1, admin = await approved_org(api, db, line, mail)
    _, _, o2, _ = await approved_org(api, db, line, mail, sub="OTHER", admin=admin)
    personal = (
        await db.execute(
            text("select id from tenants where kind='personal' and owner_user_id=:u"), {"u": uid}
        )
    ).scalar_one()
    await admin.put(sub_url(o1), json={"plan_code": "intermediate", "period": "month"})
    past = datetime.now(UTC) - timedelta(days=40)
    await admin.put(
        sub_url(o2),
        json={
            "plan_code": "advance",
            "period": "month",
            "starts_at": past.isoformat(),
            "ends_at": (past + timedelta(days=30)).isoformat(),
        },
    )
    for tid, plan in [(personal, "starter"), (o1, "starter"), (o2, "kinder")]:
        r = await admin.put(sub_url(tid), json={"plan_code": plan, "period": "month"})
        assert r.status_code == 400 and r.json()["fields"] == ["plan_code"], (tid, plan)
    r = await admin.put(sub_url(o2), json={"plan_code": "starter", "period": "month"})
    assert r.status_code == 200  # expired: any applicable plan, even a lower one


async def test_end_after_start(api, db, line, mail):  # AC-FR-SYS-012-06
    _, _, org, admin = await approved_org(api, db, line, mail)
    now = datetime.now(UTC).isoformat()
    for body in [
        {"plan_code": "starter", "period": "month", "starts_at": now, "ends_at": now},
        {
            "plan_code": "starter",
            "period": "month",
            "starts_at": now,
            "ends_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
        },
    ]:
        r = await admin.put(sub_url(org), json=body)
        assert r.status_code == 400 and r.json()["fields"] == ["ends_at"]
    assert await _subs(db, org) == []


async def test_subscription_input_validation(api, db, line, mail):
    _, _, org, admin = await approved_org(api, db, line, mail)
    for body, field in [
        ({"plan_code": "platinum", "period": "month"}, "plan_code"),
        ({"plan_code": "starter", "period": "week"}, "period"),
        ({"plan_code": "starter", "period": "month", "starts_at": "tomorrow"}, "starts_at"),
        ({"period": "month"}, "plan_code"),
    ]:
        r = await admin.put(sub_url(org), json=body)
        assert r.status_code == 400 and field in r.json()["fields"], body


async def test_history_kept(api, db, line, mail):  # AC-FR-SYS-012-08
    _, _, org, admin = await approved_org(api, db, line, mail)
    await admin.put(sub_url(org), json={"plan_code": "starter", "period": "month"})
    await admin.put(sub_url(org), json={"plan_code": "intermediate", "period": "year"})
    history = (await admin.get(f"/api/v1/admin/tenants/{org}/subscriptions")).json()
    assert [(h["plan_code"], h["period"], h["source"]) for h in history] == [
        ("starter", "month", "admin"),
        ("intermediate", "year", "admin"),
    ]


async def test_set_for_unknown_tenant_404(api, db, line, mail):  # Review Focus 4
    _, _, _, admin = await approved_org(api, db, line, mail)
    r = await admin.put(sub_url(999999), json={"plan_code": "starter", "period": "month"})
    assert r.status_code == 404


async def test_member_limit_follows_plan(api, db, line, mail):  # AC-FR-SYS-025-05
    owner, _, org, admin = await approved_org(api, db, line, mail)
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    _, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, role)
    await admin.put(sub_url(org), json={"plan_code": "intermediate", "period": "month"})
    results = [
        (await owner.post(f"/api/v1/organizations/{org}/invitations")).status_code for _ in range(4)
    ]
    assert results == [201, 201, 201, 409]


async def test_member_limit_back_to_unpaid_after_expiry(api, db, line, mail):  # AC-025-06
    owner, _, org, admin = await approved_org(api, db, line, mail)
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    for sub in ["A", "B", "C"]:
        _, uid = await registered_client(api, line, mail, sub)
        await add_member(db, org, uid, role)
    past = datetime.now(UTC) - timedelta(days=40)
    await admin.put(
        sub_url(org),
        json={
            "plan_code": "intermediate",
            "period": "month",
            "starts_at": past.isoformat(),
            "ends_at": (past + timedelta(days=30)).isoformat(),
        },
    )
    assert (await owner.post(f"/api/v1/organizations/{org}/invitations")).status_code == 409
    members = (
        await db.execute(
            text("select count(*) from memberships where tenant_id=:t and removed_at is null"),
            {"t": org},
        )
    ).scalar_one()
    assert members == 4


async def test_subscription_set_audited(api, db, line, mail):
    _, _, org, admin = await approved_org(api, db, line, mail)
    await admin.put(sub_url(org), json={"plan_code": "starter", "period": "month"})
    actions = set((await db.execute(text("select action from audit_log"))).scalars())
    assert {"subscription.auto", "subscription.set"} <= actions
