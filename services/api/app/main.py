"""FastAPI entry point: assembles the app; no business logic here (STD-005)."""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from app.config import Settings, load_settings
from app.db import create_engine, create_sessionmaker
from app.errors import register_error_handlers
from app.integrations.email import SmtpSender
from app.integrations.line import LineClient
from app.logging_setup import configure_logging
from app.request_context import RequestIdMiddleware
from app.routers import admin_auth, auth, health, me


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine = create_engine(app.state.settings)
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    settings = app.state.settings
    app.state.http = httpx.AsyncClient(timeout=5)
    if not hasattr(app.state, "line_client"):  # tests may inject a fake first
        app.state.line_client = (
            LineClient(
                settings.line_channel_id,
                settings.line_channel_secret.get_secret_value()
                if settings.line_channel_secret
                else None,
                app.state.http,
            )
            if settings.line_channel_id
            else None
        )
    if not hasattr(app.state, "email_sender"):  # tests may inject a fake first
        app.state.email_sender = _smtp_sender(settings)
    try:
        yield
    finally:
        await app.state.http.aclose()
        await app.state.engine.dispose()


def _smtp_sender(settings: Settings) -> SmtpSender | None:
    if not (settings.smtp_host and settings.smtp_from):
        return None
    return SmtpSender(
        settings.smtp_host,
        settings.smtp_port,
        settings.smtp_username,
        settings.smtp_password.get_secret_value() if settings.smtp_password else None,
        settings.smtp_from,
        settings.smtp_security,
    )


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
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(admin_auth.router)
    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing create_app in tests
    # never requires production configuration.
    if name == "app":
        return create_app()
    raise AttributeError(name)
