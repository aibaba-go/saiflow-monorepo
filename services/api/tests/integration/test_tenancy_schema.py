"""rebuild-tenant-rbac Task 1: tenancy schema (migration 0004)."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.services import claim_service

pytestmark = pytest.mark.integration

NEW_TABLES = {
    "organizations",
    "organization_applications",
    "roles",
    "memberships",
    "invitations",
    "verification_applications",
    "system_settings",
}


async def _user(db, sub: str) -> int:
    return (
        await db.execute(
            text("insert into users (line_user_id) values (:s) returning id"), {"s": sub}
        )
    ).scalar_one()


async def _org(db) -> int:
    tid = (
        await db.execute(text("insert into tenants (kind) values ('organization') returning id"))
    ).scalar_one()
    await db.execute(
        text(
            "insert into organizations (tenant_id, name, contact_phone) "
            "values (:t, 'O', '0812345678')"
        ),
        {"t": tid},
    )
    return tid


async def _role(db, tid: int) -> int:
    return (
        await db.execute(
            text(
                "insert into roles (tenant_id, name, permissions, is_default) "
                "values (:t, 'Member', '{}', true) returning id"
            ),
            {"t": tid},
        )
    ).scalar_one()


async def test_tenancy_tables_exist(db):
    names = set(
        (
            await db.execute(
                text("select tablename from pg_tables where schemaname = 'saiflow_v3'")
            )
        ).scalars()
    )
    assert NEW_TABLES <= names


async def test_one_owner_per_org_enforced(db):
    tid = await _org(db)
    a, b = await _user(db, "A"), await _user(db, "B")
    await db.execute(
        text("insert into memberships (tenant_id, user_id, is_owner) values (:t, :u, true)"),
        {"t": tid, "u": a},
    )
    with pytest.raises(IntegrityError):
        await db.execute(
            text("insert into memberships (tenant_id, user_id, is_owner) values (:t, :u, true)"),
            {"t": tid, "u": b},
        )


async def test_owner_has_no_role_and_member_has_one(db):
    tid = await _org(db)
    rid = await _role(db, tid)
    a = await _user(db, "A")
    await db.commit()
    for owner, role in [(True, rid), (False, None)]:
        with pytest.raises(IntegrityError):
            await db.execute(
                text(
                    "insert into memberships (tenant_id, user_id, is_owner, role_id) "
                    "values (:t, :u, :o, :r)"
                ),
                {"t": tid, "u": a, "o": owner, "r": role},
            )
        await db.rollback()


async def test_one_pending_application_per_user(db):
    u = await _user(db, "A")
    sql = text(
        "insert into organization_applications (applicant_user_id, name, contact_phone) "
        "values (:u, 'O', '0812345678')"
    )
    await db.execute(sql, {"u": u})
    with pytest.raises(IntegrityError):
        await db.execute(sql, {"u": u})


async def test_app_role_can_write_tenancy_tables(app_role_db):
    tid = await _org(app_role_db)
    u = await _user(app_role_db, "A")
    await app_role_db.execute(
        text("insert into memberships (tenant_id, user_id, is_owner) values (:t, :u, true)"),
        {"t": tid, "u": u},
    )
    await app_role_db.commit()
    assert (await app_role_db.execute(text("select count(*) from memberships"))).scalar_one() == 1


async def test_app_role_cannot_write_alembic_version(app_role_db):  # M9
    with pytest.raises(DBAPIError) as info:
        await app_role_db.execute(text("insert into alembic_version values ('x')"))
    assert "permission denied" in str(info.value)


async def test_new_tables_not_tenant_scoped():
    scoped = {t.name for t in claim_service.tenant_scoped_tables()}
    assert not (NEW_TABLES & scoped)


async def test_member_limit_setting_seeded(db):
    value = (
        await db.execute(
            text("select value from system_settings where key = 'org_member_limit_unpaid'")
        )
    ).scalar_one()
    assert value == 2
