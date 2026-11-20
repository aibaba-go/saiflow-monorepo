"""Error handlers that turn every failure into ErrorResponse, never exposing internals."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.request_context import request_id_var
from app.schemas.common import ErrorResponse

logger = logging.getLogger("app.errors")


class AppError(Exception):
    """A deliberate, documented error response (see the plan's error table)."""

    def __init__(
        self,
        status: int,
        code: str,
        message_key: str,
        fields: list[str] | None = None,
        details: dict | None = None,
    ):
        super().__init__(code)
        self.status, self.code, self.message_key, self.fields = status, code, message_key, fields
        self.details = details


_HTTP_CODES = {
    404: ("not_found", "error.not_found"),
    405: ("method_not_allowed", "error.method_not_allowed"),
}


def _respond(
    status: int,
    code: str,
    message_key: str,
    fields: list[str] | None = None,
    details: dict | None = None,
):
    body = ErrorResponse(
        code=code,
        message_key=message_key,
        request_id=request_id_var.get(),
        fields=fields,
        details=details,
    )
    content = body.model_dump(exclude={"details"} if details is None else None)
    return JSONResponse(status_code=status, content=content)


async def _app_error(request: Request, exc: AppError) -> JSONResponse:
    return _respond(exc.status, exc.code, exc.message_key, exc.fields, exc.details)


async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code, key = _HTTP_CODES.get(exc.status_code, (f"http_{exc.status_code}", "error.http"))
    response = _respond(exc.status_code, code, key)
    if exc.headers:
        response.headers.update(exc.headers)
    return response


async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    if any(err.get("loc", ("",))[0] == "path" for err in exc.errors()):
        # an ID in the path that cannot name anything is "not found", not a client typo (N1)
        return _respond(404, "not_found", "error.not_found")
    fields: list[str] = []
    for err in exc.errors():
        name = str(err["loc"][-1]) if err.get("loc") else ""
        if name and name not in fields:
            fields.append(name)
    return _respond(422, "validation_error", "error.validation", fields)


async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error")
    response = _respond(500, "internal_error", "error.internal")
    # This handler runs outside RequestIdMiddleware, so the header is added here.
    response.headers["X-Request-ID"] = request_id_var.get()
    return response


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(Exception, _unhandled_error)
