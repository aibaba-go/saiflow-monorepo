---
doc_id: STD-005
title: "SaiFlow Python 后端 — 目录结构"
type: standard
status: active
version: 1.2.0
updated: 2026-11-15
owner: Product Engineering
doc_source: manual
---

# SaiFlow Python 后端 — 目录结构

本标准定义 **SaiFlow monorepo 中 Python/FastAPI 后端**（`services/api/`）的目录结构、分层职责与强制约定。所有后端代码修改必须遵循本标准，以保证异步安全、可测试性、数据边界与部署一致性。

---

## 1. 推荐目录树

```text
services/api/
├── pyproject.toml              # 依赖、构建、Ruff、pytest、Alembic 配置
├── Dockerfile                  # 后端容器镜像（VPS 上由 Docker Compose 运行）
├── README.md                   # 服务级说明：运行、测试、迁移
├── .env.example                # 环境变量示例（不含真实密钥）
├── alembic/
│   ├── env.py                  # Alembic 运行环境
│   ├── README
│   └── versions/               # 迁移版本；禁止修改已合并版本
├── app/                        # 后端应用包
│   ├── main.py                 # FastAPI 入口：只注册路由、中间件、异常处理
│   ├── config.py               # Pydantic-settings，只读环境变量
│   ├── dependencies.py         # 全局依赖：DB session、当前用户、RBAC、外部 client
│   ├── routers/                # HTTP 路由层（按领域拆分）
│   │   ├── __init__.py
│   │   ├── documents.py
│   │   ├── users.py
│   │   ├── auth.py
│   │   └── ...
│   ├── schemas/                # Pydantic 请求/响应/DTO 模型
│   │   ├── __init__.py
│   │   ├── document.py
│   │   ├── user.py
│   │   └── common.py
│   ├── services/               # 业务编排层
│   │   ├── __init__.py
│   │   ├── document_service.py
│   │   ├── ocr_service.py
│   │   └── user_service.py
│   ├── repositories/           # 数据访问层（SQLAlchemy async CRUD）
│   │   ├── __init__.py
│   │   ├── document_repo.py
│   │   └── user_repo.py
│   ├── models/                 # SQLAlchemy ORM 模型
│   │   ├── __init__.py
│   │   ├── document.py
│   │   ├── user.py
│   │   └── base.py             # declarative_base / 公共 mixin
│   └── integrations/           # 外部服务适配器
│       ├── __init__.py
│       ├── gcs.py              # Google Cloud Storage（含签名 URL）
│       ├── textin.py           # TextIn OCR 服务端调用
│       └── docai.py            # Google Document AI OCR 服务端调用
├── tests/
│   ├── conftest.py             # pytest fixture：async client、测试 DB
│   ├── unit/
│   └── integration/
└── temp/                       # 临时产物；不得提交
```

---

## 2. 分层职责

| 层 | 位置 | 职责 | 禁止做的事 |
|----|------|------|-----------|
| **入口** | `app/main.py` | 组装 FastAPI 实例、注册 router、挂载中间件与全局异常处理 | 写业务逻辑、写 SQL |
| **配置** | `app/config.py` | Pydantic-settings 统一管理环境变量（凭据由服务器环境变量文件注入） | 含真实密钥、在源码中默认值 |
| **依赖** | `app/dependencies.py` | 全局可注入依赖：DB session、当前用户、RBAC、GCS client | 写具体业务逻辑 |
| **路由** | `app/routers/` | 接收请求、校验入参、调用 service、返回响应 | 直接写 SQL、直接调外部服务、写事务 |
| **Schema** | `app/schemas/` | Pydantic 模型：request / response / 领域 DTO | 引入 ORM 模型、写业务规则 |
| **业务** | `app/services/` | 编排用例、调用 repository 与 integrations、控制事务边界 | 依赖 HTTP 细节、直接依赖路由 |
| **数据访问** | `app/repositories/` | SQLAlchemy async CRUD、查询封装、分页 | 写业务规则、跨事务 |
| **ORM** | `app/models/` | 表结构、关系、索引、生命周期钩子 | 混入 Pydantic schema、写查询逻辑 |
| **外部集成** | `app/integrations/` | GCS / TextIn / Google Document AI 的隔离适配器 | 被 router 直接导入（统一经 service） |
| **测试** | `tests/` | unit + integration；API 测试用 FastAPI TestClient 或 httpx | 连生产数据库、含真实密钥 |

---

## 3. 强制约定

1. **异步优先**
   - 路由、service、repository 全部使用 `async/await`。
   - 数据库驱动使用 `asyncpg`，SQLAlchemy 使用 2.x async session。
   - 数据库只在 Docker 内部网络可达，禁止对公网开放数据库端口（ADR-008）。

2. **依赖注入**
   - DB session、当前用户、外部服务 client 通过 `app/dependencies.py` 注入。
   - 测试时可在 `tests/conftest.py` 中 override 这些依赖，替换为内存/模拟实现。

3. **配置与密钥**
   - 所有配置集中在 `app/config.py`，使用 `pydantic-settings`。
   - 真实密钥（TextIn、DB 凭据、GCP 服务账号等）只通过服务器上的环境变量文件在运行时注入（ADR-008）。
   - `.env.example` 只列 key 名，**不得**提交含真实值的 `.env`。

4. **数据库迁移**
   - 模型变更必须生成新的 Alembic 迁移：`alembic revision --autogenerate -m "describe change"`。
   - **禁止**修改已合并到主干的 `alembic/versions/` 迁移文件；新变更必须新增版本。

5. **临时文件隔离**
   - 所有临时产物（上传缓存、解析中间文件、调试输出、一次性脚本）必须放在 `services/api/temp/`。
   - `temp/` 已加入 `.gitignore` 与 `.claudeignore`，禁止提交。

6. **生产入口**
   - 容器启动命令：`uvicorn app.main:app --host 0.0.0.0 --port ${PORT}`。
   - 禁止创建 `run.py` 或其他自定义生产入口。

7. **数据边界**
   - 浏览器不得获得 GCS、数据库、OCR 或大模型凭据；对象下载只用后端签发的有时效签名 URL。
   - 所有外部服务访问必须由后端通过最小权限服务账号完成，符合 PDPA 与 `NFR-SEC-*`。

8. **可追溯性**
   - 每项代码修改至少映射到一个 `FR-*` 或 `NFR-*`。
   - 编码前必须先阅读对应 `AC-*` 验收标准。

---

## 4. 与 monorepo 的关系

- `services/api/` 是**独立 Python 工具链**，不在 `pnpm-workspace.yaml` 的 glob（`apps/*`、`packages/*`）内。
- 所有 Python 命令（`uvicorn`、`pytest`、`ruff`、`alembic`）一律在 `services/api/` 内执行。
- 前端共享库 `packages/api-client/` 由后端 OpenAPI 生成，**禁止手写第二份 API 契约**。
- 需求、设计、验收标准分别位于 `docs/20-requirements/`、`docs/30-design/`、`docs/40-acceptance/`。

---

## 5. 命名约定

- 目录：小写、kebab-case（`document-service`、`textin`）。
- Python 模块：小写、下划线（`document_repo.py`、`ocr_service.py`）。
- 类名：PascalCase；函数/变量：snake_case。
- 路由文件按领域命名，如 `documents.py`、`users.py`。

---

## Version History

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.0 | 2026-11-15 | Product Engineering | `docai-backup-engine`：Vision 适配器示例改为 Document AI |
| 1.1.0 | 2026-11-02 | Product Engineering | 按 ADR-008：去掉 Firestore 与 Secret Manager 适配器，新增 Vision 适配器；数据库只在内部网络可达；凭据来自服务器环境变量文件；容器启动命令不再限定 Cloud Run |
| 1.0.0 | 2026-10-12 | Product Engineering | 初始 SaiFlow Python 后端目录结构标准 |
