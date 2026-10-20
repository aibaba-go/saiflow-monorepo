"""Flask 扩展实例（避免循环导入）。"""
from __future__ import annotations

import atexit
import logging

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event, text

db = SQLAlchemy()


def configure_schema(app: Flask) -> None:
    """PostgreSQL schema 适配：确保 PGSCHEMA 存在，每个新连接自动设置 search_path。

    本地（公网 IP）与 Cloud Run（Unix 套接字）同一代码路径；
    非 PostgreSQL 连接（如测试用 SQLite）直接跳过。
    """
    uri = str(app.config.get("SQLALCHEMY_DATABASE_URI", ""))
    if not uri.startswith("postgresql"):
        return
    schema = app.config.get("PGSCHEMA") or ""
    if not schema:
        return
    if not schema.replace("_", "").isalnum():
        raise RuntimeError(f"PGSCHEMA 非法标识符: {schema!r}")
    with app.app_context():
        engine = db.engine

        @event.listens_for(engine, "connect")
        def _set_search_path(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute(f"SET SESSION search_path TO {schema}")
            cur.close()

        # 已存在则不执行 DDL：启动只读目录，不与共享库上的其他会话争锁
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_namespace WHERE nspname = :s"), {"s": schema}
            ).scalar()
        if not exists:
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '15s'"))
                conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))


def init_textin(app: Flask) -> None:
    """装配 TextIn 配置与客户端（唯一 OCR 厂商，PRD §12）。

    凭据齐全（`app_id` + `secret_code` + `workspace_id`）才创建 client；
    否则记 WARN（明确缺哪个），OCR 任务会进入 FAILED(能力不可用)，
    其余路由不受影响。atexit 关闭行为不变。
    """
    from textin.client import TextInClient
    from textin.config import build_textin_settings

    logger = logging.getLogger(__name__)

    settings = build_textin_settings(app.config)
    app.extensions["textin_settings"] = settings

    missing = [
        name
        for name, flag in (
            ("TEXTIN_APP_ID", bool(settings.textin_app_id)),
            ("TEXTIN_SECRET_CODE", bool(settings.textin_secret_code)),
            ("TEXTIN_DOCFLOW_WORKSPACE_ID", bool(settings.textin_docflow_workspace_id)),
        )
        if not flag
    ]

    if not missing:
        client = TextInClient(settings)
        app.extensions["textin_client"] = client

        def _close_client():
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass

        atexit.register(_close_client)
    else:
        logger.warning(
            "TextIn DocFlow 凭据缺失 (%s)；OCR 任务将失败。",
            ", ".join(missing) or "未知",
        )
