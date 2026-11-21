"""Logging in without LINE (customer-email-login): email + password (FR-SYS-149) with the
wrong-password lock (FR-SYS-156), email code (FR-SYS-150), password reset by email code
(FR-SYS-151), and sending login and reset codes without a session (FR-SYS-020).

Only registered users can use these. Every login ends in auth_service.open_user_session,
so a guest's data is claimed the same way."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.integrations.email import SmtpSender
from app.models import User
from app.repositories import session_repo, tenant_repo
from app.services import auth_service, email_code_service, password_service
from app.services.audit_service import AuditEvent, record
from app.services.session_service import Principal

MAX_FAILED = 5
LOCK_FOR = timedelta(minutes=5)

LOGIN_PASSWORD = "customer.login_password"
LOGIN_EMAIL_CODE = "customer.login_email_code"
PASSWORD_RESET = "customer.password_reset"
PASSWORD_LOCK = "customer.password_lock"


def _not_registered() -> AppError:
    return AppError(404, "email_not_registered", "error.email_not_registered", ["email"])


def _field(name: str) -> AppError:
    return AppError(400, "validation_error", "error.validation", [name])


def _text(value: object) -> str | None:
    return value if isinstance(value, str) else None


async def _registered(db: AsyncSession, email: str, lock: bool = False) -> User | None:
    query = select(User).where(User.email == email, User.registered_at.is_not(None))
    if lock:  # serialise concurrent attempts so a wrong password is never lost
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await db.execute(query)).scalar_one_or_none()


async def _failure(db: AsyncSession, user_id: int | None, action: str) -> None:
    """Log a failed attempt and commit. An unknown email is not stored: it may be a typo
    of someone else's address."""
    who = str(user_id) if user_id is not None else None
    await record(db, AuditEvent("user", who, action, "user", who, "failure"))
    await db.commit()


async def _open(
    db: AsyncSession, user: User, current: Principal | None, action: str
) -> tuple[str, Principal]:
    tenant = await tenant_repo.personal_of(db, user.id)
    assert tenant is not None
    return await auth_service.open_user_session(db, user, tenant.id, current, action)


async def _verify_password(db: AsyncSession, email: object, password: object) -> User:
    clean_email = email_code_service.normalize_email(_text(email))
    typed = _text(password)
    if not typed:
        raise _field("password")
    user = await _registered(db, clean_email, lock=True)
    if user is None:
        await password_service.verify_password(None, typed)  # the same work as a real user
        await _failure(db, None, LOGIN_PASSWORD)
        raise _not_registered()
    now = utcnow()
    if user.password_hash is None:  # registered before passwords existed
        await _failure(db, user.id, LOGIN_PASSWORD)
        raise AppError(400, "password_not_set", "error.password_not_set", ["password"])
    if user.password_locked_until is not None and user.password_locked_until > now:
        await _failure(db, user.id, LOGIN_PASSWORD)  # not even checked while locked
        raise AppError(423, "account_locked", "error.account_locked")
    if not await password_service.verify_password(user.password_hash, typed):
        user.password_failed_attempts += 1
        if user.password_failed_attempts >= MAX_FAILED:  # FR-SYS-156
            user.password_failed_attempts, user.password_locked_until = 0, now + LOCK_FOR
            await record(
                db,
                AuditEvent("user", str(user.id), PASSWORD_LOCK, "user", str(user.id), "success"),
            )
        await _failure(db, user.id, LOGIN_PASSWORD)
        raise AppError(401, "password_invalid", "error.password_invalid", ["password"])
    user.password_failed_attempts = 0
    return user


async def login_with_password(
    db: AsyncSession, email: object, password: object, current: Principal | None
) -> tuple[str, Principal]:
    user = await _verify_password(db, email, password)
    return await _open(db, user, current, LOGIN_PASSWORD)


async def verify_for_link(
    db: AsyncSession, email: object, password: object, email_code: object
) -> User:
    if (password is not None) == (email_code is not None):
        raise AppError(400, "validation_error", "error.validation", ["password", "email_code"])
    if password is not None:
        return await _verify_password(db, email, password)
    clean_email = email_code_service.normalize_email(_text(email))
    user = await _registered(db, clean_email, lock=True)
    if user is None:
        await _failure(db, None, LOGIN_EMAIL_CODE)
        raise _not_registered()
    try:
        await email_code_service.consume_code(db, user.id, clean_email, _text(email_code), "login")
    except AppError as error:
        await _failure(db, user.id, LOGIN_EMAIL_CODE)
        if error.fields:
            error.fields = ["email_code" if field == "code" else field for field in error.fields]
        raise
    return user


async def login_with_code(
    db: AsyncSession, email: object, code: object, current: Principal | None
) -> tuple[str, Principal]:
    """Never touches the password counter or lock (FR-SYS-150)."""
    clean_email = email_code_service.normalize_email(_text(email))
    user = await _registered(db, clean_email)
    if user is None:
        await _failure(db, None, LOGIN_EMAIL_CODE)
        raise _not_registered()
    try:
        await email_code_service.consume_code(db, user.id, clean_email, _text(code), "login")
    except AppError:
        await _failure(db, user.id, LOGIN_EMAIL_CODE)
        raise
    return await _open(db, user, current, LOGIN_EMAIL_CODE)


async def reset_password(
    db: AsyncSession, email: object, code: object, password: object, current: Principal | None
) -> tuple[str, Principal]:
    """FR-SYS-151: in one transaction, use the code, store the new hash, clear the lock,
    end every session of the user and log this device in."""
    clean_email = email_code_service.normalize_email(_text(email))
    user = await _registered(db, clean_email, lock=True)
    if user is None:
        raise _not_registered()
    clean = password_service.validate_password(_text(password))  # before the code is used
    password_hash = await password_service.hash_password(clean)
    await email_code_service.consume_code(db, user.id, clean_email, _text(code), "reset")
    user.password_hash = password_hash
    user.password_failed_attempts, user.password_locked_until = 0, None
    await session_repo.revoke_all_of_user(db, user.id, utcnow())
    return await _open(db, user, current, PASSWORD_RESET)


async def send_code(db: AsyncSession, sender: SmtpSender, email: object, purpose: object) -> None:
    """A login or reset code, only to a registered user's email (FR-SYS-020)."""
    if purpose not in ("login", "reset"):
        raise _field("purpose")
    clean_email = email_code_service.normalize_email(_text(email))
    user = await _registered(db, clean_email)
    if user is None:
        raise _not_registered()
    await email_code_service.send_code(db, sender, user.id, clean_email, purpose)  # type: ignore[arg-type]
