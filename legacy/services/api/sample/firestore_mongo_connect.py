# -*- coding: utf-8 -*-
"""连接 Firestore（MongoDB 兼容接口）示例

主机名 *.firestore.goog 为 Google Firestore 提供的 MongoDB 兼容端点，
可直接使用 pymongo 按标准 MongoDB 协议连接。
连接串中已包含全部必要参数，无需额外指定 authSource（默认在业务库 fb-saiflow 上认证）。
"""
from urllib.parse import quote_plus

from pymongo import MongoClient
from pymongo.errors import PyMongoError

# 连接配置（来自 Firestore MongoDB 兼容接口提供的连接串）
MONGO_HOST = "b03d8326-922f-445c-bd0e-98551c2b5ac3.asia-southeast1.firestore.goog"
MONGO_PORT = 443
MONGO_USER = "root"
MONGO_PASSWORD = "_QSgzb9P7hxAy9vrQFzUyNvmmSWYiMf8SUgDnSvd3OhCDUcr"
MONGO_DB = "fb-saiflow"

# quote_plus 可避免密码中出现特殊字符导致 URI 解析错误
MONGO_URI = (
    f"mongodb://{quote_plus(MONGO_USER)}:{quote_plus(MONGO_PASSWORD)}"
    f"@{MONGO_HOST}:{MONGO_PORT}/{MONGO_DB}"
    "?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false"
)


def get_db():
    """获取 Firestore(MongoDB 兼容) 数据库连接对象

    注意：loadBalanced=true 时不能设置 directConnection；
    云端 TLS 端点需要设置较短的服务器选择超时，网络异常时快速失败。
    """
    client = MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=10000,
        connectTimeoutMS=10000,
    )
    # 触发实际连接，验证网络、TLS 与 SCRAM 认证
    client.admin.command("ping")
    return client, client[MONGO_DB]


def query_orders(db):
    """查询 orders 集合示例

    对应 BigQuery 中 orders_raw_changelog 表的 JSON_EXTRACT_SCALAR 查询。
    注意差异：
    - BigQuery 的 orders_raw_changelog 是 CDC 变更日志表，data 字段是 JSON 字符串，
      需用 JSON_EXTRACT_SCALAR(t.data, '$.itemNo') 等提取
    - Firestore MongoDB 兼容接口的 orders 是原生文档集合，字段直接平铺在文档上
      （itemNo/price/stock 等），不存在 data 包装字段，按 key 直接取值即可
    """
    # find(过滤条件, 投射字段)；sort 按 _id 排序（_id 前 8 位含时间戳，可代表写入顺序）
    cursor = db["orders"].find(
        {},                                   # 不过滤，等价于 SQL 的 WHERE data IS NOT NULL（原生文档无空 data 概念）
        {"_id": 1, "itemNo": 1, "price": 1, "stock": 1},  # 只取需要的字段，等价于 SELECT 列
    ).sort("_id", 1)                          # 等价于 ORDER BY timestamp（用 _id 近似时间序）

    print("orders 集合查询结果（data 已按原生字段展开）:")
    print("document_id | itemNo | price | stock")
    print("-" * 60)
    for doc in cursor:
        document_id = str(doc.get("_id"))     # 等价于 SQL 的 t.document_id
        item_no = doc.get("itemNo")
        price = doc.get("price")
        stock = doc.get("stock")
        print(f"{document_id} | {item_no} | {price} | {stock}")


if __name__ == "__main__":
    try:
        client, db = get_db()
        print("Firestore(MongoDB 兼容接口) 连接成功")
        print(f"数据库: {db.name}")
        print(f"集合列表: {db.list_collection_names()}\n")

        # orders 表查询示例
        query_orders(db)

        client.close()
    except PyMongoError as e:
        print(f"连接失败: {type(e).__name__}: {e}")
