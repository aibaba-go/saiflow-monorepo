"""rebuild-notifications Task 6: B-2c Minors M1-M6."""

from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.errors import AppError
from app.services import metering_service
from tests.integration.tenancy_helpers import approved_org, registered_client

pytestmark = pytest.mark.integration


async def test_release_other_tenant_404(api, db, line, mail):  # M1
    c, _ = await registered_client(api, line, mail, "U")
    mine = (await c.get("/api/v1/me")).json()["tenant_id"]
    _, _, org, _ = await approved_org(api, db, line, mail)
    r = await metering_service.reserve(db, mine, 3, "job-1")
    await db.commit()
    rid = r.id
    with pytest.raises(AppError) as info:
        await metering_service.release(db, org, rid)
    assert info.value.status == 404
    await db.rollback()
    released = (
        await db.execute(
            text("select released_at from quota_reservations where id = :i"), {"i": rid}
        )
    ).scalar_one()
    assert released is None
    await metering_service.release(db, mine, rid)
    await db.commit()


async def test_admin_set_closes_pending_with_audit(api, db, line, mail):  # M2
    owner, _, org, admin = await approved_org(api, db, line, mail)
    data = {"legal_name": "L", "tax_id": "0105561234567", "registered_address": "A"}
    assert (
        await owner.post(f"/api/v1/organizations/{org}/verification", json=data)
    ).status_code == 201
    await admin.put(f"/api/v1/admin/organizations/{org}/verification", json={"verified": True})
    reason = (
        await db.execute(text("select reject_reason from verification_applications"))
    ).scalar_one()
    assert reason == "set_by_admin"
    actions = list(
        (
            await db.execute(
                text(
                    "select action from audit_log where target_id = :t and action like "
                    "'verification.%' order by id"
                ),
                {"t": str(org)},
            )
        ).scalars()
    )
    assert actions == ["verification.submit", "verification.reject", "verification.set"]


async def test_year_9999_start_400(api, db, line, mail):  # M3
    _, _, org, admin = await approved_org(api, db, line, mail)
    for body in [
        {"plan_code": "starter", "period": "year", "starts_at": "9999-03-15T00:00:00+07:00"},
        {"plan_code": "starter", "period": "month", "starts_at": "9999-12-15T00:00:00+07:00"},
        {
            "plan_code": "starter",
            "period": "month",
            "starts_at": "2030-01-01T00:00:00+07:00",
            "ends_at": "9999-12-31T00:00:00+07:00",
        },
    ]:
        r = await admin.put(f"/api/v1/admin/tenants/{org}/subscription", json=body)
        assert r.status_code == 400, (body, r.text)
    assert (await admin.get(f"/api/v1/admin/tenants/{org}/subscriptions")).json() == []


async def test_admin_lists_unknown_tenant_404(api, db, line, mail):  # M5
    _, _, _, admin = await approved_org(api, db, line, mail)
    for path in ["subscriptions", "reservations"]:
        r = await admin.get(f"/api/v1/admin/tenants/987654/{path}")
        assert r.status_code == 404 and r.json()["code"] == "not_found", path


async def test_usage_hides_future_period(api, db, line, mail):  # M6
    owner, _, org, _ = await approved_org(api, db, line, mail)
    start = utcnow() + timedelta(days=7)
    await db.execute(
        text(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source)"
            " values (:t, 'starter', 'month', :s, :e, 'admin')"
        ),
        {"t": org, "s": start, "e": start + timedelta(days=30)},
    )
    await db.commit()
    body = (await owner.get("/api/v1/billing/usage", headers={"X-Tenant-Id": str(org)})).json()
    assert body["plan"] is None and body["active"] is False
