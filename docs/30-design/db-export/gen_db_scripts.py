"""导出 SaiFlow 数据库建表脚本 + 基础配置数据脚本（一次性工具，放在 temp/）。

用法（在 services/api 目录内执行）：
    .venv/Scripts/python.exe ../../temp/db-export/gen_db_scripts.py

- 01_schema.sql：由 models.py 离线生成（与 app.py 启动时 db.create_all() 同一来源，
  含表/列 COMMENT、索引、部分唯一索引），不连库；
- 02_base_data.sql：只读连接当前库（SET TRANSACTION READ ONLY），导出
  plans、系统模板（tenant_id IS NULL 且未删除）及其全部版本；
- 另外只读比对线上实际表/列与 models.py 的差异，打印到控制台。
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

API_DIR = Path.cwd()
sys.path.insert(0, str(API_DIR))

from flask import Flask  # noqa: E402
from sqlalchemy import create_mock_engine, text  # noqa: E402

import models  # noqa: E402,F401
from config import Config  # noqa: E402
from extensions import configure_schema, db  # noqa: E402

OUT = Path(__file__).resolve().parent
SCHEMA = Config.PGSCHEMA or "saiflow"
NOW = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------- 1) 建表脚本 ----------------

def build_schema_sql() -> str:
    stmts: list[str] = []

    def executor(sql, *_a, **_k):
        stmts.append(str(sql.compile(dialect=engine.dialect)).strip())

    engine = create_mock_engine("postgresql+psycopg://", executor)
    db.metadata.create_all(engine, checkfirst=False)

    head = [
        "-- =====================================================================",
        "-- SaiFlow 数据库建表脚本（PostgreSQL 18）",
        f"-- 生成时间：{NOW}；来源：services/api/models.py（与后端启动 db.create_all() 一致）",
        f"-- 表数量：{len(db.metadata.tables)}",
        "-- 用法：psql \"host=... dbname=postgres user=...\" -v ON_ERROR_STOP=1 -f 01_schema.sql",
        "-- 注意：仅用于空库初始化；不含 DROP，已存在的同名表会报错中止。",
        "-- =====================================================================",
        "",
        f"CREATE SCHEMA IF NOT EXISTS {SCHEMA};",
        f"SET search_path TO {SCHEMA};",
        "",
        "BEGIN;",
        "",
    ]
    body = [s + ";\n" for s in stmts]
    return "\n".join(head) + "\n".join(body) + "\nCOMMIT;\n"


# ---------------- 2) 基础配置数据 ----------------

def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, dt.datetime):
        return "'" + v.isoformat(sep=" ") + "'"
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::json"
    return "'" + str(v).replace("'", "''") + "'"


def inserts(conn, table: str, where: str = "", order: str = "id") -> tuple[list[str], int]:
    rows = conn.execute(text(f"SELECT * FROM {table} {where} ORDER BY {order}")).mappings().all()
    out = []
    for r in rows:
        cols = ", ".join(r.keys())
        vals = ", ".join(lit(v) for v in r.values())
        out.append(f"INSERT INTO {table} ({cols}) VALUES ({vals}) ON CONFLICT DO NOTHING;")
    return out, len(rows)


def build_data_sql(conn) -> tuple[str, dict]:
    tpl_where = "WHERE tenant_id IS NULL AND deleted_at IS NULL"
    plans, n_plans = inserts(conn, "plans", order="sort_order, id")
    tpls, n_tpls = inserts(conn, "document_templates", tpl_where)
    vers, n_vers = inserts(
        conn, "document_template_versions",
        f"WHERE template_id IN (SELECT id FROM document_templates {tpl_where})",
        order="template_id, version",
    )
    seq = [
        f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), "
        f"GREATEST((SELECT COALESCE(MAX(id), 0) FROM {t}), 1), "
        f"(SELECT COUNT(*) > 0 FROM {t}));"
        for t in ("plans", "document_templates", "document_template_versions")
    ]
    parts = [
        "-- =====================================================================",
        "-- SaiFlow 基础配置数据脚本",
        f"-- 生成时间：{NOW}；来源：当前库 {SCHEMA} 的只读快照",
        f"-- 内容：plans {n_plans} 行；系统模板 document_templates {n_tpls} 行；"
        f"document_template_versions {n_vers} 行",
        "-- 不含任何用户/租户/业务数据；租户自建模板不导出。",
        "-- 用法：先执行 01_schema.sql，再在后端首次启动前执行本脚本",
        "--      （后端启动时 plans 表为空会自动导入 plans_seed.json，先跑本脚本可保证与源库一致）。",
        "-- 幂等：ON CONFLICT DO NOTHING，已存在的同 id / 同 code 行保持不变。",
        "-- =====================================================================",
        "",
        f"SET search_path TO {SCHEMA};",
        "",
        "BEGIN;",
        "",
        "-- 套餐配置（FR-SYS-019）",
        *plans,
        "",
        "-- 系统文档模板（EPIC-08；current_version_id 指向下方版本 id）",
        *tpls,
        "",
        "-- 系统文档模板版本（只增不改）",
        *vers,
        "",
        "-- 自增序列对齐到已导入的最大 id",
        *seq,
        "",
        "COMMIT;",
        "",
    ]
    return "\n".join(parts), {"plans": n_plans, "templates": n_tpls, "versions": n_vers}


def schema_drift(conn) -> list[str]:
    live: dict[str, set[str]] = {}
    for t, c in conn.execute(text(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()"
    )):
        live.setdefault(t, set()).add(c)
    notes = []
    for name, table in db.metadata.tables.items():
        want = {c.name for c in table.columns}
        have = live.get(name)
        if have is None:
            notes.append(f"线上缺表：{name}")
            continue
        if want - have:
            notes.append(f"{name} 线上缺列：{sorted(want - have)}")
        if have - want:
            notes.append(f"{name} 线上多出列（models 已无）：{sorted(have - want)}")
    extra = sorted(set(live) - set(db.metadata.tables))
    if extra:
        notes.append(f"线上 schema 内非本应用模型的表：{extra}")
    return notes


def main() -> None:
    (OUT / "01_schema.sql").write_text(build_schema_sql(), encoding="utf-8")

    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    configure_schema(app)
    with app.app_context():
        with db.engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            data_sql, counts = build_data_sql(conn)
            drift = schema_drift(conn)
            conn.rollback()
    (OUT / "02_base_data.sql").write_text(data_sql, encoding="utf-8")
    print("tables:", len(db.metadata.tables), "counts:", counts)
    print("drift:", drift or "无差异")


if __name__ == "__main__":
    main()
