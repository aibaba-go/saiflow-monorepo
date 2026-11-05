"""web-admin-console Task 2: admins query the operation log (FR-SYS-003 modified)."""

import pytest
from sqlalchemy import text

from app.services.audit_service import AuditEvent, record
from tests.integration.tenancy_helpers import admin_client, client_like

pytestmark = pytest.mark.integration

URL = "/api/v1/admin/audit-log"


async def _write(db, n: int, action: str, target_id: str | None = None, actor: str = "system"):
    for i in range(n):
        await record(db, AuditEvent(actor, None, action, "thing", target_id or str(i), "success"))
    await db.commit()


async def _count(db) -> int:
    return (await db.execute(text("select count(*) from audit_log"))).scalar_one()


async def test_audit_paging_newest_first(api, db):  # AC-FR-SYS-003-07
    admin = await admin_client(api, db)
    await _write(db, 120, "test.event")
    first = (await admin.get(URL)).json()
    assert len(first["items"]) == 50 and first["next_before"] == first["items"][-1]["id"]
    ids = [e["id"] for e in first["items"]]
    assert ids == sorted(ids, reverse=True)
    second = (await admin.get(URL, params={"before": first["next_before"]})).json()
    assert len(second["items"]) == 50
    assert not set(ids) & {e["id"] for e in second["items"]}
    assert set(first["items"][0]) == {
        "id",
        "occurred_at",
        "actor_type",
        "actor_id",
        "action",
        "target_type",
        "target_id",
        "result",
    }


async def test_audit_filters(api, db):
    admin = await admin_client(api, db)
    await _write(db, 30, "org.update")
    await _write(db, 5, "plan.update", target_id="starter")
    await _write(db, 3, "user.login", actor="user")
    before = await _count(db)
    org = (await admin.get(URL, params={"action_prefix": "org.", "limit": 100})).json()["items"]
    assert len(org) == 30 and all(e["action"].startswith("org.") for e in org)
    users = (await admin.get(URL, params={"actor_type": "user"})).json()["items"]
    assert {e["action"] for e in users} == {"user.login"}
    target = (await admin.get(URL, params={"target_type": "thing", "target_id": "starter"})).json()
    assert len(target["items"]) == 5
    window = (
        await admin.get(
            URL, params={"since": "2000-01-01T00:00:00+07:00", "until": "2000-01-02T00:00:00+07:00"}
        )
    ).json()
    assert window["items"] == []
    assert await _count(db) == before  # reading writes nothing


async def test_audit_prefix_wildcards_literal(api, db):  # Review Focus 1
    admin = await admin_client(api, db)
    await _write(db, 2, "orgX.update")
    assert (await admin.get(URL, params={"action_prefix": "%"})).json()["items"] == []
    assert (await admin.get(URL, params={"action_prefix": "org_"})).json()["items"] == []


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"limit": "0"}, "limit"),
        ({"limit": "101"}, "limit"),
        ({"before": "abc"}, "before"),
        ({"since": "2026-01-01"}, "since"),
        ({"until": "yesterday"}, "until"),
        ({"actor_type": "robot"}, "actor_type"),
        ({"action_prefix": "x" * 65}, "action_prefix"),
    ],
)
async def test_audit_bad_params_400(api, db, params, field):  # Review Focus 5
    admin = await admin_client(api, db)
    r = await admin.get(URL, params=params)
    assert r.status_code == 400 and r.json()["fields"] == [field], r.text


async def test_audit_admin_only(api, db, line):  # AC-FR-SYS-003-08
    assert (await client_like(api).get(URL)).status_code == 401
    guest = client_like(api)
    await guest.post("/api/v1/auth/guest")
    assert (await guest.get(URL)).status_code == 401
