"""Guard for the destructive database integration tests (NFR-DEV-003).

The integration fixtures reset the cluster-wide application role's password, run every
migration and TRUNCATE all tables. They may only ever touch a disposable database on a
loopback cluster, so the target is checked before any connection is opened:

- the host must be loopback (127.0.0.1, localhost, ::1);
- the database name must carry the dedicated prefix ``saiflow_test_`` followed by a plain
  identifier, which rules out the restored business database ``saiflow`` and every
  ``saiflow_dev*`` database.

REQUIRE_INTEGRATION=1 never bypasses this check; it only turns a missing database into a
failure instead of a skip.
"""

import re

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
TEST_DB_PREFIX = "saiflow_test_"
_TEST_DB_NAME = re.compile(r"saiflow_test_[a-z0-9_]+")


class UnsafeTestDatabaseError(RuntimeError):
    """The configured integration-test database is not a disposable loopback target."""


def _normalize_host(host: str) -> str:
    h = (host or "").strip().lower()
    if h.startswith("[") and h.endswith("]"):  # bracketed IPv6 literal
        h = h[1:-1]
    return h


def unsafe_reason(host: str | None, db_name: str | None) -> str | None:
    """Why the target is unsafe, or None when it is a disposable loopback test database.

    The reason names the rule that failed and never echoes credentials.
    """
    h = _normalize_host(host or "")
    if h not in LOOPBACK_HOSTS:
        return f"TEST_DB_HOST {host!r} is not a loopback address (127.0.0.1, localhost, ::1)"
    name = (db_name or "").strip()
    if not _TEST_DB_NAME.fullmatch(name):
        return (
            f"TEST_DB_NAME {db_name!r} is not a disposable test database "
            f"(must match {TEST_DB_PREFIX}<name>, lowercase letters, digits, underscores)"
        )
    return None


def check_test_db_target(host: str | None, db_name: str | None) -> None:
    """Raise UnsafeTestDatabaseError unless (host, db_name) is a safe disposable target."""
    reason = unsafe_reason(host, db_name)
    if reason is not None:
        raise UnsafeTestDatabaseError(
            f"refusing to run destructive integration tests: {reason} (NFR-DEV-003)"
        )


def check_settings(settings) -> None:
    """Check an app Settings object (db_host / db_name) before it is used to connect."""
    check_test_db_target(settings.db_host, settings.db_name)


def check_engine(engine) -> None:
    """Check a SQLAlchemy engine's URL before it is used for a destructive statement."""
    check_test_db_target(engine.url.host, engine.url.database)
