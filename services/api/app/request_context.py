"""Per-request ID: accepted from X-Request-ID when well-formed, otherwise generated."""

import logging
import re
import time
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.liff_diagnostics import LiffDiagnostics

HEADER = "X-Request-ID"
_VALID = re.compile(r"^[A-Za-z0-9-]{1,64}$")

request_id_var: ContextVar[str] = ContextVar("request_id", default="")
access_logger = logging.getLogger("app.access")


def _incoming_id(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == b"x-request-id":
            text = value.decode("latin-1")
            return text if _VALID.match(text) else None
    return None


class RequestIdMiddleware:
    """Pure ASGI middleware so the ID is set before any handler or error handler runs.

    Also writes one access record per request (method, path without query, status,
    duration), so every request ID can be found in the server log (FR-PLAT-002)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.liff_diagnostics = LiffDiagnostics()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = _incoming_id(scope) or uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        try:
            self.liff_diagnostics.record(scope)
        except Exception:
            # Optional observations must never change health/login/download handling.
            pass

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = [(k, v) for k, v in message.get("headers", []) if k != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        # On an escaping exception the ID stays set: Starlette's outermost error middleware
        # (which runs our 500 handler) executes after this one, in the same task.
        try:
            await self.app(scope, receive, send_with_id)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            path = scope["path"]
            if path.startswith("/api/v1/report-downloads/"):
                path = "/api/v1/report-downloads/[redacted]"
            access_logger.info("%s %s %d %.0fms", scope["method"], path, status, elapsed_ms)
        request_id_var.reset(token)
