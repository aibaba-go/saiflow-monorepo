"""The signed-in customer's own identity and profile."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import (
    get_db,
    get_email_sender,
    get_principal,
    require_csrf_header,
    require_registered_user,
    require_user,
)
from app.integrations.email import SmtpSender
from app.schemas.auth import MeResponse
from app.schemas.loose import ensure_text
from app.schemas.me import (
    EmailChangeRequest,
    EmailCodeRequest,
    ProfileUpdate,
    RegistrationRequest,
)
from app.schemas.organization import UsableTenantOut
from app.services import email_code_service, me_service, tenant_access, user_service
from app.services.session_service import Principal

router = APIRouter(prefix="/api/v1/me", tags=["me"], dependencies=[Depends(require_csrf_header)])


@router.get("", operation_id="getMe", response_model=MeResponse)
async def get_me(
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(get_principal)],
) -> MeResponse:
    return await me_service.me(db, principal)


@router.get("/tenants", operation_id="listMyTenants", response_model=list[UsableTenantOut])
async def list_my_tenants(
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(require_user)],
) -> list[UsableTenantOut]:
    """Tenants the caller can use: the personal tenant and active organizations (FR-SYS-017)."""
    found = await tenant_access.usable_tenants(db, principal.user_id)  # type: ignore[arg-type]
    return [UsableTenantOut.model_validate(t, from_attributes=True) for t in found]


@router.post("/email-code", operation_id="sendEmailCode", status_code=204)
async def send_email_code(
    req: EmailCodeRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[Principal, Depends(require_user)],
    sender: Annotated[SmtpSender, Depends(get_email_sender)],
) -> Response:
    ensure_text(req)
    email = email_code_service.normalize_email(req.email)
    await email_code_service.send_code(db, sender, principal.user_id, email)  # type: ignore[arg-type]
    return Response(status_code=204)


Db = Annotated[AsyncSession, Depends(get_db)]


@router.post("/registration", operation_id="register", response_model=MeResponse)
async def register(
    req: RegistrationRequest, db: Db, principal: Annotated[Principal, Depends(require_user)]
) -> MeResponse:
    await user_service.register(
        db,
        principal.user_id,
        req.email,
        req.code,
        req.display_name,
        req.phone,  # type: ignore[arg-type]
        invalid_fields=req.invalid_fields,
    )
    return await me_service.me(db, principal)


@router.patch("", operation_id="updateMe", response_model=MeResponse)
async def update_me(
    req: ProfileUpdate,
    db: Db,
    principal: Annotated[Principal, Depends(require_registered_user)],
) -> MeResponse:
    ensure_text(req)
    await user_service.update_profile(db, principal.user_id, req.model_dump(exclude_unset=True))  # type: ignore[arg-type]
    return await me_service.me(db, principal)


@router.post("/email", operation_id="changeEmail", response_model=MeResponse)
async def change_email(
    req: EmailChangeRequest,
    db: Db,
    principal: Annotated[Principal, Depends(require_registered_user)],
) -> MeResponse:
    ensure_text(req)
    await user_service.change_email(db, principal.user_id, req.email, req.code)  # type: ignore[arg-type]
    return await me_service.me(db, principal)
