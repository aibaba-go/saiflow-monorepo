"""LINE login (FR-SYS-001): find or create the user and personal tenant, claim a guest's
data (FR-SYS-010), and open a user session."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.integrations.line import LineClient, LineIdentity, LineInvalidToken, LineUnavailable
from app.models import User
from app.repositories import tenant_repo, user_repo
from app.schemas.auth import LineLoginRequest
from app.services import claim_service, session_service
from app.services.audit_service import AuditEvent, record
from app.services.session_service import Principal


async def _identity(
    line: LineClient, req: LineLoginRequest, allowed_redirects: set[str]
) -> LineIdentity:
    if req.id_token and not req.code:
        token_source = "id_token"
    elif req.code and req.redirect_uri and not req.id_token:
        if req.redirect_uri not in allowed_redirects:
            raise AppError(400, "validation_error", "error.validation", ["redirect_uri"])
        token_source = "code"
    else:
        raise AppError(400, "line_token_required", "auth.line_token_required")
    try:
        if token_source == "code":
            token = await line.exchange_code(req.code, req.redirect_uri)  # type: ignore[arg-type]
        else:
            token = req.id_token  # type: ignore[assignment]
        return await line.verify_id_token(token)
    except LineInvalidToken:
        raise AppError(401, "line_token_invalid", "auth.line_token_invalid") from None
    except LineUnavailable:
        raise AppError(503, "line_unavailable", "auth.line_unavailable") from None


async def _ensure_user(db: AsyncSession, identity: LineIdentity) -> tuple[User, int]:
    """Committed on its own, so a later failure (e.g. claiming) never loses the user."""
    user = await user_repo.by_line_id(db, identity.sub)
    if user is None:
        try:
            user = await user_repo.create(
                db,
                identity.sub,
                display_name=identity.name,
                avatar_url=identity.picture,
                line_email=identity.email,
            )
            tenant = await tenant_repo.create(db, "personal", user.id)
            await db.commit()
            return user, tenant.id
        except IntegrityError:  # the same LINE user logged in concurrently
            await db.rollback()
            user = await user_repo.by_line_id(db, identity.sub)
            assert user is not None
    tenant = await tenant_repo.personal_of(db, user.id)
    assert tenant is not None
    return user, tenant.id


async def login_with_line(
    db: AsyncSession,
    line: LineClient,
    current: Principal | None,
    req: LineLoginRequest,
    allowed_redirects: set[str],
) -> tuple[str, Principal]:
    identity = await _identity(line, req, allowed_redirects)
    user, personal_tenant_id = await _ensure_user(db, identity)
    try:
        user.avatar_url = identity.picture  # the avatar always follows LINE
        if user.registered_at is None:
            user.line_email = identity.email
        if current is not None and current.kind == "guest":
            await claim_service.claim_guest_tenant(db, current.tenant_id, personal_tenant_id)
            await session_service.revoke(db, current.session_id)
            await record(
                db,
                AuditEvent(
                    "user", str(user.id), "guest.claim", "tenant", str(current.tenant_id), "success"
                ),
            )
        elif current is not None:  # a user session on this device is replaced (AC-001-09)
            await session_service.revoke(db, current.session_id)
        token = await session_service.create_user_session(db, user.id, personal_tenant_id)
        await record(
            db, AuditEvent("user", str(user.id), "customer.login", "user", str(user.id), "success")
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    principal = await session_service.resolve(db, token)
    assert principal is not None
    await db.commit()
    return token, principal
