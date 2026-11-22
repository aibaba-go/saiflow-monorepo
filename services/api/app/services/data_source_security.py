import base64
import ipaddress
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlglot import ErrorLevel, exp, parse
from sqlglot.errors import ParseError, UnsupportedError

from app.config import Settings
from app.errors import AppError


def relation_select(schema: str, name: str) -> str:
    from psycopg.sql import Identifier

    if any(not v or "\x00" in v or len(v.encode("utf-8")) > 63 for v in (schema, name)):
        raise AppError(422, "data_source_sql_invalid", "error.data_source_sql_invalid")
    return f"SELECT * FROM {Identifier(schema, name).as_string()}"


_SAFE_NODES = frozenset(
    {
        "select",
        "union",
        "intersect",
        "except",
        "subquery",
        "with",
        "cte",
        "from",
        "join",
        "table",
        "column",
        "identifier",
        "literal",
        "alias",
        "tablealias",
        "star",
        "where",
        "group",
        "having",
        "order",
        "ordered",
        "limit",
        "offset",
        "distinct",
        "and",
        "or",
        "not",
        "between",
        "in",
        "is",
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "like",
        "ilike",
        "null",
        "boolean",
        "neg",
        "add",
        "sub",
        "mul",
        "div",
        "mod",
        "paren",
        "case",
        "datatype",
        "var",
        "tuple",
        "window",
        "windowspec",
        "filter",
        "exists",
    }
)
_SAFE_FUNCTIONS = frozenset(
    {
        "SUM",
        "AVG",
        "MIN",
        "MAX",
        "COUNT",
        "COALESCE",
        "NULLIF",
        "ABS",
        "ROUND",
        "CEIL",
        "FLOOR",
        "LOWER",
        "UPPER",
        "LENGTH",
        "CHAR_LENGTH",
        "TRIM",
        "LTRIM",
        "RTRIM",
        "SUBSTRING",
        "CONCAT",
        "CONCAT_WS",
        "REPLACE",
        "GREATEST",
        "LEAST",
        "CAST",
        "IF",
        "TIMESTAMP_TRUNC",
        "DATE_TRUNC",
        "EXTRACT",
        "CURRENT_DATE",
        "CURRENT_TIMESTAMP",
        "ROW_NUMBER",
        "RANK",
        "DENSE_RANK",
        "LAG",
        "LEAD",
        "TO_CHAR",
    }
)
_SAFE_TYPES = frozenset(
    {
        "TEXT",
        "VARCHAR",
        "CHAR",
        "INT",
        "BIGINT",
        "SMALLINT",
        "DECIMAL",
        "FLOAT",
        "DOUBLE",
        "BOOLEAN",
        "DATE",
        "TIMESTAMP",
        "TIMESTAMPTZ",
    }
)


def sql_invalid() -> AppError:
    return AppError(422, "data_source_sql_invalid", "error.data_source_sql_invalid")


def readonly_sql(sql: str) -> str:
    if not isinstance(sql, str) or not 1 <= len(sql.strip()) <= 20000 or "\x00" in sql:
        raise sql_invalid()
    try:
        statements = parse(sql, read="postgres", error_level=ErrorLevel.RAISE)
        if len(statements) != 1 or not isinstance(
            statements[0], (exp.Select, exp.Union, exp.Intersect, exp.Except)
        ):
            raise sql_invalid()
        tree = statements[0]
        for i, node in enumerate(tree.walk()):
            if i > 5000:
                raise sql_invalid()
            if isinstance(node, exp.Func):
                name = node.name.upper() if isinstance(node, exp.Anonymous) else node.sql_name()
                if name not in _SAFE_FUNCTIONS:
                    raise sql_invalid()
            elif node.key not in _SAFE_NODES:
                raise sql_invalid()
            if isinstance(node, exp.DataType) and node.this.value not in _SAFE_TYPES:
                raise sql_invalid()
            if isinstance(node, exp.With) and node.args.get("recursive"):
                raise sql_invalid()
            if isinstance(node, exp.Table):
                if not isinstance(node.this, exp.Identifier) or node.catalog:
                    raise sql_invalid()
                if node.db.lower().startswith("pg_") or node.db.lower() == "information_schema":
                    raise sql_invalid()
                if node.name.lower().startswith("pg_"):
                    raise sql_invalid()
        return tree.sql(dialect="postgres", comments=False, unsupported_level=ErrorLevel.RAISE)
    except (ParseError, UnsupportedError, RecursionError, ValueError):
        raise sql_invalid() from None


def allowed_address(
    address: ipaddress.IPv4Address | ipaddress.IPv6Address, *, explicitly_allowed: bool
) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if (
        address.is_multicast
        or address.is_unspecified
        or address.is_link_local
        or address.is_reserved
    ):
        return False
    return address.is_global or explicitly_allowed


def _cipher(settings: Settings) -> AESGCM:
    key = settings.data_source_key
    try:
        value = bytes.fromhex(key.get_secret_value()) if key else b""
        if len(value) != 32:
            raise ValueError
        return AESGCM(value)
    except ValueError:
        raise AppError(503, "data_source_unavailable", "error.data_source_unavailable") from None


def _context(tenant_id: int, source_id: int) -> bytes:
    return f"tenant:{tenant_id}/source:{source_id}".encode()


def encrypt_password(settings: Settings, password: str, *, tenant_id: int, source_id: int) -> str:
    nonce = os.urandom(12)
    cipher = _cipher(settings).encrypt(nonce, password.encode(), _context(tenant_id, source_id))
    return base64.b64encode(nonce + cipher).decode("ascii")


def decrypt_password(settings: Settings, cipher: str, *, tenant_id: int, source_id: int) -> str:
    try:
        raw = base64.b64decode(cipher, validate=True)
        return (
            _cipher(settings).decrypt(raw[:12], raw[12:], _context(tenant_id, source_id)).decode()
        )
    except (ValueError, InvalidTag, UnicodeDecodeError):
        raise AppError(503, "data_source_unavailable", "error.data_source_unavailable") from None
