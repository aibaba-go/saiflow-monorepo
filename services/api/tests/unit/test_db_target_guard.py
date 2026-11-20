"""NFR-DEV-003: the destructive integration fixtures refuse shared or remote databases before
any connection, migration, role reset or TRUNCATE; REQUIRE_INTEGRATION never bypasses it."""

import pytest
from pydantic import SecretStr

from app.config import Settings
from tests import conftest
from tests.db_target_guard import (
    UnsafeTestDatabaseError,
    check_engine,
    check_settings,
    check_test_db_target,
    unsafe_reason,
)
from tests.integration import db_fixtures

SHARED_NAMES = ["saiflow", "saiflow_dev", "saiflow_dev_local", "postgres", "saiflow_test", ""]
REMOTE_HOSTS = ["81.68.72.120", "db.example.com", "10.0.0.5", "0.0.0.0", "127.0.0.2", ""]


def _settings(host: str, name: str) -> Settings:
    return Settings(
        db_host=host,
        db_port=25432,
        db_name=name,
        db_user="tester",
        db_password=SecretStr("guard-test-password"),
    )


@pytest.mark.parametrize("name", SHARED_NAMES)
def test_ac_nfr_dev_003_01_shared_or_dev_database_names_rejected(name):
    """AC-NFR-DEV-003-01: saiflow (restored copy), saiflow_dev* and non-prefixed names fail."""
    with pytest.raises(UnsafeTestDatabaseError, match="TEST_DB_NAME"):
        check_test_db_target("127.0.0.1", name)


@pytest.mark.parametrize("host", REMOTE_HOSTS)
def test_ac_nfr_dev_003_01_remote_hosts_rejected(host):
    """AC-NFR-DEV-003-01: a shared remote server (e.g. 81.68.72.120) is refused even with a
    valid test database name."""
    with pytest.raises(UnsafeTestDatabaseError, match="loopback"):
        check_test_db_target(host, "saiflow_test_regression")


def test_ac_nfr_dev_003_01_restored_production_copy_rejected():
    """AC-NFR-DEV-003-01: the exact restored shared target is refused on both counts."""
    assert unsafe_reason("81.68.72.120", "saiflow") is not None
    with pytest.raises(UnsafeTestDatabaseError):
        check_test_db_target("81.68.72.120", "saiflow")


@pytest.mark.parametrize(
    "name",
    [
        "SAIFLOW_TEST_X",
        "saiflow_test_",
        "saiflow_test_x;drop",
        'saiflow_test_x"',
        "x_saiflow_test_a",
    ],
)
def test_ac_nfr_dev_003_01_malformed_test_names_rejected(name):
    """AC-NFR-DEV-003-01: only saiflow_test_<lowercase identifier> is a disposable name."""
    with pytest.raises(UnsafeTestDatabaseError):
        check_test_db_target("127.0.0.1", name)


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "]
)
def test_ac_nfr_dev_003_02_loopback_test_database_allowed(host):
    """AC-NFR-DEV-003-02: a saiflow_test_* database on the local loopback cluster is allowed."""
    assert unsafe_reason(host, "saiflow_test_x") is None
    check_test_db_target(host, "saiflow_test_regression")


def test_ac_nfr_dev_003_01_error_does_not_echo_credentials():
    """The refusal names the rule, never the password."""
    with pytest.raises(UnsafeTestDatabaseError) as e:
        check_settings(_settings("81.68.72.120", "saiflow"))
    assert "guard-test-password" not in str(e.value)


def test_ac_nfr_dev_003_01_engine_url_checked_without_connecting():
    """_truncate_all's guard reads the engine URL; creating an engine opens no connection."""
    from app.db import create_engine

    remote = create_engine(_settings("81.68.72.120", "saiflow_test_x"))
    local = create_engine(_settings("127.0.0.1", "saiflow_test_x"))
    with pytest.raises(UnsafeTestDatabaseError):
        check_engine(remote)
    check_engine(local)


TEST_ENV = {
    "TEST_DB_PORT": "25432",
    "TEST_DB_USER": "tester",
    "TEST_DB_PASSWORD": "guard-test-password",
}


@pytest.mark.parametrize(
    ("host", "name"),
    [
        ("81.68.72.120", "saiflow"),
        ("127.0.0.1", "saiflow"),
        ("127.0.0.1", "saiflow_dev"),
        ("81.68.72.120", "saiflow_test_regression"),
    ],
)
@pytest.mark.parametrize("require", ["1", None])
def test_ac_nfr_dev_003_01_require_integration_does_not_bypass(monkeypatch, host, name, require):
    """AC-NFR-DEV-003-01: with or without REQUIRE_INTEGRATION=1 an unsafe configured target is
    a hard failure (not a skip) raised while building settings, before any connection."""
    for k, v in {**TEST_ENV, "TEST_DB_HOST": host, "TEST_DB_NAME": name}.items():
        monkeypatch.setenv(k, v)
    if require is None:
        monkeypatch.delenv("REQUIRE_INTEGRATION", raising=False)
    else:
        monkeypatch.setenv("REQUIRE_INTEGRATION", require)
    with pytest.raises(pytest.fail.Exception) as e:
        conftest._db_settings()
    assert "NFR-DEV-003" in str(e.value)
    assert "guard-test-password" not in str(e.value)


def test_ac_nfr_dev_003_02_safe_target_builds_settings(monkeypatch):
    """AC-NFR-DEV-003-02: the dedicated loopback test database passes the conftest guard."""
    for k, v in {**TEST_ENV, "TEST_DB_HOST": "127.0.0.1", "TEST_DB_NAME": "saiflow_test_x"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setenv("REQUIRE_INTEGRATION", "1")
    s = conftest._db_settings()
    assert (s.db_host, s.db_name) == ("127.0.0.1", "saiflow_test_x")


def _no_connect(*args, **kwargs):
    raise AssertionError("a database engine was created for an unsafe target")


@pytest.mark.parametrize(
    ("host", "name"), [("81.68.72.120", "saiflow"), ("127.0.0.1", "saiflow_dev")]
)
async def test_ac_nfr_dev_003_01_fixture_helpers_refuse_before_connecting(monkeypatch, host, name):
    """AC-NFR-DEV-003-01 defense in depth: role reset, alembic env and test tables each refuse
    an unsafe target before creating an engine or starting alembic."""
    monkeypatch.setattr(db_fixtures, "create_engine", _no_connect)
    unsafe = _settings(host, name)
    with pytest.raises(UnsafeTestDatabaseError):
        await db_fixtures._ensure_app_role(unsafe)
    with pytest.raises(UnsafeTestDatabaseError):
        await db_fixtures._create_test_tables(unsafe)
    with pytest.raises(UnsafeTestDatabaseError):
        db_fixtures._env_for(unsafe)


async def test_ac_nfr_dev_003_01_truncate_refuses_shared_engine():
    """AC-NFR-DEV-003-01: TRUNCATE never runs on an engine pointing at a shared database."""
    from app.db import create_engine

    engine = create_engine(_settings("81.68.72.120", "saiflow"))
    try:
        with pytest.raises(UnsafeTestDatabaseError):
            await db_fixtures._truncate_all(engine)
    finally:
        await engine.dispose()
