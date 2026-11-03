import pytest

from app.config import ConfigError, load_settings

REQUIRED = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in [*REQUIRED, "DB_PORT", "DB_SCHEMA", "APP_VERSION"]:
        monkeypatch.delenv(key, raising=False)


def test_missing_config_lists_names(monkeypatch):
    monkeypatch.setenv("DB_HOST", "h")
    monkeypatch.setenv("DB_NAME", "n")
    monkeypatch.setenv("DB_USER", "u")
    with pytest.raises(ConfigError) as e:
        load_settings()
    assert str(e.value) == "missing configuration: DB_PASSWORD"


def test_missing_config_lists_all_names_in_field_order():
    with pytest.raises(ConfigError) as e:
        load_settings()
    assert str(e.value) == "missing configuration: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD"


def test_missing_config_error_does_not_leak_values(monkeypatch):
    monkeypatch.setenv("DB_PASSWORD", "s3cret-value")
    monkeypatch.setenv("DB_NAME", "n")
    monkeypatch.setenv("DB_USER", "u")
    with pytest.raises(ConfigError) as e:
        load_settings()
    assert "s3cret-value" not in str(e.value)
    assert e.value.__cause__ is None and e.value.__suppress_context__


def test_complete_config_loads(monkeypatch):
    monkeypatch.setenv("DB_HOST", "h")
    monkeypatch.setenv("DB_NAME", "n")
    monkeypatch.setenv("DB_USER", "u")
    monkeypatch.setenv("DB_PASSWORD", "pw-123")
    settings = load_settings()
    assert settings.db_port == 5432
    assert settings.app_version == "dev"
    assert settings.db_password.get_secret_value() == "pw-123"
    assert "pw-123" not in repr(settings)


def test_schema_is_not_configurable(monkeypatch):
    # The schema is fixed (saiflow_v3, decision D2); DB_SCHEMA must not exist as a setting.
    for key, value in {"DB_HOST": "h", "DB_NAME": "n", "DB_USER": "u", "DB_PASSWORD": "p"}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("DB_SCHEMA", "other")
    settings = load_settings()
    assert not hasattr(settings, "db_schema")
