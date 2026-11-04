"""Customer authentication: guest session, logout and LINE login."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.cookies import clear_session_cookie, set_session_cookie
from app.dependencies import (
    get_db,
    get_line_client,
    get_optional_principal,
    get_settings,
    require_csrf_header,
)
from app.integrations.line import LineClient
from app.schemas.auth import LineLoginRequest, MeResponse
from app.schemas.loose import ensure_text
from app.services import auth_service, me_service, session_service
from app.services.audit_service import AuditEvent, record
from app.services.session_service import CUSTOMER_COOKIE, CUSTOMER_IDLE, Principal

router = APIRouter(
    prefix="/api/v1/auth", tags=["auth"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]


def set_customer_cookie(response: Response, token: str) -> None:
    set_session_cookie(response, CUSTOMER_COOKIE, token, int(CUSTOMER_IDLE.total_seconds()))


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
async def logout(
    db: Db, principal: Annotated[Principal | None, Depends(get_optional_principal)]
) -> Response:
    """Always 204 and clears the cookie, even when the session is already gone (AC-001-10)."""
    if principal is not None:
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
    clear_session_cookie(response, CUSTOMER_COOKIE)
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
    ensure_text(req)
    allowed = {u.strip() for u in settings.line_login_redirect_uris.split(",") if u.strip()}
    token, principal = await auth_service.login_with_line(db, line, current, req, allowed)
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)
