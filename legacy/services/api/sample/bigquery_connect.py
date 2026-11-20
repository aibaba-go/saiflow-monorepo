# -*- coding: utf-8 -*-
"""Google BigQuery 连接与查询 Demo

认证方式：ADC（应用默认凭据），本机已通过
    gcloud auth application-default login
生成凭据，代码中无需显式提供密钥文件。

依赖：
    pip install google-cloud-bigquery
"""
from google.cloud import bigquery
from google.cloud.exceptions import GoogleCloudError

# BigQuery 配置
PROJECT_ID = "saiflow-509205"
DATASET_ID = "firestore_dw"
LOCATION = "asia-southeast1"
TABLE_ID = "users_raw_latest"
TABLE_ID_ORDERS = "users_raw_latest"
TABLE_ID_ORDERS_FLAT = "orders_flat"

# 标准表引用格式：`项目.数据集.表`
TABLE_REF = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"
TABLE_REF_ORDERS = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID_ORDERS}"
TABLE_REF_ORDERS_FLAT = f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID_ORDERS_FLAT}"


def get_client():
    """获取 BigQuery 客户端

    project 指定计费/默认项目；location 需与数据集所在区域一致
    （asia-southeast1 = 新加坡），建作业/数据集时必须匹配。
    """
    return bigquery.Client(project=PROJECT_ID, location=LOCATION)


def show_table_info(client: bigquery.Client):
    """查看表元数据与字段结构"""
    table = client.get_table(TABLE_REF)
    print(f"表: {TABLE_REF}")
    print(f"描述: {table.description or '(无)'}")
    print(f"总行数: {table.num_rows}")
    print(f"字段列表:")
    for field in table.schema:
        print(f"  - {field.name}: {field.field_type} ({field.mode})")


def query_count(client: bigquery.Client) -> int:
    """聚合查询：统计总行数"""
    sql = f"SELECT COUNT(*) AS cnt FROM `{TABLE_REF}`"
    rows = client.query(sql).result()
    return next(rows).cnt


def query_sample(client: bigquery.Client, limit: int = 10):
    """查询前 N 条数据，返回 Row 迭代器"""
    job_config = bigquery.QueryJobConfig(
        # 查询参数示例，防止 SQL 注入；实际使用时可替换为业务过滤条件
        query_parameters=[
            bigquery.ScalarQueryParameter("limit", "INT64", limit),
        ]
    )
    sql = f"""
        SELECT *
        FROM `{TABLE_REF}`
        LIMIT @limit
    """
    return client.query(sql, job_config=job_config).result()


def query_orders_changelog(client: bigquery.Client):
    """查询 orders_raw_changelog 变更日志表

    orders 是 Firestore 集合，同步到 BigQuery 后成为 CDC 变更日志表，
    业务字段被包装在 data 字段（JSON 字符串）中，例如：
        {"itemNo":"001","price":"100","stock":{"value":86}}
    这里用 JSON_EXTRACT_SCALAR + JSONPath 从 data 中提取并展开每个字段：
      $.itemNo        -> itemNo
      $.price         -> price
      $.stock.value   -> stock_value  （stock 是嵌套对象，需取 .value）
    """
    sql = f"""
        SELECT
          t.document_id,
          JSON_EXTRACT_SCALAR(t.data, '$.itemNo') AS itemNo,
          JSON_EXTRACT_SCALAR(t.data, '$.price') AS price,
          JSON_EXTRACT_SCALAR(t.data, '$.stock.value') AS stock_value,
          t.timestamp
        FROM
          `{TABLE_REF_ORDERS}` AS t
        WHERE
          t.data IS NOT NULL
        ORDER BY
          t.timestamp
    """
    return client.query(sql).result()


def query_orders_flat(client: bigquery.Client):
    """查询 orders_flat 扁平化表

    orders_flat 是由变更日志加工后的宽表，字段已类型化，可直接数值比较：
      document_id STRING / item_no STRING / price NUMERIC /
      stock INTEGER / last_event_time TIMESTAMP
    条件：价格 >= 50 且库存 > 0，按价格降序取前 100 条。
    """
    sql = f"""
        SELECT
          document_id,
          item_no,
          price,
          stock,
          last_event_time
        FROM
          `{TABLE_REF_ORDERS_FLAT}`
        WHERE
          price >= 50
          AND stock > 0
        ORDER BY
          price DESC
        LIMIT 100
    """
    return client.query(sql).result()


if __name__ == "__main__":
    try:
        client = get_client()
        print("BigQuery 客户端创建成功（使用本机 ADC 凭据）")
        print(f"项目: {PROJECT_ID} / 区域: {LOCATION}\n")

        # 1. 表元数据
        show_table_info(client)

        # 2. 统计行数
        total = query_count(client)
        print(f"\nCOUNT(*) 结果: {total}")

        # 3. 查询样例数据
        print("\n前 10 条数据:")
        result = query_sample(client, limit=10)
        columns = [field.name for field in result.schema]
        print(" | ".join(columns))
        print("-" * 80)
        for row in result:
            print(" | ".join(str(getattr(row, col)) for col in columns))

        # 4. orders 表查询：从 data JSON 字符串中展开每个字段
        print(f"\norders 表查询（从 {TABLE_ID_ORDERS} 的 data 字段提取 JSON）:")
        orders_result = query_orders_changelog(client)
        orders_columns = [field.name for field in orders_result.schema]
        print(" | ".join(orders_columns))
        print("-" * 100)
        for row in orders_result:
            print(" | ".join(str(getattr(row, col)) for col in orders_columns))

        # 5. orders_flat 扁平表查询：price >= 50 且 stock > 0，按价格降序取前 100
        print(f"\norders_flat 表查询（{TABLE_ID_ORDERS_FLAT}：price >= 50 且 stock > 0）:")
        flat_result = query_orders_flat(client)
        flat_columns = [field.name for field in flat_result.schema]
        print(" | ".join(flat_columns))
        print("-" * 100)
        for row in flat_result:
            print(" | ".join(str(getattr(row, col)) for col in flat_columns))

        client.close()
    except GoogleCloudError as e:
        print(f"BigQuery 操作失败: {type(e).__name__}: {e}")
