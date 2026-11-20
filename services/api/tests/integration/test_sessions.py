from datetime import timedelta
from typing import Annotated

import pytest
from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.dependencies import get_db, get_principal
from app.services.session_service import Principal
from app.services.tenant_access import resolve_tenant

pytestmark = pytest.mark.integration


async def _count(db, table: str) -> int:
    return (await db.execute(text(f"select count(*) from {table}"))).scalar_one()


async def test_create_guest_session(api, db):  # AC-FR-SYS-010-01
    r = await api.post("/api/v1/auth/guest")
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "guest" and body["user_id"] is None and body["registered"] is False
    assert await _count(db, "tenants where kind = 'guest'") == 1
    assert await _count(db, "customer_sessions where kind = 'guest'") == 1
    me = await api.get("/api/v1/me")
    assert me.status_code == 200 and me.json()["tenant_id"] == body["tenant_id"]


async def test_guest_session_is_reused(api, db):
    first = (await api.post("/api/v1/auth/guest")).json()
    second = (await api.post("/api/v1/auth/guest")).json()
    assert first["tenant_id"] == second["tenant_id"]
    assert await _count(db, "customer_sessions") == 1


async def test_guest_cannot_read_other_guest_tenant(api):  # AC-FR-SYS-010-02
    async def read_tenant(
        tenant_id: int,
        principal: Annotated[Principal, Depends(get_principal)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> dict:
        await resolve_tenant(db, principal, tenant_id)
        return {"tenant_id": tenant_id, "secret": "tenant-data"}

    api.app.add_api_route("/api/v1/_test/tenants/{tenant_id}", read_tenant, methods=["GET"])
    a = (await api.post("/api/v1/auth/guest")).json()
    own = await api.get(f"/api/v1/_test/tenants/{a['tenant_id']}")
    assert own.status_code == 200
    api.cookies.clear()
    await api.post("/api/v1/auth/guest")  # guest B
    other = await api.get(f"/api/v1/_test/tenants/{a['tenant_id']}")
    assert other.status_code == 404 and "tenant-data" not in other.text


async def _set_last_used(db, delta: timedelta) -> None:
    await db.execute(
        text("update customer_sessions set last_used_at = :t"), {"t": utcnow() - delta}
    )
    await db.commit()


async def test_session_expires_after_30_idle_days(api, db):  # AC-FR-SYS-001-06
    await api.post("/api/v1/auth/guest")
    await _set_last_used(db, timedelta(days=30, seconds=1))
    r = await api.get("/api/v1/me")
    assert r.status_code == 401 and r.json()["code"] == "unauthenticated"


async def test_session_use_extends_lifetime(api, db):  # AC-FR-SYS-001-07
    await api.post("/api/v1/auth/guest")
    await _set_last_used(db, timedelta(days=29))
    assert (await api.get("/api/v1/me")).status_code == 200
    last = (await db.execute(text("select last_used_at from customer_sessions"))).scalar_one()
    assert utcnow() - last < timedelta(minutes=1)


async def test_logout_revokes_session(api, db):  # AC-FR-SYS-001-08
    await api.post("/api/v1/auth/guest")
    cookie = api.cookies.get("saiflow_session")
    r = await api.post("/api/v1/auth/logout")
    assert r.status_code == 204
    api.cookies.set("saiflow_session", cookie, domain="test")
    assert (await api.get("/api/v1/me")).status_code == 401
    actions = (
        (
            await db.execute(
                text(
                    "select action from audit_log "
                    "where action not like 'subscription.%' order by id"
                )
            )
        )
        .scalars()
        .all()
    )
    assert actions == ["guest.create", "customer.logout"]


async def test_me_without_session_is_401(api):
    assert (await api.get("/api/v1/me")).status_code == 401
