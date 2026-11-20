from datetime import UTC, date, datetime

from app.billing_time import add_months, month_key


def test_month_key_bangkok():
    assert month_key(datetime(2026, 1, 31, 16, 59, tzinfo=UTC)) == date(2026, 1, 1)
    assert month_key(datetime(2026, 1, 31, 17, 0, tzinfo=UTC)) == date(2026, 2, 1)  # 00:00 +07


def test_add_months_clamps():
    assert add_months(datetime(2026, 1, 31, 9, tzinfo=UTC), 1) == datetime(
        2026, 2, 28, 9, tzinfo=UTC
    )
    assert add_months(datetime(2028, 1, 31, tzinfo=UTC), 1) == datetime(2028, 2, 29, tzinfo=UTC)
    assert add_months(datetime(2026, 3, 15, tzinfo=UTC), 12) == datetime(2027, 3, 15, tzinfo=UTC)
    assert add_months(datetime(2026, 12, 10, tzinfo=UTC), 1) == datetime(2027, 1, 10, tzinfo=UTC)


def test_add_months_bangkok_calendar():  # rebuild-notifications M4
    from datetime import UTC, datetime

    from app.billing_time import add_months

    # 2026-01-30 20:00 UTC is 01-31 03:00 in Bangkok: one month later is 02-28 03:00 Bangkok
    got = add_months(datetime(2026, 1, 30, 20, tzinfo=UTC), 1)
    assert got == datetime(2026, 2, 27, 20, tzinfo=UTC) and got.tzinfo == UTC
