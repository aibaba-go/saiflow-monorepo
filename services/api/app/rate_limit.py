"""In-process sliding-window limiter. The API runs as a single uvicorn process (Dockerfile
CMD), so memory is the shared state; a restart clears it."""

from collections import deque
from collections.abc import Callable
from datetime import datetime, timedelta

from app.clock import utcnow

GUEST_LIMIT = 30  # guest sessions per source IP (AC-FR-SYS-010-07)
GUEST_WINDOW = timedelta(seconds=60)


class SlidingWindowLimiter:
    def __init__(
        self, limit: int, window: timedelta, clock: Callable[[], datetime] = utcnow
    ) -> None:
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[str, deque[datetime]] = {}

    def hit(self, key: str) -> bool:
        """Record one event for key; False (nothing recorded) when the window is full."""
        now = self.clock()
        cutoff = now - self.window
        for other in [k for k, q in self._hits.items() if q[-1] <= cutoff]:
            del self._hits[other]  # idle keys, so memory stays bounded
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True
