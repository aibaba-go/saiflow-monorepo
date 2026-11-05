"""FR-SYS-018 subscription-expiry reminders."""

from datetime import timedelta

import pytest

from tests.integration.reminder_helpers import (
    bkk,
    expiring,
    notes,
    organization,
    personal_tenant,
    reminder_rows,
    run,
    set_periods,
)

pytestmark = pytest.mark.integration


async def test_d7_once(api, db, db_engine, line, mail):  # AC-FR-SYS-018-01
    tid, uid = await personal_tenant(api, line, mail, "P")
    end = bkk(2030, 3, 17, 10)
    await expiring(db, tid, end, "kinder")
    now = bkk(2030, 3, 10, 8)
    assert await run(db_engine, mail, now) == 1
    assert await run(db_engine, mail, now + timedelta(hours=6)) == 0
    [n] = await notes(db, tid)
    assert n["user_id"] == uid and n["type"] == "subscription_expiry"
    assert n["data"]["stage"] == "d7" and n["data"]["plan_code"] == "kinder"
    assert n["data"]["ends_at"] == "2030-03-17T03:00:00+00:00"
    assert len(mail.sent) == 1 and mail.sent[0].to == "p@example.com"
    assert mail.sent[0].subject == "SaiFlow: your plan expires in 7 days"


async def test_missed_node_not_sent(api, db, db_engine, line, mail):  # AC-FR-SYS-018-02
    _, _, org, _ = await organization(api, db, line, mail)
    await expiring(db, org, bkk(2030, 3, 15, 10))
    assert await run(db_engine, mail, bkk(2030, 3, 10)) == 0
    assert await notes(db, org) == [] and mail.sent == []


async def test_d0_and_after(api, db, db_engine, line, mail):  # AC-FR-SYS-018-03
    _, _, org, _ = await organization(api, db, line, mail)
    await expiring(db, org, bkk(2030, 3, 10, 10))
    await run(db_engine, mail, bkk(2030, 3, 10, 15))  # already past 10:00: still "today"
    await run(db_engine, mail, bkk(2030, 3, 11))
    await run(db_engine, mail, bkk(2030, 3, 12))
    assert [n["data"]["stage"] for n in await notes(db, org)] == ["d0", "after"]
    assert [m.subject for m in mail.sent] == [
        "SaiFlow: your plan expires today",
        "SaiFlow: your plan has expired",
    ]


async def test_chained_renewal_no_old_reminder(api, db, db_engine, line, mail):  # 018-04
    _, _, org, _ = await organization(api, db, line, mail)
    old_end = bkk(2030, 3, 13, 10)
    new_end = bkk(2030, 4, 13, 10)
    await set_periods(db, org, [(old_end - timedelta(days=30), old_end), (old_end, new_end)])
    assert await run(db_engine, mail, bkk(2030, 3, 10)) == 0  # 3 days before the old end
    assert await run(db_engine, mail, bkk(2030, 4, 10)) == 1  # 3 days before the new end
    [n] = await notes(db, org)
    assert n["data"]["stage"] == "d3" and n["data"]["ends_at"] == "2030-04-13T03:00:00+00:00"


async def test_chained_renewal_through_admin_api(api, db, db_engine, line, mail):  # 018-04
    """The admin's default same-plan renewal chains at the old end (B-2c A5)."""
    _, _, org, admin = await organization(api, db, line, mail)
    r = await admin.put(
        f"/api/v1/admin/tenants/{org}/subscription",
        json={"plan_code": "starter", "period": "month"},
    )
    assert r.status_code == 200, r.text
    first_end = r.json()["ends_at"]
    r = await admin.put(
        f"/api/v1/admin/tenants/{org}/subscription",
        json={"plan_code": "starter", "period": "month"},
    )
    assert r.json()["starts_at"] == first_end
    from datetime import datetime

    end = datetime.fromisoformat(first_end)
    await run(db_engine, mail, end - timedelta(days=3))
    # the free quota (approval + 1 month) may be due that day; the expiry reminder is not
    assert [n for n in await notes(db, org) if n["type"] == "subscription_expiry"] == []


async def test_renewal_restarts_nodes(api, db, db_engine, line, mail):  # AC-FR-SYS-018-05
    _, _, org, _ = await organization(api, db, line, mail)
    end = bkk(2030, 3, 17, 10)
    await expiring(db, org, end)
    assert await run(db_engine, mail, bkk(2030, 3, 10)) == 1
    later = bkk(2030, 4, 17, 10)
    await set_periods(db, org, [(end - timedelta(days=30), end), (end, later)])
    assert await run(db_engine, mail, bkk(2030, 4, 10)) == 1
    cycles = [r["cycle"] for r in await reminder_rows(db, org)]
    assert cycles == ["2030-03-17T03:00:00+00:00", "2030-04-17T03:00:00+00:00"]


async def test_never_subscribed_org_silent(api, db, db_engine, line, mail):  # 018-06
    _, _, org, _ = await organization(api, db, line, mail)
    for day in range(1, 31):
        await run(db_engine, mail, bkk(2030, 3, day))
    assert await notes(db, org) == []
