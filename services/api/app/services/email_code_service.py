"""Email verification codes (FR-SYS-020) for registration and email change.

A code is 6 digits, valid 10 minutes from a successful send, single-use, bound to the
user and the email, voided by a newer code or by 5 wrong entries. Only a hash is
stored; the code never appears in responses or logs."""

import hashlib
import secrets
from datetime import timedelta

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.errors import AppError
from app.integrations.email import EmailRejected, EmailUnavailable, SmtpSender
from app.models import EmailCode
from app.services.audit_service import AuditEvent, record

CODE_TTL = timedelta(minutes=10)
RESEND_INTERVAL = timedelta(seconds=60)
MAX_FAILED = 5
SUBJECT = "SaiFlow verification code"
SEND_LOCK_NS = 4207002


def normalize_email(raw: str | None, field: str = "email") -> str:
    value = (raw or "").strip().lower()
    try:
        validate_email(value, check_deliverability=False)
    except EmailNotValidError:
        raise AppError(400, "validation_error", "error.validation", [field]) from None
    return value


def _hash(user_id: int, email: str, code: str) -> bytes:
    return hashlib.sha256(f"{user_id}:{email}:{code}".encode()).digest()


def _invalid() -> AppError:
    return AppError(400, "email_code_invalid", "error.email_code_invalid", ["code"])


async def send_code(db: AsyncSession, sender: SmtpSender, user_id: int, email: str) -> None:
    # One send at a time per user, held through the SMTP call: a double tap must not pass
    # the 60 s check twice (lock released when this transaction ends).
    await db.execute(
        text("SELECT pg_advisory_xact_lock(:ns, :uid)"), {"ns": SEND_LOCK_NS, "uid": user_id}
    )
    now = utcnow()
    last = (
        await db.execute(
            select(EmailCode.sent_at)
            .where(EmailCode.user_id == user_id)
            .order_by(EmailCode.sent_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last is not None and now - last < RESEND_INTERVAL:
        raise AppError(429, "email_code_too_soon", "error.email_code_too_soon")
    code = f"{secrets.randbelow(10**6):06d}"
    body = (
        f"Your SaiFlow verification code is {code}.\n"
        "It is valid for 10 minutes. If you did not request it, ignore this email.\n"
    )
    try:
        await sender.send(email, SUBJECT, body)
    except EmailRejected:
        raise AppError(400, "email_rejected", "error.email_rejected", ["email"]) from None
    except EmailUnavailable:
        raise AppError(503, "email_unavailable", "error.email_service_unavailable") from None
    sent_at = utcnow()
    await db.execute(
        update(EmailCode)
        .where(
            EmailCode.user_id == user_id, EmailCode.used_at.is_(None), EmailCode.voided_at.is_(None)
        )
        .values(voided_at=sent_at)
    )
    db.add(
        EmailCode(
            user_id=user_id,
            email=email,
            code_hash=_hash(user_id, email, code),
            sent_at=sent_at,
            expires_at=sent_at + CODE_TTL,
            failed_attempts=0,
        )
    )
    await record(
        db, AuditEvent("user", str(user_id), "user.email_code", "user", str(user_id), "success")
    )
    await db.commit()


async def consume_code(db: AsyncSession, user_id: int, email: str, code: str | None) -> None:
    """Mark the code used in the caller's transaction (the caller commits). A wrong code
    is counted and committed before the error is raised."""
    row = (
        await db.execute(
            select(EmailCode)
            .where(
                EmailCode.user_id == user_id,
                EmailCode.used_at.is_(None),
                EmailCode.voided_at.is_(None),
            )
            .order_by(EmailCode.sent_at.desc())
            .limit(1)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None or row.email != email or now > row.expires_at or not code:
        raise _invalid()
    if not secrets.compare_digest(row.code_hash, _hash(user_id, email, code.strip())):
        row.failed_attempts += 1
        if row.failed_attempts >= MAX_FAILED:
            row.voided_at = now
        await db.commit()
        raise _invalid()
    row.used_at = now
    await db.flush()
