from sqlalchemy.ext.asyncio import AsyncEngine

from app.db import check_database
from app.schemas.health import HealthResponse


async def get_health(engine: AsyncEngine | None, version: str) -> HealthResponse:
    if await check_database(engine):
        return HealthResponse(status="ok", version=version, database="ok")
    return HealthResponse(status="degraded", version=version, database="error")
