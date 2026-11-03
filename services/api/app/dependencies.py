from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import Settings
from app.errors import AppError
from app.integrations.line import LineClient
from app.repositories import user_repo
from app.services import session_service
from app.services.session_service import Principal


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_engine(request: Request) -> AsyncEngine | None:
    # None when the app runs without its lifespan (unit tests patch the database check).
    return getattr(request.app.state, "engine", None)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER, CSRF_VALUE = "X-Requested-With", "SaiFlow"


def require_csrf_header(request: Request) -> None:
    """Cookie-authenticated writes must carry a custom header: sibling aibaba.asia
    subdomains are same-site, so SameSite alone does not stop forged requests."""
    if request.method in UNSAFE_METHODS and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise AppError(403, "csrf_header_missing", "error.csrf")


async def get_optional_principal(
    request: Request, db: Annotated[AsyncSession, Depends(get_db)]
) -> Principal | None:
    token = request.cookies.get(session_service.CUSTOMER_COOKIE)
    if not token:
        return None
    principal = await session_service.resolve(db, token)
    if principal is not None:
        await db.commit()  # keep the extended lifetime
    return principal


async def get_principal(
    principal: Annotated[Principal | None, Depends(get_optional_principal)],
) -> Principal:
    if principal is None:
        raise AppError(401, "unauthenticated", "auth.required")
    return principal


async def require_user(principal: Annotated[Principal, Depends(get_principal)]) -> Principal:
    if principal.kind != "user":
        raise AppError(401, "unauthenticated", "auth.required")
    return principal


async def require_registered_user(
    principal: Annotated[Principal, Depends(require_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Principal:
    user = await user_repo.get(db, principal.user_id)  # type: ignore[arg-type]
    if user is None or user.registered_at is None:
        raise AppError(403, "registration_required", "auth.registration_required")
    return principal


def get_line_client(request: Request) -> LineClient:
    client = getattr(request.app.state, "line_client", None)
    if client is None:
        raise AppError(503, "line_unavailable", "auth.line_unavailable")
    return client
