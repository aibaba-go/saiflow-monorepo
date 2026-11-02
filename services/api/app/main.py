"""FastAPI entry point: assembles the app; no business logic here (STD-005)."""

from fastapi import FastAPI

from app.config import Settings, load_settings
from app.errors import register_error_handlers
from app.logging_setup import configure_logging
from app.request_context import RequestIdMiddleware


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    configure_logging()
    app = FastAPI(
        title="SaiFlow API",
        version=settings.app_version,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
    )
    app.state.settings = settings
    register_error_handlers(app)
    app.add_middleware(RequestIdMiddleware)
    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing create_app in tests
    # never requires production configuration.
    if name == "app":
        return create_app()
    raise AttributeError(name)
