"""Customer password rule and hashing (FR-SYS-152)."""

import pytest

from app.errors import AppError
from app.services import password_service


@pytest.mark.parametrize("password", ["abcd1234", "a1" * 32, " abc 123 ", "Pass1234!@#"])
def test_rule_accepts(password):  # AC-FR-SYS-152-01
    assert password_service.validate_password(password) == password


@pytest.mark.parametrize(
    "password",
    [None, "", "abc1234", "a1" * 32 + "x", "abcdefgh", "12345678", "        ", 12345678],
)
def test_rule_rejects(password):  # AC-FR-SYS-152-02
    with pytest.raises(AppError) as exc:
        password_service.validate_password(password)  # type: ignore[arg-type]
    assert exc.value.status == 400 and exc.value.fields == ["password"]


def test_rule_uses_given_field_name():
    with pytest.raises(AppError) as exc:
        password_service.validate_password("short1", field="new_password")
    assert exc.value.fields == ["new_password"]


def test_non_ascii_letters_do_not_count():  # "an English letter" means A-Z or a-z
    with pytest.raises(AppError):
        password_service.validate_password("ภาษาไทย12345")


def test_spaces_are_kept():  # the rule never trims
    assert password_service.validate_password(" abc123 ") == " abc123 "
    with pytest.raises(AppError):
        password_service.validate_password(" abc12 ")  # 7 characters


async def test_hash_and_verify():  # AC-FR-SYS-152-03: only a hash is kept
    hashed = await password_service.hash_password("abcd1234")
    assert "abcd1234" not in hashed and hashed.startswith("$argon2")
    assert await password_service.verify_password(hashed, "abcd1234") is True
    assert await password_service.verify_password(hashed, "abcd12345") is False
    assert await password_service.verify_password(None, "abcd1234") is False
