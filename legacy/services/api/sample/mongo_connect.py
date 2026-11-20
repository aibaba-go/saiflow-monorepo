# -*- coding: utf-8 -*-
"""连接本地 MongoDB 示例"""
from pymongo import MongoClient
from pymongo.errors import PyMongoError

# MongoDB 连接配置
MONGO_HOST = "localhost"
MONGO_PORT = 27017
MONGO_USER = "root"
MONGO_PASSWORD = "root"
MONGO_DB = "local"
# root 用户通常创建在 admin 库下，认证需指定 authSource=admin
MONGO_AUTH_SOURCE = "admin"

MONGO_URI = (
    f"mongodb://{MONGO_USER}:{MONGO_PASSWORD}"
    f"@{MONGO_HOST}:{MONGO_PORT}/{MONGO_DB}"
    f"?authSource={MONGO_AUTH_SOURCE}"
)


def get_db():
    """获取 MongoDB 数据库连接对象"""
    client = MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=5000,  # 5 秒内连不上快速失败，避免长时间阻塞
        connectTimeoutMS=5000,
    )
    # 触发一次实际连接，验证连通性与认证是否成功
    client.admin.command("ping")
    return client, client[MONGO_DB]


if __name__ == "__main__":
    try:
        client, db = get_db()
        print("MongoDB 连接成功")
        print(f"数据库: {db.name}")
        print(f"集合列表: {db.list_collection_names()}")
        client.close()
    except PyMongoError as e:
        print(f"MongoDB 连接失败: {e}")
