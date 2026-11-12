"""Bounded, untrusted LIFF observations via health GET (FR-PLAT-002/003).

No new endpoint, authentication, DB writes, raw URLs, UA, or error messages.
Invalid headers and throttled events are silently ignored, not echoed.
"""

import json
import logging
import re
from collections.abc import Callable
from datetime import datetime, timedelta

from starlette.types import Scope

from app.clock import utcnow
from app.rate_limit import SlidingWindowLimiter

HEADER = b"x-saiflow-liff"
MAX_HEADER_BYTES = 1024
logger = logging.getLogger("app.liff")
_ENUMS = {
    "event": {"init", "xlsx_branch", "csv_branch"},
    "init": {"not_started", "ready", "failed", "timeout"},
    "os": {"ios", "android", "web", "unknown", "error"},
    "ua_os": {"ios", "android", "other"},
    "page": {"home", "final", "report", "other"},
    "adapter": {"real", "dev"},
    "branch": {"none", "ticket", "blob", "error"},
}
_FLAGS = {"ua_line", "loopback", "api_same_origin"}
_NULLABLE_FLAGS = {"in_client", "logged_in"}
_KEYS = set(_ENUMS) | _FLAGS | _NULLABLE_FLAGS | {"v", "trace", "liff_id", "elapsed_ms"}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def parse_diagnostic(raw: bytes) -> dict | None:
    """Reject entire malformed observations; never retain or log arbitrary fields."""
    if len(raw) > MAX_HEADER_BYTES or not raw.isascii():
        return None
    try:
        value = json.loads(raw, object_pairs_hook=_unique_object)
        if not isinstance(value, dict) or set(value) != _KEYS:
            return None
        if type(value["v"]) is not int or value["v"] != 1:
            return None
        for key, allowed in _ENUMS.items():
            if not isinstance(value[key], str) or value[key] not in allowed:
                return None
        if any(type(value[key]) is not bool for key in _FLAGS):
            return None
        if any(value[key] is not None and type(value[key]) is not bool for key in _NULLABLE_FLAGS):
            return None
        if not isinstance(value["trace"], str) or not re.fullmatch(r"[a-f0-9]{32}", value["trace"]):
            return None
        liff_id = value["liff_id"]
        if not isinstance(liff_id, str) or not re.fullmatch(
            r"(?:[0-9]{6,20}-[A-Za-z0-9]{1,32}|unconfigured)", liff_id
        ):
            return None
        elapsed = value["elapsed_ms"]
        if type(elapsed) is not int or not 0 <= elapsed <= 86_400_000:
            return None
        if value["event"] == "init":
            if value["branch"] != "none":
                return None
        else:
            # LINE browsers use attachments even if isInClient() is false; a cached
            # earlier bundle may still report blob for that combination.
            if value["in_client"] is None:
                allowed = {"error"}
            elif value["in_client"]:
                allowed = {"ticket"}
            elif value["ua_line"]:
                allowed = {"ticket", "blob"}
            else:
                allowed = {"blob"}
            if value["branch"] not in allowed:
                return None
        return value
    except (ValueError, TypeError, RecursionError):
        return None


class LiffDiagnostics:
    def __init__(self, clock: Callable[[], datetime] = utcnow) -> None:
        window = timedelta(seconds=60)
        self.total = SlidingWindowLimiter(120, window, clock)
        self.per_trace = SlidingWindowLimiter(20, window, clock)

    def record(self, scope: Scope) -> None:
        if scope["method"] != "GET" or scope["path"] != "/api/v1/health":
            return
        headers = [v for k, v in scope.get("headers", []) if k == HEADER]
        if len(headers) != 1:
            return
        value = parse_diagnostic(headers[0])
        if value is None or not self.total.hit("all") or not self.per_trace.hit(value["trace"]):
            return
        # Client-reported, not a trusted proof of device identity or download completion.
        # JSON remains inside the existing formatter's message and carries request_id.
        logger.info("liff_diagnostic %s", json.dumps(value, separators=(",", ":"), sort_keys=True))
