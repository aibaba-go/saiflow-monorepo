"""FastAPI entry point: assembles the app; no business logic here (STD-005)."""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.config import Settings, load_settings
from app.cookies import install_cookie_refresh
from app.db import create_engine, create_sessionmaker
from app.errors import register_error_handlers
from app.integrations.email import smtp_sender_from
from app.integrations.line import LineClient
from app.logging_setup import configure_logging
from app.rate_limit import GUEST_LIMIT, GUEST_WINDOW, SlidingWindowLimiter
from app.request_context import RequestIdMiddleware
from app.routers import (
    admin_auth,
    admin_billing,
    admin_ocr,
    admin_organizations,
    admin_query,
    auth,
    billing,
    exports,
    health,
    me,
    notifications,
    ocr_jobs,
    organizations,
    results,
    templates,
    uploads,
)


def _secret(value) -> str | None:
    return value.get_secret_value() if value else None


def build_line_clients(settings: Settings, http) -> tuple[LineClient | None, LineClient | None]:
    """(mini app client, web-pc login client). The mini app verifies LIFF ID tokens with
    its LINE MINI App channel; web-pc exchanges authorization codes with its own LINE Login
    channel when one is configured, else with the same channel (one-channel setups)."""
    mini = (
        LineClient(settings.line_channel_id, _secret(settings.line_channel_secret), http)
        if settings.line_channel_id
        else None
    )
    web = (
        LineClient(settings.line_web_channel_id, _secret(settings.line_web_channel_secret), http)
        if settings.line_web_channel_id
        else mini
    )
    return mini, web


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine = create_engine(app.state.settings)
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    settings = app.state.settings
    app.state.http = httpx.AsyncClient(timeout=5)
    mini, web = build_line_clients(settings, app.state.http)
    if not hasattr(app.state, "line_client"):  # tests may inject a fake first
        app.state.line_client = mini
    if not hasattr(app.state, "line_web_client"):
        app.state.line_web_client = web if settings.line_web_channel_id else app.state.line_client
    if not hasattr(app.state, "guest_limiter"):  # AC-FR-SYS-010-07: 30 per IP per 60 s
        app.state.guest_limiter = SlidingWindowLimiter(GUEST_LIMIT, GUEST_WINDOW)
    if not hasattr(app.state, "email_sender"):  # tests may inject a fake first
        app.state.email_sender = smtp_sender_from(settings)
    try:
        yield
    finally:
        await app.state.http.aclose()
        await app.state.engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging()
    app = FastAPI(
        title="SaiFlow API",
        version=settings.app_version,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    register_error_handlers(app)
    install_cookie_refresh(app)
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(admin_auth.router)
    app.include_router(organizations.router)
    app.include_router(admin_organizations.router)
    app.include_router(admin_billing.router)
    app.include_router(admin_ocr.router)
    app.include_router(admin_query.router)
    app.include_router(billing.router)
    app.include_router(notifications.router)
    app.include_router(uploads.router)
    app.include_router(ocr_jobs.router)
    app.include_router(templates.router)
    app.include_router(templates.versions_router)
    app.include_router(results.router)
    app.include_router(exports.router)
    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing create_app in tests
    # never requires production configuration.
    if name == "app":
        return create_app()
    raise AttributeError(name)
