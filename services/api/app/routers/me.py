"""The signed-in customer's own identity and profile."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    get_db,
    get_email_sender,
    get_principal,
    require_csrf_header,
    require_user,
)
from app.integrations.email import SmtpSender
from app.schemas.auth import MeResponse
from app.schemas.me import EmailCodeRequest
from app.services import email_code_service, me_service
from app.services.session_service import Principal

router = APIRouter(prefix="/api/v1/me", tags=["me"], dependencies=[Depends(require_csrf_header)])


@router.get("", operation_id="getMe", response_model=MeResponse)
async def get_me(
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(get_principal)],
) -> MeResponse:
    return await me_service.me(db, principal)


@router.post("/email-code", operation_id="sendEmailCode", status_code=204)
async def send_email_code(
    req: EmailCodeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(require_user)],
    sender: Annotated[SmtpSender, Depends(get_email_sender)],
) -> Response:
    email = email_code_service.normalize_email(req.email)
    await email_code_service.send_code(db, sender, principal.user_id, email)  # type: ignore[arg-type]
    return Response(status_code=204)
