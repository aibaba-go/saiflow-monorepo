import pytest

from app.errors import AppError
from app.services.user_service import normalize_display_name, normalize_phone


@pytest.mark.parametrize("raw", ["+66 (81) 234-5678", "081.234.5678", "123456", "1" * 15])
def test_valid_phones(raw):
    assert normalize_phone(raw) == raw.strip()


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_empty_phone_clears(raw):
    assert normalize_phone(raw) is None


@pytest.mark.parametrize("raw", ["12345", "1" * 16, "+" + "1-" * 16, "08123abc45", "081/2345678"])
def test_invalid_phones(raw):
    with pytest.raises(AppError) as e:
        normalize_phone(raw)
    assert e.value.status == 400 and e.value.fields == ["phone"]


def test_display_name_limits():
    assert normalize_display_name("  Somchai  ") == "Somchai"
    assert normalize_display_name("a" * 128) == "a" * 128
    for raw in ["", "   ", None, "a" * 129]:
        with pytest.raises(AppError) as e:
            normalize_display_name(raw)
        assert e.value.fields == ["display_name"]
