"""一次性数据迁移：Tencent CynosDB MySQL（sai-flow）→ Cloud SQL PostgreSQL（saiflow schema）。

- 源/目标连接均可环境变量覆盖：MYSQL_HOST/PORT/USER/PASSWORD/DB、PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSCHEMA；
- 目标表先 TRUNCATE ... RESTART IDENTITY CASCADE（可重复执行，幂等）；
- 按外键依赖顺序拷贝，保持原主键 ID（关联不丢）；
- JSON 列从 MySQL 字符串解析为 Python 对象后交给 psycopg 自动适配；
- TINYINT(1) 转 bool； enterprises.cert_file_id 与 files.enterprise_id 的环引用先置空、文件入库后回补；
- 最后把所有自增序列 setval 到 max(id)，避免新插入撞主键。

用法：python migrate_mysql_to_pg.py
"""
from __future__ import annotations

import json
import os
import sys

import psycopg
import pymysql
from dotenv import load_dotenv
from psycopg.types.json import Jsonb

load_dotenv()

MYSQL = {
    "host": os.getenv("MYSQL_HOST", "gz-cynosdbmysql-grp-g82l5jpt.sql.tencentcdb.com"),
    "port": int(os.getenv("MYSQL_PORT", "25349")),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", "T48m.j{]5xJ!Qp"),
    "database": os.getenv("MYSQL_DB", "sai-flow"),
}

PG = {
    "host": os.getenv("PGHOST", "34.87.95.49"),
    "port": int(os.getenv("PGPORT", "5432")),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", ""),
    "dbname": os.getenv("PGDATABASE", "postgres"),
}
PGSCHEMA = os.getenv("PGSCHEMA", "saiflow")

# 外键依赖顺序（parents first）。users/enterprises 互换即可满足 files 的两个 FK；
# enterprises.cert_file_id 指向 files 的环引用单独处理。
TABLES = [
    "users",
    "enterprises",
    "files",
    "sessions",
    "memberships",
    "applications",
    "invitations",
    "ocr_jobs",
    "result_versions",
    "page_results",
    "exports",
    "notifications",
    "audit_events",
    "data_requests",
    "review_sync_cursors",
    "quota_ledger",
]

BIGINT_PK_TABLES = [
    "users", "sessions", "enterprises", "memberships", "applications",
    "invitations", "notifications", "audit_events", "data_requests",
    "review_sync_cursors", "quota_ledger",
]

JSON_COLUMNS = {
    "applications": {"form"},
    "audit_events": {"detail"},
    "ocr_jobs": {"params", "capability", "missing_pages"},
    "page_results": {"tables", "fields"},
}
BOOL_COLUMNS = {"result_versions": {"is_current"}}


def mysql_columns(cur, table: str) -> list[str]:
    cur.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
        (MYSQL["database"], table),
    )
    return [(r[0], r[1]) for r in cur.fetchall()]


def pg_columns(pcur, table: str) -> set[str]:
    pcur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema=%s AND table_name=%s",
        (PGSCHEMA, table),
    )
    return {r[0] for r in pcur.fetchall()}


def read_table(cur, table: str) -> list[dict]:
    cur.execute(f"SELECT * FROM `{table}`")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def transform(table: str, row: dict) -> dict:
    out = dict(row)
    for col in JSON_COLUMNS.get(table, ()):
        v = out.get(col)
        if isinstance(v, str):
            out[col] = json.loads(v)
    for col in BOOL_COLUMNS.get(table, ()):
        if out.get(col) is not None:
            out[col] = bool(out[col])
    return out


def main() -> int:
    mconn = pymysql.connect(**MYSQL, connect_timeout=15, charset="utf8mb4")
    pgconn = psycopg.connect(**PG, connect_timeout=15, autocommit=False)
    try:
        with pgconn.cursor() as cur:
            cur.execute(f"SET search_path TO {PGSCHEMA}")
            cur.execute(
                f"TRUNCATE TABLE {', '.join(f'{PGSCHEMA}.{t}' for t in TABLES)} "
                "RESTART IDENTITY CASCADE"
            )

        cert_refs: list[tuple] = []  # (enterprise_id, cert_file_id)
        counts: dict[str, tuple[int, int]] = {}
        with mconn.cursor() as mcur, pgconn.cursor() as pcur:
            pcur.execute(f"SET search_path TO {PGSCHEMA}")
            for table in TABLES:
                cols_meta = mysql_columns(mcur, table)
                rows = [transform(table, r) for r in read_table(mcur, table)]

                if table == "enterprises":
                    for r in rows:
                        if r.get("cert_file_id"):
                            cert_refs.append((r["id"], r["cert_file_id"]))
                            r["cert_file_id"] = None

                if not rows:
                    counts[table] = (0, 0)
                    continue
                # 两边列名交集：MySQL 历史遗留列（如 users.username/email）不搬；
                # PG 侧多出的列（如 invitations.created_at）由默认值/数据库填充。
                valid = pg_columns(pcur, table)
                cols = [c for c, _ in cols_meta if c in valid]
                stmt = (
                    f"INSERT INTO {PGSCHEMA}.{table} ({', '.join(cols)}) "
                    f"VALUES ({', '.join(['%s'] * len(cols))})"
                )
                json_cols = JSON_COLUMNS.get(table, set())
                pcur.executemany(
                    stmt,
                    [[Jsonb(r[c]) if c in json_cols else r[c] for c in cols] for r in rows],
                )
                counts[table] = (len(rows), pcur.rowcount if pcur.rowcount != -1 else len(rows))

            for ent_id, file_id in cert_refs:
                pcur.execute(
                    f"UPDATE {PGSCHEMA}.enterprises SET cert_file_id=%s WHERE id=%s",
                    (file_id, ent_id),
                )

            for table in BIGINT_PK_TABLES:
                pcur.execute(
                    f"SELECT setval(pg_get_serial_sequence(%s, 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {PGSCHEMA}.{table}), 1))"
                , (f"{PGSCHEMA}.{table}",))
        pgconn.commit()

        print(f"{'table':<24} {'src_rows':>8} {'inserted':>8}")
        for t in TABLES:
            s, i = counts[t]
            print(f"{t:<24} {s:>8} {i:>8}")
        print(f"cert_file_id restored: {len(cert_refs)}")
        return 0
    except Exception:
        pgconn.rollback()
        raise
    finally:
        mconn.close()
        pgconn.close()


if __name__ == "__main__":
    sys.exit(main())
