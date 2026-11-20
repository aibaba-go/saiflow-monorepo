"""Dev login configuration fails closed (NFR-DEV-001/002): AC-NFR-DEV-001-01, AC-NFR-DEV-002-02."""

import pytest
from pydantic import SecretStr

from app.config import (
    ConfigError,
    Settings,
    check_dev_login,
    dev_login_active,
    is_isolated_dev_target,
    load_settings,
)
from app.main import create_app

KEYS = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "APP_ENV", "DEV_LOGIN_ENABLED"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in KEYS:
        monkeypatch.delenv(key, raising=False)


def _env(monkeypatch, host="127.0.0.1", name="saiflow_dev", **extra):
    values = {"DB_HOST": host, "DB_NAME": name, "DB_USER": "u", "DB_PASSWORD": "pw-dev-1", **extra}
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def _settings(**fields) -> Settings:
    base = {
        "db_host": "127.0.0.1",
        "db_name": "saiflow_dev",
        "db_user": "u",
        "db_password": SecretStr("p"),
    }
    return Settings(**{**base, **fields})


def test_defaults_are_production_and_off(monkeypatch):  # AC-NFR-DEV-001-01
    _env(monkeypatch, host="db.internal", name="saiflow")
    settings = load_settings()
    assert settings.app_env == "production"
    assert settings.dev_login_enabled is False
    assert dev_login_active(settings) is False


def test_development_alone_does_not_enable_dev_login(monkeypatch):
    _env(monkeypatch, APP_ENV="development")
    assert dev_login_active(load_settings()) is False


@pytest.mark.parametrize("app_env", [None, "production", "staging", "test", "dev"])
def test_dev_login_without_development_fails(monkeypatch, app_env):  # AC-NFR-DEV-002-02
    _env(monkeypatch, DEV_LOGIN_ENABLED="true")
    if app_env is not None:
        monkeypatch.setenv("APP_ENV", app_env)
    with pytest.raises(ConfigError) as e:
        load_settings()
    assert "DEV_LOGIN_ENABLED requires APP_ENV=development" in str(e.value)


@pytest.mark.parametrize(
    ("host", "name"),
    [
        ("127.0.0.1", "saiflow"),  # the restored business database
        ("81.68.72.120", "saiflow_dev"),  # the shared remote server
        ("81.68.72.120", "saiflow"),
        ("127.0.0.1", "saiflow_test_x"),  # disposable test databases are not dev targets
        ("127.0.0.1", "saiflow_dev_"),
        ("127.0.0.1", "saiflow_devx"),
        ("postgres", "saiflow_dev"),  # the compose service name
        ("db.example.com", "saiflow_dev"),
    ],
)
def test_unsafe_db_target_fails(monkeypatch, host, name):  # AC-NFR-DEV-002-02
    _env(monkeypatch, host=host, name=name, APP_ENV="development", DEV_LOGIN_ENABLED="true")
    with pytest.raises(ConfigError) as e:
        load_settings()
    message = str(e.value)
    assert "DEV_LOGIN_ENABLED requires a loopback DB_HOST" in message
    assert host not in message and "pw-dev-1" not in message


@pytest.mark.parametrize(
    ("host", "name"),
    [
        ("127.0.0.1", "saiflow_dev"),
        ("localhost", "saiflow_dev"),
        ("LOCALHOST", "saiflow_dev_alice"),
        ("::1", "saiflow_dev"),
        ("[::1]", "saiflow_dev_2"),
    ],
)
def test_isolated_targets_pass(monkeypatch, host, name):
    _env(monkeypatch, host=host, name=name, APP_ENV="development", DEV_LOGIN_ENABLED="true")
    settings = load_settings()
    assert dev_login_active(settings) is True


def test_target_check_alone():
    assert is_isolated_dev_target("127.0.0.1", "saiflow_dev")
    assert not is_isolated_dev_target("127.0.0.2", "saiflow_dev")
    assert not is_isolated_dev_target("127.0.0.1", "SAIFLOW_DEV")
    assert not is_isolated_dev_target("127.0.0.1", "saiflow")


def test_create_app_refuses_unsafe_settings_built_in_code():  # AC-NFR-DEV-002-02
    with pytest.raises(ConfigError):
        create_app(_settings(dev_login_enabled=True))  # app_env stays production
    with pytest.raises(ConfigError):
        create_app(_settings(dev_login_enabled=True, app_env="development", db_name="saiflow"))


def test_create_app_accepts_safe_dev_settings():
    settings = _settings(dev_login_enabled=True, app_env="development")
    check_dev_login(settings)
    assert create_app(settings).state.settings is settings
