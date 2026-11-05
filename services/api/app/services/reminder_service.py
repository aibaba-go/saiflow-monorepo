"""One reminder pass (rebuild-notifications, FR-SYS-018, 035, 038, 037).

For every active personal tenant and organization, compute the reminders due today (Bangkok
date) and send each at most once. The once-only key is reminders (tenant, kind, cycle,
stage): the notification and its reminder row are inserted and committed together, and a
concurrent pass that loses the insert rolls its notification back. Emails are sent after
every tenant is claimed, once each, without retries, within a time budget; a crash in
between leaves email_status 'pending', never retried (A6). Nothing here writes audit_log (A8)."""

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.billing_time import month_key
from app.clock import utcnow
from app.models import (
    FreeQuota,
    Membership,
    Notification,
    Organization,
    Plan,
    Reminder,
    Subscription,
    Tenant,
    User,
)
from app.reminder_mail import render
from app.reminder_rules import (
    expiry_stage,
    expiry_time,
    free_quota_stage,
    month_cycle,
    time_cycle,
    usage_stages,
)
from app.services import metering_service, subscription_service

logger = logging.getLogger("app.reminders")

PERSONAL_LABEL = "your personal account"

Due = tuple[str, str, str, dict]  # kind, cycle, stage, notification data


async def _expiry(db: AsyncSession, tenant_id: int, now: datetime) -> list[Due]:
    subs = list(
        (await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id)))
        .scalars()
        .all()
    )
    end = expiry_time([(s.starts_at, s.ends_at) for s in subs], now)
    if end is None:
        return []
    stage = expiry_stage(end, now)
    if stage is None:
        return []
    plan = max((s for s in subs if s.ends_at == end), key=lambda s: s.starts_at).plan_code
    data = {"stage": stage, "plan_code": plan, "ends_at": time_cycle(end)}
    return [("subscription_expiry", time_cycle(end), stage, data)]


async def _usage(db: AsyncSession, tenant_id: int, now: datetime) -> list[Due]:
    sub = await subscription_service.current(db, tenant_id, now)
    if not subscription_service.is_active(sub, now):
        return []
    plan = await db.get(Plan, sub.plan_code)  # type: ignore[union-attr]
    month = month_key(now)
    used = await metering_service.used_in_month(db, tenant_id, month)
    quota = plan.monthly_quota  # type: ignore[union-attr]
    base = {
        "plan_code": plan.code,  # type: ignore[union-attr]
        "quota": quota,
        "used": used,
        "remaining": max(quota - used, 0),
        "month": month.isoformat(),
    }
    return [
        ("usage", month_cycle(now), stage, {"stage": stage, **base})
        for stage in usage_stages(quota, used, now)
    ]


async def _free_quota(db: AsyncSession, tenant_id: int, now: datetime) -> list[Due]:
    row = await db.get(FreeQuota, tenant_id)
    if row is None or row.expires_at is None:
        return []
    stage = free_quota_stage(row.expires_at, row.remaining, now)
    if stage is None:
        return []
    data = {"stage": stage, "remaining": row.remaining, "expires_at": time_cycle(row.expires_at)}
    return [("free_quota_expiry", time_cycle(row.expires_at), stage, data)]


async def _due(db: AsyncSession, tenant: Tenant, now: datetime) -> list[Due]:
    due = await _expiry(db, tenant.id, now) + await _usage(db, tenant.id, now)
    if tenant.kind == "organization":
        due += await _free_quota(db, tenant.id, now)
    return due


async def _recipient(db: AsyncSession, tenant: Tenant) -> tuple[User | None, str]:
    """The user who gets this tenant's reminders, and how the email names the tenant."""
    if tenant.kind == "personal":
        user = await db.get(User, tenant.owner_user_id) if tenant.owner_user_id else None
        return user, PERSONAL_LABEL
    owner = (
        await db.execute(
            select(Membership.user_id).where(
                Membership.tenant_id == tenant.id,
                Membership.is_owner,
                Membership.removed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    org = await db.get(Organization, tenant.id)
    user = await db.get(User, owner) if owner is not None else None
    return user, org.name if org is not None else "your organization"


def _can_email(user: User, sender) -> bool:
    return sender is not None and user.registered_at is not None and bool(user.email)


async def _claim(
    sessionmaker: async_sessionmaker, tenant_id: int, user_id: int, due: Due, status: str
) -> int | None:
    """Insert the notification and its reminder in one transaction; None if already sent."""
    kind, cycle, stage, data = due
    async with sessionmaker() as db:
        note = Notification(user_id=user_id, tenant_id=tenant_id, type=kind, data=data)
        db.add(note)
        await db.flush()
        reminder_id = (
            await db.execute(
                insert(Reminder)
                .values(
                    tenant_id=tenant_id,
                    kind=kind,
                    cycle=cycle,
                    stage=stage,
                    recipient_user_id=user_id,
                    notification_id=note.id,
                    email_status=status,
                )
                .on_conflict_do_nothing(index_elements=["tenant_id", "kind", "cycle", "stage"])
                .returning(Reminder.id)
            )
        ).scalar_one_or_none()
        if reminder_id is None:
            await db.rollback()
            return None
        await db.commit()
        return reminder_id


EMAIL_CONCURRENCY = 5
EMAIL_BUDGET_SECONDS = 600.0  # the sending phase of one pass; the loop then runs again


@dataclass(frozen=True)
class Outgoing:
    reminder_id: int
    to: str
    due: Due
    label: str


async def _email(sessionmaker: async_sessionmaker, sender, item: Outgoing, deadline: float) -> None:
    """The one attempt for a claimed reminder (A6). Whatever goes wrong (rendering, the
    server, the pass's time budget) is recorded as failed; the notification stays."""
    kind, _, stage, data = item.due
    status, error = "sent", None
    try:
        subject, body = render(kind, stage, data, item.label)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DeadlineExceeded()
        try:
            await asyncio.wait_for(sender.send(item.to, subject, body), remaining)
        except TimeoutError:
            raise DeadlineExceeded() from None
    except Exception as exc:  # any failure: the notification already exists (FR-SYS-037)
        status, error = "failed", type(exc).__name__
        logger.warning("reminder %s email failed: %s", item.reminder_id, error)
    async with sessionmaker() as db:
        row = await db.get(Reminder, item.reminder_id)
        row.email_status, row.email_error = status, error  # type: ignore[union-attr]
        row.email_at = utcnow()  # type: ignore[union-attr]
        await db.commit()


class DeadlineExceeded(Exception):
    """The pass's email budget ran out before this reminder's email was sent."""


async def _tenant_pass(
    sessionmaker, sender, tenant_id: int, now: datetime, outbox: list[Outgoing]
) -> int:
    """Claim this tenant's due reminders; emails are queued in outbox, sent after every
    tenant has been claimed, so a slow mail server never delays the in-app notifications."""
    async with sessionmaker() as db:
        tenant = await db.get(Tenant, tenant_id)
        if tenant is None:
            return 0
        due = await _due(db, tenant, now)
        if not due:
            return 0
        user, label = await _recipient(db, tenant)
        if user is None:
            return 0
        user_id, email, can_email = user.id, user.email, _can_email(user, sender)
    created = 0
    for item in due:
        status = "pending" if can_email else "skipped"
        reminder_id = await _claim(sessionmaker, tenant_id, user_id, item, status)
        if reminder_id is None:
            continue
        created += 1
        if can_email:
            outbox.append(Outgoing(reminder_id, email, item, label))  # type: ignore[arg-type]
    return created


async def _send_all(
    sessionmaker: async_sessionmaker, sender, outbox: list[Outgoing], budget: float
) -> None:
    deadline = time.monotonic() + budget
    gate = asyncio.Semaphore(EMAIL_CONCURRENCY)

    async def one(item: Outgoing) -> None:
        async with gate:
            try:
                await _email(sessionmaker, sender, item, deadline)
            except Exception:
                logger.exception("reminder %s: recording the email result failed", item.reminder_id)

    await asyncio.gather(*(one(item) for item in outbox))


async def run_once(
    sessionmaker: async_sessionmaker,
    sender,
    now: datetime,
    enabled: bool = True,
    email_budget_seconds: float = EMAIL_BUDGET_SECONDS,
) -> int:
    """One pass: claim every tenant's due reminders (in-app notifications), then send the
    emails with bounded concurrency within email_budget_seconds. Returns how many reminders
    it created. Pass a sender without retries: each email is attempted once (A6)."""
    if not enabled:
        return 0
    async with sessionmaker() as db:
        tenant_ids = list(
            (
                await db.execute(
                    select(Tenant.id)
                    .where(Tenant.kind.in_(("personal", "organization")), Tenant.status == "active")
                    .order_by(Tenant.id)
                )
            ).scalars()
        )
    created, outbox = 0, []
    for tenant_id in tenant_ids:
        try:
            created += await _tenant_pass(sessionmaker, sender, tenant_id, now, outbox)
        except Exception:
            logger.exception("reminders: tenant %s failed", tenant_id)
    if outbox:
        await _send_all(sessionmaker, sender, outbox, email_budget_seconds)
    return created
