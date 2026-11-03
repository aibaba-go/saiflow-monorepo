"""Database engine and connectivity probe (PostgreSQL, fixed schema saiflow_v3, decision D2)."""

import asyncio
import logging

from sqlalchemy import MetaData, text
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import Settings

logger = logging.getLogger("app.db")

SCHEMA = "saiflow_v3"


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)


def database_url(settings: Settings) -> URL:
    return URL.create(
        "postgresql+asyncpg",
        username=settings.db_user,
        password=settings.db_password.get_secret_value(),
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
    )


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        database_url(settings),
        pool_pre_ping=True,
        connect_args={"timeout": 3, "server_settings": {"search_path": SCHEMA}},
    )


async def check_database(engine: AsyncEngine | None, timeout: float = 3.0) -> bool:
    """One `SELECT 1` bounded by `timeout`; logs only the exception type, never its text."""
    if engine is None:
        return False

    async def probe() -> None:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(probe(), timeout=timeout)
        return True
    except Exception as exc:  # noqa: BLE001 - any failure means "database unavailable"
        logger.warning("database check failed: %s", type(exc).__name__)
        return False
