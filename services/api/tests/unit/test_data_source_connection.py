import socket
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.errors import AppError


async def test_resolver_rejects_mixed_safe_and_unsafe_answers(settings, monkeypatch):
    from app.services.data_source_connection import resolve_target

    async def answers(*args, **kw):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 5432)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 5432)),
        ]

    import asyncio

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", answers)
    source = SimpleNamespace(host="erp.example.test", port=5432, database="erp")
    with pytest.raises(AppError) as exc:
        await resolve_target(settings, source)
    assert exc.value.code == "data_source_host_denied"


@pytest.mark.parametrize("database", [None, "another_database"])
async def test_source_cannot_target_platform_database(settings, monkeypatch, database):
    import asyncio

    from app.services.data_source_connection import resolve_target

    async def answers(*args, **kw):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.9", 5432))]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", answers)
    settings = settings.model_copy(update={"data_source_allowed_hosts": "erp.example.test"})
    source = SimpleNamespace(
        host="erp.example.test", port=5432, database=database or settings.db_name
    )
    with pytest.raises(AppError) as exc:
        await resolve_target(settings, source)
    assert exc.value.code == "data_source_host_denied"


def test_result_page_preserves_decimal_null_and_duplicates():
    from app.services.data_source_connection import result_page

    columns = [{"key": "amount", "label": "amount", "type": "decimal"}]
    rows = [{"amount": Decimal("12.00")} for _ in range(11)] + [{"amount": None}]
    first = result_page(columns, rows, page=1, page_size=5)
    second = result_page(columns, rows, page=2, page_size=5)
    third = result_page(columns, rows, page=3, page_size=5)
    assert [len(x["rows"]) for x in (first, second, third)] == [5, 5, 2]
    assert third["rows"] == [{"amount": "12.00"}, {"amount": None}]
    assert all(x["total"] == 12 for x in (first, second, third))


def test_too_many_result_rows_are_rejected_not_truncated():
    from app.services.data_source_connection import result_page

    with pytest.raises(AppError) as exc:
        result_page([], [{}] * 50001, page=1, page_size=5)
    assert exc.value.code == "data_source_row_limit"


async def test_external_catalog_preserves_pinned_tls_and_returns_relations(settings, monkeypatch):
    from unittest.mock import AsyncMock

    from app.services import data_source_connection as connection

    source = SimpleNamespace(
        host="erp.test",
        port=5432,
        database="erp",
        username="reader",
        password_cipher="cipher",
        tenant_id=7,
        id=3,
    )
    monkeypatch.setattr(connection, "resolve_target", AsyncMock(return_value="8.8.8.8"))
    monkeypatch.setattr(connection, "decrypt_password", lambda *a, **kw: "secret")
    execute = AsyncMock(return_value=([], [{"schema": "sales", "name": "Orders", "kind": "table"}]))
    monkeypatch.setattr(connection, "_execute", execute)
    assert await connection.source_tables(settings, source) == [
        {"schema": "sales", "name": "Orders", "kind": "table"}
    ]
    options, sql = execute.call_args.args
    assert options["hostaddr"] == "8.8.8.8"
    assert options["sslmode"] == "verify-full"
    assert options["sslrootcert"] == "system"
    assert "has_table_privilege" in sql and "has_schema_privilege" in sql


def test_relation_select_quotes_identifiers():
    from app.services.data_source_security import relation_select

    assert relation_select('Sales"East', "Order; DROP TABLE users") == (
        'SELECT * FROM "Sales""East"."Order; DROP TABLE users"'
    )
