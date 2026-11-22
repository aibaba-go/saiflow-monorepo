from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.dependencies import get_db, get_tenant_context
from app.main import create_app
from app.permissions import ALL
from app.services.tenant_access import TenantContext


def test_source_metadata_never_contains_cipher_or_password():
    from app.services.data_source_service import metadata

    source = SimpleNamespace(
        id=4,
        tenant_id=7,
        name="ERP",
        host="erp.example.test",
        port=5432,
        database="erp",
        username="reader",
        ssl_mode="verify-full",
        password_cipher="cipher-secret",
        enabled=True,
    )
    result = metadata(source)
    assert result["id"] == "postgres:4"
    assert result["password_configured"] is True
    assert "password" not in result and "password_cipher" not in result
    assert "cipher-secret" not in str(result)


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/data-sources/system-pg",
        "/api/v1/data-sources/system-pg/query",
        "/api/v1/data-sources/postgres:9/query",
        "/api/v1/data-sources/system-pg/tables",
        "/api/v1/data-sources/postgres:9/tables",
    ],
)
async def test_customer_cannot_use_builtin_or_foreign_source(settings, monkeypatch, path):
    from app.services import report_service

    monkeypatch.setattr(report_service, "gate", AsyncMock())
    app = create_app(settings)

    async def db():
        yield SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: None))
        )

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_tenant_context] = lambda: TenantContext(
        7, "organization", 3, True, None, ALL
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        response = await client.request(
            "POST" if path.endswith("query") else "GET",
            path,
            json={"sql": "select 1", "page": 1, "page_size": 5},
            headers={"X-Requested-With": "SaiFlow"},
        )
    assert response.status_code == 404
    suffix = "/query" if path.endswith("query") else "/tables" if path.endswith("tables") else ""
    route_path = "/api/v1/data-sources/{source_id}" + suffix
    assert route_path in app.openapi()["paths"]


async def test_source_list_requires_report_manage(settings, monkeypatch):
    from app.services import report_service

    monkeypatch.setattr(report_service, "gate", AsyncMock())
    app = create_app(settings)

    async def db():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_tenant_context] = lambda: TenantContext(
        7, "organization", 3, False, None, frozenset({"report_view"})
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        response = await client.get("/api/v1/data-sources")
    assert response.status_code == 403


async def test_source_catalog_uses_template_catalog_identity(settings, monkeypatch):
    from app.services import data_source_service as sources
    from app.services import report_service

    monkeypatch.setattr(
        report_service,
        "catalog_templates",
        AsyncMock(return_value=[{"template_id": 18, "name": "Invoice", "usable": True}]),
    )
    db = SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
        )
    )
    result = await sources.list_sources(db, 7, settings)
    assert result["items"] == [
        {
            "id": "template:18",
            "name": "Invoice",
            "kind": "template",
            "template_id": 18,
            "tenant_id": 7,
        }
    ]


async def test_platform_admin_can_list_builtin_without_tenant(settings):
    from app.dependencies import get_admin

    app = create_app(settings)
    app.dependency_overrides[get_admin] = lambda: SimpleNamespace(account=SimpleNamespace(id=2))

    async def db():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        response = await client.get("/api/v1/admin/data-sources")
    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "system-pg"
    assert "password" not in response.json()["items"][0]


async def test_denied_query_does_not_execute_database_connection(settings, monkeypatch):
    from app.errors import AppError
    from app.services import data_source_service as sources

    connection = AsyncMock(side_effect=AssertionError("must not connect"))
    monkeypatch.setattr(sources, "system_query", connection)
    with pytest.raises(AppError) as denied:
        await sources.audited_query(
            SimpleNamespace(), 7, "system-pg", settings, "select 1", 1, 5, "user", 3
        )
    assert denied.value.status == 404


@pytest.mark.parametrize("permissions", [frozenset({"report_manage"}), frozenset({"data_browse"})])
async def test_table_catalog_requires_both_permissions(settings, monkeypatch, permissions):
    from app.services import data_source_service as sources
    from app.services import report_service

    monkeypatch.setattr(report_service, "gate", AsyncMock())
    monkeypatch.setattr(
        sources, "tables", AsyncMock(side_effect=AssertionError("must not connect"))
    )
    app = create_app(settings)

    async def db():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_tenant_context] = lambda: TenantContext(
        7, "organization", 3, False, None, permissions
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        response = await client.get("/api/v1/data-sources/postgres:1/tables")
    assert response.status_code in {403, 404}


async def test_admin_builtin_catalog_preserves_schema_alias(settings, monkeypatch):
    from app.dependencies import get_admin
    from app.services import data_source_service as sources

    monkeypatch.setattr(
        sources,
        "system_tables",
        AsyncMock(return_value=[{"schema": "reporting", "name": "jobs", "kind": "view"}]),
    )
    app = create_app(settings)
    app.dependency_overrides[get_admin] = lambda: SimpleNamespace(account=SimpleNamespace(id=2))

    async def db():
        yield SimpleNamespace()

    app.dependency_overrides[get_db] = db
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        response = await client.get("/api/v1/admin/data-sources/system-pg/tables")
    assert response.status_code == 200
    assert response.json() == {"items": [{"schema": "reporting", "name": "jobs", "kind": "view"}]}


async def test_disabled_catalog_and_builtin_mutations_never_connect(settings, monkeypatch):
    from app.errors import AppError
    from app.schemas.data_source import SourceIn
    from app.services import data_source_service as sources

    monkeypatch.setattr(
        sources, "source_tables", AsyncMock(side_effect=AssertionError("must not connect"))
    )
    db = SimpleNamespace(
        execute=AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(enabled=False))
        )
    )
    with pytest.raises(AppError) as denied:
        await sources.tables(db, 7, "postgres:1", settings)
    assert denied.value.status == 503
    body = SourceIn(name="ERP", host="erp.example.test", database="erp", username="reader")
    for operation in (
        sources.save_source(db, 7, body, settings, "admin", 2, "system-pg"),
        sources.remove_source(db, 7, "system-pg", "admin", 2),
    ):
        with pytest.raises(AppError) as immutable:
            await operation
        assert immutable.value.status == 404


def test_blank_updated_password_is_not_an_empty_new_secret():
    from app.schemas.data_source import SourceIn

    body = SourceIn(
        name="ERP", host="erp.example.test", database="erp", username="reader", password=""
    )
    assert body.password.get_secret_value() == ""
    assert body.ssl_mode == "verify-full"


@pytest.mark.parametrize("value", ["disable", "require", "verify-ca"])
def test_tls_cannot_be_disabled(value):
    from pydantic import ValidationError

    from app.schemas.data_source import SourceIn

    with pytest.raises(ValidationError):
        SourceIn(
            name="ERP", host="erp.example.test", database="erp", username="reader", ssl_mode=value
        )
