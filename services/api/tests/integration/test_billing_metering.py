"""rebuild-plans-metering Task 4: free quotas (FR-SYS-031), scan reservation and release
(FR-SYS-013), usage (FR-SYS-033), reservation records (FR-SYS-034-02)."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Annotated

import pytest
from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing_time import BANGKOK
from app.dependencies import get_db, get_tenant_context
from app.errors import AppError
from app.services import metering_service
from app.services.tenant_access import TenantContext
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import (
    add_member,
    admin_client,
    approved_org,
    registered_client,
    tenant,
)

pytestmark = pytest.mark.integration
USAGE = "/api/v1/billing/usage"


def mount_reserve(api) -> None:
    if getattr(api.app.state, "reserve_mounted", False):
        return
    api.app.state.reserve_mounted = True

    async def reserve(
        pages: int,
        ref: str,
        ctx: Annotated[TenantContext, Depends(get_tenant_context)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> dict:
        r = await metering_service.reserve(db, ctx.tenant_id, pages, ref)
        await db.commit()
        return {"id": r.id, "from_free": r.from_free, "from_monthly": r.from_monthly}

    api.app.add_api_route("/api/v1/_test/reserve", reserve, methods=["POST"])


async def _free(db, tid: int) -> int:
    return (
        await db.execute(text("select remaining from free_quotas where tenant_id=:t"), {"t": tid})
    ).scalar_one_or_none() or 0


async def _set_free(db, tid: int, remaining: int) -> None:
    await db.execute(
        text("update free_quotas set remaining=:r where tenant_id=:t"), {"r": remaining, "t": tid}
    )
    await db.commit()


async def _set_plan(admin, tid: int, plan: str, starts: datetime, ends: datetime, period="month"):
    r = await admin.put(
        f"/api/v1/admin/tenants/{tid}/subscription",
        json={
            "plan_code": plan,
            "period": period,
            "starts_at": starts.isoformat(),
            "ends_at": ends.isoformat(),
        },
    )
    assert r.status_code == 200, r.text


async def _expire_personal(db, tid: int) -> None:
    await db.execute(
        text(
            "update subscriptions set starts_at = now() - interval '40 days', "
            "ends_at = now() - interval '10 days' where tenant_id = :t"
        ),
        {"t": tid},
    )
    await db.commit()


async def _reserve(db, tid: int, pages: int, ref: str):
    r = await metering_service.reserve(db, tid, pages, ref)
    await db.commit()
    return r


# FR-SYS-031 free quota


async def test_registration_grants_free_quota(api, line, mail, db):  # AC-FR-SYS-031-01
    c, _ = await registered_client(api, line, mail, "U")
    body = (await c.get(USAGE)).json()
    assert body["free"] == {"remaining": 100, "expires_at": None, "paused": False}


async def test_free_quota_once(api, line, mail, db):  # AC-FR-SYS-031-02
    c, uid = await registered_client(api, line, mail, "U")
    await login(c, line, "U")
    from app.services import free_quota_service

    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    await free_quota_service.grant_personal(db, personal, datetime.now(UTC))
    await db.commit()
    assert await _free(db, personal) == 100
    count = (
        await db.execute(
            text("select count(*) from free_quotas where tenant_id=:t"), {"t": personal}
        )
    ).scalar_one()
    assert count == 1


async def test_org_free_quota_expires_after_month(api, db, line, mail, monkeypatch):  # 031-03
    owner, _, org, _ = await approved_org(api, db, line, mail)
    body = (await owner.get(USAGE, headers=tenant(org))).json()
    assert body["free"]["remaining"] == 100 and body["free"]["expires_at"] is not None
    later = datetime.now(UTC) + timedelta(days=32)
    monkeypatch.setattr("app.services.metering_service.utcnow", lambda: later)
    body = (await owner.get(USAGE, headers=tenant(org))).json()
    assert body["free"]["remaining"] == 0


async def test_personal_free_paused_when_expired(api, db, line, mail):  # AC-FR-SYS-031-04
    mount_reserve(api)
    c, _ = await registered_client(api, line, mail, "U")
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    await _set_free(db, personal, 30)
    await _expire_personal(db, personal)
    r = await c.post("/api/v1/_test/reserve", params={"pages": 1, "ref": "j1"})
    assert r.status_code == 402 and r.json()["code"] == "plan_expired"
    assert (await c.get(USAGE)).json()["free"] == {
        "remaining": 30,
        "expires_at": None,
        "paused": True,
    }
    admin = await admin_client(api, db)
    r = await admin.put(
        f"/api/v1/admin/tenants/{personal}/subscription",
        json={"plan_code": "kinder", "period": "month"},
    )
    assert r.status_code == 200
    r = await c.post("/api/v1/_test/reserve", params={"pages": 1, "ref": "j2"})
    assert r.status_code == 200 and r.json()["from_free"] == 1
    assert await _free(db, personal) == 29


async def test_guest_has_no_free_quota(api):  # AC-FR-SYS-031-05
    await api.post("/api/v1/auth/guest")
    assert (await api.get(USAGE)).json()["free"]["remaining"] == 0


async def test_setting_change_affects_only_later_grants(api, db, line, mail):  # AC-031-06
    ca, _ = await registered_client(api, line, mail, "A")
    admin = await admin_client(api, db)
    r = await admin.put("/api/v1/admin/settings/free-quota-personal", json={"value": 50})
    assert r.status_code == 200
    cb, _ = await registered_client(api, line, mail, "B")
    assert (await ca.get(USAGE)).json()["free"]["remaining"] == 100
    assert (await cb.get(USAGE)).json()["free"]["remaining"] == 50


# FR-SYS-013 reservation and release


async def test_free_first_then_monthly(api, db, line, mail):  # AC-FR-SYS-013-01
    c, _ = await registered_client(api, line, mail, "U")
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    await _set_free(db, personal, 5)
    r = await _reserve(db, personal, 8, "j1")
    assert (r.from_free, r.from_monthly) == (5, 3)
    body = (await c.get(USAGE)).json()
    assert body["free"]["remaining"] == 0 and body["month"]["used"] == 3


async def test_insufficient_rejects_whole(api, db, line, mail):  # AC-FR-SYS-013-02
    mount_reserve(api)
    owner, _, org, _ = await approved_org(api, db, line, mail)
    await _set_free(db, org, 5)
    r = await owner.post(
        "/api/v1/_test/reserve", params={"pages": 10, "ref": "j"}, headers=tenant(org)
    )
    assert r.status_code == 402 and r.json()["code"] == "quota_exceeded"
    assert r.json()["details"] == {"available": 5}
    assert await _free(db, org) == 5


async def test_no_plan_no_free_is_plan_expired(api, db, line, mail):  # AC-FR-SYS-013-03
    owner, _, org, _ = await approved_org(api, db, line, mail)
    await _set_free(db, org, 0)
    with pytest.raises(AppError) as info:
        await metering_service.reserve(db, org, 1, "j")
    assert info.value.status == 402 and info.value.code == "plan_expired"


async def test_release_returns_once(api, db, line, mail):  # AC-FR-SYS-013-04
    c, _ = await registered_client(api, line, mail, "U")
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    await _set_free(db, personal, 2)
    r = await _reserve(db, personal, 8, "j1")
    assert (r.from_free, r.from_monthly) == (2, 6)
    for _ in range(2):
        await metering_service.release(db, r.id)
        await db.commit()
        body = (await c.get(USAGE)).json()
        assert body["free"]["remaining"] == 2 and body["month"]["used"] == 0


async def test_concurrent_reservations_do_not_overspend(api, db, line, mail):  # 013-05
    mount_reserve(api)
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_free(db, org, 0)
    now = datetime.now(UTC)
    await _set_plan(admin, org, "starter", now - timedelta(days=1), now + timedelta(days=20))
    await admin.patch("/api/v1/admin/plans/starter", json={"monthly_quota": 10})
    results = await asyncio.gather(
        *[
            owner.post(
                "/api/v1/_test/reserve", params={"pages": 8, "ref": f"j{i}"}, headers=tenant(org)
            )
            for i in range(2)
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 402]
    assert (await owner.get(USAGE, headers=tenant(org))).json()["month"]["used"] == 8


async def test_concurrent_free_and_monthly_race(api, db, line, mail):  # Review Focus 1
    mount_reserve(api)
    c, _ = await registered_client(api, line, mail, "U")
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    await _set_free(db, personal, 1)
    await db.execute(text("update plans set monthly_quota = 1 where code = 'kinder'"))
    await db.commit()
    results = await asyncio.gather(
        *[c.post("/api/v1/_test/reserve", params={"pages": 1, "ref": f"j{i}"}) for i in range(3)]
    )
    assert sorted(r.status_code for r in results) == [200, 200, 402]
    body = (await c.get(USAGE)).json()
    assert body["free"]["remaining"] == 0 and body["month"]["used"] == 1


async def test_new_month_resets(api, db, line, mail, monkeypatch):  # AC-FR-SYS-013-06
    _, _, org, admin = await approved_org(api, db, line, mail)
    await _set_free(db, org, 0)
    start = datetime(2027, 1, 1, tzinfo=BANGKOK)
    await _set_plan(admin, org, "starter", start, datetime(2027, 3, 1, tzinfo=BANGKOK))
    jan = datetime(2027, 1, 31, 23, 59, tzinfo=BANGKOK)
    monkeypatch.setattr("app.services.metering_service.utcnow", lambda: jan)
    await _reserve(db, org, 5000, "jan")
    with pytest.raises(AppError):
        await metering_service.reserve(db, org, 1, "jan-more")
    await db.rollback()
    feb = datetime(2027, 2, 1, 0, 1, tzinfo=BANGKOK)
    monkeypatch.setattr("app.services.metering_service.utcnow", lambda: feb)
    r = await _reserve(db, org, 1, "feb")
    assert r.month.month == 2 and r.from_monthly == 1


async def test_release_across_month_returns_to_old_month(api, db, line, mail, monkeypatch):  # 07
    owner, _, org, admin = await approved_org(api, db, line, mail)
    await _set_free(db, org, 0)
    await _set_plan(
        admin,
        org,
        "starter",
        datetime(2027, 1, 1, tzinfo=BANGKOK),
        datetime(2027, 3, 1, tzinfo=BANGKOK),
    )
    monkeypatch.setattr(
        "app.services.metering_service.utcnow",
        lambda: datetime(2027, 1, 31, 23, 59, tzinfo=BANGKOK),
    )
    r = await _reserve(db, org, 6, "jan")
    feb = datetime(2027, 2, 1, 0, 1, tzinfo=BANGKOK)
    monkeypatch.setattr("app.services.metering_service.utcnow", lambda: feb)
    await metering_service.release(db, r.id)
    await db.commit()
    jan_used = (
        await db.execute(
            text(
                "select coalesce(sum(from_monthly), 0) from quota_reservations where tenant_id=:t "
                "and month = date '2027-01-01' and released_at is null"
            ),
            {"t": org},
        )
    ).scalar_one()
    assert jan_used == 0
    assert (await owner.get(USAGE, headers=tenant(org))).json()["month"]["used"] == 0


async def test_yearly_plan_monthly_quota(api, db, line, mail, monkeypatch):  # AC-FR-SYS-013-08
    owner, _, org, admin = await approved_org(api, db, line, mail)
    start = datetime(2027, 1, 15, tzinfo=BANGKOK)
    await _set_plan(admin, org, "starter", start, datetime(2028, 1, 15, tzinfo=BANGKOK), "year")
    for when in [datetime(2027, 1, 20, tzinfo=BANGKOK), datetime(2027, 3, 5, tzinfo=BANGKOK)]:
        monkeypatch.setattr("app.services.metering_service.utcnow", lambda w=when: w)
        body = (await owner.get(USAGE, headers=tenant(org))).json()
        assert body["month"]["quota"] == 5000 and body["active"] is True


async def test_release_after_org_free_expiry_does_not_restore(api, db, line, mail, monkeypatch):
    owner, _, org, _ = await approved_org(api, db, line, mail)  # Review Focus 3
    r = await _reserve(db, org, 4, "j")
    assert r.from_free == 4
    later = datetime.now(UTC) + timedelta(days=32)
    monkeypatch.setattr("app.services.metering_service.utcnow", lambda: later)
    await metering_service.release(db, r.id)
    await db.commit()
    assert await _free(db, org) == 96
    assert (await owner.get(USAGE, headers=tenant(org))).json()["free"]["remaining"] == 0


async def test_same_reference_returns_same_reservation(api, db, line, mail):
    c, _ = await registered_client(api, line, mail, "U")
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    a = await _reserve(db, personal, 3, "job-1")
    b = await _reserve(db, personal, 3, "job-1")
    assert a.id == b.id
    assert (await c.get(USAGE)).json()["free"]["remaining"] == 97


async def test_pages_must_be_positive(api, db, line, mail):
    c, _ = await registered_client(api, line, mail, "U")
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    with pytest.raises(AppError) as info:
        await metering_service.reserve(db, personal, 0, "j")
    assert info.value.status == 400 and info.value.fields == ["pages"]


# FR-SYS-033 usage, FR-SYS-030-02, FR-SYS-034-02


async def test_member_sees_usage(api, db, line, mail):  # AC-FR-SYS-033-01
    _, _, org, admin = await approved_org(api, db, line, mail)
    now = datetime.now(UTC)
    await _set_plan(admin, org, "starter", now - timedelta(days=1), now + timedelta(days=29))
    await _set_free(db, org, 40)
    await _reserve(db, org, 40, "a")  # free first
    await _reserve(db, org, 120, "b")
    await _set_free(db, org, 40)
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, role)
    body = (await cm.get(USAGE, headers=tenant(org))).json()
    assert body["plan"]["code"] == "starter" and body["active"] is True
    assert body["month"] | {} == {**body["month"], "quota": 5000, "used": 120, "remaining": 4880}
    assert body["free"]["remaining"] == 40 and body["free"]["expires_at"] is not None


async def test_non_member_usage_404(api, db, line, mail):  # AC-FR-SYS-033-02
    _, _, org, _ = await approved_org(api, db, line, mail)
    cv, _ = await registered_client(api, line, mail, "V")
    assert (await cv.get(USAGE, headers=tenant(org))).status_code == 404


async def test_quota_change_applies_to_existing_subscription(api, db, line, mail):  # 030-02
    owner, _, org, admin = await approved_org(api, db, line, mail)
    now = datetime.now(UTC)
    await _set_plan(admin, org, "starter", now - timedelta(days=1), now + timedelta(days=29))
    await _set_free(db, org, 0)
    await _reserve(db, org, 4000, "a")
    await admin.patch("/api/v1/admin/plans/starter", json={"monthly_quota": 4500})
    month = (await owner.get(USAGE, headers=tenant(org))).json()["month"]
    assert (month["quota"], month["remaining"]) == (4500, 500)


async def test_admin_sees_reservation_with_split(api, db, line, mail):  # AC-FR-SYS-034-02
    _, _, org, admin = await approved_org(api, db, line, mail)
    now = datetime.now(UTC)
    await _set_plan(admin, org, "starter", now - timedelta(days=1), now + timedelta(days=29))
    await _set_free(db, org, 3)
    r = await _reserve(db, org, 8, "job-42")
    await metering_service.release(db, r.id)
    await db.commit()
    [row] = (await admin.get(f"/api/v1/admin/tenants/{org}/reservations")).json()
    assert (row["reference"], row["pages"], row["from_free"], row["from_monthly"]) == (
        "job-42",
        8,
        3,
        5,
    )
    assert row["reserved_at"] and row["released_at"]


async def test_free_quota_grant_audited(api, db, line, mail):
    await registered_client(api, line, mail, "U")
    await approved_org(api, db, line, mail, sub="OWNER")
    grants = (
        await db.execute(text("select count(*) from audit_log where action = 'free_quota.grant'"))
    ).scalar_one()
    assert grants >= 3  # U, OWNER (registration) and the organization
