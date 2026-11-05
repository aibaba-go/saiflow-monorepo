"""Platform admin back-office login (FR-SYS-019); only the admin cookie is accepted here."""

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.cookies import clear_session_cookie, set_session_cookie
from app.dependencies import AdminContext, get_admin, get_db, require_csrf_header
from app.schemas.admin import AdminLoginRequest, AdminMeResponse, ChangePasswordIn
from app.schemas.loose import ensure_text
from app.services import admin_service
from app.services.admin_service import ADMIN_COOKIE, ADMIN_IDLE

router = APIRouter(
    prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_csrf_header)]
)

Db = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[AdminContext, Depends(get_admin)]


@router.post("/auth/login", operation_id="adminLogin", response_model=AdminMeResponse)
async def admin_login(req: AdminLoginRequest, response: Response, db: Db) -> AdminMeResponse:
    ensure_text(req)
    token, account = await admin_service.login(db, req.username, req.password)
    set_session_cookie(response, ADMIN_COOKIE, token, int(ADMIN_IDLE.total_seconds()))
    return AdminMeResponse(admin_id=account.id, username=account.username)


@router.post("/auth/logout", operation_id="adminLogout", status_code=204)
async def admin_logout(db: Db, admin: Admin) -> Response:
    await admin_service.logout(db, admin.session)
    response = Response(status_code=204)
    clear_session_cookie(response, ADMIN_COOKIE)
    return response


@router.post("/me/password", operation_id="adminChangePassword", status_code=204)
async def change_password(req: ChangePasswordIn, db: Db, admin: Admin) -> Response:
    """Change the signed-in admin's own password (FR-SYS-019); other sessions end."""
    ensure_text(req)
    await admin_service.change_own_password(
        db, admin.account, admin.session, req.current_password, req.new_password
    )
    return Response(status_code=204)


@router.get("/me", operation_id="getAdminMe", response_model=AdminMeResponse)
async def admin_me(admin: Admin) -> AdminMeResponse:
    return AdminMeResponse(admin_id=admin.account.id, username=admin.account.username)
