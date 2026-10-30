# rebuild-skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可测试、可构建、可手动部署的空骨架：FastAPI 后端（健康检查、统一错误、配置加载）、三个只显示后端状态的前端空壳、生成的接口客户端、CI 与手动部署。

**Architecture:** 一个 FastAPI 服务（`services/api`）连接 Cloud SQL 的 `saiflow_v3` schema；三个 Vite + React 前端（`apps/line-mini`、`apps/web-pc`、`apps/web-admin`）以同源 `/api` 路径访问后端，由各自 nginx 容器反向代理到后端，因此前端镜像不含后端地址、后端无需 CORS。接口客户端由后端导出的 OpenAPI 生成；GitHub Actions 负责 CI 与手动部署，部署调用 `scripts/deploy.sh`。

**Tech Stack:** Python 3.12、uv、FastAPI、pydantic-settings、SQLAlchemy 2 async + asyncpg、Alembic、pytest、ruff；Node 24、pnpm、Vite、React 18.3、TypeScript、Ant Design 5、Ant Design Mobile 5、TanStack Query、Vitest + React Testing Library、ESLint、openapi-typescript + openapi-fetch；nginx；GitHub Actions、Artifact Registry、Cloud Run（服务与 Job）、Secret Manager、Workload Identity Federation。

**Spec:** `openspec/changes/rebuild-skeleton/specs/platform-baseline/spec.md`（FR-PLAT-001..005），范围与决定见同目录 `proposal.md`（D1–D5）。

## Global Constraints

- 只在当前分支 `chore/ai-workflow-v2` 上提交（负责人决定，不建 worktree、不改其他分支）；**推送前必须得到负责人确认**（Task 10）。提交信息以 `[rebuild-skeleton]` 开头。
- `legacy/` 只读：不修改、不引用、不复制代码。
- Python 命令只在 `services/api/` 内执行；`services/` 不加入 pnpm workspace。
- 依赖版本：实施时取各库当前稳定版并锁定（`uv.lock`、`pnpm-lock.yaml`）；Python `requires-python = ">=3.12,<3.13"`；React 固定 18.3.x（与 Ant Design 5、Ant Design Mobile 5 兼容）。
- 服务与镜像名（D1）：`saiflow-be-api`、`saiflow-fe-web-pc`、`saiflow-fe-web-admin`、`saiflow-fe-line-mini`；迁移 Job：`saiflow-be-api-migrate`。schema（D2）：`saiflow_v3`。区域（D3）：`asia-southeast1`。
- 接口路径前缀 `/api/v1`；健康检查为 `GET /api/v1/health`（不用 `/healthz`：Cloud Run 保留以 `z` 结尾的路径）。
- 后端配置环境变量名：`DB_HOST`、`DB_PORT`（默认 5432）、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、`DB_SCHEMA`（默认 `saiflow_v3`）、`APP_VERSION`（默认 `dev`）。凭据（`DB_PASSWORD`）无默认值。
- 错误码与消息键固定为：`not_found`/`error.not_found`、`method_not_allowed`/`error.method_not_allowed`、`validation_error`/`error.validation`、`internal_error`/`error.internal`；其他 HTTP 错误为 `http_<status>`/`error.http`。
- 健康检查数据库探测超时 3 秒（满足 spec 的 5 秒上限）。
- 对外 API 契约唯一来源为 `docs/30-design/openapi.json`（`Directory-Structure.md` 规则 5），由后端导出覆盖旧 v1 契约（旧版保留在 tag `legacy-v1`）；`docs/30-design/API-Spec.md` 改为指向它的说明页。
- 人读的部署说明放 `docs/deployment/`，脚本放 `scripts/`（`Directory-Structure.md` 规则 10）。
- 本机没有 Docker、gcloud 与 PostgreSQL：集成测试在本机缺少 `TEST_DB_HOST` 时跳过，CI 中设 `REQUIRE_INTEGRATION=1` 使其必须运行；镜像构建与部署只在 GitHub Actions 中验证。

## Review Focus

1. 必需配置缺失时，pydantic 的校验错误默认会把全部输入值（含 `DB_PASSWORD`）打印出来；启动错误必须只列配置名 → Task 1 `test_missing_config_error_does_not_leak_values`。
2. 数据库接受 TCP 连接但从不响应（而不是直接拒绝）时，健康检查仍须在 5 秒内返回 503 → Task 3 `test_health_db_hangs_returns_503_within_5s`。
3. asyncpg 的错误文本含主机与用户名，可能经健康检查或 500 错误体泄露 → Task 3 `test_health_db_error_hides_connection_details`。
4. nginx 在后端不可达时返回 502 HTML（不是 JSON），前端不得崩溃或显示为正常 → Task 4 `getBackendHealth returns unreachable for non-JSON 502`。
5. 对 CI 仍在运行（尚无结论）的提交手动触发部署，必须被拒绝 → Task 8 `require-ci-success` 用例 `in_progress`。

---

### Task 1: 后端工程与配置加载（FR-PLAT-003）

**Files:**
- Create: `services/api/pyproject.toml`、`services/api/uv.lock`、`services/api/.python-version`（`3.12`）、`services/api/.env.example`、`services/api/README.md`、`services/api/app/__init__.py`、`services/api/app/config.py`
- Test: `services/api/tests/__init__.py`、`services/api/tests/unit/test_config.py`
- Modify: `.gitignore`（加入 `services/api/temp/`）

**Interfaces:**
- Produces: `class Settings(BaseSettings)`（字段 `db_host: str`、`db_port: int = 5432`、`db_name: str`、`db_user: str`、`db_password: SecretStr`、`db_schema: str = "saiflow_v3"`、`app_version: str = "dev"`；读取同名大写环境变量，不读 `.env` 文件以外的来源）；`class ConfigError(RuntimeError)`；`def load_settings() -> Settings`（缺失时抛 `ConfigError("missing configuration: DB_HOST, DB_PASSWORD")`，名称按字段顺序、大写、逗号分隔，`from None` 截断原始校验错误）。

- [ ] **Step 1: 安装工具并建工程**：`py -m pip install uv`；在 `services/api/` 执行 `uv init --app`（随后按上面文件清单整理）、`uv add fastapi "uvicorn[standard]" pydantic-settings "sqlalchemy[asyncio]" asyncpg alembic`、`uv add --dev pytest pytest-asyncio httpx ruff`。`pyproject.toml` 中配置 ruff（`line-length = 100`，规则 `E,F,I,UP,B`）与 pytest（`asyncio_mode = "auto"`，`testpaths = ["tests"]`，marker `integration`）。

- [ ] **Step 2: 写失败测试** `tests/unit/test_config.py`：

```python
def test_missing_config_lists_names(monkeypatch):
    for k in ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("DB_HOST", "h"); monkeypatch.setenv("DB_NAME", "n"); monkeypatch.setenv("DB_USER", "u")
    with pytest.raises(ConfigError) as e:
        load_settings()
    assert str(e.value) == "missing configuration: DB_PASSWORD"

def test_missing_config_error_does_not_leak_values(monkeypatch):
    monkeypatch.setenv("DB_PASSWORD", "s3cret-value"); monkeypatch.setenv("DB_NAME", "n"); monkeypatch.setenv("DB_USER", "u")
    monkeypatch.delenv("DB_HOST", raising=False)
    with pytest.raises(ConfigError) as e:
        load_settings()
    assert "s3cret-value" not in str(e.value) and e.value.__cause__ is None and e.value.__suppress_context__

def test_complete_config_loads(monkeypatch): ...  # 四个必需值齐全 → db_schema == "saiflow_v3", app_version == "dev", db_password.get_secret_value() == 设定值
```

- [ ] **Step 3: 运行** `uv run pytest tests/unit/test_config.py -v` → Expected: FAIL（`ImportError: cannot import name 'ConfigError'`）。
- [ ] **Step 4: 实现** `app/config.py`。`.env.example` 只列变量名（含注释“Cloud Run 中 DB_HOST 为 /cloudsql/<连接名>”）；README 写本地运行、测试、迁移命令。
- [ ] **Step 5: 运行** `uv run pytest tests/unit -v` 与 `uv run ruff check . && uv run ruff format --check .` → Expected: 全部 PASS，ruff 无输出错误。
- [ ] **Step 6: 提交** `[rebuild-skeleton] backend project and config loading (FR-PLAT-003)`。

### Task 2: 应用工厂、请求 ID、日志与统一错误响应（FR-PLAT-002）

**Files:**
- Create: `app/main.py`、`app/request_context.py`、`app/logging_setup.py`、`app/errors.py`、`app/schemas/__init__.py`、`app/schemas/common.py`
- Test: `tests/conftest.py`、`tests/unit/test_errors.py`

**Interfaces:**
- Consumes: `Settings`、`load_settings`（Task 1）。
- Produces:
  - `def create_app(settings: Settings | None = None) -> FastAPI`（`None` 时调用 `load_settings()`；`app.state.settings` 保存配置）；模块级 `app = create_app()` 只在 `app/main.py` 被 uvicorn 导入时生效——测试一律调用 `create_app(settings)`。
  - `class ErrorResponse(BaseModel)`：`code: str`、`message_key: str`、`request_id: str`、`fields: list[str] | None = None`（`app/schemas/common.py`）。
  - `request_id_var: ContextVar[str]`；纯 ASGI 中间件 `RequestIdMiddleware`：读取请求头 `X-Request-ID`（仅接受 1–64 位 `[A-Za-z0-9-]`，否则生成 `uuid4().hex`），写入响应头 `X-Request-ID`。
  - `def configure_logging() -> None`：根日志输出单行 JSON 到 stdout，字段 `severity`、`message`、`request_id`（取自 `request_id_var`，无则空串）、`logger`；异常时加 `exception`（仅日志，不进响应）。
  - `def register_error_handlers(app: FastAPI) -> None`：处理 `StarletteHTTPException`、`RequestValidationError`（`fields` = 每个错误 `loc` 的最后一段，去重保序）、`Exception`（记录 `logger.exception("unhandled error")` 后返回 500）。
- `tests/conftest.py` 提供 fixture `settings`（假数据库值，`app_version="test-sha"`）与 `client`（`httpx.AsyncClient(transport=ASGITransport(app))`）；测试用路由只在测试中通过 `app.add_api_route` 添加：`GET /api/v1/_test/required?q=`（必填 `q: str`）与 `GET /api/v1/_test/boom`（抛 `RuntimeError("internal detail xyz")`）。

- [ ] **Step 1: 写失败测试** `tests/unit/test_errors.py`：

```python
async def test_unknown_path_returns_envelope(client):          # AC-FR-PLAT-002-01
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "not_found" and body["message_key"] == "error.not_found"
    assert body["request_id"] == r.headers["X-Request-ID"]

async def test_missing_param_lists_fields(client):             # AC-FR-PLAT-002-02
    r = await client.get("/api/v1/_test/required")
    assert r.status_code == 422 and r.json()["code"] == "validation_error" and r.json()["fields"] == ["q"]

async def test_unhandled_error_hides_detail(client, caplog):   # AC-FR-PLAT-002-03
    r = await client.get("/api/v1/_test/boom", headers={"X-Request-ID": "req-123"})
    assert r.status_code == 500
    assert r.json() == {"code": "internal_error", "message_key": "error.internal", "request_id": "req-123", "fields": None}
    assert "internal detail xyz" not in r.text and "Traceback" not in r.text
    errors = [rec for rec in caplog.records if rec.levelname == "ERROR"]
    assert errors and errors[-1].request_id == "req-123" and "internal detail xyz" in caplog.text

async def test_invalid_request_id_header_is_replaced(client):
    r = await client.get("/api/v1/nope", headers={"X-Request-ID": "bad id!"})
    assert r.headers["X-Request-ID"] != "bad id!" and len(r.headers["X-Request-ID"]) == 32
```

- [ ] **Step 2: 运行** `uv run pytest tests/unit/test_errors.py -v` → Expected: FAIL（`create_app` 不存在）。
- [ ] **Step 3: 实现**上面 Interfaces 中的四个模块与 `create_app`（注册中间件与错误处理；`docs_url=None`、`redoc_url=None`、`openapi_url="/api/v1/openapi.json"`）。`configure_logging()` 用 `logging.setLogRecordFactory` 在每条记录创建时写入 `request_id` 属性（取自 `request_id_var`），因此 pytest 的 `caplog` 与 JSON 输出看到同一个值；`create_app` 调用 `configure_logging()`。
- [ ] **Step 4: 运行** `uv run pytest tests/unit -v` → Expected: 全部 PASS。
- [ ] **Step 5: 提交** `[rebuild-skeleton] app factory, request id, JSON logging, unified errors (FR-PLAT-002)`。

### Task 3: 数据库、健康检查与 Alembic 基线（FR-PLAT-001、FR-PLAT-003-02）

**Files:**
- Create: `app/db.py`、`app/dependencies.py`、`app/routers/__init__.py`、`app/routers/health.py`、`app/schemas/health.py`、`app/services/__init__.py`、`app/services/health_service.py`、`alembic.ini`、`alembic/env.py`、`alembic/script.py.mako`、`alembic/versions/0001_baseline.py`
- Test: `tests/unit/test_health.py`、`tests/integration/test_health_db.py`、`tests/integration/test_migrations.py`、`tests/integration/test_secrets_not_logged.py`
- Modify: `app/main.py`（lifespan 与路由注册）、`tests/conftest.py`

**Interfaces:**
- Consumes: `Settings`、`create_app`、`ErrorResponse`（Task 1–2）。
- Produces:
  - `def database_url(settings: Settings) -> sqlalchemy.engine.URL`：`URL.create("postgresql+asyncpg", username, password, host, port, database)`；`DB_HOST` 以 `/` 开头时改为 `query={"host": DB_HOST}`（Unix 套接字）。
  - `def create_engine(settings: Settings) -> AsyncEngine`：`connect_args={"timeout": 3, "server_settings": {"search_path": settings.db_schema}}`、`pool_pre_ping=True`；lifespan 中创建并存到 `app.state.engine`，关闭时 `dispose()`。
  - `async def check_database(engine: AsyncEngine, timeout: float = 3.0) -> bool`：`asyncio.wait_for` 包住一次 `SELECT 1`；任何异常或超时都返回 `False`，并以 `logger.warning("database check failed: %s", type(exc).__name__)` 只记录异常类型。
  - `class HealthResponse(BaseModel)`：`status: Literal["ok", "degraded"]`、`version: str`、`database: Literal["ok", "error"]`。
  - `GET /api/v1/health` → 200 `HealthResponse(status="ok", database="ok")` 或 503 `HealthResponse(status="degraded", database="error")`；在 OpenAPI 中声明两种响应，`operation_id="getHealth"`。
  - Alembic：`env.py` 用异步引擎（复用 `create_engine(load_settings())`），先执行 `CREATE SCHEMA IF NOT EXISTS <db_schema>`，`version_table_schema=db_schema`，`target_metadata = Base.metadata`（`app/db.py` 定义 `class Base(DeclarativeBase)`，`metadata` 的 `schema` 设为 `saiflow_v3`）。`0001_baseline` 的 upgrade/downgrade 为空。
- 集成测试 fixture（`tests/conftest.py`）：`TEST_DB_HOST/PORT/NAME/USER/PASSWORD` 齐全时提供 `db_settings`；缺少时 `pytest.skip`，若 `REQUIRE_INTEGRATION=1` 则 `pytest.fail("integration database not configured")`。

- [ ] **Step 1: 写失败测试**：

```python
# tests/unit/test_health.py —— 用 monkeypatch 替换 check_database
async def test_health_ok(client_db_ok):        # AC-FR-PLAT-001-01
    r = await client_db_ok.get("/api/v1/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "version": "test-sha", "database": "ok"}

async def test_health_db_down(client_db_down): # AC-FR-PLAT-001-02（逻辑部分）
    r = await client_db_down.get("/api/v1/health")
    assert r.status_code == 503 and r.json()["status"] == "degraded" and r.json()["database"] == "error"

# tests/integration/test_health_db.py —— 真实连接
async def test_health_db_refused_hides_connection_details(settings):   # AC-FR-PLAT-001-03
    s = settings.model_copy(update={"db_host": "127.0.0.1", "db_port": 1, "db_user": "visible_user_name"})
    r = await get_health(create_app(s))
    assert r.status_code == 503
    for secret in ["127.0.0.1", "visible_user_name", s.db_password.get_secret_value(), "Traceback"]:
        assert secret not in r.text

async def test_health_db_hangs_returns_503_within_5s(settings, silent_tcp_server):  # Review Focus 2
    s = settings.model_copy(update={"db_host": "127.0.0.1", "db_port": silent_tcp_server.port})
    t0 = time.monotonic(); r = await get_health(create_app(s))
    assert r.status_code == 503 and time.monotonic() - t0 < 5.0

async def test_health_with_real_db_ok(db_settings):   # 需要 TEST_DB_*
    r = await get_health(create_app(db_settings))
    assert r.status_code == 200 and r.json()["database"] == "ok"

# tests/integration/test_migrations.py
def test_upgrade_creates_version_table_in_schema(db_settings): # 运行 alembic upgrade head（子进程，环境变量取自 db_settings）
    ...  # 断言 information_schema.tables 中存在 ('saiflow_v3', 'alembic_version')，且 public 中不存在 alembic_version

# tests/integration/test_secrets_not_logged.py
async def test_password_absent_from_logs_and_response(db_settings, capsys, caplog):  # AC-FR-PLAT-003-02
    configure_logging(); app = create_app(db_settings)   # 启动（lifespan）+ 一次健康检查
    r = await get_health(app)
    pw = db_settings.db_password.get_secret_value()
    assert pw not in r.text and pw not in caplog.text and pw not in capsys.readouterr().out
```

`get_health(app)` 为 conftest 中的辅助函数：用 `asgi-lifespan` 的 `LifespanManager` 包住 app（`uv add --dev asgi-lifespan`）后发一次 `GET /api/v1/health`。`silent_tcp_server` fixture 用 `asyncio.start_server` 接受连接但不读不写。前两个集成测试不需要真实数据库，不受跳过规则影响（只标记 `integration`，不依赖 `db_settings`）。

- [ ] **Step 2: 运行** `uv run pytest -v` → Expected: 新测试 FAIL（路由 404 / 模块不存在）；需要 `TEST_DB_*` 的用例在本机 SKIPPED。
- [ ] **Step 3: 实现** Interfaces 中的模块与 Alembic 配置。
- [ ] **Step 4: 运行** `uv run pytest -v` → Expected: 除需要真实数据库的用例 SKIPPED 外全部 PASS；`test_health_db_hangs_returns_503_within_5s` 用时 < 5 s。
- [ ] **Step 5: 提交** `[rebuild-skeleton] database engine, health endpoint, alembic baseline (FR-PLAT-001)`。

### Task 4: OpenAPI 导出、接口客户端与前端共享配置（FR-PLAT-004 前半）

**Files:**
- Create: `services/api/app/export_openapi.py`；`packages/api-client/{package.json,tsconfig.json,README.md,scripts/generate.sh,src/index.ts,src/client.ts,src/health.ts,src/health.test.ts,src/generated/schema.ts}`；`packages/tsconfig/{package.json,base.json,react-app.json,react-package.json}`；`packages/ui/{package.json,README.md,src/index.ts}`（空导出）；根 `eslint.config.js`
- Modify: 根 `package.json`（`"packageManager": "pnpm@<本机版本>"`、`"engines": {"node": ">=24"}`、脚本 `generate:api-client`、`dev:web-admin`；根 devDependencies：`eslint`、`typescript-eslint`、`eslint-plugin-react-hooks`、`typescript`、`vitest`）
- Replace: `docs/30-design/openapi.json`（导出结果）；`docs/30-design/API-Spec.md`（改为说明页：契约见 `openapi.json`，由 `pnpm generate:api-client` 生成；v1 契约见 tag `legacy-v1`）
- Remove: 三个 `.gitkeep`

**Interfaces:**
- Consumes: `create_app`（Task 2），`GET /api/v1/health` 的 `operation_id="getHealth"`（Task 3）。
- Produces:
  - `python -m app.export_openapi <path>`：用假配置（`DB_*` 占位，不连接数据库）构建 app，将 `app.openapi()` 以 `indent=2`、`sort_keys=True`、末尾换行写入 `<path>`。
  - `packages/api-client/scripts/generate.sh`：`cd services/api && uv run python -m app.export_openapi ../../docs/30-design/openapi.json`，再 `openapi-typescript docs/30-design/openapi.json -o packages/api-client/src/generated/schema.ts`。
  - `createApiClient(options?: { baseUrl?: string; fetch?: typeof fetch }): ApiClient`（openapi-fetch 的 `createClient<paths>`，`baseUrl` 默认 `""` 即同源）。
  - `type BackendHealth = { state: "ok" | "degraded" | "unreachable"; version?: string }`；`getBackendHealth(client: ApiClient): Promise<BackendHealth>`：200 → `ok` + `version`；503 且正文为健康检查结构 → `degraded` + `version`；网络错误、非 JSON 正文或其他状态 → `unreachable`。永不抛出。

- [ ] **Step 1: 写失败测试** `packages/api-client/src/health.test.ts`（`fetch` 用手写 stub 传入 `createApiClient`）：

```ts
it("returns ok with version on 200", async () => { /* stub 返回 200 {"status":"ok","version":"abc","database":"ok"} */ expect(await getBackendHealth(c)).toEqual({ state: "ok", version: "abc" }); });
it("returns degraded on 503 health body", async () => { /* 503 {"status":"degraded","version":"abc","database":"error"} */ expect(...).toEqual({ state: "degraded", version: "abc" }); });
it("returns unreachable for non-JSON 502", async () => { /* 502, text/html "<html>Bad Gateway</html>" */ expect(...).toEqual({ state: "unreachable" }); });
it("returns unreachable when fetch rejects", async () => { /* stub 抛 TypeError("Failed to fetch") */ expect(...).toEqual({ state: "unreachable" }); });
```

- [ ] **Step 2: 运行** `pnpm install && pnpm --filter @saiflow/api-client test` → Expected: FAIL（`getBackendHealth` 未定义）。
- [ ] **Step 3: 实现** `export_openapi.py`、`generate.sh`，执行 `pnpm generate:api-client` 生成 `schema.ts` 与 `docs/30-design/openapi.json`；实现 `client.ts`、`health.ts`、`index.ts`；建 `packages/tsconfig` 三个配置（`strict: true`，`react-app.json` 含 `jsx: react-jsx`、`moduleResolution: bundler`）与 `packages/ui` 空包；根 `eslint.config.js`（typescript-eslint recommended + react-hooks，忽略 `**/dist`、`**/generated`）。
- [ ] **Step 4: 运行** `pnpm --filter @saiflow/api-client test && pnpm -r lint` 与 `bash packages/api-client/scripts/generate.sh && git diff --exit-code docs/30-design/openapi.json packages/api-client/src/generated` → Expected: 测试 4/4 PASS，lint 无错误，第二次生成无差异。
- [ ] **Step 5: 提交** `[rebuild-skeleton] openapi export, generated api-client, shared tsconfig/eslint (FR-PLAT-004)`。

### Task 5: 三个前端空壳（FR-PLAT-004-02/03）

**Files（每个应用相同结构，`<app>` ∈ `line-mini`、`web-pc`、`web-admin`）：**
- Create: `apps/<app>/{package.json,tsconfig.json,vite.config.ts,index.html,README.md,src/main.tsx,src/App.tsx,src/config.ts,src/services/health.ts,src/pages/HealthPage.tsx,src/pages/HealthPage.test.tsx,src/test/setup.ts}`

**Interfaces:**
- Consumes: `createApiClient`、`getBackendHealth`、`BackendHealth`（Task 4）。
- Produces:
  - 包名 `@saiflow/line-mini`、`@saiflow/web-pc`、`@saiflow/web-admin`；脚本 `dev`、`build`（`tsc -b && vite build`）、`test`（`vitest run`）、`lint`（`eslint .`）。
  - `src/config.ts` 导出 `apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ""`。
  - `src/services/health.ts` 导出 `fetchBackendHealth(): Promise<BackendHealth>`（用 `createApiClient({ baseUrl: apiBaseUrl })`）。
  - `HealthPage`：用 TanStack Query 调用 `fetchBackendHealth`；显示文案固定为 `Backend: OK (<version>)`、`Backend: DEGRADED (<version>)`、`Backend: UNREACHABLE`，加载中显示 `Backend: checking…`。web-pc 与 web-admin 用 Ant Design `Result`/`Typography`，line-mini 用 Ant Design Mobile `Result`；web-admin 页面标题 `SaiFlow Admin`，web-pc 为 `SaiFlow`，line-mini 为 `SaiFlow LINE`。
  - `vite.config.ts`：开发服务器把 `/api` 代理到 `http://localhost:8000`；端口 line-mini 5173、web-pc 5174、web-admin 5175。

- [ ] **Step 1: 写失败测试**（三个应用各一份，`vi.mock("../services/health")`）：

```tsx
it("shows OK with version", async () => { mockHealth({ state: "ok", version: "abc" }); render(<HealthPage />, { wrapper }); expect(await screen.findByText("Backend: OK (abc)")).toBeInTheDocument(); });       // AC-FR-PLAT-004-02
it("shows DEGRADED", async () => { mockHealth({ state: "degraded", version: "abc" }); ...findByText("Backend: DEGRADED (abc)") });                                                                       // AC-FR-PLAT-004-03
it("shows UNREACHABLE", async () => { mockHealth({ state: "unreachable" }); ...findByText("Backend: UNREACHABLE"); expect(screen.queryByText(/Backend: OK/)).toBeNull(); });                      // AC-FR-PLAT-004-03
```

- [ ] **Step 2: 运行** `pnpm -r --filter "./apps/*" test` → Expected: FAIL（`HealthPage` 不存在）。
- [ ] **Step 3: 实现**三个应用（依赖：`react@18.3`、`react-dom@18.3`、`@tanstack/react-query`、`antd@5`（web-pc、web-admin）、`antd-mobile@5`（line-mini）、`@saiflow/api-client: workspace:*`；dev：`vite`、`@vitejs/plugin-react`、`vitest`、`jsdom`、`@testing-library/react`、`@testing-library/jest-dom`）。不加路由库：每个应用只有一个页面，路由在 B-5 引入。
- [ ] **Step 4: 运行** `pnpm -r test && pnpm -r lint && pnpm -r build` → Expected: 全部 PASS，三个 `dist/` 生成。
- [ ] **Step 5: 提交** `[rebuild-skeleton] three frontend shells showing backend health (FR-PLAT-004)`。

### Task 6: 容器镜像与部署后检查脚本（FR-PLAT-005-03）

**Files:**
- Create: `services/api/Dockerfile`、`services/api/.dockerignore`、`scripts/docker/frontend.Dockerfile`、`scripts/docker/nginx.conf.template`、`.dockerignore`（根）、`scripts/smoke-check.sh`、`scripts/tests/smoke-check.test.sh`

**Interfaces:**
- Produces:
  - 后端镜像：`python:3.12-slim` 基础；`uv sync --frozen --no-dev`；`ARG APP_VERSION` → `ENV APP_VERSION`；`CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}`（shell 形式，标准 §3.6）。构建上下文 `services/api`。
  - 前端镜像：构建上下文为仓库根；`ARG APP`（`line-mini` / `web-pc` / `web-admin`）；Node 阶段 `pnpm install --frozen-lockfile` 后 `pnpm --filter @saiflow/${APP} build`；运行阶段 `nginx:stable-alpine`，`dist` 复制到 `/usr/share/nginx/html`，模板放 `/etc/nginx/templates/default.conf.template`（官方镜像启动时以环境变量替换）。
  - `nginx.conf.template`：监听 `${PORT}`；`location /api/ { proxy_pass ${API_UPSTREAM}; proxy_ssl_server_name on; proxy_set_header Host ${API_HOST}; proxy_set_header X-Request-ID $request_id; }`；其余路径 `try_files $uri /index.html`。`API_UPSTREAM`（如 `https://saiflow-be-api-xxxx.a.run.app`）与 `API_HOST`（同一主机名）由部署时注入。
  - `scripts/smoke-check.sh <base_url> <expected_version> [--timeout-seconds N=60]`：轮询 `<base_url>/api/v1/health` 直到 200 且 `status=ok`、`version=<expected_version>`，成功退出 0 并打印正文；超时退出 1 并打印最后一次状态码与正文。只用 `curl` 与 `python3 -c` 解析 JSON。
- [ ] **Step 1: 写失败测试** `scripts/tests/smoke-check.test.sh`：用 `python3 -m http.server` 风格的极小桩服务（同目录 `fake_health_server.py`，按参数返回 200 ok / 503 degraded / 200 ok 但版本不同）验证三种情况：ok 且版本匹配 → 退出 0；503 → 退出 1；版本不匹配 → 退出 1（`--timeout-seconds 3`）。
- [ ] **Step 2: 运行** `bash scripts/tests/smoke-check.test.sh` → Expected: FAIL（脚本不存在）。
- [ ] **Step 3: 实现**两个 Dockerfile、nginx 模板、`smoke-check.sh`。
- [ ] **Step 4: 运行** `bash scripts/tests/smoke-check.test.sh` → Expected: 3/3 PASS。镜像构建在 Task 7 的 CI 中验证（本机无 Docker）。
- [ ] **Step 5: 提交** `[rebuild-skeleton] container images and post-deploy smoke check (FR-PLAT-005)`。

### Task 7: CI 工作流（FR-PLAT-004-01、FR-PLAT-005-01、FR-PLAT-005-04）

**Files:**
- Create: `.github/workflows/ci.yml`、`scripts/check-no-sa-keys.sh`、`scripts/tests/check-no-sa-keys.test.sh`

**Interfaces:**
- Produces: 工作流名 `CI`；触发 `push`（分支 `chore/ai-workflow-v2`）与 `pull_request`；**没有任何部署步骤**。Jobs：
  - `backend`：`services.postgres`（镜像 `postgres:18`，库 `saiflow_test`）；`astral-sh/setup-uv`；`uv sync --frozen`；`ruff check`、`ruff format --check`；`REQUIRE_INTEGRATION=1` 与 `TEST_DB_*` 下运行 `uv run pytest -v`。
  - `frontend`：`pnpm/action-setup`（版本取 `packageManager`）、`actions/setup-node`（24，pnpm 缓存）；`pnpm install --frozen-lockfile`；`pnpm -r lint`、`pnpm -r test`、`pnpm -r build`。
  - `contract`：同时装 uv 与 pnpm；运行 `bash packages/api-client/scripts/generate.sh`，再 `git diff --exit-code docs/30-design/openapi.json packages/api-client/src/generated`，失败时输出 `::error::api-client is out of date; run pnpm generate:api-client`。
  - `scripts`：`shellcheck scripts/*.sh scripts/tests/*.sh`；运行 `scripts/tests/*.test.sh`；运行 `scripts/check-no-sa-keys.sh`。
  - `images`：`docker build` 后端镜像与三个前端镜像（不推送），以确认 Dockerfile 可用；随后启动后端容器（连 `backend` 同款 postgres 服务）与 `web-pc` 容器（`API_UPSTREAM=http://<后端容器>`），对两者分别运行 `scripts/smoke-check.sh`，以证明 nginx 代理与健康检查端到端可用。
  - `scripts/check-no-sa-keys.sh`：在 `git ls-files` 范围内搜索 `"type": "service_account"` 与 `"private_key"`，命中则列出文件并退出 1（AC-FR-PLAT-005-04）。
- [ ] **Step 1: 写失败测试** `scripts/tests/check-no-sa-keys.test.sh`：在临时 git 仓库中，无密钥 → 退出 0；提交一个含 `"type": "service_account"` 的 JSON → 退出 1 并输出该文件名。
- [ ] **Step 2: 运行** `bash scripts/tests/check-no-sa-keys.test.sh` → Expected: FAIL。
- [ ] **Step 3: 实现** `check-no-sa-keys.sh` 与 `ci.yml`。
- [ ] **Step 4: 运行** `bash scripts/tests/check-no-sa-keys.test.sh && bash scripts/check-no-sa-keys.sh` → Expected: 测试 PASS，仓库检查退出 0。`ci.yml` 在 Task 10 推送后首次实际运行。
- [ ] **Step 5: 提交** `[rebuild-skeleton] CI workflow (FR-PLAT-004, FR-PLAT-005)`。

### Task 8: 部署脚本、部署工作流与 GCP 一次性配置（FR-PLAT-005）

**Files:**
- Create: `scripts/require-ci-success.sh`、`scripts/tests/require-ci-success.test.sh`、`scripts/deploy.sh`、`scripts/tests/deploy-dry-run.test.sh`、`scripts/gcp-bootstrap.sh`、`.github/workflows/deploy.yml`、`docs/deployment/README.md`

**Interfaces:**
- Consumes: `scripts/smoke-check.sh`（Task 6）、镜像构建约定（Task 6）。
- Produces:
  - `scripts/require-ci-success.sh <sha>`：`gh run list --workflow CI --commit <sha> --json status,conclusion --limit 20`；存在 `status=completed` 且 `conclusion=success` 的运行 → 退出 0；否则退出 1 并打印 `CI has not passed for <sha>`（含 `in_progress`、`queued`、`failure`、无记录）。
  - `scripts/deploy.sh`，必需环境变量：`GCP_PROJECT_ID`、`GCP_REGION`（`asia-southeast1`）、`AR_REPO`（`saiflow`）、`CLOUDSQL_CONNECTION`（如 `saiflow-509205:asia-southeast1:saiflow-dev`）、`RUNTIME_SA`、`DB_USER`、`DB_NAME`、`DB_PASSWORD_SECRET`（`saiflow-v3-db-password`）、`GIT_SHA`；`DRY_RUN=1` 时只打印命令。顺序：
    1. 构建并推送 4 个镜像到 `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}/<服务名>:${GIT_SHA}`；
    2. `gcloud run jobs deploy saiflow-be-api-migrate`（同一后端镜像，`--command alembic --args upgrade,head`，`--set-cloudsql-instances`，`--set-secrets DB_PASSWORD=${DB_PASSWORD_SECRET}:latest`，`--service-account ${RUNTIME_SA}`，环境变量 `DB_HOST=/cloudsql/${CLOUDSQL_CONNECTION}` 等）后 `gcloud run jobs execute saiflow-be-api-migrate --wait`；
    3. `gcloud run deploy saiflow-be-api`（同上连接与密钥，`APP_VERSION=${GIT_SHA}`，`--allow-unauthenticated`）；取其 URL；
    4. 依次部署 3 个前端服务（`API_UPSTREAM=<后端 URL>`、`API_HOST=<后端主机名>`，`--allow-unauthenticated`）；
    5. 对后端 URL 与每个前端 URL 运行 `smoke-check.sh <url> ${GIT_SHA}`，任一失败则脚本退出 1（AC-FR-PLAT-005-03）。
  - `.github/workflows/deploy.yml`：名 `Deploy`；**只有** `workflow_dispatch` 触发（AC-FR-PLAT-005-01）；`permissions: id-token: write, contents: read, actions: read`；步骤：checkout → `scripts/require-ci-success.sh ${{ github.sha }}`（AC-FR-PLAT-005-02）→ `google-github-actions/auth`（`workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}`、`service_account: ${{ vars.GCP_DEPLOYER_SA }}`，不使用 `credentials_json`）→ `google-github-actions/setup-gcloud` → `gcloud auth configure-docker` → `scripts/deploy.sh`（变量取自仓库 Variables，`GIT_SHA=${{ github.sha }}`）→ 将 `smoke-check` 输出写入 job summary。
  - `scripts/gcp-bootstrap.sh`（在 Cloud Shell 中执行一次，必需变量 `GCP_PROJECT_ID`、`GCP_REGION`、`GITHUB_REPO=aibaba-go/saiflow-monorepo`、`CLOUDSQL_INSTANCE=saiflow-dev`）：启用 API（run、artifactregistry、sqladmin、secretmanager、iamcredentials、sts）；建 Artifact Registry 仓库 `saiflow`；建服务账号 `saiflow-v3-deployer`（`roles/run.admin`、`roles/artifactregistry.writer`，对运行账号的 `roles/iam.serviceAccountUser`）与 `saiflow-v3-runtime`（`roles/cloudsql.client`，对密钥的 `roles/secretmanager.secretAccessor`）；建 Workload Identity 池 `github` 与提供方 `github-oidc`（`attribute-condition: assertion.repository=='aibaba-go/saiflow-monorepo'`），授权 deployer；建 Cloud SQL 用户 `saiflow_v3_app`（随机口令）并写入密钥 `saiflow-v3-db-password`；最后打印需要执行的 SQL（`GRANT CREATE ON DATABASE postgres TO saiflow_v3_app;`，经 `gcloud sql connect` 执行）与需要填入 GitHub 仓库 Variables 的值。每一步先检查资源是否已存在，重复执行不报错。
  - `docs/deployment/README.md`：一次性配置步骤（含 Cloud Run 列表查重名，D4）、GitHub Variables 清单、如何手动触发部署、如何查看结果与回滚（`gcloud run services update-traffic` 到上一个版本）。
- [ ] **Step 1: 写失败测试**：
  - `require-ci-success.test.sh`：在 `PATH` 前放一个假 `gh`，按用例输出 JSON：`[{"status":"completed","conclusion":"success"}]` → 0；`[{"status":"in_progress","conclusion":""}]` → 1（Review Focus 5）；`[{"status":"completed","conclusion":"failure"}]` → 1；`[]` → 1。
  - `deploy-dry-run.test.sh`：`DRY_RUN=1` 与全部必需变量下运行 `deploy.sh`，断言输出含 4 个服务名、`saiflow-be-api-migrate`、`--set-secrets DB_PASSWORD=saiflow-v3-db-password:latest`、`/cloudsql/`、4 次 `smoke-check.sh`，且迁移 Job 的执行出现在 `run deploy saiflow-be-api` 之前；缺少 `GIT_SHA` 时退出非 0 并提示变量名。
- [ ] **Step 2: 运行** `bash scripts/tests/require-ci-success.test.sh && bash scripts/tests/deploy-dry-run.test.sh` → Expected: FAIL。
- [ ] **Step 3: 实现**上述脚本、工作流与文档。
- [ ] **Step 4: 运行**两个测试与 `shellcheck scripts/*.sh scripts/tests/*.sh`（本机无 shellcheck 时由 CI 的 `scripts` job 覆盖）→ Expected: 测试全部 PASS。
- [ ] **Step 5: 提交** `[rebuild-skeleton] deploy script, deploy workflow, GCP bootstrap (FR-PLAT-005)`。

### Task 9: 文档同步

**Files:**
- Modify:
  - `docs/30-design/adr/ADR-006-ai-native-workflow.md`：§6 部署条改为“`scripts/deploy.sh` 由 GitHub Actions 手动触发调用”；§7 B-1 行改为三个前端空壳；版本历史。
  - `docs/30-design/Architecture.md`：§0 web-pc 行拆为“web-pc 企业版”“web-pc admin 后台”两行；§5 前端行改为三个独立 Cloud Run 服务（服务命名规则 D1）、发布行改为 GitHub Actions 手动触发；版本历史。
  - `docs/00-standards/Directory-Structure.md`：目录树新增 `apps/web-admin`、`.github/workflows/`、`docs/deployment/`；规则 10 改为 `docs/deployment/` 已启用；应用包名示例加 `@saiflow/web-admin`；新增服务命名规则（D1）；版本历史。
  - `docs/00-standards/React-Frontend-Structure.md`：§3.1 加 `@saiflow/web-admin`；§1.1 加 `apps/web-admin/` 一行；版本历史。
  - `docs/00-standards/ID-Conventions.md`：§2 新增 `PLAT | 平台基线（健康检查、错误格式、配置、部署） | openspec/specs/platform-baseline`；版本历史。
  - 根 `README.md`：本地开发命令（后端、三个前端、生成接口客户端）。
- [ ] **Step 1: 检查** `git grep -n "web-pc（企业版与 admin 后台）\|line-mini\` 空壳\|手动执行 \`gcloud" -- docs` 列出待改处。
- [ ] **Step 2: 修改**上述文件。
- [ ] **Step 3: 检查**再次运行 Step 1 的 grep → Expected: 无结果；`git grep -n "web-admin" -- docs` 在上述 5 个文档中都有命中。
- [ ] **Step 4: 提交** `[rebuild-skeleton] docs: three frontends, deploy via GitHub Actions, PLAT domain`。

### Task 10: 首次推送、CI 与真实部署（需负责人参与）

本任务涉及推送与外部系统，每一步前先向负责人确认。

- [ ] **Step 1: 请负责人确认推送** `chore/ai-workflow-v2` 到 `origin`。确认后 `git push origin chore/ai-workflow-v2`。
- [ ] **Step 2: 观察 CI** `gh run watch`（工作流 `CI`）→ Expected: 5 个 job 全部成功；同时确认没有任何部署运行（AC-FR-PLAT-005-01）。失败按 systematic-debugging 修复后重新推送（推送前再次确认）。
- [ ] **Step 3: 一次性 GCP 配置**：请负责人或同事在 Cloud Shell 执行 `scripts/gcp-bootstrap.sh` 与打印出的 SQL，在 Cloud Run 列表确认无重名，并把输出的值填入 GitHub 仓库 Variables（`docs/deployment/README.md`）。
- [ ] **Step 4: 拒绝验证**（AC-FR-PLAT-005-02）：在一个 CI 尚未完成的提交上手动触发 `Deploy` → Expected: `require-ci-success` 步骤失败，未构建镜像。
- [ ] **Step 5: 正式部署**：CI 通过后手动触发 `Deploy` → Expected: 迁移 Job 成功；4 个服务的 smoke-check 全部通过（后端 `database=ok`，验证 ADR-005 中的口令认证问题已不存在）。
- [ ] **Step 6: 失败路径验证**（AC-FR-PLAT-005-03）：在 Cloud Run 控制台临时把 `saiflow-be-api` 的 `DB_PASSWORD` 指向一个错误口令版本后运行 `scripts/smoke-check.sh <后端 URL> <sha> --timeout-seconds 30`（Cloud Shell）→ Expected: 退出 1，输出 503 与 `database=error`；随后恢复。
- [ ] **Step 7: 打开三个前端 URL** → Expected: 页面显示 `Backend: OK (<sha>)`（AC-FR-PLAT-004-02）。
- [ ] **Step 8: 写验证记录** `openspec/changes/rebuild-skeleton/verification.md`：AC → 测试或手工步骤 → 结果；包含 CI 运行链接、部署运行链接、4 个服务 URL、smoke-check 输出。提交 `[rebuild-skeleton] verification record`。
