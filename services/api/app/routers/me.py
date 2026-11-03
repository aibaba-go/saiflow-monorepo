"""The signed-in customer's own identity and profile."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_principal, require_csrf_header
from app.schemas.auth import MeResponse
from app.services import me_service
from app.services.session_service import Principal

router = APIRouter(prefix="/api/v1/me", tags=["me"], dependencies=[Depends(require_csrf_header)])


@router.get("", operation_id="getMe", response_model=MeResponse)
async def get_me(
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(get_principal)],
) -> MeResponse:
    return await me_service.me(db, principal)
