"""FR-SYS-036 notification center."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from tests.integration.tenancy_helpers import client_like

pytestmark = pytest.mark.integration

LIST = "/api/v1/me/notifications"
READ = "/api/v1/me/notifications/read"


async def _user(api, line, mail, sub: str):
    from tests.integration.tenancy_helpers import registered_client

    c, uid = await registered_client(api, line, mail, sub)
    tid = (await c.get("/api/v1/me")).json()["tenant_id"]
    return c, uid, tid


async def _add(db, uid: int, tid: int, n: int = 1, read: bool = False) -> list[int]:
    ids = []
    for i in range(n):
        ids.append(
            (
                await db.execute(
                    text(
                        "insert into notifications (user_id, tenant_id, type, data, read_at) "
                        "values (:u, :t, 'usage', cast(:d as jsonb), :r) returning id"
                    ),
                    {
                        "u": uid,
                        "t": tid,
                        "d": f'{{"stage": "low", "i": {i}}}',
                        "r": datetime.now(UTC) if read else None,
                    },
                )
            ).scalar_one()
        )
    await db.commit()
    return ids


async def test_list_and_unread_count(api, db, line, mail):  # AC-FR-SYS-036-01
    c, uid, tid = await _user(api, line, mail, "U")
    [read_id] = await _add(db, uid, tid, read=True)
    a, b = await _add(db, uid, tid, 2)
    body = (await c.get(LIST)).json()
    assert body["unread_count"] == 2 and body["next_before"] is None
    assert [i["id"] for i in body["items"]] == [b, a, read_id]
    first = body["items"][0]
    assert set(first) == {"id", "type", "tenant_id", "data", "created_at", "read"}
    assert first["type"] == "usage" and first["tenant_id"] == tid and first["read"] is False
    assert first["data"] == {"stage": "low", "i": 1}
    assert body["items"][2]["read"] is True


async def test_paging_no_overlap(api, db, line, mail):  # AC-FR-SYS-036-02
    c, uid, tid = await _user(api, line, mail, "U")
    ids = await _add(db, uid, tid, 25)
    page1 = (await c.get(LIST)).json()
    assert len(page1["items"]) == 20 and page1["next_before"] == page1["items"][-1]["id"]
    page2 = (await c.get(LIST, params={"before": page1["next_before"]})).json()
    assert len(page2["items"]) == 5 and page2["next_before"] is None
    got = [i["id"] for i in page1["items"] + page2["items"]]
    assert got == sorted(ids, reverse=True)
    small = (await c.get(LIST, params={"limit": 100})).json()
    assert len(small["items"]) == 25


async def test_mark_some_idempotent(api, db, line, mail):  # AC-FR-SYS-036-03
    c, uid, tid = await _user(api, line, mail, "U")
    n1, _ = await _add(db, uid, tid, 2)
    assert (await c.post(READ, json={"ids": [n1]})).json() == {"updated": 1, "unread_count": 1}
    assert (await c.post(READ, json={"ids": [n1]})).json() == {"updated": 0, "unread_count": 1}


async def test_mark_all(api, db, line, mail):  # AC-FR-SYS-036-04
    c, uid, tid = await _user(api, line, mail, "U")
    await _add(db, uid, tid, 3)
    assert (await c.post(READ, json={})).json() == {"updated": 3, "unread_count": 0}
    await _add(db, uid, tid, 2)
    assert (await c.post(READ, json={"ids": None})).json() == {"updated": 2, "unread_count": 0}
    await _add(db, uid, tid, 1)
    assert (await c.post(READ)).json() == {"updated": 1, "unread_count": 0}  # no body


async def test_empty_list_marks_nothing(api, db, line, mail):
    c, uid, tid = await _user(api, line, mail, "U")
    await _add(db, uid, tid, 2)
    assert (await c.post(READ, json={"ids": []})).json() == {"updated": 0, "unread_count": 2}


async def test_only_own_notifications(api, db, line, mail):  # AC-FR-SYS-036-05
    cu, u, tu = await _user(api, line, mail, "U")
    cv, v, tv = await _user(api, line, mail, "V")
    [n1] = await _add(db, u, tu)
    [n2] = await _add(db, v, tv)
    r = await cu.post(READ, json={"ids": [n1, n2, 999999]})
    assert r.json() == {"updated": 1, "unread_count": 0}
    assert (await cv.get(LIST)).json()["unread_count"] == 1
    assert [i["id"] for i in (await cu.get(LIST)).json()["items"]] == [n1]


@pytest.mark.parametrize(
    "body", [{"ids": [True]}, {"ids": "1"}, {"ids": [2**63]}, {"ids": ["1"]}, {"ids": 1}]
)
async def test_mark_read_validation(api, db, line, mail, body):  # AC-FR-SYS-036-06
    c, uid, tid = await _user(api, line, mail, "U")
    await _add(db, uid, tid)
    r = await c.post(READ, json=body)
    assert r.status_code == 400 and r.json()["fields"] == ["ids"], r.text
    assert (await c.get(LIST)).json()["unread_count"] == 1


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"limit": 0}, "limit"),
        ({"limit": 101}, "limit"),
        ({"limit": "x"}, "limit"),
        ({"before": "abc"}, "before"),
        ({"before": 0}, "before"),
        ({"before": 2**63}, "before"),
    ],
)
async def test_list_query_validation(api, db, line, mail, params, field):
    c, _, _ = await _user(api, line, mail, "U")
    r = await c.get(LIST, params=params)
    assert r.status_code == 400 and r.json()["fields"] == [field], r.text


async def test_read_kept_no_delete(api, db, line, mail):  # AC-FR-SYS-036-07
    c, uid, tid = await _user(api, line, mail, "U")
    [n] = await _add(db, uid, tid)
    await c.post(READ, json={"ids": [n]})
    assert (await c.delete(f"{LIST}/{n}")).status_code in (404, 405)
    [item] = (await c.get(LIST)).json()["items"]
    assert item["id"] == n and item["read"] is True


async def test_guest_and_anonymous_401(api):  # AC-FR-SYS-036-08
    anonymous = client_like(api)
    assert (await anonymous.get(LIST)).status_code == 401
    assert (await anonymous.post(READ, json={})).status_code == 401
    guest = client_like(api)
    assert (await guest.post("/api/v1/auth/guest")).status_code == 200
    assert (await guest.get(LIST)).status_code == 401
    assert (await guest.post(READ, json={})).status_code == 401


async def test_csrf_required_on_mark_read(api, db, line, mail):
    c, uid, tid = await _user(api, line, mail, "U")
    await _add(db, uid, tid)
    r = await c.post(READ, json={}, headers={"X-Requested-With": ""})
    assert r.status_code == 403
    assert (await c.get(LIST)).json()["unread_count"] == 1


async def test_openapi_has_notification_schemas(api):
    spec = (await api.get("/api/v1/openapi.json")).json()
    for path, method in [(LIST, "get"), (READ, "post")]:
        ok = spec["paths"][path][method]["responses"]["200"]
        assert "schema" in ok["content"]["application/json"], path
