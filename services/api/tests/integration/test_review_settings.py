"""Review settings: levels per template and the email switch, owner only (FR-VERIFY-010,
FR-SYS-126; review-flow Task 2)."""

from sqlalchemy import text

from app.services import review_settings_service
from tests.integration.db_fixtures import login
from tests.integration.tenancy_helpers import add_member, client_like, make_org, make_role, tenant

URL = "/api/v1/review-settings"


async def _tax_template(db) -> int:
    return (
        await db.execute(text("select id from document_templates where code = 'tax_invoice'"))
    ).scalar_one()


async def _org(api, line, db):
    owner = client_like(api)
    me = await login(owner, line, "OWNER")
    org, _ = await make_org(db, me["user_id"])
    return owner, me["user_id"], org


async def test_owner_sets_level_and_lists(api, line, db):
    owner, _, org = await _org(api, line, db)
    tax = await _tax_template(db)
    r = await owner.put(f"{URL}/levels", json={"template_id": tax, "level": 2}, headers=tenant(org))
    assert r.status_code == 200, r.text
    assert r.json() == {"template_id": tax, "name": r.json()["name"], "level": 2}
    body = (await owner.get(URL, headers=tenant(org))).json()
    assert body["email_enabled"] is False
    levels = {i["template_id"]: i["level"] for i in body["items"]}
    assert levels[tax] == 2 and levels[None] == 0
    assert body["items"][-1]["template_id"] is None  # 通用结果 last
    assert all(i["name"] for i in body["items"] if i["template_id"] is not None)


async def test_owner_sets_email_switch(api, line, db):
    owner, _, org = await _org(api, line, db)
    r = await owner.put(f"{URL}/email", json={"enabled": True}, headers=tenant(org))
    assert r.status_code == 200 and r.json()["email_enabled"] is True
    r = await owner.put(f"{URL}/email", json={"enabled": "yes"}, headers=tenant(org))
    assert r.status_code == 422


async def test_non_owner_403(api, line, db):  # AC-FR-VERIFY-010-02
    owner, _, org = await _org(api, line, db)
    tax = await _tax_template(db)
    role = await make_role(db, org, "Reviewer", ["review_l1"])
    member = await login(api, line, "M1")
    await add_member(db, org, member["user_id"], role)
    r = await api.put(f"{URL}/levels", json={"template_id": tax, "level": 2}, headers=tenant(org))
    assert (r.status_code, r.json()["code"]) == (403, "permission_denied")
    assert (await api.get(URL, headers=tenant(org))).status_code == 403
    assert (
        await api.put(f"{URL}/email", json={"enabled": True}, headers=tenant(org))
    ).status_code == 403
    count = (await db.execute(text("select count(*) from review_levels"))).scalar_one()
    assert count == 0


async def test_level_out_of_range_422(api, line, db):
    owner, _, org = await _org(api, line, db)
    tax = await _tax_template(db)
    for bad in (3, -1, True, "1", None):
        r = await owner.put(
            f"{URL}/levels", json={"template_id": tax, "level": bad}, headers=tenant(org)
        )
        assert r.status_code == 422, (bad, r.text)


async def test_personal_tenant_403(api, line):
    await login(api, line, "SOLO")
    assert (await api.get(URL)).status_code == 403
    assert (
        await api.put(f"{URL}/levels", json={"template_id": None, "level": 1})
    ).status_code == 403


async def test_unknown_template_404(api, line, db):
    owner, _, org = await _org(api, line, db)
    r = await owner.put(
        f"{URL}/levels", json={"template_id": 999999, "level": 1}, headers=tenant(org)
    )
    assert r.status_code == 404


async def test_audit_written_once(api, line, db):
    owner, _, org = await _org(api, line, db)
    tax = await _tax_template(db)
    for _ in range(2):
        r = await owner.put(
            f"{URL}/levels", json={"template_id": tax, "level": 2}, headers=tenant(org)
        )
        assert r.status_code == 200
    rows = (
        (
            await db.execute(
                text("select target_id from audit_log where action = 'review.level_set'")
            )
        )
        .scalars()
        .all()
    )
    assert rows == [f"{org}/{tax}/0->2"]
    await owner.put(f"{URL}/email", json={"enabled": True}, headers=tenant(org))
    rows = (
        (
            await db.execute(
                text("select target_id from audit_log where action = 'review.email_set'")
            )
        )
        .scalars()
        .all()
    )
    assert rows == [f"{org}/false->true"]


async def test_level_for_defaults(api, line, db):
    owner, _, org = await _org(api, line, db)
    tax = await _tax_template(db)
    assert await review_settings_service.level_for(db, org, "organization", tax) == 0
    await owner.put(f"{URL}/levels", json={"template_id": None, "level": 1}, headers=tenant(org))
    await owner.put(f"{URL}/levels", json={"template_id": tax, "level": 2}, headers=tenant(org))
    db.expire_all()
    assert await review_settings_service.level_for(db, org, "organization", None) == 1
    assert await review_settings_service.level_for(db, org, "organization", tax) == 2
    assert await review_settings_service.level_for(db, org, "personal", tax) == 0
    assert await review_settings_service.level_for(db, org, "guest", None) == 0
