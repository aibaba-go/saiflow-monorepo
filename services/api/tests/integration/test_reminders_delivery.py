"""FR-SYS-037 recipients and delivery."""

import asyncio

import pytest
from sqlalchemy import text

from app.db import create_engine, create_sessionmaker
from app.integrations.email import EmailUnavailable
from app.services import reminder_service
from tests.integration.reminder_helpers import (
    bkk,
    expiring,
    notes,
    organization,
    personal_tenant,
    reminder_rows,
    run,
)

pytestmark = pytest.mark.integration

END = bkk(2030, 3, 17, 10)
D7 = bkk(2030, 3, 10)


async def _default_role(db, org: int) -> int:
    return (
        await db.execute(
            text("select id from roles where tenant_id = :t and is_default"), {"t": org}
        )
    ).scalar_one()


async def test_org_reminder_to_owner_only(api, db, db_engine, line, mail):  # 037-01
    from tests.integration.tenancy_helpers import add_member, registered_client

    _, owner_id, org, _ = await organization(api, db, line, mail)
    _, member_id = await registered_client(api, line, mail, "M")
    await add_member(db, org, member_id, await _default_role(db, org))
    mail.sent.clear()
    await expiring(db, org, END)
    await run(db_engine, mail, D7)
    assert [n["user_id"] for n in await notes(db, org)] == [owner_id]
    assert [m.to for m in mail.sent] == ["owner@example.com"]


async def test_after_transfer_new_owner(api, db, db_engine, line, mail):  # 037-02
    from tests.integration.tenancy_helpers import add_member, registered_client

    owner, owner_id, org, _ = await organization(api, db, line, mail)
    _, v = await registered_client(api, line, mail, "V")
    await add_member(db, org, v, await _default_role(db, org))
    await expiring(db, org, END)
    await run(db_engine, mail, D7)
    r = await owner.post(f"/api/v1/organizations/{org}/owner-transfer", json={"user_id": v})
    assert r.status_code == 200
    await run(db_engine, mail, bkk(2030, 3, 14))
    assert [(n["user_id"], n["data"]["stage"]) for n in await notes(db, org)] == [
        (owner_id, "d7"),
        (v, "d3"),
    ]


async def test_guest_silent(api, db, db_engine, line, mail):  # AC-FR-SYS-037-03
    r = await api.post("/api/v1/auth/guest")
    assert r.status_code == 200, r.text
    guest = r.json()["tenant_id"]
    await expiring(db, guest, bkk(2030, 3, 11, 10), "kinder")
    await db.execute(
        text(
            "insert into quota_reservations (tenant_id, reference, pages, from_free, "
            "from_monthly, month) values (:t, 'g', 900, 0, 900, date '2030-03-01')"
        ),
        {"t": guest},
    )
    await db.commit()
    await run(db_engine, mail, D7)
    assert await notes(db, guest) == [] and await reminder_rows(db, guest) == []
    assert mail.sent == []


async def test_unregistered_in_app_only(api, db, db_engine, line, mail):  # 037-04
    from tests.integration.db_fixtures import login

    me = await login(api, line, "UNREG")
    tid = me["tenant_id"]
    await expiring(db, tid, bkk(2030, 3, 10, 20), "kinder")
    await run(db_engine, mail, D7)
    [n] = await notes(db, tid)
    assert n["data"]["stage"] == "d0"
    assert [r["email_status"] for r in await reminder_rows(db, tid)] == ["skipped"]
    assert mail.sent == []


async def test_email_failure_keeps_notification(api, db, db_engine, line, mail):  # 037-05
    tid, _ = await personal_tenant(api, line, mail, "P")
    await expiring(db, tid, bkk(2030, 3, 11, 10), "kinder")
    mail.fail_with = EmailUnavailable("SMTPConnectError: down")
    assert await run(db_engine, mail, D7) == 1
    assert await run(db_engine, mail, bkk(2030, 3, 10, 18)) == 0
    assert len(await notes(db, tid)) == 1
    row = (await db.execute(text("select email_status, email_error from reminders"))).one()
    assert tuple(row) == ("failed", "EmailUnavailable")


async def test_no_sender_skips_email(api, db, db_engine, line, mail):
    tid, _ = await personal_tenant(api, line, mail, "P")
    await expiring(db, tid, bkk(2030, 3, 11, 10), "kinder")
    assert await run(db_engine, None, D7) == 1
    assert [r["email_status"] for r in await reminder_rows(db, tid)] == ["skipped"]


async def test_concurrent_passes_send_once(api, db, db_engine, line, mail, migrated_db):  # 037-06
    _, _, org, _ = await organization(api, db, line, mail)
    await expiring(db, org, END)
    other = create_engine(migrated_db)
    try:
        created = await asyncio.gather(
            reminder_service.run_once(create_sessionmaker(db_engine), mail, D7),
            reminder_service.run_once(create_sessionmaker(other), mail, D7),
        )
    finally:
        await other.dispose()
    assert sorted(created) == [0, 1]
    assert len(await notes(db, org)) == 1 and len(mail.sent) == 1


async def test_disabled_then_enabled_no_backfill(api, db, db_engine, line, mail):  # 037-07
    _, _, org, _ = await organization(api, db, line, mail)
    await expiring(db, org, END)
    assert await run(db_engine, mail, D7, enabled=False) == 0
    assert await run(db_engine, mail, bkk(2030, 3, 11)) == 0
    assert await notes(db, org) == [] and mail.sent == []


async def test_reminders_not_audited(api, db, db_engine, line, mail):  # A8
    _, _, org, _ = await organization(api, db, line, mail)
    await expiring(db, org, END)
    before = (await db.execute(text("select count(*) from audit_log"))).scalar_one()
    await run(db_engine, mail, D7)
    assert (await db.execute(text("select count(*) from audit_log"))).scalar_one() == before


async def test_one_failing_tenant_does_not_stop_pass(api, db, db_engine, line, mail, monkeypatch):
    first, _ = await personal_tenant(api, line, mail, "A")
    second, _ = await personal_tenant(api, line, mail, "B")
    await expiring(db, first, END, "kinder")
    await expiring(db, second, END, "kinder")
    real = reminder_service._due

    async def broken(db_, tenant, now):
        if tenant.id == first:
            raise RuntimeError("boom")
        return await real(db_, tenant, now)

    monkeypatch.setattr(reminder_service, "_due", broken)
    assert await run(db_engine, mail, D7) == 1
    assert await notes(db, first) == [] and len(await notes(db, second)) == 1
