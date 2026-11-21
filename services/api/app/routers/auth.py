"""Customer authentication: guest session, logout, LINE login, email logins and password
reset (customer-email-login), and entering as a user with an admin's one-time ticket."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.cookies import clear_session_cookie, set_session_cookie
from app.dependencies import (
    get_db,
    get_email_sender,
    get_guest_limiter,
    get_line_web_client,
    get_optional_line_client,
    get_optional_principal,
    get_settings,
    limit_auth_requests,
    require_csrf_header,
)
from app.errors import AppError
from app.integrations.email import SmtpSender
from app.integrations.line import LineClient
from app.rate_limit import SlidingWindowLimiter, client_key
from app.schemas.auth import (
    EmailAuthCodeRequest,
    EmailCodeLoginRequest,
    ImpersonationRedeemRequest,
    LineLinkRequest,
    LineLoginRequest,
    MeResponse,
    PasswordLoginRequest,
    PasswordResetRequest,
)
from app.schemas.loose import ensure_text
from app.services import (
    auth_service,
    dev_login_service,
    email_auth_service,
    impersonation_service,
    line_link_service,
    me_service,
    session_service,
)
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
    request: Request,
    response: Response,
    db: Db,
    current: Annotated[Principal | None, Depends(get_optional_principal)],
    limiter: Annotated[SlidingWindowLimiter, Depends(get_guest_limiter)],
) -> MeResponse:
    if current is not None:
        return await me_service.me(db, current)
    ip = request.client.host if request.client else "unknown"
    if not limiter.hit(client_key(ip)):
        raise AppError(429, "guest_too_many", "error.guest_too_many")
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
    request: Request,
    response: Response,
    db: Db,
    current: Annotated[Principal | None, Depends(get_optional_principal)],
    line: Annotated[LineClient | None, Depends(get_optional_line_client)],
    web: Annotated[LineClient | None, Depends(get_line_web_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MeResponse:
    client_host = request.client.host if request.client else None
    dev = dev_login_service.dev_identity_for(  # NFR-DEV-002
        settings, req, client_host, request.headers.get("host"), request.headers.get("origin")
    )
    if dev is None and line is None:
        raise AppError(503, "line_unavailable", "auth.line_unavailable")
    ensure_text(req)
    if dev is not None:
        token, principal = await auth_service.login_with_identity(db, dev, current)
    else:
        allowed = {u.strip() for u in settings.line_login_redirect_uris.split(",") if u.strip()}
        token, principal = await auth_service.login_with_line(
            db, line, current, req, allowed, web=web
        )
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)


Current = Annotated[Principal | None, Depends(get_optional_principal)]
Limited = [Depends(limit_auth_requests)]


def _check(req) -> None:
    """A field of the wrong JSON type is a 400 naming it, like every other loose body."""
    ensure_text(req)


@router.post(
    "/line-link", operation_id="linkLineAccount", response_model=MeResponse, dependencies=Limited
)
async def link_line_account(
    req: LineLinkRequest,
    response: Response,
    db: Db,
    current: Current,
    line: Annotated[LineClient | None, Depends(get_optional_line_client)],
    web: Annotated[LineClient | None, Depends(get_line_web_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> MeResponse:
    _check(req)
    if line is None:
        raise AppError(503, "line_unavailable", "auth.line_unavailable")
    allowed = {u.strip() for u in settings.line_login_redirect_uris.split(",") if u.strip()}
    token, principal = await line_link_service.link(db, line, current, req, allowed, web)
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)


@router.post("/email-code", operation_id="sendAuthEmailCode", status_code=204, dependencies=Limited)
async def send_auth_email_code(
    req: EmailAuthCodeRequest,
    db: Db,
    sender: Annotated[SmtpSender, Depends(get_email_sender)],
) -> Response:
    """A login or reset code to a registered email, without a session (FR-SYS-020)."""
    if "purpose" in req.invalid_fields:  # not a string: answered like an unknown purpose
        raise AppError(400, "validation_error", "error.validation", ["purpose"])
    _check(req)
    await email_auth_service.send_code(db, sender, req.email, req.purpose)
    return Response(status_code=204)


@router.post(
    "/password", operation_id="loginWithPassword", response_model=MeResponse, dependencies=Limited
)
async def login_with_password(
    req: PasswordLoginRequest, response: Response, db: Db, current: Current
) -> MeResponse:
    """FR-SYS-149, with the wrong-password lock of FR-SYS-156."""
    _check(req)
    token, principal = await email_auth_service.login_with_password(
        db, req.email, req.password, current
    )
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)


@router.post(
    "/email-login",
    operation_id="loginWithEmailCode",
    response_model=MeResponse,
    dependencies=Limited,
)
async def login_with_email_code(
    req: EmailCodeLoginRequest, response: Response, db: Db, current: Current
) -> MeResponse:
    """FR-SYS-150."""
    _check(req)
    token, principal = await email_auth_service.login_with_code(db, req.email, req.code, current)
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)


@router.post(
    "/password-reset",
    operation_id="resetPassword",
    response_model=MeResponse,
    dependencies=Limited,
)
async def reset_password(
    req: PasswordResetRequest, response: Response, db: Db, current: Current
) -> MeResponse:
    """FR-SYS-151: every other session of the user ends; this device is logged in."""
    _check(req)
    token, principal = await email_auth_service.reset_password(
        db, req.email, req.code, req.password, current
    )
    set_customer_cookie(response, token)
    return await me_service.me(db, principal)


@router.post("/impersonation", operation_id="redeemImpersonation", response_model=MeResponse)
async def redeem_impersonation(
    req: ImpersonationRedeemRequest,
    response: Response,
    db: Db,
    current: Annotated[Principal | None, Depends(get_optional_principal)],
) -> MeResponse:
    """Enter as a user with an admin's one-time ticket (FR-SYS-145, FR-SYS-148): replaces
    this browser's session; a bad ticket is 401 and changes nothing."""
    token, principal = await impersonation_service.redeem(
        db, req.ticket if not req.invalid_fields else None, current
    )
    max_age = int(session_service.idle_limit(principal).total_seconds())
    set_session_cookie(response, CUSTOMER_COOKIE, token, max_age)
    return await me_service.me(db, principal)
