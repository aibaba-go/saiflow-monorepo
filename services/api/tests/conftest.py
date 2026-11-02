import httpx
import pytest
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(
        db_host="db.invalid",
        db_port=5432,
        db_name="saiflow_test",
        db_user="tester",
        db_password=SecretStr("test-password-value"),
        app_version="test-sha",
    )


def _add_test_routes(app):
    async def required(q: str) -> dict:
        return {"q": q}

    async def boom() -> dict:
        raise RuntimeError("internal detail xyz")

    app.add_api_route("/api/v1/_test/required", required, methods=["GET"])
    app.add_api_route("/api/v1/_test/boom", boom, methods=["GET"])


@pytest.fixture
async def client(settings):
    app = create_app(settings)
    _add_test_routes(app)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
