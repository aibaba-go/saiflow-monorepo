"""An admin enters web-pc as a registered user (FR-SYS-145, FR-SYS-148).

The admin console and web-pc are different hosts with host-only cookies, so the admin
gets a one-time link instead of a customer cookie: a random 60-second ticket (only its
SHA-256 is stored) in the URL fragment, which web-pc redeems in its own browser for a user
session marked with that admin. Redeeming replaces this browser's customer session and
never claims a guest's data. Neither the ticket nor any session value is logged."""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.errors import AppError
from app.models import AdminAccount, ImpersonationTicket
from app.repositories import tenant_repo, user_repo
from app.services import session_service
from app.services.audit_service import AuditEvent, record
from app.services.session_service import Principal

TICKET_TTL = timedelta(seconds=60)
MAX_TICKET_LENGTH = 128


@dataclass(frozen=True)
class IssuedLink:
    url: str
    expires_in: int


async def issue(
    db: AsyncSession, settings: Settings, admin: AdminAccount, user_id: int
) -> IssuedLink:
    """A one-time link for a registered user: 404 unknown user, 409 not yet registered,
    503 while web-pc's origin is not configured."""
    user = await user_repo.get(db, user_id)
    if user is None:
        raise AppError(404, "not_found", "error.not_found")
    if user.registered_at is None:
        raise AppError(409, "user_not_registered", "admin.impersonate_unregistered")
    origin = (settings.web_pc_origin or "").strip().rstrip("/")
    if not origin:
        raise AppError(503, "impersonation_unavailable", "admin.impersonate_unavailable")
    token = session_service.new_token()
    db.add(
        ImpersonationTicket(
            token_hash=session_service.hash_token(token),
            admin_id=admin.id,
            user_id=user.id,
            expires_at=utcnow() + TICKET_TTL,
        )
    )
    await record(
        db,
        AuditEvent(
            "admin", str(admin.id), "admin.impersonate.issue", "user", str(user.id), "success"
        ),
    )
    await db.commit()
    return IssuedLink(f"{origin}/impersonate#{token}", int(TICKET_TTL.total_seconds()))


async def _fail(db: AsyncSession, ticket: ImpersonationTicket | None) -> AppError:
    admin = str(ticket.admin_id) if ticket else None
    user = str(ticket.user_id) if ticket else None
    await db.rollback()  # nothing of this attempt is kept but its log entry
    await record(db, AuditEvent("admin", admin, "admin.impersonate.start", "user", user, "failure"))
    await db.commit()
    return AppError(401, "impersonation_invalid", "auth.impersonation_invalid")


async def redeem(
    db: AsyncSession, raw: str | None, current: Principal | None
) -> tuple[str, Principal]:
    """Exchange a ticket for the user's session. An unknown, expired or used ticket is 401
    and leaves the browser's current session alone."""
    if not raw or len(raw) > MAX_TICKET_LENGTH:
        raise await _fail(db, None)
    now = utcnow()
    ticket = (
        await db.execute(
            select(ImpersonationTicket)
            .where(ImpersonationTicket.token_hash == session_service.hash_token(raw))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if ticket is None or ticket.used_at is not None or ticket.expires_at < now:
        raise await _fail(db, ticket)
    admin = await db.get(AdminAccount, ticket.admin_id)
    user = await user_repo.get(db, ticket.user_id)
    tenant = await tenant_repo.personal_of(db, ticket.user_id) if user else None
    if admin is None or admin.disabled_at is not None or user is None or tenant is None:
        raise await _fail(db, ticket)
    if user.registered_at is None:
        raise await _fail(db, ticket)
    ticket.used_at = now
    if current is not None:  # this browser's session is replaced; a guest is not claimed
        await session_service.revoke(db, current.session_id)
    token = await session_service.create_user_session(db, user.id, tenant.id, admin.id)
    await record(
        db,
        AuditEvent(
            "admin", str(admin.id), "admin.impersonate.start", "user", str(user.id), "success"
        ),
    )
    await db.commit()
    principal = await session_service.resolve(db, token)
    assert principal is not None
    await db.commit()
    return token, principal
