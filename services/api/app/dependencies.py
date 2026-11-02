from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_engine(request: Request) -> AsyncEngine | None:
    # None when the app runs without its lifespan (unit tests patch the database check).
    return getattr(request.app.state, "engine", None)
