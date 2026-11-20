from datetime import timedelta

import pytest
from sqlalchemy import text

from app.clock import utcnow
from app.services import claim_service

pytestmark = pytest.mark.integration


async def _add_items(db, tenant_id: int, *labels: str) -> None:
    for label in labels:
        await db.execute(
            text("insert into test_tenant_items (tenant_id, label) values (:t, :l)"),
            {"t": tenant_id, "l": label},
        )
    await db.commit()


async def _labels(db, tenant_id: int) -> list[str]:
    rows = await db.execute(
        text("select label from test_tenant_items where tenant_id = :t order by label"),
        {"t": tenant_id},
    )
    return list(rows.scalars())


async def _guest(api, db, *labels: str) -> tuple[int, str]:
    guest = (await api.post("/api/v1/auth/guest")).json()
    await _add_items(db, guest["tenant_id"], *labels)
    return guest["tenant_id"], api.cookies.get("saiflow_session")


async def test_claim_into_new_user(api, db, line):  # AC-FR-SYS-010-03
    guest_tenant, guest_cookie = await _guest(api, db, "a", "b")
    line.add("tok", "U-new")
    body = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()
    assert await _labels(db, body["tenant_id"]) == ["a", "b"]
    assert await _labels(db, guest_tenant) == []
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
    assert actions == ["guest.create", "guest.claim", "customer.login"]
    api.cookies.clear()
    api.cookies.set("saiflow_session", guest_cookie, domain="test")
    assert (await api.get("/api/v1/me")).status_code == 401


async def test_claim_into_registered_user(api, db, line):  # AC-FR-SYS-010-04
    line.add("tok", "U-old")
    user = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()
    await _add_items(db, user["tenant_id"], "mine")
    api.cookies.clear()
    await _guest(api, db, "g1", "g2")
    again = (await api.post("/api/v1/auth/line", json={"id_token": "tok"})).json()
    assert again["user_id"] == user["user_id"] and again["tenant_id"] == user["tenant_id"]
    assert await _labels(db, user["tenant_id"]) == ["g1", "g2", "mine"]


async def test_claim_failure_rolls_back(api, db, line, monkeypatch):  # AC-FR-SYS-010-05
    guest_tenant, _ = await _guest(api, db, "a", "b")
    real = claim_service.claim_guest_tenant

    async def failing(session, guest_tenant_id, personal_tenant_id):
        await real(session, guest_tenant_id, personal_tenant_id)
        raise RuntimeError("claim broke half way")

    monkeypatch.setattr(claim_service, "claim_guest_tenant", failing)
    line.add("tok", "U-new")
    r = await api.post("/api/v1/auth/line", json={"id_token": "tok"})
    assert r.status_code == 500
    assert await _labels(db, guest_tenant) == ["a", "b"]
    status = (
        await db.execute(text("select status from tenants where id = :t"), {"t": guest_tenant})
    ).scalar_one()
    assert status == "active"
    me = await api.get("/api/v1/me")
    assert me.status_code == 200 and me.json()["kind"] == "guest"


async def test_login_with_expired_guest_cookie_skips_claim(api, db, line):  # Review Focus 3
    guest_tenant, _ = await _guest(api, db, "a")
    await db.execute(
        text("update customer_sessions set last_used_at = :t"), {"t": utcnow() - timedelta(days=31)}
    )
    await db.commit()
    line.add("tok", "U-new")
    r = await api.post("/api/v1/auth/line", json={"id_token": "tok"})
    assert r.status_code == 200
    assert await _labels(db, guest_tenant) == ["a"]
