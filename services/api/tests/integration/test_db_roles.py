"""AC-FR-SYS-003-06: the application's database role cannot lift the audit-log protection."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.services import audit_service
from app.services.audit_service import AuditEvent

pytestmark = pytest.mark.integration

FORBIDDEN = [
    "ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete",
    "DROP TRIGGER audit_log_no_update_delete ON audit_log",
    "TRUNCATE audit_log",
    "DROP TABLE audit_log",
    "DELETE FROM audit_log",
    "UPDATE audit_log SET result = 'failure'",
]


async def test_app_role_cannot_disable_audit_protection(db, app_role_db):
    await audit_service.record(db, AuditEvent("system", None, "t.seed", "x", "1", "success"))
    await db.commit()
    for statement in FORBIDDEN:
        with pytest.raises(DBAPIError) as info:
            await app_role_db.execute(text(statement))
        await app_role_db.rollback()
        assert "permission denied" in str(info.value) or "must be owner" in str(info.value), (
            statement,
            info.value,
        )
    assert (await db.execute(text("select count(*) from audit_log"))).scalar_one() == 1


async def test_app_role_can_use_identity_tables(app_role_db):
    await app_role_db.execute(text("insert into tenants (kind) values ('guest')"))
    await audit_service.record(
        app_role_db, AuditEvent("system", None, "t.app", "x", "1", "success")
    )
    await app_role_db.commit()
    assert (await app_role_db.execute(text("select count(*) from tenants"))).scalar_one() == 1
    assert (await app_role_db.execute(text("select count(*) from audit_log"))).scalar_one() == 1


async def test_indexes_exist(db):
    names = set(
        (
            await db.execute(
                text("select indexname from pg_indexes where schemaname = 'saiflow_v3'")
            )
        ).scalars()
    )
    assert {"ix_email_codes_user_sent", "ix_customer_sessions_user"} <= names


async def test_admin_username_check_constraint(db):
    with pytest.raises(DBAPIError):
        await db.execute(
            text(
                "insert into admin_accounts (username, password_hash, failed_attempts) "
                "values ('Ops', 'x', 0)"
            )
        )
