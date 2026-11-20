"""Which reminder is due when (rebuild-notifications, FR-SYS-018, 035, 038). Pure functions:
the caller supplies the periods, counts and the current time; days are Bangkok dates."""

import calendar
from datetime import UTC, datetime

from app.billing_time import bangkok_date, month_key

EXPIRY_STAGES = {7: "d7", 3: "d3", 1: "d1", 0: "d0", -1: "after"}
FREE_QUOTA_STAGES = {7: "d7", 3: "d3", 1: "d1", 0: "d0"}
MONTH_END_DAYS_BEFORE = 3


def _days_left(end: datetime, now: datetime) -> int:
    return (bangkok_date(end) - bangkok_date(now)).days


def expiry_time(periods: list[tuple[datetime, datetime]], now: datetime) -> datetime | None:
    """When the tenant's continuous subscription ends (A1). From the periods active now,
    follow every period that starts at or before the running end and lasts longer. With
    none active, the latest end already passed; never subscribed (or only future) is None."""
    active = [e for s, e in periods if s <= now < e]
    if not active:
        ended = [e for _, e in periods if e <= now]
        return max(ended) if ended else None
    end = max(active)
    while True:
        later = [e for s, e in periods if s <= end < e]
        if not later:
            return end
        end = max(later)


def expiry_stage(end: datetime, now: datetime) -> str | None:
    return EXPIRY_STAGES.get(_days_left(end, now))


def usage_stages(quota: int, used: int, now: datetime) -> list[str]:
    """Due usage stages for a tenant with an active subscription (FR-SYS-035)."""
    remaining = max(quota - used, 0)
    stages = []
    if remaining * 5 < quota:
        stages.append("low")
    today = bangkok_date(now)
    last = calendar.monthrange(today.year, today.month)[1]
    if today.day == last - MONTH_END_DAYS_BEFORE and remaining > 0:
        stages.append("month_end")
    return stages


def free_quota_stage(expires_at: datetime, remaining: int, now: datetime) -> str | None:
    """Organization free quota (FR-SYS-038): only while some is left and not yet expired."""
    if remaining <= 0 or now >= expires_at:
        return None
    return FREE_QUOTA_STAGES.get(_days_left(expires_at, now))


def month_cycle(now: datetime) -> str:
    return month_key(now).isoformat()


def time_cycle(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()
