"""rebuild-tenant-rbac Task 8: enterprise verification (FR-SYS-027)."""

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import add_member, approved_org, registered_client

pytestmark = pytest.mark.integration

DATA = {
    "legal_name": "Siam Tools Co., Ltd.",
    "tax_id": "0105561234567",
    "registered_address": "99 Sukhumvit, Bangkok 10110",
}
ADMIN_VER = "/api/v1/admin/verification-applications"


def ver_url(org: int) -> str:
    return f"/api/v1/organizations/{org}/verification"


async def _pending_id(admin) -> int:
    return (await admin.get(ADMIN_VER, params={"status": "pending"})).json()[0]["id"]


async def test_submit_and_approve(api, db, line, mail):  # AC-FR-SYS-027-01
    owner, _, org, admin = await approved_org(api, db, line, mail)
    assert (await owner.get(ver_url(org))).json()["status"] == "none"
    assert (await owner.post(ver_url(org), json=DATA)).status_code == 201
    assert (await owner.get(ver_url(org))).json()["status"] == "pending"
    assert (await admin.post(f"{ADMIN_VER}/{await _pending_id(admin)}/approve")).status_code == 200
    body = (await owner.get(ver_url(org))).json()
    assert body["status"] == "verified"
    assert (body["legal_name"], body["tax_id"], body["registered_address"]) == tuple(DATA.values())
    org_row = (await owner.get(f"/api/v1/organizations/{org}")).json()
    assert org_row["verification_status"] == "verified"


async def test_verification_validation(api, db, line, mail):  # AC-FR-SYS-027-02
    owner, _, org, _ = await approved_org(api, db, line, mail)
    for body, field in [
        ({**DATA, "legal_name": ""}, "legal_name"),
        ({**DATA, "tax_id": "123"}, "tax_id"),
        ({**DATA, "tax_id": "01055612345ab"}, "tax_id"),
        ({**DATA, "tax_id": "０１０５５６１２３４５６７"}, "tax_id"),
        ({**DATA, "registered_address": " "}, "registered_address"),
    ]:
        r = await owner.post(ver_url(org), json=body)
        assert r.status_code == 400 and field in r.json()["fields"], body
    assert (await owner.get(ver_url(org))).json()["status"] == "none"


async def test_reject_and_resubmit(api, db, line, mail):  # AC-FR-SYS-027-03
    owner, _, org, admin = await approved_org(api, db, line, mail)
    cm, m = await registered_client(api, line, mail, "M")
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    await add_member(db, org, m, role)
    await owner.post(ver_url(org), json=DATA)
    r = await admin.post(
        f"{ADMIN_VER}/{await _pending_id(admin)}/reject", json={"reason": "Blurry"}
    )
    assert r.status_code == 200
    seen = (await cm.get(ver_url(org))).json()
    assert seen["status"] == "rejected" and seen["reject_reason"] == "Blurry"
    assert (await owner.post(ver_url(org), json=DATA)).status_code == 201
    assert (await owner.get(ver_url(org))).json()["status"] == "pending"


async def test_second_pending_409(api, db, line, mail):  # AC-FR-SYS-027-04
    owner, _, org, _ = await approved_org(api, db, line, mail)
    await owner.post(ver_url(org), json=DATA)
    r = await owner.post(ver_url(org), json=DATA)
    assert r.status_code == 409 and r.json()["code"] == "application_pending"


async def test_admin_direct_set_and_unset(api, db, line, mail):  # AC-FR-SYS-027-05
    owner, _, org, admin = await approved_org(api, db, line, mail)
    url = f"/api/v1/admin/organizations/{org}/verification"
    assert (await admin.put(url, json={"verified": True})).status_code == 200
    assert (await owner.get(ver_url(org))).json()["status"] == "verified"
    assert (await admin.put(url, json={"verified": False})).status_code == 200
    assert (await owner.get(ver_url(org))).json()["status"] == "none"


async def test_without_permission_403(api, db, line, mail):  # AC-FR-SYS-027-06
    _, _, org, _ = await approved_org(api, db, line, mail)
    cm, m = await registered_client(api, line, mail, "M")
    role = (
        await db.execute(text("select id from roles where tenant_id=:t and is_default"), {"t": org})
    ).scalar_one()
    await add_member(db, org, m, role)
    assert (await cm.post(ver_url(org), json=DATA)).status_code == 403
    assert (await cm.get(ver_url(org))).json()["status"] == "none"


async def test_member_with_verification_apply_can_submit(api, db, line, mail):
    owner, _, org, _ = await approved_org(api, db, line, mail)
    rid = (
        await owner.post(
            f"/api/v1/organizations/{org}/roles",
            json={"name": "Clerk", "permissions": ["verification_apply"]},
        )
    ).json()["id"]
    cm, m = await registered_client(api, line, mail, "M")
    await add_member(db, org, m, rid)
    assert (await cm.post(ver_url(org), json=DATA)).status_code == 201
