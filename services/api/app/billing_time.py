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
    """dt plus n months on the Bangkok calendar, the day clamped to the target month's last
    day, returned in dt's own timezone. Raises ValueError past year 9999."""
    local = dt.astimezone(BANGKOK)
    month_index = local.month - 1 + n
    year, month = local.year + month_index // 12, month_index % 12 + 1
    if not 1 <= year <= 9999:
        raise ValueError("year out of range")
    day = min(local.day, calendar.monthrange(year, month)[1])
    return local.replace(year=year, month=month, day=day).astimezone(dt.tzinfo)


PERIOD_MONTHS = {"month": 1, "year": 12}


def bangkok_date(dt: datetime) -> date:
    """dt's calendar date in Bangkok (reminder days follow Asia/Bangkok)."""
    return dt.astimezone(BANGKOK).date()
