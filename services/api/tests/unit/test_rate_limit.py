from datetime import UTC, datetime, timedelta

from app.rate_limit import SlidingWindowLimiter


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 4, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


def make() -> tuple[SlidingWindowLimiter, Clock]:
    clock = Clock()
    return SlidingWindowLimiter(30, timedelta(seconds=60), clock), clock


def test_allows_limit_then_blocks():
    limiter, _ = make()
    assert all(limiter.hit("ip") for _ in range(30))
    assert limiter.hit("ip") is False


def test_window_slides():
    limiter, clock = make()
    for _ in range(30):
        limiter.hit("ip")
    clock.now += timedelta(seconds=59)
    assert limiter.hit("ip") is False
    clock.now += timedelta(seconds=1, microseconds=1)
    assert limiter.hit("ip") is True


def test_keys_independent():
    limiter, _ = make()
    for _ in range(30):
        limiter.hit("a")
    assert limiter.hit("b") is True


def test_idle_keys_are_dropped():
    limiter, clock = make()
    limiter.hit("old")
    clock.now += timedelta(seconds=61)
    limiter.hit("new")
    assert "old" not in limiter._hits
