"""Calendar helpers for billing. Thailand has no daylight saving time, so a fixed UTC+7
offset is exact and needs no tz database (FR-SYS-013: months follow Asia/Bangkok)."""

import calendar
from datetime import date, datetime, timedelta, timezone

BANGKOK = timezone(timedelta(hours=7))


def month_key(dt: datetime) -> date:
    """The first day of dt's calendar month in Bangkok."""
    local = dt.astimezone(BANGKOK)
    return date(local.year, local.month, 1)


def add_months(dt: datetime, n: int) -> datetime:
    """dt plus n calendar months, the day clamped to the target month's last day."""
    month_index = dt.month - 1 + n
    year, month = dt.year + month_index // 12, month_index % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


PERIOD_MONTHS = {"month": 1, "year": 12}
