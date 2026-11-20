from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.dependencies import get_engine, get_settings
from app.schemas.health import HealthResponse
from app.services import health_service

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get(
    "/health",
    operation_id="getHealth",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
async def health(
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[AsyncEngine | None, Depends(get_engine)],
) -> JSONResponse:
    result = await health_service.get_health(engine, settings.app_version)
    status = 200 if result.status == "ok" else 503
    return JSONResponse(status_code=status, content=result.model_dump())
