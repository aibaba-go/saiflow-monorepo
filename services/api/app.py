"""Flask 主应用（PRD v1.2 /api/v1 架构）。

- 唯一匿名白名单：POST /api/v1/auth/line（middleware 强制）
- 其余 /api/v1/* 必须携带 HttpOnly 会话 Cookie + CSRF（写操作）
- 未知版本 / 旧版未版本化路径一律 404，无兼容别名
- OCR 由进程内 worker 轮询自有队列表驱动（不依赖厂商回调）

运行：python app.py  （开发；生产用 gunicorn/waitress 等 WSGI 服务器）
"""
from __future__ import annotations

import logging
import os

from flask import Flask, jsonify
from sqlalchemy import text
from werkzeug.exceptions import RequestEntityTooLarge

from config import Config
from errors import ApiError, error_response, invalid_argument
from extensions import configure_schema, db, init_textin
from middleware import register_security
from worker import start_worker


_ADD_COLUMNS = [
    ("result_versions", "structured", "JSON"),
    ("users", "phone", "VARCHAR(32) NOT NULL DEFAULT ''"),
    ("users", "email", "VARCHAR(254) NOT NULL DEFAULT ''"),
    ("users", "registered_at", "TIMESTAMP"),
    ("users", "avatar_path", "VARCHAR(255) NOT NULL DEFAULT ''"),
    ("ocr_jobs", "completed_at", "TIMESTAMP"),
    ("enterprises", "verified_at", "TIMESTAMP"),
    # 模板映射（FR-VERIFY-018）：均为可空指针列，旧行默认 NULL = 通用结果
    ("ocr_jobs", "current_mapping_id", "VARCHAR(36)"),
    ("ocr_jobs", "pending_mapping_id", "VARCHAR(36)"),
    ("result_versions", "mapping_id", "VARCHAR(36)"),
]
# 这里只补「可带默认值的新列」。租户改造的 tenant_id 是 NOT NULL 外键，
# 旧库无法靠 ADD COLUMN 补齐（没有合法默认值），必须用 setup_db.py 重建结构，
# 所以不要把归属列加进来；启动流程也不再有 workspace_type/enterprise_id 这类旧归属列。
# subscriptions / plan_reminders 是新表，由 _ensure_tables 建；已废弃的 quota_ledger
# 不在 models 里，旧库残留表不会被自动清理（重建或人工 DROP）。


def _ensure_tables() -> None:
    """只在缺表时建表：表齐全时启动只做只读的目录查询，不执行任何 DDL、不申请表锁。"""
    from sqlalchemy import inspect

    existing = set(inspect(db.engine).get_table_names())
    missing = [t for t in db.metadata.tables.values() if t.name not in existing]
    if not missing:
        return
    with db.engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            # 新表的外键会锁被引用表；拿不到锁就失败退出，而不是无限等待
            conn.execute(text("SET LOCAL lock_timeout = '15s'"))
        db.metadata.create_all(bind=conn, tables=missing)


# 旧库补建的索引：(索引名, DDL)。只在目录里不存在时执行。
_ADD_INDEXES = [
    ("ix_result_versions_mapping_id",
     "CREATE INDEX IF NOT EXISTS ix_result_versions_mapping_id ON result_versions (mapping_id)"),
]
_CURRENT_VERSION_INDEX = (
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_result_versions_job_current"
    " ON result_versions (job_id) WHERE is_current"
)


def _pending_schema_stmts(cols: dict, nullable: dict, indexes: set, duplicate_current: bool) -> list[str]:
    """根据只读目录信息算出需要执行的 DDL（纯函数，便于单测；无缺失项时返回空列表）。"""
    stmts = [
        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ddl}"
        for table, col, ddl in _ADD_COLUMNS
        if (table, col) not in cols
    ]
    if cols.get(("users", "avatar_url"), "text") != "text":
        stmts.append("ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT")
    if ("users", "registered_at") not in cols:
        # 注册信息录入上线前的既有正式账号视为已注册，避免老用户被强制补录
        stmts.append("UPDATE users SET registered_at = created_at WHERE line_provider <> 'guest'")
    # 模板维护脚本与映射 Worker 的审计没有登录用户（D4/D16）
    if nullable.get(("audit_events", "user_id")) == "NO":
        stmts.append("ALTER TABLE audit_events ALTER COLUMN user_id DROP NOT NULL")
    stmts.extend(ddl for name, ddl in _ADD_INDEXES if name not in indexes)
    # 每个任务最多一个当前版本：只有确认现存数据无重复时才补建，否则跳过（不阻断启动）
    if "uq_result_versions_job_current" not in indexes and not duplicate_current:
        stmts.append(_CURRENT_VERSION_INDEX)
    return stmts


def _patch_columns() -> None:
    # 空跑的 ALTER 也要拿 ACCESS EXCLUSIVE 锁，会被任一未结束事务挡死启动：先查缺失项，再以 lock_timeout 兜底
    with db.engine.begin() as conn:
        cols, nullable = {}, {}
        for r in conn.execute(text(
            "SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns"
            " WHERE table_schema = current_schema()"
        )):
            cols[(r[0], r[1])] = r[2]
            nullable[(r[0], r[1])] = r[3]
        indexes = {
            r[0] for r in conn.execute(text(
                "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"
            ))
        }
        duplicate_current = False
        if "uq_result_versions_job_current" not in indexes:
            duplicate_current = bool(conn.execute(text(
                "SELECT 1 FROM result_versions WHERE is_current"
                " GROUP BY job_id HAVING COUNT(*) > 1 LIMIT 1"
            )).first())
            if duplicate_current:
                logging.getLogger(__name__).warning(
                    "result_versions 存在同一任务多个当前版本，跳过 uq_result_versions_job_current"
                )
    stmts = _pending_schema_stmts(cols, nullable, indexes, duplicate_current)
    if not stmts:
        return
    with db.engine.begin() as conn:
        conn.execute(text("SET LOCAL lock_timeout = '15s'"))
        for stmt in stmts:
            conn.execute(text(stmt))


def create_app(config_overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    if config_overrides:
        app.config.update(config_overrides)
    app.json.ensure_ascii = False
    # 结果 JSON 要保留 DeepSeek 给出的分组顺序（structured 列用 JSON 而非 JSONB，库里也保序）
    app.json.sort_keys = False

    db.init_app(app)
    configure_schema(app)
    init_textin(app)

    from routes import v1_bp

    app.register_blueprint(v1_bp, url_prefix="/api/v1")

    register_security(app)

    @app.errorhandler(ApiError)
    def _handle_api_error(err: ApiError):
        return error_response(err)

    @app.errorhandler(RequestEntityTooLarge)
    def _request_too_large(_):
        return error_response(invalid_argument("files.too_large"))

    if app.config.get("STORAGE_BACKEND", "local") == "local":
        for key in ("FILE_STORAGE_DIR", "EXPORT_STORAGE_DIR", "OCR_STORAGE_DIR"):
            os.makedirs(app.config[key], exist_ok=True)

    with app.app_context():
        _ensure_tables()
        if db.engine.dialect.name == "postgresql":
            _patch_columns()
        # FR-SYS-019：套餐配置表为空时导入内置种子（已有任何行则不触碰，配置以库为准）
        import plans

        plans.seed_if_empty()

    if app.config.get("OCR_WORKER_ENABLED", True):
        start_worker(app)
        # D12：模板映射 Worker 独立线程，开关关闭时不启动（本地共享库必须保持关闭）
        if app.config.get("TEMPLATE_MAPPING_ENABLED"):
            from mapping_worker import start_mapping_worker

            start_mapping_worker(app)

    @app.get("/api/health")
    def health():
        client = app.extensions.get("textin_client")
        return jsonify(
            ok=True,
            service="saiflow-api",
            vendor="textin" if client is not None else "unconfigured",
        )

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
