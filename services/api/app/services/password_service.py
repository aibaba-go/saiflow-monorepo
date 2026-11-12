"""Customer passwords (FR-SYS-152): the rule, and argon2 hashing off the event loop.

Customer passwords and platform admin passwords use the same algorithm but are stored in
different tables and never accepted for one another."""

import asyncio
import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.errors import AppError

MIN_LENGTH = 8
MAX_LENGTH = 64
_LETTER = re.compile(r"[A-Za-z]")
_DIGIT = re.compile(r"[0-9]")

_hasher = PasswordHasher()
DUMMY_HASH = _hasher.hash("not-a-real-customer-password-1")  # equal work for unknown emails


def validate_password(raw: str | None, field: str = "password") -> str:
    """The password as typed (never trimmed), or 400 naming `field`."""
    if (
        not isinstance(raw, str)
        or not MIN_LENGTH <= len(raw) <= MAX_LENGTH
        or not _LETTER.search(raw)
        or not _DIGIT.search(raw)
    ):
        raise AppError(400, "validation_error", "error.validation", [field])
    return raw


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    """argon2 is CPU-heavy: run it in a thread. No hash still costs one verification."""

    def check() -> bool:
        try:
            return _hasher.verify(password_hash or DUMMY_HASH, password) and bool(password_hash)
        except (VerificationError, InvalidHashError):
            return False

    return await asyncio.to_thread(check)
