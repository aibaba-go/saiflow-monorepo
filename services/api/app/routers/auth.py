"""Customer authentication: guest session, logout and LINE login."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.dependencies import (
    get_db,
    get_line_client,
    get_optional_principal,
    get_principal,
    get_settings,
    require_csrf_header,
)
from app.integrations.line import LineClient
from app.schemas.auth import LineLoginRequest, MeResponse
from app.services import auth_service, me_service, session_service
from app.services.audit_service import AuditEvent, record
from app.services.session_service import CUSTOMER_COOKIE, CUSTOMER_IDLE, Principal

router = APIRouter(
    prefix="/api/v1/auth", tags=["auth"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]


def set_customer_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        CUSTOMER_COOKIE,
        token,
        max_age=int(CUSTOMER_IDLE.total_seconds()),
        path="/api",
        secure=True,
        httponly=True,
        samesite="lax",
    )


@router.post("/guest", operation_id="createGuestSession", response_model=MeResponse)
async def create_guest_session(
    response: Response,
    db: Db,
    current: Annotated[Principal | None, Depends(get_optional_principal)],
) -> MeResponse:
    if current is not None:
        return await me_service.me(db, current)
    token, principal = await session_service.create_guest(db)
    await db.commit()
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)


@router.post("/logout", operation_id="logout", status_code=204)
async def logout(db: Db, principal: Annotated[Principal, Depends(get_principal)]) -> Response:
    await session_service.revoke(db, principal.session_id)
    actor = str(principal.user_id) if principal.kind == "user" else str(principal.tenant_id)
    await record(
        db,
        AuditEvent(
            principal.kind,
            actor,
            "customer.logout",
            "session",
            str(principal.session_id),
            "success",
        ),
    )
    await db.commit()
    response = Response(status_code=204)
    response.delete_cookie(CUSTOMER_COOKIE, path="/api", secure=True, httponly=True, samesite="lax")
    return response


@router.post("/line", operation_id="loginWithLine", response_model=MeResponse)
async def login_with_line(
    req: LineLoginRequest,
    response: Response,
    db: Db,
    current: Annotated[Principal | None, Depends(get_optional_principal)],
    line: Annotated[LineClient, Depends(get_line_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MeResponse:
    allowed = {u.strip() for u in settings.line_login_redirect_uris.split(",") if u.strip()}
    token, principal = await auth_service.login_with_line(db, line, current, req, allowed)
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)
