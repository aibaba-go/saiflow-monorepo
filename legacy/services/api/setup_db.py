"""干净重建 PostgreSQL 中的业务表（开发/重建用，PRD §13）。

- 连接参数与 Flask 完全一致：PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSCHEMA/PGSSLMODE
  （TCP 直连按 PGSSLMODE，默认 require；PGHOST 为 /cloudsql/... 时走 Unix 套接字）；
- 只重建 models.py 声明的本应用表（DROP TABLE ... CASCADE），
  不碰同 schema 下不属于本应用的对象（如演示表 saiflow."user"）；
- 表结构以 models.py 为准（与 app.py 启动时的 db.create_all() 一致）；
- 额外清理已废弃的历史表（LEGACY_TABLES）：它们不再出现在 models.py 里，
  db.drop_all() 不会处理，残留会让后续排查误以为仍在使用。

警告：会删除 PGSCHEMA 下本应用全部业务表（users/sessions/ocr_jobs/...），不可恢复！
"""
from flask import Flask

from sqlalchemy import inspect, text

import models  # noqa: F401  注册全部表到 db.metadata，否则 drop_all/create_all 为空操作
from config import Config
from extensions import configure_schema, db

# 已从 models.py 移除的历史表（订阅制改造前的免费任务/页数流水）
LEGACY_TABLES = ("quota_ledger",)


def main() -> None:
    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    configure_schema(app)
    with app.app_context():
        db.drop_all()
        schema = app.config.get("PGSCHEMA")
        prefix = f"{schema}." if schema else ""
        with db.engine.begin() as conn:
            for table in LEGACY_TABLES:
                conn.execute(text(f"DROP TABLE IF EXISTS {prefix}{table} CASCADE"))
        db.create_all()
        names = inspect(db.engine).get_table_names(schema=schema)
        print(f"schema `{schema}` 现有表: {sorted(names)}")


if __name__ == "__main__":
    main()
