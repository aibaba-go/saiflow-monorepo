"""rebuild-notifications Task 2: which reminder is due when (pure rules)."""

from datetime import UTC, datetime, timedelta

from app.billing_time import BANGKOK, bangkok_date
from app.reminder_rules import (
    expiry_stage,
    expiry_time,
    free_quota_stage,
    month_cycle,
    time_cycle,
    usage_stages,
)


def bkk(y, m, d, h=12, mi=0) -> datetime:
    return datetime(y, m, d, h, mi, tzinfo=BANGKOK)


def test_bangkok_date_crosses_midnight():
    assert bangkok_date(datetime(2026, 1, 31, 18, 0, tzinfo=UTC)).isoformat() == "2026-02-01"


def test_expiry_stage_nodes():
    end = bkk(2026, 12, 10, 10)
    cases = {
        bkk(2026, 12, 3): "d7",
        bkk(2026, 12, 7): "d3",
        bkk(2026, 12, 9): "d1",
        bkk(2026, 12, 10, 9): "d0",
        bkk(2026, 12, 10, 15): "d0",
        bkk(2026, 12, 11): "after",
        bkk(2026, 12, 12): None,
        bkk(2026, 12, 5): None,
        bkk(2026, 12, 2): None,
    }
    for now, stage in cases.items():
        assert expiry_stage(end, now) == stage, now


def test_expiry_time_chained_and_overlapping():
    a, b, c, d = bkk(2026, 1, 1), bkk(2026, 2, 1), bkk(2026, 3, 1), bkk(2026, 4, 1)
    m = bkk(2026, 1, 15)
    assert expiry_time([(a, b), (b, c)], bkk(2026, 1, 10)) == c
    assert expiry_time([(b, c), (a, b)], bkk(2026, 1, 10)) == c  # order does not matter
    assert expiry_time([(a, c), (m, d)], bkk(2026, 1, 20)) == d
    assert expiry_time([(a, b), (b + timedelta(hours=1), c)], bkk(2026, 1, 10)) == b


def test_expiry_time_after_end():
    a, b, c = bkk(2026, 1, 1), bkk(2026, 2, 1), bkk(2026, 3, 1)
    assert expiry_time([(a, b)], bkk(2026, 2, 2)) == b
    assert expiry_time([(a, b), (b, c)], bkk(2026, 3, 2)) == c
    assert expiry_time([], bkk(2026, 1, 1)) is None


def test_expiry_time_future_only_is_none():
    assert expiry_time([(bkk(2026, 5, 1), bkk(2026, 6, 1))], bkk(2026, 1, 1)) is None


def test_usage_low_threshold():
    now = bkk(2026, 1, 10)
    assert "low" in usage_stages(5000, 4001, now)
    assert "low" not in usage_stages(5000, 4000, now)
    assert "low" in usage_stages(5000, 6000, now)  # over-used after a quota cut


def test_month_end_day():
    assert "month_end" in usage_stages(1000, 10, bkk(2026, 1, 28))
    assert "month_end" not in usage_stages(1000, 10, bkk(2026, 1, 29))
    assert "month_end" not in usage_stages(1000, 10, bkk(2026, 1, 27))
    assert "month_end" in usage_stages(1000, 10, bkk(2026, 2, 25))
    assert "month_end" in usage_stages(1000, 10, bkk(2028, 2, 26))
    assert "month_end" in usage_stages(1000, 10, bkk(2026, 4, 27))
    assert "month_end" not in usage_stages(1000, 1000, bkk(2026, 1, 28))


def test_month_end_uses_bangkok_calendar():
    # 2026-01-27 18:00 UTC is already 01-28 01:00 in Bangkok
    assert "month_end" in usage_stages(1000, 10, datetime(2026, 1, 27, 18, tzinfo=UTC))


def test_free_quota_stage():
    exp = bkk(2026, 12, 10, 10)
    assert free_quota_stage(exp, 60, bkk(2026, 12, 3)) == "d7"
    assert free_quota_stage(exp, 60, bkk(2026, 12, 7)) == "d3"
    assert free_quota_stage(exp, 60, bkk(2026, 12, 9)) == "d1"
    assert free_quota_stage(exp, 60, bkk(2026, 12, 10, 9)) == "d0"
    assert free_quota_stage(exp, 60, bkk(2026, 12, 10, 15)) is None
    assert free_quota_stage(exp, 60, bkk(2026, 12, 11)) is None
    assert free_quota_stage(exp, 0, bkk(2026, 12, 3)) is None
    assert free_quota_stage(exp, 60, bkk(2026, 12, 5)) is None


def test_cycles():
    assert month_cycle(bkk(2026, 2, 1, 3)) == "2026-02-01"
    assert month_cycle(datetime(2026, 1, 31, 18, tzinfo=UTC)) == "2026-02-01"
    assert time_cycle(bkk(2026, 12, 10, 10)) == "2026-12-10T03:00:00+00:00"
