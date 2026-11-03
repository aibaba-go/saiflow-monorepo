"""Platform admin back-office accounts (FR-SYS-019), separate from customer users.

Accounts are managed only by server commands. Passwords are argon2id hashes. Five wrong
passwords in a row lock the account for 15 minutes; a session ends after 30 idle
minutes. Every login failure answers the same way, whatever the reason."""

import asyncio
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import AdminAccount, AdminSession
from app.services.audit_service import AuditEvent, record
from app.services.session_service import hash_token, new_token

ADMIN_COOKIE = "saiflow_admin_session"
ADMIN_IDLE = timedelta(minutes=30)
MAX_FAILED = 5
LOCK_FOR = timedelta(minutes=15)
MIN_PASSWORD = 12

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("not-a-real-admin-password")  # equal work for unknown names


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"password must be at least {MIN_PASSWORD} characters")


async def _by_username(db: AsyncSession, username: str, lock: bool = False) -> AdminAccount | None:
    query = select(AdminAccount).where(AdminAccount.username == username)
    if lock:  # serialise concurrent logins so failed_attempts is never lost
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def _verify(password_hash: str, password: str) -> bool:
    """argon2 is CPU-heavy: run it off the event loop so other requests keep flowing."""

    def check() -> bool:
        try:
            return _hasher.verify(password_hash, password)
        except VerificationError:
            return False

    return await asyncio.to_thread(check)


async def _system(db: AsyncSession, action: str, username: str) -> None:
    await record(db, AuditEvent("system", None, action, "admin_account", username, "success"))


async def create_admin(db: AsyncSession, username: str, password: str) -> int:
    _check_password(password)
    if not username or await _by_username(db, username) is not None:
        raise ValueError(f"admin account {username!r} already exists or is empty")
    account = AdminAccount(
        username=username, password_hash=_hasher.hash(password), failed_attempts=0
    )
    db.add(account)
    await db.flush()
    await _system(db, "admin.create", username)
    return account.id


async def _require(db: AsyncSession, username: str) -> AdminAccount:
    account = await _by_username(db, username)
    if account is None:
        raise ValueError(f"no admin account {username!r}")
    return account


async def disable_admin(db: AsyncSession, username: str) -> None:
    account = await _require(db, username)
    now = utcnow()
    account.disabled_at = now
    await db.execute(
        update(AdminSession)
        .where(AdminSession.admin_id == account.id, AdminSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    await _system(db, "admin.disable", username)


async def reset_password(db: AsyncSession, username: str, password: str) -> None:
    _check_password(password)
    account = await _require(db, username)
    account.password_hash = _hasher.hash(password)
    account.failed_attempts, account.locked_until = 0, None
    await _system(db, "admin.reset_password", username)


def _failed() -> AppError:
    return AppError(401, "admin_login_failed", "admin.login_failed")


async def _log_failure(db: AsyncSession, username: str | None) -> None:
    """`username` only for an existing account: an unknown name may be a mistyped password."""
    await record(db, AuditEvent("admin", None, "admin.login", "admin_account", username, "failure"))
    await db.commit()


async def login(
    db: AsyncSession, username: str | None, password: str | None
) -> tuple[str, AdminAccount]:
    username, password = username or "", password or ""
    account = await _by_username(db, username, lock=True)
    if account is None:
        await _verify(_DUMMY_HASH, password)  # same work as for a real account
        await _log_failure(db, None)
        raise _failed()
    ok = await _verify(account.password_hash, password)
    now = utcnow()
    locked = account.locked_until is not None and account.locked_until > now
    if account.disabled_at is not None or locked or not ok:
        if not ok and not locked and account.disabled_at is None:
            account.failed_attempts += 1
            if account.failed_attempts >= MAX_FAILED:
                account.failed_attempts, account.locked_until = 0, now + LOCK_FOR
                await record(
                    db,
                    AuditEvent("admin", None, "admin.login", "admin_account", username, "failure"),
                )
                await record(
                    db,
                    AuditEvent(
                        "admin", str(account.id), "admin.lock", "admin_account", username, "success"
                    ),
                )
                await db.commit()
                raise _failed()
        await _log_failure(db, username)
        raise _failed()
    account.failed_attempts, account.locked_until = 0, None
    token = new_token()
    db.add(AdminSession(token_hash=hash_token(token), admin_id=account.id))
    await record(
        db,
        AuditEvent("admin", str(account.id), "admin.login", "admin_account", username, "success"),
    )
    await db.commit()
    return token, account


async def resolve_admin(db: AsyncSession, token: str) -> tuple[AdminSession, AdminAccount] | None:
    row = (
        await db.execute(
            select(AdminSession, AdminAccount)
            .join(AdminAccount, AdminAccount.id == AdminSession.admin_id)
            .where(AdminSession.token_hash == hash_token(token), AdminSession.revoked_at.is_(None))
        )
    ).one_or_none()
    now = utcnow()
    if row is None:
        return None
    session, account = row
    if account.disabled_at is not None or now - session.last_used_at > ADMIN_IDLE:
        return None
    session.last_used_at = now
    await db.commit()
    return session, account


async def logout(db: AsyncSession, session: AdminSession) -> None:
    session.revoked_at = utcnow()
    await db.commit()
