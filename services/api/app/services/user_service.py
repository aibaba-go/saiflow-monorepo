"""Registration (FR-SYS-014), profile edits (FR-SYS-015) and email change (FR-SYS-016)."""

import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.models import User
from app.repositories import user_repo
from app.services import email_code_service
from app.services.audit_service import AuditEvent, record

_PHONE_CHARS = re.compile(r"^[+0-9 ().\-]+$")
NAME_MAX = 128
PHONE_MAX = 32


def _field_error(*fields: str) -> AppError:
    return AppError(400, "validation_error", "error.validation", list(fields))


def normalize_phone(raw: str | None) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    digits = sum(ch.isdigit() for ch in value)
    if len(value) > PHONE_MAX or not _PHONE_CHARS.match(value) or not 6 <= digits <= 15:
        raise _field_error("phone")
    return value


def normalize_display_name(raw: str | None) -> str:
    value = (raw or "").strip()
    if not 1 <= len(value) <= NAME_MAX:
        raise _field_error("display_name")
    return value


def _email_taken() -> AppError:
    return AppError(409, "email_taken", "error.email_taken", ["email"])


async def _email_owner(db: AsyncSession, email: str) -> int | None:
    return (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none()


async def _load(db: AsyncSession, user_id: int) -> User:
    user = await user_repo.get(db, user_id)
    assert user is not None
    return user


def _collect(*checks, invalid: list[str] | None = None) -> list:
    """Run each normaliser; raise one 400 listing every failing field (plus `invalid`,
    fields whose value was not a string)."""
    values, failed = [], list(invalid or [])
    for check in checks:
        try:
            values.append(check())
        except AppError as exc:
            failed.extend(exc.fields or [])
    if failed:
        raise _field_error(*dict.fromkeys(failed))
    return values


async def register(
    db: AsyncSession,
    user_id: int,
    email: str | None,
    code: str | None,
    display_name: str | None,
    phone: str | None,
    invalid_fields: list[str] | None = None,
) -> None:
    user = await _load(db, user_id)
    if user.registered_at is not None:  # AC-FR-SYS-014-04: whatever the body contains
        raise AppError(409, "already_registered", "registration.already_done")
    clean_email, clean_name, clean_phone = _collect(
        lambda: email_code_service.normalize_email(email),
        lambda: normalize_display_name(display_name),
        lambda: normalize_phone(phone),
        invalid=invalid_fields or [],
    )
    owner = await _email_owner(db, clean_email)
    if owner is not None and owner != user_id:
        raise _email_taken()
    await email_code_service.consume_code(db, user_id, clean_email, code)
    user.email, user.display_name, user.phone = clean_email, clean_name, clean_phone
    user.registered_at = utcnow()
    await record(
        db, AuditEvent("user", str(user_id), "user.register", "user", str(user_id), "success")
    )
    await _commit_unique_email(db)


async def update_profile(db: AsyncSession, user_id: int, fields: dict[str, str | None]) -> None:
    checks = []
    if "display_name" in fields:
        checks.append(lambda: ("display_name", normalize_display_name(fields["display_name"])))
    if "phone" in fields:
        checks.append(lambda: ("phone", normalize_phone(fields["phone"])))
    changes = dict(_collect(*checks))
    user = await _load(db, user_id)
    for name, value in changes.items():
        setattr(user, name, value)
    await record(
        db, AuditEvent("user", str(user_id), "user.update_profile", "user", str(user_id), "success")
    )
    await db.commit()


async def change_email(db: AsyncSession, user_id: int, email: str | None, code: str | None) -> None:
    new_email = email_code_service.normalize_email(email)
    user = await _load(db, user_id)
    if new_email == user.email:
        raise AppError(400, "email_unchanged", "error.email_unchanged", ["email"])
    if await _email_owner(db, new_email) is not None:
        raise _email_taken()
    await email_code_service.consume_code(db, user_id, new_email, code)
    user.email = new_email
    await record(
        db, AuditEvent("user", str(user_id), "user.change_email", "user", str(user_id), "success")
    )
    await _commit_unique_email(db)


async def _commit_unique_email(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError:  # another user took the address at the same moment
        await db.rollback()
        raise _email_taken() from None
