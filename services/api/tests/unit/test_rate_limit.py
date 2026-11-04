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


def test_sweep_at_most_once_per_window():  # M1
    limiter, clock = make()
    sweeps = []
    original = limiter._sweep
    limiter._sweep = lambda now: (sweeps.append(now), original(now))  # type: ignore[method-assign]
    for i in range(10_000):
        limiter.hit(f"k{i}")
    assert len(sweeps) <= 1
    clock.now += timedelta(seconds=61)
    limiter.hit("late")
    assert len(sweeps) <= 2
    assert set(limiter._hits) == {"late"}


def test_ipv6_keyed_by_64():  # M1
    from app.rate_limit import client_key

    assert client_key("2001:db8:0:1::1") == client_key("2001:db8:0:1::2")
    assert client_key("2001:db8:0:1::1") != client_key("2001:db8:0:2::1")
    assert client_key("203.0.113.1") == "203.0.113.1"
    assert client_key("unknown") == "unknown"
