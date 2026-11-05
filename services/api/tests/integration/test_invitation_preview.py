"""line-mini-account Task 7: look at an invitation before accepting it (FR-SYS-024 modified)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import approved_org, client_like, registered_client

pytestmark = pytest.mark.integration

PREVIEW = "/api/v1/invitations/preview"


async def _invite(owner, org: int) -> str:
    r = await owner.post(f"/api/v1/organizations/{org}/invitations")
    assert r.status_code == 201
    return r.json()["token"]


async def _counts(db) -> tuple[int, int]:
    audit = (await db.execute(text("select count(*) from audit_log"))).scalar_one()
    members = (await db.execute(text("select count(*) from memberships"))).scalar_one()
    return audit, members


async def test_preview_valid_for_guest(api, db, line, mail):  # AC-FR-SYS-024-08
    owner, _, org, _ = await approved_org(api, db, line, mail)
    token = await _invite(owner, org)
    guest = client_like(api)
    assert (await guest.post("/api/v1/auth/guest")).status_code == 200
    before = await _counts(db)
    r = await guest.get(PREVIEW, params={"token": token})
    assert r.status_code == 200, r.text
    assert r.json()["organization_name"] == "Siam Tools"
    assert "expires_at" in r.json() and set(r.json()) == {"organization_name", "expires_at"}
    assert await _counts(db) == before
    user, _ = await registered_client(api, line, mail, "JOINER")
    r = await user.post("/api/v1/invitations/accept", json={"token": token})
    assert r.status_code == 200  # still valid after the preview


async def test_preview_gone(api, db, line, mail):  # AC-FR-SYS-024-09
    owner, _, org, admin = await approved_org(api, db, line, mail)
    r = await admin.put(  # unlimited seats, so every case below can get an invitation
        f"/api/v1/admin/tenants/{org}/subscription",
        json={"plan_code": "advance", "period": "month"},
    )
    assert r.status_code == 200
    accepted = await _invite(owner, org)
    user, _ = await registered_client(api, line, mail, "JOINER")
    assert (
        await user.post("/api/v1/invitations/accept", json={"token": accepted})
    ).status_code == 200
    revoked = await _invite(owner, org)
    inv_id = (await owner.get(f"/api/v1/organizations/{org}/invitations")).json()[0]["id"]
    assert (
        await owner.delete(f"/api/v1/organizations/{org}/invitations/{inv_id}")
    ).status_code == 204
    expired = await _invite(owner, org)
    await db.execute(
        text(
            "update invitations set expires_at = now() - interval '1 day' where revoked_at is null "
            "and accepted_at is null"
        ),
    )
    await db.commit()
    for token in [accepted, revoked, expired, "no-such-token", "", "x" * 129]:
        r = await user.get(PREVIEW, params={"token": token})
        assert r.status_code == 410, (token[:10], r.text)
        assert "Siam Tools" not in r.text


async def test_preview_missing_token_is_gone(api, db, line, mail):
    user, _ = await registered_client(api, line, mail, "U")
    assert (await user.get(PREVIEW)).status_code == 410


async def test_preview_requires_session(api):
    assert (await client_like(api).get(PREVIEW, params={"token": "x"})).status_code == 401
