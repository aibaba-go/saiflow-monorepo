"""FastAPI entry point: assembles the app; no business logic here (STD-005)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import Settings, load_settings
from app.db import create_engine, create_sessionmaker
from app.errors import register_error_handlers
from app.logging_setup import configure_logging
from app.request_context import RequestIdMiddleware
from app.routers import auth, health, me


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.engine = create_engine(app.state.settings)
    app.state.sessionmaker = create_sessionmaker(app.state.engine)
    try:
        yield
    finally:
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
    app.add_middleware(RequestIdMiddleware)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app lazily, so importing create_app in tests
    # never requires production configuration.
    if name == "app":
        return create_app()
    raise AttributeError(name)
