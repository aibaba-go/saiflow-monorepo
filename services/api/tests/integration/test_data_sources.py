import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.db import create_engine
from app.errors import AppError
from app.services.data_source_connection import _execute, result_page, system_query

pytestmark = pytest.mark.integration


def connection_options(settings):
    return {
        "host": settings.db_host,
        "port": settings.db_port,
        "dbname": settings.db_name,
        "user": settings.db_user,
        "password": settings.db_password.get_secret_value(),
        "sslmode": "disable",
    }


async def test_source_schema_and_safe_reporting_views_are_migrated(migrated_db):
    engine = create_engine(migrated_db)
    try:
        async with engine.connect() as conn:
            assert await conn.scalar(text("select to_regclass('saiflow_v3.data_sources')"))
            assert await conn.scalar(text("select to_regclass('saiflow_v3.report_source_refs')"))
            names = (
                (
                    await conn.execute(
                        text(
                            "select column_name from information_schema.columns "
                            "where table_schema = 'reporting' and table_name = 'jobs'"
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert {
                "id",
                "tenant_id",
                "created_by_user_id",
                "original_name",
                "status",
                "review_status",
                "created_at",
                "official_at",
            } <= set(names)
            assert not {"params", "capability", "password_hash", "storage_path"} & set(names)
    finally:
        await engine.dispose()


async def test_real_query_retains_duplicates_nulls_and_decimal_scale(migrated_db):
    columns, rows = await _execute(
        connection_options(migrated_db),
        "select amount, label from (values (12.00::numeric, null::text), "
        "(12.00::numeric, null::text), (0.00::numeric, 'zero')) as v(amount,label)",
    )
    result = result_page(columns, rows, page=1, page_size=5)
    assert result["total"] == 3
    assert result["rows"] == [
        {"amount": "12.00", "label": None},
        {"amount": "12.00", "label": None},
        {"amount": "0.00", "label": "zero"},
    ]
    assert [c["type"] for c in columns] == ["decimal", "string"]


async def test_empty_real_query_still_returns_columns(migrated_db):
    columns, rows = await _execute(
        connection_options(migrated_db), "select 1::bigint as amount where false"
    )
    assert columns == [{"key": "amount", "label": "amount", "type": "integer"}]
    assert rows == []


async def test_real_query_rejects_duplicate_column_names(migrated_db):
    with pytest.raises(AppError) as denied:
        await _execute(connection_options(migrated_db), "select 1 as amount, 2 as amount")
    assert denied.value.code == "data_source_columns_invalid"


async def test_system_query_rejects_identity_tables_before_connecting(migrated_db):
    settings = migrated_db.model_copy(update={"report_db_password": SecretStr("local-reporter")})
    with pytest.raises(AppError) as denied:
        await system_query(settings, "select * from saiflow_v3.users")
    assert denied.value.code == "data_source_sql_invalid"


async def test_reporter_role_reads_only_restricted_views(migrated_db):
    settings = migrated_db.model_copy(update={"report_db_password": SecretStr("local-reporter")})
    columns, rows = await system_query(settings, "select count(*) as jobs from reporting.jobs")
    assert columns[0]["key"] == "jobs"
    assert len(rows) == 1
    options = {
        **connection_options(migrated_db),
        "user": "saiflow_v3_reporter",
        "password": "local-reporter",
    }
    for sql in (
        "select * from saiflow_v3.users",
        "select * from saiflow_v3.customer_sessions",
        "select * from saiflow_v3.data_sources",
        "select * from saiflow_v3.ocr_raw_results",
    ):
        with pytest.raises(AppError) as denied:
            await _execute(options, sql)
        assert denied.value.code == "data_source_query_failed"
    engine = create_engine(migrated_db)
    try:
        async with engine.connect() as conn:
            assert not await conn.scalar(
                text("select has_table_privilege('saiflow_v3_reporter','reporting.jobs','INSERT')")
            )
            assert not await conn.scalar(
                text(
                    "select rolsuper or rolcreatedb or rolcreaterole "
                    "or rolreplication or rolbypassrls "
                    "from pg_roles where rolname = 'saiflow_v3_reporter'"
                )
            )
    finally:
        await engine.dispose()


async def test_customer_source_password_edit_retains_encrypted_secret(api, line, db, monkeypatch):
    from app.services import data_source_service
    from app.services.data_source_security import decrypt_password
    from tests.integration.report_helpers import report_org

    async def addresses(*args, **kwargs):
        return "8.8.8.8"

    monkeypatch.setattr(data_source_service, "resolve_target", addresses)
    api.app.state.settings.data_source_key = SecretStr("12" * 32)
    org = await report_org(api, line, db)
    body = {
        "name": "ERP",
        "host": "erp.example.test",
        "database": "erp",
        "username": "reader",
        "password": "secret-original",
    }
    created = await org.owner.client.post("/api/v1/data-sources", json=body, headers=org.h)
    assert created.status_code == 201, created.text
    source_id = created.json()["id"]
    assert "secret-original" not in created.text
    changed = await org.owner.client.put(
        f"/api/v1/data-sources/{source_id}",
        json={**body, "password": "", "name": "ERP renamed"},
        headers=org.h,
    )
    assert changed.status_code == 200, changed.text
    stored = (await db.execute(text("select id, password_cipher from data_sources"))).one()
    assert stored.password_cipher != "secret-original"
    assert (
        decrypt_password(
            api.app.state.settings,
            stored.password_cipher,
            tenant_id=org.tenant_id,
            source_id=stored.id,
        )
        == "secret-original"
    )
    listing = await org.owner.client.get("/api/v1/data-sources", headers=org.h)
    assert listing.status_code == 200, listing.text
    assert stored.password_cipher not in listing.text
    assert "secret-original" not in listing.text
    deleted = await org.owner.client.delete(f"/api/v1/data-sources/{source_id}", headers=org.h)
    assert deleted.status_code == 204, deleted.text


async def test_real_builtin_catalog_exposes_only_reporting_views(migrated_db):
    from app.services.data_source_connection import system_tables

    settings = migrated_db.model_copy(update={"report_db_password": SecretStr("local-reporter")})
    items = await system_tables(settings)
    assert {(item["schema"], item["name"], item["kind"]) for item in items} == {
        ("reporting", name, "view")
        for name in ("jobs", "plans", "subscriptions", "free_quotas", "quota_reservations")
    }


async def test_real_catalog_excludes_partial_column_and_missing_schema_privileges(migrated_db):
    from uuid import uuid4

    from app.services.data_source_connection import CATALOG_SQL

    schema = "catalog_" + uuid4().hex
    engine = create_engine(migrated_db)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            for name in ("visible", "partial", "hidden"):
                await conn.execute(text(f'CREATE TABLE "{schema}".{name} (a int, b int)'))
            await conn.execute(text(f'GRANT SELECT ON "{schema}".visible TO saiflow_v3_reporter'))
            await conn.execute(
                text(f'GRANT SELECT (a) ON "{schema}".partial TO saiflow_v3_reporter')
            )
        options = {
            **connection_options(migrated_db),
            "user": "saiflow_v3_reporter",
            "password": "local-reporter",
        }
        _, rows = await _execute(options, CATALOG_SQL)
        assert not [r for r in rows if r["schema"] == schema]
        async with engine.begin() as conn:
            await conn.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO saiflow_v3_reporter'))
        _, rows = await _execute(options, CATALOG_SQL)
        assert [r for r in rows if r["schema"] == schema] == [
            {"schema": schema, "name": "visible", "kind": "table"}
        ]
        assert not [r for r in rows if r["schema"].startswith("pg_")]
    finally:
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()
