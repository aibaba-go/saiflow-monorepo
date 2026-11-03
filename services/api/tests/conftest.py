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


@pytest.fixture
def patch_db_check(monkeypatch):
    def _patch(result: bool):
        async def fake_check(engine, timeout: float = 3.0) -> bool:
            return result

        monkeypatch.setattr("app.services.health_service.check_database", fake_check)

    return _patch


@pytest.fixture
async def client_db_ok(client, patch_db_check):
    patch_db_check(True)
    return client


@pytest.fixture
async def client_db_down(client, patch_db_check):
    patch_db_check(False)
    return client


async def get_health(app) -> httpx.Response:
    """Run the app with its lifespan (engine creation/disposal) and call the health endpoint."""
    from asgi_lifespan import LifespanManager

    async with LifespanManager(app) as manager:
        transport = httpx.ASGITransport(app=manager.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await c.get("/api/v1/health")


class _SilentServer:
    def __init__(self, server, port: int):
        self.server, self.port = server, port


@pytest.fixture
async def silent_tcp_server():
    """Accepts TCP connections but never reads or writes (a hung database)."""
    import asyncio

    held = []

    async def on_connect(reader, writer):
        held.append(writer)
        await asyncio.sleep(3600)

    server = await asyncio.start_server(on_connect, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    yield _SilentServer(server, port)
    for w in held:
        w.close()
    server.close()


def _db_settings() -> Settings:
    import os

    names = ["TEST_DB_HOST", "TEST_DB_PORT", "TEST_DB_NAME", "TEST_DB_USER", "TEST_DB_PASSWORD"]
    if not all(os.environ.get(n) for n in names):
        if os.environ.get("REQUIRE_INTEGRATION") == "1":
            pytest.fail("integration database not configured")
        pytest.skip("integration database not configured (TEST_DB_*)")
    return Settings(
        db_host=os.environ["TEST_DB_HOST"],
        db_port=int(os.environ["TEST_DB_PORT"]),
        db_name=os.environ["TEST_DB_NAME"],
        db_user=os.environ["TEST_DB_USER"],
        db_password=SecretStr(os.environ["TEST_DB_PASSWORD"]),
        app_version="test-sha",
    )


@pytest.fixture
def db_settings() -> Settings:
    return _db_settings()


@pytest.fixture(scope="session")
def db_settings_session() -> Settings:
    return _db_settings()


from tests.integration.db_fixtures import (  # noqa: E402,F401  (shared DB fixtures)
    api,
    app_settings,
    db,
    db_engine,
    line,
    mail,
    migrated_db,
)
