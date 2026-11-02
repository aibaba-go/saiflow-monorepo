# saiflow-api

SaiFlow 后端（FastAPI）。结构见 `docs/00-standards/Python-Backend-Structure.md`。所有命令在本目录执行。

## 准备

```bash
uv sync                      # 安装依赖（Python 3.12，由 uv 管理）
```

配置只从环境变量读取（变量名见 `.env.example`），缺少必需项时拒绝启动。本地可这样加载：

```bash
cp .env.example .env         # 填入本地值；.env 不入库
set -a; source .env; set +a
```

## 运行

```bash
uv run uvicorn app.main:app --reload --port 8000
# 健康检查: GET http://localhost:8000/api/v1/health
```

## 测试与检查

```bash
uv run pytest -v             # 未设置 TEST_DB_* 时跳过需要数据库的用例
REQUIRE_INTEGRATION=1 uv run pytest -v   # CI 用：缺数据库则失败
uv run ruff check . && uv run ruff format --check .
```

## 数据库迁移

```bash
uv run alembic upgrade head  # 在 DB_SCHEMA（默认 saiflow_v3）中建表与版本表
```

## 导出接口描述

```bash
uv run python -m app.export_openapi ../../docs/30-design/openapi.json
```

通常用仓库根的 `pnpm generate:api-client`，它同时重新生成前端接口客户端。
