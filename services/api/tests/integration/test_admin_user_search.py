"""web-admin-console Task 2: admins search customer users (FR-SYS-080)."""

import pytest
from sqlalchemy import text

from app.services import admin_query_service
from tests.integration.tenancy_helpers import admin_client, client_like, registered_client

pytestmark = pytest.mark.integration

URL = "/api/v1/admin/users"


async def test_search_by_email_and_name(api, db, line, mail):  # AC-FR-SYS-080-01
    await registered_client(api, line, mail, "SOMCHAI")
    _, malee = await registered_client(api, line, mail, "MALEE")
    # the registration helper names everyone "Somchai"; make the second user distinct
    await db.execute(text("update users set display_name = 'Malee' where id = :u"), {"u": malee})
    await db.commit()
    guest = client_like(api)
    await guest.post("/api/v1/auth/guest")
    admin = await admin_client(api, db)
    r = await admin.get(URL, params={"q": "SOMCHAI"})
    assert r.status_code == 200, r.text
    [hit] = r.json()["items"]
    assert hit["email"] == "somchai@example.com" and hit["registered"] is True
    assert hit["line_linked"] is True
    assert set(hit) == {
        "user_id",
        "display_name",
        "email",
        "phone",
        "registered",
        "line_linked",
        "registered_at",
        "created_at",
        "personal_tenant_id",
    }
    personal = (
        await db.execute(
            text("select id from tenants where kind = 'personal' and owner_user_id = :u"),
            {"u": hit["user_id"]},
        )
    ).scalar_one()
    assert hit["personal_tenant_id"] == personal
    both = (await admin.get(URL, params={"q": "example.com"})).json()
    assert len(both["items"]) == 2 and both["has_more"] is False


async def test_search_by_id(api, db, line, mail):  # AC-FR-SYS-080-02
    _, uid = await registered_client(api, line, mail, "U")
    admin = await admin_client(api, db)
    items = (await admin.get(URL, params={"q": str(uid)})).json()["items"]
    assert [i["user_id"] for i in items] == [uid]


async def test_search_too_short_and_wildcards(api, db, line, mail):  # AC-FR-SYS-080-03
    await registered_client(api, line, mail, "U")
    admin = await admin_client(api, db)
    r = await admin.get(URL, params={"q": "s"})
    assert r.status_code == 400 and r.json()["fields"] == ["q"]
    assert (await admin.get(URL, params={"q": "%%"})).json()["items"] == []
    assert (await admin.get(URL, params={"q": "__"})).json()["items"] == []
    assert (await admin.get(URL, params={"q": "ab", "page": "0"})).status_code == 400


async def test_search_paging(api, db, line, mail):
    for i in range(3):
        await registered_client(api, line, mail, f"PAGE{i}")
    admin = await admin_client(api, db)
    r = (await admin.get(URL, params={"q": "page"})).json()
    assert len(r["items"]) == 3 and r["has_more"] is False


async def test_list_all_without_query(api, db, line, mail, monkeypatch):  # AC-FR-SYS-080-04
    monkeypatch.setattr(admin_query_service, "USERS_PER_PAGE", 2)
    ids = [(await registered_client(api, line, mail, f"ALL{i}"))[1] for i in range(3)]
    guest = client_like(api)
    await guest.post("/api/v1/auth/guest")
    admin = await admin_client(api, db)
    audits = (await db.execute(text("select count(*) from audit_log"))).scalar_one()
    first = (await admin.get(URL)).json()
    blank = (await admin.get(URL, params={"q": "   ", "page": "1"})).json()
    second = (await admin.get(URL, params={"page": "2"})).json()
    assert first == blank
    assert first["has_more"] is True and second["has_more"] is False
    seen = [i["user_id"] for i in first["items"] + second["items"]]
    assert seen == sorted(ids, reverse=True)  # newest first, no repeats, no guests
    assert (await db.execute(text("select count(*) from audit_log"))).scalar_one() == audits


async def test_search_admin_only(api):
    assert (await client_like(api).get(URL, params={"q": "ab"})).status_code == 401
    assert (await client_like(api).get(URL)).status_code == 401
