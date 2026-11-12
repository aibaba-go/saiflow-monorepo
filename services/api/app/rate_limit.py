"""In-process sliding-window limiter. The API runs as a single uvicorn process (Dockerfile
CMD), so memory is the shared state; a restart clears it."""

import ipaddress
from collections import deque
from collections.abc import Callable
from datetime import datetime, timedelta

from app.clock import utcnow

GUEST_LIMIT = 30  # guest sessions per source IP (AC-FR-SYS-010-07)
GUEST_WINDOW = timedelta(seconds=60)
AUTH_LIMIT = 30  # session-less email logins, resets and codes per source IP (FR-SYS-157)
AUTH_WINDOW = timedelta(minutes=10)


class SlidingWindowLimiter:
    def __init__(
        self, limit: int, window: timedelta, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[str, deque[datetime]] = {}
        self._next_sweep: datetime | None = None

    def _sweep(self, now: datetime) -> None:
        cutoff = now - self.window
        for other in [k for k, q in self._hits.items() if not q or q[-1] <= cutoff]:
            del self._hits[other]  # idle keys, so memory stays bounded
        self._next_sweep = now + self.window

    def hit(self, key: str) -> bool:
        """Record one event for key; False (nothing recorded) when the window is full.
        Idle keys are dropped at most once per window, not on every call (M1)."""
        now = self.clock()
        cutoff = now - self.window
        if self._next_sweep is None or now >= self._next_sweep:
            self._sweep(now)
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True


def client_key(host: str) -> str:
    """The limiter key for a client address: an IPv6 address counts per /64 network, since
    one subscriber usually holds a whole /64 (M1); anything else is used as is."""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return host
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return host
