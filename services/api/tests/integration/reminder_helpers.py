"""Shared setup for the reminder tests (rebuild-notifications Task 3). Times are far in the
future so the auto Kinder month and the approval-time free quota (both from the real clock)
never fall on a reminder day."""

from datetime import date, datetime, timedelta

from sqlalchemy import text

from app.billing_time import BANGKOK
from app.db import create_sessionmaker
from app.services import reminder_service


def bkk(y: int, m: int, d: int, h: int = 12, mi: int = 0) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=BANGKOK)


NOW = bkk(2030, 3, 10)


async def run(db_engine, mail, now: datetime, enabled: bool = True) -> int:
    return await reminder_service.run_once(create_sessionmaker(db_engine), mail, now, enabled)


async def set_periods(db, tenant_id: int, periods, plan: str = "starter") -> None:
    """Replace the tenant's subscriptions with (starts_at, ends_at[, plan]) periods."""
    await db.execute(text("delete from subscriptions where tenant_id = :t"), {"t": tenant_id})
    for p in periods:
        await db.execute(
            text(
                "insert into subscriptions (tenant_id, plan_code, period, starts_at, ends_at, "
                "source) values (:t, :p, 'month', :s, :e, 'admin')"
            ),
            {"t": tenant_id, "p": p[2] if len(p) > 2 else plan, "s": p[0], "e": p[1]},
        )
    await db.commit()


async def expiring(db, tenant_id: int, end: datetime, plan: str = "starter") -> None:
    """One subscription for the tenant, a month long, ending at `end`."""
    await set_periods(db, tenant_id, [(end - timedelta(days=30), end)], plan)


async def use_monthly(db, tenant_id: int, used: int, month: date) -> None:
    await db.execute(
        text(
            "insert into quota_reservations (tenant_id, reference, pages, from_free, "
            "from_monthly, month) values (:t, :r, :n, 0, :n, :m)"
        ),
        {"t": tenant_id, "r": f"ref-{tenant_id}-{used}-{month}", "n": used, "m": month},
    )
    await db.commit()


async def set_free(db, tenant_id: int, remaining: int, expires_at: datetime | None) -> None:
    await db.execute(
        text("update free_quotas set remaining = :r, expires_at = :e where tenant_id = :t"),
        {"t": tenant_id, "r": remaining, "e": expires_at},
    )
    await db.commit()


async def notes(db, tenant_id: int | None = None) -> list[dict]:
    sql = "select id, user_id, tenant_id, type, data from notifications"
    params = {}
    if tenant_id is not None:
        sql += " where tenant_id = :t"
        params["t"] = tenant_id
    rows = (await db.execute(text(sql + " order by id"), params)).mappings().all()
    return [dict(r) for r in rows]


async def reminder_rows(db, tenant_id: int | None = None) -> list[dict]:
    sql = "select tenant_id, kind, cycle, stage, recipient_user_id, email_status from reminders"
    params = {}
    if tenant_id is not None:
        sql += " where tenant_id = :t"
        params["t"] = tenant_id
    rows = (await db.execute(text(sql + " order by id"), params)).mappings().all()
    return [dict(r) for r in rows]


async def personal_tenant(api, line, mail, sub: str) -> tuple[int, int]:
    """A registered user with an email: (personal tenant ID, user ID). Clears the mail log."""
    from tests.integration.tenancy_helpers import registered_client

    c, uid = await registered_client(api, line, mail, sub)
    tid = (await c.get("/api/v1/me")).json()["tenant_id"]
    mail.sent.clear()
    return tid, uid


async def organization(api, db, line, mail, sub: str = "OWNER", admin=None):
    """An approved organization: (owner client, owner user ID, tenant ID, admin client)."""
    from tests.integration.tenancy_helpers import approved_org

    result = await approved_org(api, db, line, mail, sub, admin)
    mail.sent.clear()
    return result
