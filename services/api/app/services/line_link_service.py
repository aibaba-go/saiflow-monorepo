from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.integrations.line import LineClient
from app.repositories import tenant_repo, user_repo
from app.schemas.auth import LineLinkRequest
from app.services import auth_service, email_auth_service
from app.services.session_service import Principal


async def link(
    db: AsyncSession,
    line: LineClient,
    current: Principal | None,
    req: LineLinkRequest,
    allowed_redirects: set[str],
    web: LineClient | None,
) -> tuple[str, Principal]:
    if current is not None and current.impersonated_by is not None:
        raise AppError(403, "impersonation_link_forbidden", "error.impersonation_link_forbidden")
    identity = await auth_service._identity(line, req, allowed_redirects, web)
    user = await email_auth_service.verify_for_link(db, req.email, req.password, req.email_code)
    try:
        if current is not None and current.kind == "user" and current.user_id != user.id:
            existing = await user_repo.get(db, current.user_id)
            if existing is not None and existing.registered_at is not None:
                raise AppError(409, "line_account_mismatch", "error.line_account_mismatch")
        owner = await user_repo.by_line_id(db, identity.sub)
        if owner is not None and owner.id != user.id:
            raise AppError(409, "line_already_linked", "error.line_already_linked")
        if user.line_user_id is not None and user.line_user_id != identity.sub:
            raise AppError(409, "line_account_mismatch", "error.line_account_mismatch")
        user.line_user_id = identity.sub
        user.avatar_url = identity.picture
        await db.flush()
        tenant = await tenant_repo.personal_of(db, user.id)
        assert tenant is not None
        return await auth_service.open_user_session(
            db, user, tenant.id, current, "customer.line_link"
        )
    except IntegrityError:
        await db.rollback()
        raise AppError(409, "line_already_linked", "error.line_already_linked") from None
    except AppError:
        await db.rollback()
        raise
