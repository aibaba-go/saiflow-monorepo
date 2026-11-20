"""Object storage behind one interface (ADR-008, T8): GCS in deployment, memory in tests."""

import pytest
from pydantic import SecretStr

from app.config import Settings
from app.dependencies import get_store
from app.errors import AppError
from app.integrations.storage import MemoryStore, ObjectMissing


async def test_memory_store_round_trip():
    store = MemoryStore()
    await store.put("originals/1/a.png", b"abc", "image/png")
    assert await store.exists("originals/1/a.png")
    assert await store.get("originals/1/a.png") == b"abc"
    await store.delete("originals/1/a.png")
    assert not await store.exists("originals/1/a.png")
    with pytest.raises(ObjectMissing):
        await store.get("originals/1/a.png")
    await store.delete("originals/1/a.png")  # deleting a missing object is not an error


def _settings(**extra) -> Settings:
    return Settings(
        db_host="db.invalid", db_name="x", db_user="u", db_password=SecretStr("p"), **extra
    )


class _App:
    def __init__(self, settings):
        self.state = type("S", (), {"settings": settings, "store": None})()


class _Request:
    def __init__(self, settings):
        self.app = _App(settings)


def test_no_bucket_is_503():
    with pytest.raises(AppError) as err:
        get_store(_Request(_settings()))
    assert err.value.status == 503
    assert err.value.code == "storage_unavailable"


def test_store_from_app_state_wins():
    request = _Request(_settings())
    request.app.state.store = MemoryStore()
    assert get_store(request) is request.app.state.store
