"""line-mini-account Task 6: the organization view shows the member limit and the seats in use
(FR-SYS-048 needs "2 / 2" and a disabled invite at the limit; FR-SYS-025 counts open invites)."""

import pytest

from tests.integration.tenancy_helpers import approved_org

pytestmark = pytest.mark.integration


async def test_organization_view_has_limit_and_seats(api, db, line, mail):
    owner, _, org, admin = await approved_org(api, db, line, mail)
    body = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert (body["member_limit"], body["seats_used"]) == (2, 1)
    assert (await owner.post(f"/api/v1/organizations/{org}/invitations")).status_code == 201
    body = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert (body["member_limit"], body["seats_used"]) == (2, 2)
    r = await admin.put(
        f"/api/v1/admin/tenants/{org}/subscription",
        json={"plan_code": "advance", "period": "month"},
    )
    assert r.status_code == 200
    body = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert body["member_limit"] is None  # Advance: unlimited


async def test_patch_returns_limit_and_seats(api, db, line, mail):
    owner, _, org, _ = await approved_org(api, db, line, mail)
    r = await owner.patch(f"/api/v1/organizations/{org}", json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed" and r.json()["seats_used"] == 1
