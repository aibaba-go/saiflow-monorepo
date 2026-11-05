"""FR-SYS-038 organization free-quota expiry reminders."""

import pytest

from tests.integration.reminder_helpers import (
    bkk,
    notes,
    organization,
    personal_tenant,
    run,
    set_free,
)

pytestmark = pytest.mark.integration

EXPIRES = bkk(2030, 3, 17, 10)


async def _free(db, tid):
    return [n for n in await notes(db, tid) if n["type"] == "free_quota_expiry"]


async def test_d7_once(api, db, db_engine, line, mail):  # AC-FR-SYS-038-01
    _, owner_id, org, _ = await organization(api, db, line, mail)
    await set_free(db, org, 60, EXPIRES)
    assert await run(db_engine, mail, bkk(2030, 3, 10, 8)) == 1
    assert await run(db_engine, mail, bkk(2030, 3, 10, 20)) == 0
    [n] = await _free(db, org)
    assert n["user_id"] == owner_id
    assert n["data"] == {"stage": "d7", "remaining": 60, "expires_at": "2030-03-17T03:00:00+00:00"}
    assert [m.subject for m in mail.sent] == [
        "SaiFlow: your organization's free scans expire in 7 days"
    ]


async def test_zero_remaining_silent(api, db, db_engine, line, mail):  # AC-FR-SYS-038-02
    _, _, org, _ = await organization(api, db, line, mail)
    await set_free(db, org, 0, bkk(2030, 3, 13, 10))
    await run(db_engine, mail, bkk(2030, 3, 10))
    assert await _free(db, org) == []


async def test_d0_then_nothing(api, db, db_engine, line, mail):  # AC-FR-SYS-038-03
    _, _, org, _ = await organization(api, db, line, mail)
    await set_free(db, org, 10, bkk(2030, 3, 10, 10))
    await run(db_engine, mail, bkk(2030, 3, 10, 9))
    await run(db_engine, mail, bkk(2030, 3, 10, 15))
    await run(db_engine, mail, bkk(2030, 3, 11))
    assert [n["data"]["stage"] for n in await _free(db, org)] == ["d0"]


async def test_d0_after_expiry_time_not_sent(api, db, db_engine, line, mail):  # 038-03
    _, _, org, _ = await organization(api, db, line, mail)
    await set_free(db, org, 10, bkk(2030, 3, 10, 10))
    await run(db_engine, mail, bkk(2030, 3, 10, 15))  # first check of the day is too late
    assert await _free(db, org) == []


async def test_missed_node_not_sent(api, db, db_engine, line, mail):  # AC-FR-SYS-038-04
    _, _, org, _ = await organization(api, db, line, mail)
    await set_free(db, org, 10, bkk(2030, 3, 15, 10))
    await run(db_engine, mail, bkk(2030, 3, 10))
    assert await _free(db, org) == []


async def test_personal_silent(api, db, db_engine, line, mail):  # AC-FR-SYS-038-05
    tid, _ = await personal_tenant(api, line, mail, "P")
    await set_free(db, tid, 100, None)
    for day in (3, 7, 9, 10):
        await run(db_engine, mail, bkk(2030, 3, day))
    assert await _free(db, tid) == []


async def test_reminded_with_or_without_subscription(api, db, db_engine, line, mail):  # A10
    from tests.integration.reminder_helpers import set_periods

    _, _, org, _ = await organization(api, db, line, mail)
    await set_periods(db, org, [(bkk(2030, 2, 1), bkk(2030, 6, 1))])
    await set_free(db, org, 5, EXPIRES)
    await run(db_engine, mail, bkk(2030, 3, 10))
    assert [n["data"]["stage"] for n in await _free(db, org)] == ["d7"]
