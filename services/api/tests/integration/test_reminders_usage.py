"""FR-SYS-035 usage reminders."""

from datetime import date, timedelta

import pytest

from tests.integration.reminder_helpers import (
    bkk,
    expiring,
    notes,
    organization,
    personal_tenant,
    run,
    set_free,
    set_periods,
    use_monthly,
)

pytestmark = pytest.mark.integration

MARCH = date(2030, 3, 1)
ACTIVE_MARCH = (bkk(2030, 2, 20), bkk(2030, 4, 20))


async def _usage(db, tid):
    return [n for n in await notes(db, tid) if n["type"] == "usage"]


async def test_low_once(api, db, db_engine, line, mail):  # AC-FR-SYS-035-01
    _, owner_id, org, _ = await organization(api, db, line, mail)
    await set_periods(db, org, [ACTIVE_MARCH])
    await use_monthly(db, org, 4000, MARCH)
    assert await run(db_engine, mail, bkk(2030, 3, 10)) == 0
    await use_monthly(db, org, 1, MARCH)
    assert await run(db_engine, mail, bkk(2030, 3, 10, 13)) == 1
    assert await run(db_engine, mail, bkk(2030, 3, 10, 14)) == 0
    [n] = await _usage(db, org)
    assert n["user_id"] == owner_id
    assert n["data"] == {
        "stage": "low",
        "plan_code": "starter",
        "quota": 5000,
        "used": 4001,
        "remaining": 999,
        "month": "2030-03-01",
    }
    assert [m.subject for m in mail.sent] == ["SaiFlow: less than 20% of this month's scans left"]


async def test_exactly_twenty_percent_silent(api, db, db_engine, line, mail):  # 035-02
    _, _, org, _ = await organization(api, db, line, mail)
    await set_periods(db, org, [ACTIVE_MARCH])
    await use_monthly(db, org, 4000, MARCH)
    await run(db_engine, mail, bkk(2030, 3, 10))
    assert await _usage(db, org) == []


async def test_free_quota_not_counted(api, db, db_engine, line, mail):  # AC-FR-SYS-035-03
    tid, _ = await personal_tenant(api, line, mail, "P")
    await set_periods(db, tid, [ACTIVE_MARCH], "kinder")
    await set_free(db, tid, 100, None)
    await use_monthly(db, tid, 850, MARCH)
    await run(db_engine, mail, bkk(2030, 3, 10))
    [n] = await _usage(db, tid)
    assert n["data"]["stage"] == "low" and n["data"]["remaining"] == 150


async def test_next_month_again(api, db, db_engine, line, mail):  # AC-FR-SYS-035-04
    _, _, org, _ = await organization(api, db, line, mail)
    await set_periods(db, org, [(bkk(2030, 1, 1), bkk(2030, 6, 1))])
    await use_monthly(db, org, 4500, date(2030, 1, 1))
    await run(db_engine, mail, bkk(2030, 1, 10))
    await run(db_engine, mail, bkk(2030, 2, 5))  # February: nothing used yet
    await use_monthly(db, org, 4500, date(2030, 2, 1))
    await run(db_engine, mail, bkk(2030, 2, 10))
    assert [n["data"]["month"] for n in await _usage(db, org)] == ["2030-01-01", "2030-02-01"]


async def test_month_end_once(api, db, db_engine, line, mail):  # AC-FR-SYS-035-05
    _, _, org, _ = await organization(api, db, line, mail)
    await set_periods(db, org, [(bkk(2030, 1, 1), bkk(2030, 6, 1))])
    await use_monthly(db, org, 4700, date(2030, 1, 1))  # 300 left: below 20%, so "low" too
    await run(db_engine, mail, bkk(2030, 1, 28, 9))
    await run(db_engine, mail, bkk(2030, 1, 28, 18))
    stages = sorted(n["data"]["stage"] for n in await _usage(db, org))
    assert stages == ["low", "month_end"]
    [end] = [n for n in await _usage(db, org) if n["data"]["stage"] == "month_end"]
    assert end["data"]["remaining"] == 300


async def test_month_end_zero_or_wrong_day(api, db, db_engine, line, mail):  # 035-06
    _, _, org, admin = await organization(api, db, line, mail)
    await set_periods(db, org, [(bkk(2030, 1, 1), bkk(2030, 6, 1))])
    await use_monthly(db, org, 5000, date(2030, 1, 1))
    await run(db_engine, mail, bkk(2030, 1, 28))
    _, _, org2, _ = await organization(api, db, line, mail, sub="OWNER2", admin=admin)
    await set_periods(db, org2, [(bkk(2030, 1, 1), bkk(2030, 6, 1))])
    await run(db_engine, mail, bkk(2030, 1, 29))
    assert [n["data"]["stage"] for n in await _usage(db, org)] == ["low"]
    assert await _usage(db, org2) == []


async def test_expired_no_usage_reminder(api, db, db_engine, line, mail):  # 035-07
    _, _, org, _ = await organization(api, db, line, mail)
    await expiring(db, org, bkk(2030, 3, 1, 10))
    await use_monthly(db, org, 4900, MARCH)
    await run(db_engine, mail, bkk(2030, 3, 28))
    assert await _usage(db, org) == []


async def test_plan_change_same_month_no_repeat(api, db, db_engine, line, mail):  # A3
    _, _, org, _ = await organization(api, db, line, mail)
    await set_periods(db, org, [ACTIVE_MARCH])
    await use_monthly(db, org, 4500, MARCH)
    await run(db_engine, mail, bkk(2030, 3, 10))
    upgrade_at = bkk(2030, 3, 12)
    await set_periods(
        db,
        org,
        [(ACTIVE_MARCH[0], upgrade_at), (upgrade_at, upgrade_at + timedelta(days=30), "advance")],
    )
    await use_monthly(db, org, 85000, MARCH)  # low again under the Advance quota
    await run(db_engine, mail, bkk(2030, 3, 15))
    assert len(await _usage(db, org)) == 1
