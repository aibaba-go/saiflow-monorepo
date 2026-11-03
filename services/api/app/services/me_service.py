from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import user_repo
from app.schemas.auth import MeResponse
from app.services.session_service import Principal


async def me(db: AsyncSession, principal: Principal) -> MeResponse:
    if principal.kind == "guest" or principal.user_id is None:
        return MeResponse(
            kind="guest", tenant_id=principal.tenant_id, user_id=None, registered=False
        )
    user = await user_repo.get(db, principal.user_id)
    assert user is not None
    registered = user.registered_at is not None
    return MeResponse(
        kind="user",
        tenant_id=principal.tenant_id,
        user_id=user.id,
        registered=registered,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        email=user.email,
        phone=user.phone,
        email_suggestion=None if registered else user.line_email,
    )
