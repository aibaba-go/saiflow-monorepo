"""干净重建 PostgreSQL 中的业务表（开发/重建用，PRD §13）。

- 连接参数与 Flask 完全一致：PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSCHEMA/PGSSLMODE
  （TCP 直连按 PGSSLMODE，默认 prefer；PGHOST 为 /cloudsql/... 时走 Unix 套接字）；
- 只重建 models.py 声明的本应用表（DROP TABLE ... CASCADE），
  不碰同 schema 下不属于本应用的对象（如演示表 saiflow."user"）；
- 表结构以 models.py 为准（与 app.py 启动时的 db.create_all() 一致）。

警告：会删除 PGSCHEMA 下本应用全部业务表（users/sessions/ocr_jobs/...），不可恢复！
"""
from flask import Flask

from sqlalchemy import inspect

from config import Config
from extensions import configure_schema, db


def main() -> None:
    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    configure_schema(app)
    with app.app_context():
        db.drop_all()
        db.create_all()
        schema = app.config.get("PGSCHEMA")
        names = inspect(db.engine).get_table_names(schema=schema)
        print(f"schema `{schema}` 现有表: {sorted(names)}")


if __name__ == "__main__":
    main()
