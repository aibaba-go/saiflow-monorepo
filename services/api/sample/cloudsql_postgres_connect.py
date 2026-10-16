# -*- coding: utf-8 -*-
"""Cloud SQL for PostgreSQL 连接与查询 Demo

实例信息（gcloud sql instances describe saiflow-dev 探测得到）：
  实例连接名 : saiflow-509205:asia-southeast1:saiflow-dev
  公网 IP    : 34.87.95.49
  版本       : PostgreSQL 18.6
  认证方式   : 数据库原生账号密码 + SSL（pg_hba 要求加密连接）
  数据库     : postgres（实例内目前仅有 cloudsqladmin/postgres 两个库）
  模式 Schema: saiflow（注意不是 sailflow）
  表         : saiflow.user（user 是 PostgreSQL 保留字，SQL 中必须加双引号）

连接方式说明（二选一）：
  1. 公网 IP 直连（本 demo 采用，已实测）：本机公网 IP 需加入实例"授权网络"，
     且 sslmode 必须为 require 及以上，否则报 pg_hba.conf rejects ... no encryption。
  2. Cloud SQL Auth Proxy（生产推荐，无需授权 IP）：
     ./cloud-sql-proxy saiflow-509205:asia-southeast1:saiflow-dev
     然后 host=127.0.0.1, port=5432, sslmode=disable（代理本地回环免 SSL）。

依赖：
    pip install psycopg2-binary
"""
import os

import psycopg2
from psycopg2 import OperationalError

# Cloud SQL Postgres 连接配置
PG_HOST = "34.87.95.49"
PG_PORT = 5432
PG_DATABASE = "postgres"
PG_USER = "postgres"
# 密码建议通过环境变量 PG_PASSWORD 注入，避免硬编码入库
PG_PASSWORD = os.getenv("PG_PASSWORD", "TQYIntelligenct@2026")
PG_SSLMODE = "require"  # 公网直连必须；若走 Cloud SQL Auth Proxy 可改为 disable

PG_SCHEMA = "saiflow"
PG_TABLE = "user"  # 保留字，拼 SQL 时必须带双引号：saiflow."user"


def get_connection():
    """建立数据库连接"""
    conn = psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD,
        sslmode=PG_SSLMODE,
        connect_timeout=10,
    )
    return conn


def show_table_info(cur):
    """查看 saiflow.user 表结构与总行数"""
    cur.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        (PG_SCHEMA, PG_TABLE),
    )
    print(f"表: {PG_SCHEMA}.{PG_TABLE}")
    print("字段列表:")
    for name, data_type in cur.fetchall():
        print(f"  - {name}: {data_type}")

    cur.execute(f'SELECT count(*) FROM {PG_SCHEMA}."{PG_TABLE}"')
    print(f"总行数: {cur.fetchone()[0]}")


def query_users(cur, min_age: int = 0, limit: int = 100):
    """查询用户数据（参数化查询，防止 SQL 注入）

    注意：表名 "user" 是保留字，必须双引号包裹；
    表名不能通过 %s 参数绑定（标识符不能用值参数），故仅在代码常量中拼接。
    """
    sql = f"""
        SELECT pid, name, age
        FROM {PG_SCHEMA}."{PG_TABLE}"
        WHERE age >= %s
        ORDER BY age ASC
        LIMIT %s
    """
    cur.execute(sql, (min_age, limit))
    columns = [desc[0] for desc in cur.description]
    return columns, cur.fetchall()


if __name__ == "__main__":
    conn = None
    try:
        conn = get_connection()
        print("Cloud SQL PostgreSQL 连接成功")
        print(f"实例: saiflow-dev ({PG_HOST}) / 库: {PG_DATABASE}\n")

        with conn.cursor() as cur:
            # 1. 表结构与行数
            show_table_info(cur)

            # 2. 查询全部用户（age >= 0）
            print("\n用户列表（按 age 升序）:")
            columns, rows = query_users(cur, min_age=0, limit=100)
            print(" | ".join(columns))
            print("-" * 60)
            for row in rows:
                print(" | ".join(str(v) for v in row))
    except OperationalError as e:
        print(f"连接失败: {e}")
        print("排查：1) 本机公网 IP 是否加入授权网络；2) sslmode 是否为 require；3) 账号密码是否正确")
    finally:
        if conn is not None:
            conn.close()
