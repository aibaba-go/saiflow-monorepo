import io

import pytest

from app import cli
from app.services import admin_service

PASSWORD = "correct-horse-battery"


@pytest.fixture
def captured(monkeypatch):
    for key, value in {"DB_HOST": "h", "DB_NAME": "n", "DB_USER": "u", "DB_PASSWORD": "p"}.items():
        monkeypatch.setenv(key, value)
    got: list[str] = []

    async def fake_create(db, username, password):
        got.append(password)

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def commit(self):
            pass

    class FakeEngine:
        async def dispose(self):
            pass

    monkeypatch.setattr(admin_service, "create_admin", fake_create)
    monkeypatch.setattr(cli, "create_engine", lambda settings: FakeEngine())
    monkeypatch.setattr(cli, "create_sessionmaker", lambda engine: FakeSession)
    return got


def test_cli_reads_password_without_echo_on_tty(captured, monkeypatch):
    stdin = io.StringIO("")
    stdin.isatty = lambda: True  # type: ignore[method-assign]
    monkeypatch.setattr("sys.stdin", stdin)
    monkeypatch.setattr("getpass.getpass", lambda prompt="": PASSWORD)
    assert cli.main(["admin-create", "ops"]) == 0
    assert captured == [PASSWORD]


def test_cli_reads_password_from_pipe(captured, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(PASSWORD + "\n"))
    assert cli.main(["admin-create", "ops"]) == 0
    assert captured == [PASSWORD]
