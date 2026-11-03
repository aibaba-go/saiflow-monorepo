import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

pytestmark = pytest.mark.integration

TABLES = {
    "users",
    "tenants",
    "customer_sessions",
    "email_codes",
    "admin_accounts",
    "admin_sessions",
    "audit_log",
}


async def test_tables_exist(db):
    rows = await db.execute(
        text("select table_name from information_schema.tables where table_schema='saiflow_v3'")
    )
    assert TABLES <= {r[0] for r in rows}


async def test_one_personal_tenant_per_user(db):
    uid = (
        await db.execute(text("insert into users (line_user_id) values ('U1') returning id"))
    ).scalar_one()
    await db.execute(
        text("insert into tenants (kind, owner_user_id) values ('personal', :u)"), {"u": uid}
    )
    with pytest.raises(IntegrityError):
        await db.execute(
            text("insert into tenants (kind, owner_user_id) values ('personal', :u)"), {"u": uid}
        )
    await db.rollback()


async def test_audit_log_rejects_update_and_delete(db):  # AC-FR-SYS-003-03
    await db.execute(
        text(
            "insert into audit_log (actor_type, action, target_type, result, prev_hash, hash) "
            "values ('system', 'x.test', 'thing', 'success', :p, :h)"
        ),
        {"p": bytes(32), "h": bytes([1]) * 32},
    )
    await db.commit()
    for stmt in ["update audit_log set action = 'changed'", "delete from audit_log"]:
        with pytest.raises(DBAPIError):
            await db.execute(text(stmt))
        await db.rollback()
    action = (await db.execute(text("select action from audit_log"))).scalar_one()
    assert action == "x.test"
