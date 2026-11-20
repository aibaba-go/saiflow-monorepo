"""rebuild-plans-metering final review fixes."""

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from app.errors import AppError
from app.services import membership_service, metering_service
from app.services.session_service import Principal
from app.services.tenant_access import resolve_tenant
from tests.integration.tenancy_helpers import approved_org, registered_client, tenant

pytestmark = pytest.mark.integration
API_DIR = Path(__file__).resolve().parents[2]
BIG = 3_000_000_000  # beyond int4


async def test_huge_tenant_id_is_404_not_500(api, db, line, mail):  # Important 1
    _, _, _, admin = await approved_org(api, db, line, mail)
    r = await admin.put(
        f"/api/v1/admin/tenants/{BIG}/subscription",
        json={"plan_code": "starter", "period": "month"},
    )
    assert r.status_code == 404
    with pytest.raises(AppError) as info:
        await metering_service.reserve(db, BIG, 1, "j")
    assert info.value.status == 404


async def test_int4_bounds_on_plan_and_settings(api, db, line, mail):  # Important 2
    _, _, _, admin = await approved_org(api, db, line, mail)
    for method, path, body, field in [
        ("PATCH", "/api/v1/admin/plans/starter", {"monthly_quota": BIG}, "monthly_quota"),
        ("PATCH", "/api/v1/admin/plans/starter", {"member_limit": BIG}, "member_limit"),
        ("PUT", "/api/v1/admin/settings/free-quota-personal", {"value": BIG}, "value"),
        ("PUT", "/api/v1/admin/settings/free-quota-organization", {"value": BIG}, "value"),
        ("PUT", "/api/v1/admin/settings/org-member-limit-unpaid", {"value": BIG}, "value"),
    ]:
        r = await admin.request(method, path, json=body)
        assert r.status_code == 400 and r.json()["fields"] == [field], (path, body)
    _, uid = await registered_client(api, line, mail, "STILL")  # registration still works
    assert uid


async def test_two_same_plan_renewals_chain(api, db, line, mail):  # Important 3
    _, _, org, admin = await approved_org(api, db, line, mail)
    now = datetime.now(UTC)
    end = now + timedelta(days=10)
    await admin.put(
        f"/api/v1/admin/tenants/{org}/subscription",
        json={
            "plan_code": "starter",
            "period": "month",
            "starts_at": (now - timedelta(days=20)).isoformat(),
            "ends_at": end.isoformat(),
        },
    )
    first = (
        await admin.put(
            f"/api/v1/admin/tenants/{org}/subscription",
            json={"plan_code": "starter", "period": "month"},
        )
    ).json()
    second = (
        await admin.put(
            f"/api/v1/admin/tenants/{org}/subscription",
            json={"plan_code": "starter", "period": "month"},
        )
    ).json()
    assert datetime.fromisoformat(second["starts_at"]) == datetime.fromisoformat(first["ends_at"])
    assert datetime.fromisoformat(first["starts_at"]) == end


def test_downgrade_0005_refuses_with_billing_data(db_settings_session):  # Important 4
    import asyncio

    from app.db import create_engine

    async def run(sql: str):
        engine = create_engine(db_settings_session)
        async with engine.begin() as conn:
            result = (await conn.execute(text(sql))).all() if sql.startswith("select") else None
            if result is None:
                await conn.execute(text(sql))
        await engine.dispose()
        return result

    asyncio.run(run("insert into tenants (kind) values ('organization')"))
    asyncio.run(
        run(
            "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, source) "
            "select max(id), 'starter', 'month', now(), now() + interval '1 day', 'admin' "
            "from tenants"
        )
    )
    env = {
        **os.environ,
        "DB_HOST": db_settings_session.db_host,
        "DB_PORT": str(db_settings_session.db_port),
        "DB_NAME": db_settings_session.db_name,
        "DB_USER": db_settings_session.db_user,
        "DB_PASSWORD": db_settings_session.db_password.get_secret_value(),
    }
    r = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0004"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    try:
        assert r.returncode != 0 and "billing data" in r.stderr
        assert asyncio.run(run("select count(*) from subscriptions"))[0][0] >= 1
    finally:
        asyncio.run(run("delete from subscriptions"))
        asyncio.run(run("delete from tenants where kind = 'organization'"))


async def test_reused_reference_with_other_pages_or_released_is_409(api, db, line, mail):
    c, _ = await registered_client(api, line, mail, "U")  # review Minor 1, re-graded
    personal = (await c.get("/api/v1/me")).json()["tenant_id"]
    r = await metering_service.reserve(db, personal, 3, "job-1")
    await db.commit()
    rid = r.id
    with pytest.raises(AppError) as info:
        await metering_service.reserve(db, personal, 8, "job-1")
    assert info.value.status == 409 and info.value.code == "reservation_conflict"
    await db.rollback()
    await metering_service.release(db, personal, rid)
    await db.commit()
    with pytest.raises(AppError) as info:
        await metering_service.reserve(db, personal, 3, "job-1")
    assert info.value.status == 409
    await db.rollback()


async def test_refresh_sees_lost_ownership(api, db, line, mail):  # review Minor 3, re-graded
    owner, owner_id, org, _ = await approved_org(api, db, line, mail)
    _, m = await registered_client(api, line, mail, "M")
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    await db.execute(
        text("insert into memberships (tenant_id, user_id, role_id) values (:t, :u, :r)"),
        {"t": org, "u": m, "r": role},
    )
    await db.commit()
    personal = (
        await db.execute(
            text("select id from tenants where kind='personal' and owner_user_id=:u"),
            {"u": owner_id},
        )
    ).scalar_one()
    stale = await resolve_tenant(db, Principal("user", 0, personal, owner_id), org)
    assert stale.is_owner
    await owner.post(f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": m})
    await owner.get("/api/v1/me")  # unrelated request; the session object stays cached
    with pytest.raises(AppError) as info:
        await membership_service.create_invitation(db, stale)
    assert info.value.status == 403
    await db.rollback()
    _ = tenant
