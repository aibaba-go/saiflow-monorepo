# local-test-development 验证记录

验证日期：2026-11-09。环境：本机 Windows，本地 PostgreSQL 18.6 集群 `127.0.0.1:25432`（开发库 `saiflow_dev`，一次性测试库 `saiflow_test_regression`）。未连接线上库，也未连接恢复库 `81.68.72.120:15432/saiflow`；未读取 `services/api/.env*` 或任何生产环境文件。未提交，未部署。

## 1. 自动化测试

| 范围 | 命令（在对应目录执行） | 结果 |
|---|---|---|
| 后端单元 | `services/api`: `.venv/Scripts/python.exe -m pytest tests/unit -q -p no:cacheprovider` | **415 passed**（含 Host/Origin 新增用例） |
| 后端集成 | `services/api`: 载入 `temp/local-postgres/secrets.env`，`REQUIRE_INTEGRATION=1`，`.venv/Scripts/python.exe -m pytest tests/integration -q -p no:cacheprovider` | 首轮 **582 passed**，另有 2 个用例偶发超时，单独重跑通过；加固后复跑全量 **584 passed, 1 failed**（`test_job_filters.py::test_mapping_state_has_target` 依赖 `now() + 1 second` 先后顺序，25 分钟负载下偶发，单独重跑通过；`test_dev_login.py` 7 个全部通过） |
| 后端静态检查 | `services/api`: `ruff check .`、`ruff format --check .` | 无问题 |
| line-mini | `npx vitest run --no-file-parallelism` | **270 passed**（含 `src/features/auth/devLogin.test.tsx` 15 个） |
| web-pc | `npx vitest run --no-file-parallelism` | **169 passed**（含 `src/auth/devLogin.test.tsx`） |
| web-admin | `npx vitest run` | **62 passed**（不受本变更影响） |
| lint / tsc | 各 app：`eslint .`、`tsc --noEmit -p tsconfig.json` | line-mini、web-pc 均为 0 错误 |
| 构建 | line-mini、web-pc：`vite build` | 通过；`dist/` 中没有保留开发 token `saiflow-local-development` |

## 2. 验收标准 → 证据

| 需求 | 验收标准 | 证据 |
|---|---|---|
| NFR-DEV-001 本地开发与服务隔离 | AC-NFR-DEV-001-01 默认隔离 | `services/api/tests/unit/test_dev_login_config.py`（默认关闭、非 development 拒绝）；`tests/unit/test_dev_login.py`、`tests/integration/test_dev_login.py`（未开启时保留 token 按普通 LINE token 处理）；客户端 `apps/line-mini/src/features/auth/devLogin.test.tsx`、`apps/web-pc/src/auth/devLogin.test.tsx`（生产构建、无开关、开关非 `1`、局域网/线上主机、跨源 API 均关闭）；构建产物扫描 |
| | AC-NFR-DEV-001-02 不读取线上凭据 | `scripts/dev/local-env.sh` 只读取 `temp/local-postgres/secrets.env` 与可选 `temp/local-dev/services.env`，先 `unset` 当前 shell 继承的 LINE/SMTP/TextIn/Vision/LLM/GCS 变量；`OCR_WORKER_ENABLED`、`REMINDERS_ENABLED` 默认 false；`start-local-dev.sh` 不启动 worker 与提醒进程。实际启动后 `scripts/dev/check-local-dev.sh` 输出 OK（数据目标为隔离库、API 仅监听 127.0.0.1） |
| NFR-DEV-002 受限独立开发登录 | AC-NFR-DEV-002-01 本地真实会话 | `tests/integration/test_dev_login.py`（保留 token 生成真实会话、固定开发身份、不创建 admin 账号、seed 幂等）；`tests/unit/test_dev_login.py`（仍要求 CSRF 头）；两个客户端 `devLogin.test.tsx`（登录→登出→再登录）；浏览器实测：PC `http://localhost:5174` 与小程序 `http://localhost:5173` 均无 LINE 跳转直接进入开发账号 |
| | AC-NFR-DEV-002-02 非本地失败关闭 | `tests/unit/test_dev_login_config.py`（生产环境、不安全数据目标启动时拒绝）；`tests/unit/test_dev_login.py`（非回环来源拒绝；`test_browser_not_on_this_machine_rejected`：局域网 Host、DNS rebinding Host、局域网/外站/`null` Origin、空 Host 均 401，不创建身份、不发会话、不调用 LINE；`test_browser_on_this_machine_allowed`：localhost+Origin、`127.0.0.1:8010`、`[::1]` 通过）；`tests/integration/test_dev_login.py::test_reserved_token_from_another_host_is_invalid` |
| | AC-NFR-DEV-002-03 任意身份不可指定 | `tests/unit/test_dev_login.py`、`tests/integration/test_dev_login.py`（其他 token、附带用户标识均不能取得其他用户会话） |
| NFR-DEV-003 测试数据保护 | AC-NFR-DEV-003-01 禁止共享库 | `tests/unit/test_db_target_guard.py`：`saiflow`、开发库、非回环主机、线上地址在首次连接前拒绝，`REQUIRE_INTEGRATION=1` 不能绕过；守卫在 `tests/db_target_guard.py`，由 `tests/conftest.py` 与 `tests/integration/db_fixtures.py` 在连接前调用 |
| | AC-NFR-DEV-003-02 独立测试运行 | 集成测试只在本地集群 `saiflow_test_regression` 上执行（见 §1）；开发库与恢复库未被迁移或清表 |

## 3. 审查修复：经 Vite 代理暴露到局域网

代码审查发现：开发服务器若以 `--host` 对局域网开放，Vite 代理把请求从 `127.0.0.1` 转发给 API，仅凭 TCP 来源为回环会放行局域网浏览器。修复：`services/api/app/services/dev_login_service.py` 新增 `is_loopback_browser`，开发登录除回环来源外，还要求 `Host` 为 `localhost`/回环地址，且若带 `Origin`，其协议为 http(s) 且主机为回环；否则按普通无效 LINE token 返回 401。`app/routers/auth.py` 传入请求的 `Host` 与 `Origin`。集成测试因夹具基址为 `https://test`，开发 token 请求改为显式带 `Host: localhost:5173`。

实测又发现一处：Vite 的字符串形式代理默认 `changeOrigin: true`，会把 Host 改写为 `127.0.0.1:8010`，后端看不到浏览器使用的主机（浏览器发 POST 时总带 Origin，所以局域网浏览器仍会被 Origin 检查拦下，但不带 Origin 的局域网客户端可以通过）。两个 `vite.config.ts` 改为对象形式并设 `changeOrigin: false`，与部署时 Caddy 保留 Host 的行为一致。

真实栈复测（`scripts/dev/start-local-dev.sh --skip-migrate`，隔离库 `saiflow_dev`）：经 Vite 代理对 `/api/v1/auth/line` 提交开发 token——

| 请求 | 结果 |
|---|---|
| mini `Host: localhost:5173` + `Origin: http://localhost:5173` | 200 |
| PC `Host: localhost:5174` + `Origin: http://localhost:5174` | 200 |
| `Host: localhost:5173`，不带 Origin | 200 |
| `Host: 192.168.1.50:5173` / `192.168.1.50:5174`（局域网） | 401 / 401（修复前 200） |
| `Host: localhost:5173` + `Origin: http://192.168.1.50:5173` | 401 |
| `Host: evil.example:5173`（DNS rebinding） | 403（Vite 主机白名单先拦下） |

浏览器复测：PC 登出 → `/login?next=%2F` → “Local development login” → 首页显示 SaiFlow Dev；小程序登出 → 访客首页 → 我的 → “Log in / Register” → 显示 SaiFlow Dev。修改后两个客户端 `eslint`、`tsc` 为 0，登录相关测试 line-mini 34 个、web-pc 33 个通过。

## 4. 未覆盖与限制

- 没有独立的 GCS、OCR（TextIn/Vision）、LLM、SMTP、LINE 开发凭据，相关真实链路（上传原件到存储、真实识别、发信、LINE 分享）**未验证**；本地保持"未配置"状态，没有用线上凭据替代。
- 小程序在本地浏览器中 `isInClient()` 为 false，LINE 内专属功能（分享目标选择器）按设计不可用，未在 LINE 客户端内验证。
- 集成测试在全量并行负载下有 2 个偶发超时，单独重跑通过；不是本变更引入的行为问题，但说明本机负载下有时序敏感用例。
- 修复记录：`devLogin.test.tsx` 的"再登录"一步原先可能点到登出后即将卸载的"我的"页按钮（登出按 FR-SYS-043 回到首页），导致偶发失败；改为等首页出现后经底部导航回到"我的"再点击。产品代码未改，连续 6 次单独运行通过。
- 提交前复查（2026-11-09）：CI 的后端任务原用数据库名 `saiflow_test`，会被 NFR-DEV-003 的测试库守卫拒绝（只允许回环主机上的 `saiflow_test_<name>`），导致 CI 必然失败、部署门禁无法通过。已把 `.github/workflows/ci.yml` 的 CI 一次性数据库改名为 `saiflow_test_ci`（`POSTGRES_DB`、健康检查与 `TEST_DB_NAME` 三处），守卫规则不放宽。本机复跑 `ruff check`、`ruff format --check` 通过，单元测试 415 passed。
