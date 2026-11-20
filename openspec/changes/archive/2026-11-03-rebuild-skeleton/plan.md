# rebuild-skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可测试、可构建、可手动部署的空骨架：FastAPI 后端（健康检查、统一错误、配置加载）、三个只显示后端状态的前端空壳、生成的接口客户端、CI、手动部署到 VPS，以及数据库每日备份。

**Architecture:** 一台 LightNode VPS 上的 Docker Compose 栈（ADR-008）：PostgreSQL（schema `saiflow_v3`，不发布端口）、一个 FastAPI 服务（`services/api`）、三个 Vite + React 前端静态容器（`apps/line-mini`、`apps/web-pc`、`apps/web-admin`）与 Caddy。Caddy 为三个子域名自动申请 HTTPS 证书，并把每个子域名下的 `/api` 转给后端，因此前端与后端同源、前端镜像不含后端地址、后端无需 CORS。接口客户端由后端导出的 OpenAPI 生成；GitHub Actions 负责 CI 与手动部署（GHCR + SSH）；systemd 定时器每天运行备份脚本。

**Tech Stack:** Python 3.12、uv、FastAPI、pydantic-settings、SQLAlchemy 2 async + asyncpg、Alembic、pytest、ruff；Node 24、pnpm、Vite、React 18.3、TypeScript、Ant Design 5、Ant Design Mobile 5、TanStack Query、Vitest + React Testing Library、ESLint、openapi-typescript + openapi-fetch；nginx（前端静态文件）；PostgreSQL 18、Caddy 2、Docker Compose；GitHub Actions、GHCR；GCS（仅备份桶）；Ubuntu 24.04、systemd。

**Spec:** `openspec/changes/rebuild-skeleton/specs/platform-baseline/spec.md`（FR-PLAT-001..006），范围与决定见同目录 `proposal.md`（D1–D10）；运行环境见 `docs/30-design/adr/ADR-008-vps-docker-hosting.md`。

## Global Constraints

- 只在当前分支 `chore/ai-workflow-v2` 上提交（负责人决定，不建 worktree、不改其他分支）；**推送前必须得到负责人确认**（Task 11）。提交信息以 `[rebuild-skeleton]` 开头。
- `legacy/` 只读：不修改、不引用、不复制代码。
- Python 命令只在 `services/api/` 内执行；`services/` 不加入 pnpm workspace。
- 依赖版本：实施时取各库当前稳定版并锁定（`uv.lock`、`pnpm-lock.yaml`）；Python `requires-python = ">=3.12,<3.13"`；React 固定 18.3.x（与 Ant Design 5、Ant Design Mobile 5 兼容）。
- 服务、镜像与 Compose 服务名（D1）：`saiflow-be-api`、`saiflow-fe-web-pc`、`saiflow-fe-web-admin`、`saiflow-fe-line-mini`；镜像仓库 `ghcr.io/aibaba-go`。schema（D2）：`saiflow_v3`；数据库名 `saiflow`；应用账号 `saiflow_v3_app`。
- 域名（D6）：`saiflow-app.aibaba.asia`（web-pc）、`saiflow-admin.aibaba.asia`（web-admin）、`saiflow-line2.aibaba.asia`（line-mini）。VPS：SSH 端口 11022，账号 `deploy`，部署目录 `/opt/saiflow`（D9、D10）。
- 接口路径前缀 `/api/v1`；健康检查为 `GET /api/v1/health`（与后续业务接口同一前缀，经 Caddy 的 `/api` 转发即可访问）。
- 后端配置环境变量名：`DB_HOST`、`DB_PORT`（默认 5432）、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、`APP_VERSION`（默认 `dev`）。schema 固定为 `saiflow_v3`（D2），不是配置项（`app/db.py` 的 `SCHEMA`；负责人 2026-11-03 决定去掉原 `DB_SCHEMA`）。凭据（`DB_PASSWORD`）无默认值。服务器上的凭据只在 `/opt/saiflow/.env`（权限 600）与 `/opt/saiflow/secrets/`；仓库中只有变量名。
- 错误码与消息键固定为：`not_found`/`error.not_found`、`method_not_allowed`/`error.method_not_allowed`、`validation_error`/`error.validation`、`internal_error`/`error.internal`；其他 HTTP 错误为 `http_<status>`/`error.http`。
- 健康检查数据库探测超时 3 秒（满足 spec 的 5 秒上限）。
- 对外 API 契约唯一来源为 `docs/30-design/openapi.json`（`Directory-Structure.md` 规则 5），由后端导出覆盖旧 v1 契约（旧版保留在 tag `legacy-v1`）；`docs/30-design/API-Spec.md` 改为指向它的说明页。
- 人读的部署说明放 `docs/deployment/`，脚本与部署配置放 `scripts/`（Compose 与 Caddy 配置在 `scripts/deploy/`，`Directory-Structure.md` 规则 10）。所有 shell 脚本 `set -euo pipefail` 且通过 shellcheck。
- 本机没有 Docker 与 PostgreSQL，`python3` 是无效的系统别名：集成测试在本机缺少 `TEST_DB_HOST` 时跳过，CI 中设 `REQUIRE_INTEGRATION=1` 使其必须运行；镜像、Compose 栈与部署只在 GitHub Actions 中验证；本机运行脚本测试时用指向 `py` 的临时 `python3` 别名。

## Review Focus

1. 必需配置缺失时，pydantic 的校验错误默认会把全部输入值（含 `DB_PASSWORD`）打印出来；启动错误必须只列配置名 → Task 1 `test_missing_config_error_does_not_leak_values`。
2. 数据库接受 TCP 连接但从不响应（而不是直接拒绝）时，健康检查仍须在 5 秒内返回 503 → Task 3 `test_health_db_hangs_returns_503_within_5s`。
3. asyncpg 的错误文本含主机与用户名，可能经健康检查或 500 错误体泄露 → Task 3 `test_health_db_error_hides_connection_details`。
4. Caddy 在后端不可达时返回 502（不是 JSON），前端不得崩溃或显示为正常 → Task 4 `getBackendHealth returns unreachable for non-JSON 502`。
5. 对 CI 仍在运行（尚无结论）的提交手动触发部署，必须被拒绝 → Task 9 `require-ci-success` 用例 `in_progress`。
6. 部署中途失败（例如迁移失败）时，服务器上不得留下 GHCR 登录凭据 → Task 9 `remote-deploy.test.sh` 迁移失败用例。

---

### Task 1: 后端工程与配置加载（FR-PLAT-003）

**Files:**
- Create: `services/api/pyproject.toml`、`services/api/uv.lock`、`services/api/.python-version`（`3.12`）、`services/api/.env.example`（只列变量名）、`services/api/README.md`、`services/api/app/__init__.py`、`services/api/app/config.py`
- Test: `services/api/tests/__init__.py`、`services/api/tests/unit/test_config.py`
- Modify: `.gitignore`（加入 `services/api/temp/`）

**Interfaces:**
- Produces: `class Settings(BaseSettings)`（字段 `db_host: str`、`db_port: int = 5432`、`db_name: str`、`db_user: str`、`db_password: SecretStr`、`app_version: str = "dev"`；读取同名大写环境变量，不读 `.env` 文件以外的来源）；`class ConfigError(RuntimeError)`；`def load_settings() -> Settings`（缺失时抛 `ConfigError("missing configuration: DB_HOST, DB_PASSWORD")`，名称按字段顺序、大写、逗号分隔，`from None` 截断原始校验错误）。

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

def test_complete_config_loads(monkeypatch): ...  # 四个必需值齐全 → app_version == "dev", db_password.get_secret_value() == 设定值
```

- [ ] **Step 3: 运行** `uv run pytest tests/unit/test_config.py -v` → Expected: FAIL（`ImportError: cannot import name 'ConfigError'`）。
- [ ] **Step 4: 实现** `app/config.py`。`.env.example` 只列变量名；README 写本地运行、测试、迁移命令。
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
  - `def database_url(settings: Settings) -> sqlalchemy.engine.URL`：`URL.create("postgresql+asyncpg", username, password, host, port, database)`（Compose 中 `DB_HOST=postgres`）。
  - `def create_engine(settings: Settings) -> AsyncEngine`：`connect_args={"timeout": 3, "server_settings": {"search_path": SCHEMA}}`、`pool_pre_ping=True`；lifespan 中创建并存到 `app.state.engine`，关闭时 `dispose()`。
  - `async def check_database(engine: AsyncEngine, timeout: float = 3.0) -> bool`：`asyncio.wait_for` 包住一次 `SELECT 1`；任何异常或超时都返回 `False`，并以 `logger.warning("database check failed: %s", type(exc).__name__)` 只记录异常类型。
  - `class HealthResponse(BaseModel)`：`status: Literal["ok", "degraded"]`、`version: str`、`database: Literal["ok", "error"]`。
  - `GET /api/v1/health` → 200 `HealthResponse(status="ok", database="ok")` 或 503 `HealthResponse(status="degraded", database="error")`；在 OpenAPI 中声明两种响应，`operation_id="getHealth"`。
  - Alembic：`env.py` 用异步引擎（复用 `create_engine(load_settings())`），先执行 `CREATE SCHEMA IF NOT EXISTS <SCHEMA>`，`version_table_schema=SCHEMA`，`target_metadata = Base.metadata`（`app/db.py` 定义 `class Base(DeclarativeBase)`，`metadata` 的 `schema` 设为 `saiflow_v3`）。`0001_baseline` 的 upgrade/downgrade 为空。
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

### Task 6: 容器镜像、Compose 栈、Caddy 与部署后检查脚本（FR-PLAT-005-03、005-06）

**Files:**
- Create: `services/api/Dockerfile`、`services/api/.dockerignore`、`scripts/docker/frontend.Dockerfile`、`scripts/docker/nginx-static.conf`、`.dockerignore`（根）、`scripts/deploy/compose.yaml`、`scripts/deploy/Caddyfile`、`scripts/deploy/env.example`、`scripts/deploy/postgres-init/01-app-user.sh`、`scripts/smoke-check.sh`、`scripts/tests/smoke-check.test.sh`、`scripts/tests/fake_health_server.py`
- Modify: `services/api/.env.example`（注释改为“Compose 中 DB_HOST 为 postgres”）

**Interfaces:**
- Produces:
  - 后端镜像：`python:3.12-slim` 基础；`uv sync --frozen --no-dev`；`ARG APP_VERSION` → `ENV APP_VERSION`；`CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}`（shell 形式）。构建上下文 `services/api`。
  - 前端镜像：构建上下文为仓库根；`ARG APP`（`line-mini` / `web-pc` / `web-admin`）；Node 阶段 `pnpm install --frozen-lockfile` 后 `pnpm --filter @saiflow/${APP} build`；运行阶段 `nginx:stable-alpine`，只提供静态文件（监听 8080，`try_files $uri /index.html`），**不代理 `/api`**（由 Caddy 负责）。
  - 镜像名：`${IMAGE_REGISTRY:-ghcr.io/aibaba-go}/<服务名>:${IMAGE_TAG}`，服务名按 D1。
  - `scripts/deploy/compose.yaml`（项目名 `saiflow`）：
    - `postgres`：`postgres:18`；数据卷 `pgdata`；**不发布任何端口**；`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB=saiflow` 来自 `.env`；挂载 `postgres-init/` 到 `/docker-entrypoint-initdb.d`；健康检查 `pg_isready`。
    - `saiflow-be-api`：`env_file: .env`；`DB_HOST=postgres`、`DB_NAME=saiflow`、`DB_USER=saiflow_v3_app`；`depends_on: postgres (service_healthy)`。
    - `saiflow-fe-web-pc`、`saiflow-fe-web-admin`、`saiflow-fe-line-mini`：各自镜像。
    - `caddy`：`caddy:2`；发布 `80`、`443`（含 `443/udp`）；挂载 `Caddyfile` 与数据卷 `caddy_data`、`caddy_config`；环境变量 `APP_HOST`、`ADMIN_HOST`、`LINE_HOST`。
    - 所有服务 `restart: unless-stopped`；日志 `json-file`，`max-size: 10m`、`max-file: 5`。
    - 迁移命令：`docker compose run --rm saiflow-be-api alembic upgrade head`。
  - `Caddyfile`：`{$APP_HOST}`、`{$ADMIN_HOST}`、`{$LINE_HOST}` 三个站点块，每块 `handle /api/* { reverse_proxy saiflow-be-api:8000 }`，其余 `reverse_proxy <对应前端>:8080`；请求头 `X-Request-ID` 透传。站点名为 `*.localhost` 时 Caddy 自动使用内部证书（CI 用）。
  - `postgres-init/01-app-user.sh`：首次初始化时建角色 `saiflow_v3_app`（口令取 `DB_PASSWORD`）、`GRANT CREATE ON DATABASE saiflow`；不授予超级用户。
  - `scripts/deploy/env.example`：只列变量名：`POSTGRES_USER`、`POSTGRES_PASSWORD`、`DB_PASSWORD`、`APP_HOST`、`ADMIN_HOST`、`LINE_HOST`、`IMAGE_TAG`、`BACKUP_BUCKET`。
  - `scripts/smoke-check.sh <base_url> <expected_version> [--timeout-seconds N=60]`：轮询 `<base_url>/api/v1/health` 直到 200 且 `status=ok`、`version=<expected_version>`，成功退出 0 并打印正文；超时退出 1 并打印最后一次状态码与正文。只用 `curl` 与 `python3 -c` 解析 JSON；`SMOKE_INSECURE=1` 时加 `curl -k`（CI 的内部证书）。
- [ ] **Step 1: 写失败测试** `scripts/tests/smoke-check.test.sh`：用 `fake_health_server.py`（按参数返回 200 ok / 503 degraded / 200 ok 但版本不同）验证：ok 且版本匹配 → 退出 0；503 → 退出 1；版本不匹配 → 退出 1（`--timeout-seconds 3`）。
- [ ] **Step 2: 运行** `bash scripts/tests/smoke-check.test.sh` → Expected: FAIL（脚本不存在）。
- [ ] **Step 3: 实现**两个 Dockerfile、nginx 配置、Compose 文件、Caddyfile、初始化脚本、`smoke-check.sh`。
- [ ] **Step 4: 运行** `bash scripts/tests/smoke-check.test.sh` → Expected: 3/3 PASS。镜像与整套 Compose 在 Task 7 的 CI `stack` job 中验证（本机无 Docker）。
- [ ] **Step 5: 提交** `[rebuild-skeleton] container images, compose stack, caddy, smoke check (FR-PLAT-005)`。

### Task 7: 数据库备份与恢复脚本（FR-PLAT-006）

**Files:**
- Create: `scripts/deploy/backup.sh`、`scripts/deploy/restore-check.sh`、`scripts/tests/backup.test.sh`、`scripts/tests/fakes/docker`（测试用假命令）

**Interfaces:**
- Consumes: `scripts/deploy/compose.yaml`（服务名 `postgres`，Task 6）。
- Produces:
  - `scripts/deploy/backup.sh`，环境变量：`DEPLOY_DIR`（默认 `/opt/saiflow`）、`BACKUP_BUCKET`（如 `gs://saiflow-db-backup`）、`GCS_KEY_FILE`（默认 `${DEPLOY_DIR}/secrets/gcs-backup.json`）。步骤：
    1. `docker compose -p saiflow exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc saiflow` 写入 `${DEPLOY_DIR}/backups/saiflow-<UTC 时间 YYYYmmddTHHMMSSZ>.dump`（先写 `.partial`，成功后改名）；导出失败 → 删除 `.partial`，日志 `backup: dump failed`，退出 1。
    2. `docker run --rm -v <key>:/key.json:ro -v <backups>:/backups:ro google/cloud-sdk:slim sh -c 'gcloud auth activate-service-account --key-file=/key.json && gcloud storage cp /backups/<文件> ${BACKUP_BUCKET}/'`；失败 → 日志 `backup: upload failed`，**保留本地备份**，退出 1。
    3. 删除 `${DEPLOY_DIR}/backups/` 下修改时间超过 7 天的 `*.dump`（`find -mtime +7`）。保留清理在上传失败时也执行。
    每行日志带 UTC 时间，写到 stdout（由 systemd 记入 journal）。
  - `scripts/deploy/restore-check.sh <dump_file>`：启动一个临时 `postgres:18` 容器（随机口令、不发布端口），`pg_restore` 该文件，查询 `information_schema` 确认 schema `saiflow_v3` 与表 `saiflow_v3.alembic_version` 存在且有一行，打印结果；成功退出 0，最后删除临时容器（`trap`）。
- [ ] **Step 1: 写失败测试** `scripts/tests/backup.test.sh`（`PATH` 前放 `scripts/tests/fakes/`，假 `docker` 按环境变量 `FAKE_DUMP_FAIL`、`FAKE_UPLOAD_FAIL` 决定成功或失败，并把调用记录到文件）：
  - 正常：生成 `saiflow-*.dump`，记录中有一次 `gcloud storage cp`，退出 0（AC-FR-PLAT-006-01）；
  - 保留期：预先放入 `touch -d '8 days ago'` 与 `touch -d '6 days ago'` 的两个 `.dump` → 前者被删、后者保留（AC-FR-PLAT-006-02）；
  - 上传失败：本地新备份仍在，退出 1，输出含 `backup: upload failed`（AC-FR-PLAT-006-03）；
  - 导出失败：不留 `.partial`，退出 1，输出含 `backup: dump failed`。
- [ ] **Step 2: 运行** `bash scripts/tests/backup.test.sh` → Expected: FAIL（脚本不存在）。
- [ ] **Step 3: 实现** `backup.sh` 与 `restore-check.sh`。
- [ ] **Step 4: 运行** `bash scripts/tests/backup.test.sh` → Expected: 4/4 PASS。`restore-check.sh` 在 Task 8 的 CI `stack` job 中对真实备份运行（AC-FR-PLAT-006-04）。
- [ ] **Step 5: 提交** `[rebuild-skeleton] database backup and restore check (FR-PLAT-006)`。

### Task 8: CI 工作流（FR-PLAT-004-01、005-01、005-04、005-06、006-04）

**Files:**
- Create: `.github/workflows/ci.yml`、`scripts/check-no-secrets.sh`、`scripts/tests/check-no-secrets.test.sh`

**Interfaces:**
- Consumes: Task 6 的镜像、Compose 与 `smoke-check.sh`；Task 7 的 `backup.sh`、`restore-check.sh`。
- Produces: 工作流名 `CI`；触发 `push`（分支 `chore/ai-workflow-v2`）与 `pull_request`；**没有任何部署步骤**。Jobs：
  - `backend`：`services.postgres`（`postgres:18`，库 `saiflow_test`）；`astral-sh/setup-uv`；`uv sync --frozen`；`ruff check`、`ruff format --check`；`REQUIRE_INTEGRATION=1` 与 `TEST_DB_*` 下运行 `uv run pytest -v`。
  - `frontend`：`pnpm/action-setup`（版本取 `packageManager`）、`actions/setup-node`（24，pnpm 缓存）；`pnpm install --frozen-lockfile`；`pnpm -r lint`、`pnpm -r test`、`pnpm -r build`。
  - `contract`：装 uv 与 pnpm；`bash packages/api-client/scripts/generate.sh` 后 `git diff --exit-code docs/30-design/openapi.json packages/api-client/src/generated`，失败时输出 `::error::api-client is out of date; run pnpm generate:api-client`。
  - `scripts`：`shellcheck scripts/*.sh scripts/deploy/*.sh scripts/tests/*.sh`；运行 `scripts/tests/*.test.sh`；运行 `scripts/check-no-secrets.sh`。
  - `stack`：本地构建 4 个镜像（`IMAGE_TAG=ci`，不推送）；在临时目录按 `env.example` 写 `.env`（随机口令，`APP_HOST=app.localhost`、`ADMIN_HOST=admin.localhost`、`LINE_HOST=line.localhost`）；`docker compose up -d postgres` → 迁移命令 → `docker compose up -d`；`SMOKE_INSECURE=1` 对三个 `https://*.localhost` 运行 `smoke-check.sh <url> ci`；断言 `docker compose port postgres 5432` 无输出（数据库未发布端口，AC-FR-PLAT-005-06 的配置部分）；对运行中的栈执行一次 `pg_dump`（与 `backup.sh` 相同参数）并运行 `restore-check.sh`（AC-FR-PLAT-006-04）。
  - `scripts/check-no-secrets.sh`：在 `git ls-files` 范围内搜索 服务账号密钥 JSON 的类型字段（type = service account）、`private_key` 字段、PEM 私钥开头行（BEGIN … PRIVATE KEY），命中则列出文件并退出 1（AC-FR-PLAT-005-04）。
- [ ] **Step 1: 写失败测试** `scripts/tests/check-no-secrets.test.sh`：在临时 git 仓库中，无密钥 → 退出 0；提交含服务账号类型字段的 JSON → 退出 1 并输出文件名；提交含 OpenSSH 私钥开头行的文件 → 退出 1。
- [ ] **Step 2: 运行** `bash scripts/tests/check-no-secrets.test.sh` → Expected: FAIL。
- [ ] **Step 3: 实现** `check-no-secrets.sh` 与 `ci.yml`。
- [ ] **Step 4: 运行** `bash scripts/tests/check-no-secrets.test.sh && bash scripts/check-no-secrets.sh` → Expected: 测试 PASS，仓库检查退出 0。`ci.yml` 在 Task 11 推送后首次实际运行。
- [ ] **Step 5: 提交** `[rebuild-skeleton] CI workflow with full compose stack check (FR-PLAT-004, FR-PLAT-005, FR-PLAT-006)`。

### Task 9: 部署脚本、部署工作流与一次性配置（FR-PLAT-005）

**Files:**
- Create: `scripts/require-ci-success.sh`、`scripts/tests/require-ci-success.test.sh`、`scripts/deploy/remote-deploy.sh`、`scripts/tests/remote-deploy.test.sh`、`scripts/vps-bootstrap.sh`、`scripts/gcp-backup-bootstrap.sh`、`scripts/deploy/saiflow-backup.service`、`scripts/deploy/saiflow-backup.timer`、`.github/workflows/deploy.yml`、`docs/deployment/README.md`

**Interfaces:**
- Consumes: `smoke-check.sh`、`compose.yaml`、`Caddyfile`、`backup.sh`（Task 6、7）。
- Produces:
  - `scripts/require-ci-success.sh <sha>`：`gh run list --workflow CI --commit <sha> --json status,conclusion --limit 20`；存在 `status=completed` 且 `conclusion=success` 的运行 → 退出 0；否则退出 1 并打印 `CI has not passed for <sha>`（含 `in_progress`、`queued`、`failure`、无记录）。
  - `scripts/deploy/remote-deploy.sh <image_tag>`（在 VPS 上以 `deploy` 运行，工作目录 `/opt/saiflow`）：从 stdin 读取 GHCR 令牌与用户名（两行）；`trap 'docker logout ghcr.io' EXIT` 后 `docker login ghcr.io --password-stdin`；把 `.env` 中的 `IMAGE_TAG` 更新为 `<image_tag>`；`docker compose pull` → `docker compose up -d postgres` → 迁移命令 → `docker compose up -d --remove-orphans` → `docker image prune -f`。任一步失败即退出非 0（`trap` 仍执行退出登录，AC-FR-PLAT-005-05）。
  - `.github/workflows/deploy.yml`：名 `Deploy`；**只有** `workflow_dispatch` 触发（AC-FR-PLAT-005-01）；`permissions: contents: read, packages: write, actions: read`；步骤：
    1. checkout → `scripts/require-ci-success.sh ${{ github.sha }}`（AC-FR-PLAT-005-02，失败则后续步骤都不执行）；
    2. 用 `GITHUB_TOKEN` 登录 GHCR，构建并推送 4 个镜像（标签 `${{ github.sha }}`）；
    3. 从 Secrets 写入 SSH 私钥（`VPS_SSH_KEY`）与主机指纹（`VPS_KNOWN_HOSTS`，开启严格主机校验）；`scp -P 11022` 把 `compose.yaml`、`Caddyfile`、`postgres-init/`、`remote-deploy.sh`、`backup.sh`、`restore-check.sh` 复制到 `deploy@${{ vars.VPS_HOST }}:/opt/saiflow/`；
    4. `ssh -p 11022 deploy@… 'bash /opt/saiflow/remote-deploy.sh <sha>'`，stdin 传入 `GITHUB_TOKEN` 与 `github.actor`；
    5. 对 `https://${{ vars.APP_HOST }}`、`ADMIN_HOST`、`LINE_HOST` 运行 `smoke-check.sh <url> <sha>`，任一失败则工作流失败（AC-FR-PLAT-005-03）；
    6. 从 runner 用 `nc -z -w 5 <VPS_HOST> 5432` 确认连接失败（AC-FR-PLAT-005-06）；
    7. 把 smoke-check 输出写入 job summary；最后无论成功失败都删除 runner 上的私钥文件。
  - `scripts/vps-bootstrap.sh`（负责人以 root 在 VPS 上执行一次，重复执行不报错；参数：部署公钥文件路径）：按 Docker 官方 apt 源安装 Docker Engine 与 Compose 插件；建账号 `deploy` 并加入 `docker` 组；写入其 `authorized_keys`；`/etc/ssh/sshd_config.d/saiflow-deploy.conf` 中对 `deploy` 设 `PasswordAuthentication no`，`sshd -t` 通过后重载；建 `/opt/saiflow/{backups,secrets}`（属主 `deploy`，权限 700）；若 `/opt/saiflow/.env` 不存在，按 `env.example` 生成，`POSTGRES_PASSWORD` 与 `DB_PASSWORD` 用 `openssl rand` 生成，三个主机名写入 D6 的子域名，权限 600、属主 `deploy`；安装并启用 `saiflow-backup.timer`。不修改防火墙与 SSH 端口（负责人已配置）。
  - `saiflow-backup.service` / `.timer`：以 `deploy` 运行 `/opt/saiflow/backup.sh`；每天 03:00（`Asia/Bangkok`）；`Persistent=true`。
  - `scripts/gcp-backup-bootstrap.sh`（在 Cloud Shell 执行一次，重复执行不报错；必需变量 `GCP_PROJECT_ID`、`BACKUP_BUCKET`、`BUCKET_LOCATION=asia-southeast1`）：建桶（统一桶级访问、禁止公开访问）；生命周期规则 30 天删除；建服务账号 `saiflow-v3-backup`，**只在该桶上**授予 `roles/storage.objectCreator`；生成密钥文件并提示用 `scp -P 11022` 放到 VPS 的 `/opt/saiflow/secrets/gcs-backup.json`（权限 600）后从 Cloud Shell 删除。
  - `docs/deployment/README.md`：一次性配置顺序（DNS 三条 A 记录 → VPS 初始化 → GCP 备份桶 → GitHub Secrets `VPS_SSH_KEY`、`VPS_KNOWN_HOSTS` 与 Variables `VPS_HOST`、`APP_HOST`、`ADMIN_HOST`、`LINE_HOST`）；如何手动触发部署、查看结果；回滚（以上一个提交的 sha 重新触发 Deploy，或在 VPS 上把 `IMAGE_TAG` 改回后 `docker compose up -d`）；如何手动运行备份与恢复演练；`deploy` 账号权限接近 root 的风险说明（D9）。
- [ ] **Step 1: 写失败测试**：
  - `require-ci-success.test.sh`：`PATH` 前放假 `gh`，按用例输出 JSON：`[{"status":"completed","conclusion":"success"}]` → 0；`[{"status":"in_progress","conclusion":""}]` → 1（Review Focus 5）；`[{"status":"completed","conclusion":"failure"}]` → 1；`[]` → 1。
  - `remote-deploy.test.sh`：`PATH` 前放记录调用的假 `docker`；正常 → 调用顺序为 `login` → `compose pull` → `compose up -d postgres` → `compose run --rm saiflow-be-api alembic upgrade head` → `compose up -d --remove-orphans` → `logout`，且 `.env` 中 `IMAGE_TAG` 已更新；迁移失败（假 `docker` 对 `alembic` 返回 1）→ 退出非 0、未执行最后的 `up -d --remove-orphans`、**仍执行了 `logout`**（AC-FR-PLAT-005-05）。
- [ ] **Step 2: 运行** `bash scripts/tests/require-ci-success.test.sh && bash scripts/tests/remote-deploy.test.sh` → Expected: FAIL。
- [ ] **Step 3: 实现**上述脚本、systemd 单元、工作流与文档。
- [ ] **Step 4: 运行**两个测试与 `shellcheck`（本机无 shellcheck 时由 CI 的 `scripts` job 覆盖）→ Expected: 测试全部 PASS。
- [ ] **Step 5: 提交** `[rebuild-skeleton] deploy workflow, remote deploy, VPS and GCP bootstrap (FR-PLAT-005)`。

### Task 10: 文档同步

**Files:**
- Modify:
  - `docs/30-design/adr/ADR-006-ai-native-workflow.md`：§7 B-1 行改为三个前端空壳与数据库备份；版本历史。
  - `docs/30-design/Architecture.md`：§0 web-pc 行拆为“web-pc 企业版”“web-pc admin 后台”两行；§5 前端行改为三个前端容器与三个子域名（D6），服务命名规则（D1）；版本历史。
  - `docs/00-standards/Directory-Structure.md`：目录树新增 `apps/web-admin`、`.github/workflows/`、`docs/deployment/`、`scripts/deploy/`、`scripts/docker/`；规则 10 改为 `docs/deployment/` 已启用；应用包名示例加 `@saiflow/web-admin`；新增服务命名规则（D1）；版本历史。
  - `docs/00-standards/React-Frontend-Structure.md`：§3.1 加 `@saiflow/web-admin`；§1.1 加 `apps/web-admin/` 一行；版本历史。
  - `docs/00-standards/ID-Conventions.md`：§2 新增 `PLAT | 平台基线（健康检查、错误格式、配置、部署、备份） | openspec/specs/platform-baseline`；版本历史。
  - 根 `README.md`：本地开发命令（后端、三个前端、生成接口客户端）与部署说明链接。
- [ ] **Step 1: 检查** `git grep -n "web-pc（企业版与 admin 后台）\|web-pc 各为独立\|不设\` \`docs/deployment/" -- docs` 列出待改处。
- [ ] **Step 2: 修改**上述文件。
- [ ] **Step 3: 检查**再次运行 Step 1 的 grep → Expected: 无结果；`git grep -n "web-admin" -- docs` 在上述 5 个文档中都有命中。
- [ ] **Step 4: 提交** `[rebuild-skeleton] docs: three frontends, subdomains, deployment docs, PLAT domain`。

### Task 11: 首次推送、CI 与真实部署（需负责人参与）

本任务涉及推送与外部系统，每一步前先向负责人确认。

- [ ] **Step 1: 请负责人确认推送** `chore/ai-workflow-v2` 到 `origin`。确认后 `git push origin chore/ai-workflow-v2`。
- [ ] **Step 2: 观察 CI** `gh run watch`（工作流 `CI`）→ Expected: 6 个 job 全部成功；同时确认没有任何部署运行（AC-FR-PLAT-005-01）。失败按 systematic-debugging 修复后重新推送（推送前再次确认）。
- [ ] **Step 3: 一次性配置**（负责人执行，按 `docs/deployment/README.md`）：
  1. DNS：`saiflow-app`、`saiflow-admin`、`saiflow-line2` 三条 A 记录指向 VPS；
  2. VPS：以 root 执行 `scripts/vps-bootstrap.sh <部署公钥>`；
  3. GCP：在 Cloud Shell 执行 `scripts/gcp-backup-bootstrap.sh`，把密钥文件放到 VPS；
  4. GitHub：填入 Secrets 与 Variables。
- [ ] **Step 4: 拒绝验证**（AC-FR-PLAT-005-02）：在一个 CI 尚未完成的提交上手动触发 `Deploy` → Expected: `require-ci-success` 步骤失败，未构建镜像。
- [ ] **Step 5: 正式部署**：CI 通过后手动触发 `Deploy` → Expected: 迁移成功；三个子域名的 smoke-check 全部通过（`database=ok`）；端口 5432 从外部不可连（AC-FR-PLAT-005-06）；Caddy 已为三个子域名取得证书。
- [ ] **Step 6: 凭据检查**（AC-FR-PLAT-005-05）：在 VPS 上以 `deploy` 查看 `~/.docker/config.json` → Expected: 没有 `ghcr.io` 的凭据。
- [ ] **Step 7: 失败路径验证**（AC-FR-PLAT-005-03）：在 VPS 上临时停止 `postgres` 服务后运行 `scripts/smoke-check.sh https://saiflow-app.aibaba.asia <sha> --timeout-seconds 30` → Expected: 退出 1，输出 503 与 `database=error`；随后恢复并确认恢复正常。
- [ ] **Step 8: 打开三个前端地址** → Expected: 页面显示 `Backend: OK (<sha>)`（AC-FR-PLAT-004-02）。
- [ ] **Step 9: 备份与恢复演练**（AC-FR-PLAT-006-01、04）：在 VPS 上手动运行一次 `systemctl start saiflow-backup.service` → Expected: `backups/` 中出现新备份，备份桶中出现同名对象；对该文件运行 `restore-check.sh` → Expected: 恢复成功。
- [ ] **Step 10: 写验证记录** `openspec/changes/rebuild-skeleton/verification.md`：AC → 测试或手工步骤 → 结果；包含 CI 运行链接、部署运行链接、三个地址、smoke-check 输出、备份与恢复输出。提交 `[rebuild-skeleton] verification record`。
