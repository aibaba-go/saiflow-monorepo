import asyncio
import ipaddress
import json
import socket
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.config import Settings
from app.errors import AppError
from app.services.data_source_security import allowed_address, decrypt_password, readonly_sql

MAX_ROWS = 50000
MAX_BYTES = 8 * 1024 * 1024
_QUERY_SLOTS = asyncio.Semaphore(8)
_TYPES = {
    16: "boolean",
    20: "integer",
    21: "integer",
    23: "integer",
    700: "decimal",
    701: "decimal",
    1700: "decimal",
    1082: "date",
    1114: "date",
    1184: "date",
}


def failure(code: str, status: int = 422) -> AppError:
    return AppError(status, code, f"error.{code}")


async def _addresses(host: str, port: int) -> list[str]:
    try:
        answers = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 3
        )
        return list(dict.fromkeys(a[4][0] for a in answers))
    except (OSError, TimeoutError):
        raise failure("data_source_unavailable", 503) from None


async def resolve_target(settings: Settings, source: Any) -> str:
    host = source.host.strip().lower()
    allowed = {
        h.strip().lower() for h in settings.data_source_allowed_hosts.split(",") if h.strip()
    }
    addresses = await _addresses(host, source.port)
    if not addresses or any(
        not allowed_address(ipaddress.ip_address(a), explicitly_allowed=host in allowed)
        for a in addresses
    ):
        raise failure("data_source_host_denied")
    platform_addresses = await _addresses(settings.db_host, settings.db_port)
    if host == settings.db_host.lower() or set(addresses) & set(platform_addresses):
        raise failure("data_source_host_denied")
    return addresses[0]


def value_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def result_page(columns: list[dict], rows: list[dict], *, page: int, page_size: int) -> dict:
    if len(rows) > MAX_ROWS:
        raise failure("data_source_row_limit")
    rendered = [{k: value_text(v) for k, v in row.items()} for row in rows]
    if len(json.dumps(rendered, ensure_ascii=False).encode()) > MAX_BYTES:
        raise failure("data_source_row_limit")
    start = (page - 1) * page_size
    return {
        "columns": columns,
        "rows": rendered[start : start + page_size],
        "page": page,
        "page_size": page_size,
        "total": len(rows),
    }


async def _execute(
    options: dict, sql: str, params: dict | None = None
) -> tuple[list[dict], list[dict]]:
    try:
        async with asyncio.timeout(18):
            async with _QUERY_SLOTS:
                async with await psycopg.AsyncConnection.connect(
                    **options,
                    connect_timeout=5,
                    autocommit=True,
                    row_factory=dict_row,
                    options="-c default_transaction_read_only=on -c statement_timeout=10000 "
                    "-c lock_timeout=1000 -c search_path=pg_catalog,public "
                    "-c idle_in_transaction_session_timeout=15000",
                ) as conn:
                    async with conn.transaction():
                        await conn.execute(
                            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
                        )
                        async with conn.cursor(name="saiflow_report") as cursor:
                            await cursor.execute(sql, params)
                            rows: list[dict] = []
                            size = 0
                            while True:
                                batch = await cursor.fetchmany(200)
                                if not batch:
                                    break
                                rows.extend(batch)
                                size += sum(len(str(row).encode()) for row in batch)
                                if len(rows) > MAX_ROWS or size > MAX_BYTES:
                                    raise failure("data_source_row_limit")
                            description = cursor.description or []
                            keys = [d.name for d in description]
                            if len(keys) != len(set(keys)) or len(keys) > 100:
                                raise failure("data_source_columns_invalid")
                            columns = [
                                {
                                    "key": d.name,
                                    "label": d.name,
                                    "type": _TYPES.get(d.type_code, "string"),
                                }
                                for d in description
                            ]
                            return columns, rows
    except psycopg.errors.QueryCanceled:
        raise failure("data_source_query_timeout") from None
    except TimeoutError:
        raise failure("data_source_query_timeout") from None
    except psycopg.Error:
        raise failure("data_source_query_failed", 503) from None


async def source_options(settings: Settings, source: Any) -> dict:
    address = await resolve_target(settings, source)
    password = decrypt_password(
        settings, source.password_cipher, tenant_id=source.tenant_id, source_id=source.id
    )
    return {
        "host": source.host,
        "hostaddr": address,
        "port": source.port,
        "dbname": source.database,
        "user": source.username,
        "password": password,
        "sslmode": "verify-full",
        "sslrootcert": "system",
    }


CATALOG_SQL = """
SELECT n.nspname AS schema, c.relname AS name,
       CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END AS kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'
  AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  AND pg_catalog.has_table_privilege(c.oid, 'SELECT')
"""


async def source_tables(settings: Settings, source: Any) -> list[dict]:
    _, rows = await _execute(
        await source_options(settings, source), CATALOG_SQL + " ORDER BY n.nspname, c.relname"
    )
    return rows


async def system_tables(settings: Settings) -> list[dict]:
    return await system_report_rows(
        settings,
        CATALOG_SQL + " AND n.nspname = 'reporting' AND c.relname = ANY(%(names)s)"
        " ORDER BY c.relname",
        {"names": ["jobs", "plans", "subscriptions", "free_quotas", "quota_reservations"]},
    )


async def source_rows(settings: Settings, source: Any, sql: str) -> tuple[list[dict], list[dict]]:
    clean = readonly_sql(sql)
    return await _execute(await source_options(settings, source), clean)


async def system_report_rows(settings: Settings, sql: str, params: dict) -> list[dict]:
    if not settings.report_db_password or settings.report_db_user != "saiflow_v3_reporter":
        raise failure("data_source_unavailable", 503)
    _, rows = await _execute(
        {
            "host": settings.db_host,
            "port": settings.db_port,
            "dbname": settings.db_name,
            "user": settings.report_db_user,
            "password": settings.report_db_password.get_secret_value(),
            "sslmode": "disable",
        },
        sql,
        params,
    )
    return rows


async def system_query(settings: Settings, sql: str) -> tuple[list[dict], list[dict]]:
    clean = readonly_sql(sql)
    from sqlglot import exp, parse_one

    tree = parse_one(clean, read="postgres")
    ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
    allowed = {"jobs", "plans", "subscriptions", "free_quotas", "quota_reservations"}
    for table in tree.find_all(exp.Table):
        if not table.db and table.name.lower() in ctes:
            continue
        if table.db.lower() != "reporting" or table.name.lower() not in allowed:
            raise failure("data_source_sql_invalid")
    if not settings.report_db_password or settings.report_db_user != "saiflow_v3_reporter":
        raise failure("data_source_unavailable", 503)
    return await _execute(
        {
            "host": settings.db_host,
            "port": settings.db_port,
            "dbname": settings.db_name,
            "user": settings.report_db_user,
            "password": settings.report_db_password.get_secret_value(),
            "sslmode": "disable",
        },
        clean,
    )
