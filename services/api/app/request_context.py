"""Per-request ID: accepted from X-Request-ID when well-formed, otherwise generated."""

import re
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER = "X-Request-ID"
_VALID = re.compile(r"^[A-Za-z0-9-]{1,64}$")

request_id_var: ContextVar[str] = ContextVar("request_id", default="")


def _incoming_id(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == b"x-request-id":
            text = value.decode("latin-1")
            return text if _VALID.match(text) else None
    return None


class RequestIdMiddleware:
    """Pure ASGI middleware so the ID is set before any handler or error handler runs."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = _incoming_id(scope) or uuid.uuid4().hex
        token = request_id_var.set(request_id)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k != b"x-request-id"]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        # On an escaping exception the ID stays set: Starlette's outermost error middleware
        # (which runs our 500 handler) executes after this one, in the same task.
        await self.app(scope, receive, send_with_id)
        request_id_var.reset(token)
