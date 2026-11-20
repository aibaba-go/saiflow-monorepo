# rebuild-identity（B-2a 身份）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `services/api` 中实现客户 LINE 登录与会话、游客会话与数据归集、注册与邮箱验证码、个人资料与更换邮箱、平台管理员后台账号，以及带校验链的操作日志（只做后端接口）。

**Architecture:** 按 STD-005 分层：`routers/`（HTTP）→ `services/`（业务规则）→ `repositories/`（SQLAlchemy async）→ `models/`（ORM，schema `saiflow_v3`）；外部服务（LINE、SMTP）放 `integrations/`，经依赖注入，测试用假实现替换。会话是随机令牌，放在 HttpOnly Cookie 中，数据库只存令牌的 SHA-256。操作日志与业务写入在同一事务内追加，数据库触发器禁止修改与删除。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy 2 async + asyncpg、Alembic、httpx（LINE 接口）、aiosmtplib（SMTP）、argon2-cffi（口令哈希）、email-validator；pytest + pytest-asyncio。

**Spec:** `openspec/changes/rebuild-identity/specs/identity/spec.md`（决定与假设见同目录 `proposal.md` D1–D11、A1–A4）。

## Global Constraints

- 只在分支 `chore/ai-workflow-v2` 提交，提交信息以 `[rebuild-identity]` 开头；可以推送到该分支；**部署（Task 12）前必须得到负责人确认**。`legacy/` 只读。
- Python 命令只在 `services/api/` 内执行（`uv run …`）。本机没有 PostgreSQL：需要数据库的测试标 `pytest.mark.integration`，在本机跳过，在 CI（`REQUIRE_INTEGRATION=1`）中必须运行。数据库相关的 RED/GREEN 以 CI 结果为准：先推送只含测试的提交看到失败，再推送实现看到通过。
- 所有接口前缀 `/api/v1`；错误一律走 `ErrorResponse`（FR-PLAT-002）。本 change 的业务校验错误用 **HTTP 400**（spec 要求），由 `AppError` 返回，`fields` 列出字段名；请求模型的字段全部声明为可选字符串，内容规则在 service 中检查，避免 FastAPI 的 422。
- 错误码与消息键固定为：

| HTTP | code | message_key | fields |
|------|------|-------------|--------|
| 400 | `validation_error` | `error.validation` | 出错字段 |
| 400 | `line_token_required` | `auth.line_token_required` | — |
| 400 | `email_code_invalid` | `error.email_code_invalid` | `["code"]` |
| 400 | `email_unchanged` | `error.email_unchanged` | `["email"]` |
| 401 | `unauthenticated` | `auth.required` | — |
| 401 | `line_token_invalid` | `auth.line_token_invalid` | — |
| 401 | `admin_login_failed` | `admin.login_failed` | —（口令错、用户名不存在、已锁定、已停用都用这一个） |
| 403 | `registration_required` | `auth.registration_required` | — |
| 403 | `csrf_header_missing` | `error.csrf` | — |
| 404 | `not_found` | `error.not_found` | — |
| 409 | `already_registered` | `registration.already_done` | — |
| 409 | `email_taken` | `error.email_taken` | `["email"]` |
| 429 | `email_code_too_soon` | `error.email_code_too_soon` | — |
| 503 | `line_unavailable` | `auth.line_unavailable` | — |
| 503 | `email_unavailable` | `error.email_service_unavailable` | — |

- 数值：客户会话闲置 30 天失效（每次使用顺延）；后台会话闲置 30 分钟失效；验证码 6 位数字、10 分钟有效、60 秒重发间隔、输错 5 次作废；后台口令至少 12 个字符，连续 5 次错误锁定 15 分钟；外部服务临时性错误重试 3 次（共 4 次调用），间隔 0.5 s、1 s、2 s；昵称 1–128 个字符；手机号规则见 FR-SYS-015。
- Cookie：客户 `saiflow_session`，后台 `saiflow_admin_session`；均 `HttpOnly; Secure; SameSite=Lax; Path=/api`，不设 `Domain`（只发给签发的子域名）。测试客户端的 `base_url` 用 `https://test`，否则 Secure Cookie 不会回传。
- 所有改变状态且依靠 Cookie 认证的请求（POST/PATCH/DELETE）必须带请求头 `X-Requested-With: SaiFlow`，否则 403 `csrf_header_missing`（`aibaba.asia` 的子域名之间属于同站，SameSite 挡不住；自定义请求头会触发跨源预检，而后端不开放 CORS）。登录与建游客会话也要求此头。
- 凭据只来自环境变量；新增配置项全部可缺省（缺省时对应功能返回 503），不影响现有部署启动。日志与操作日志中不得出现口令、验证码、LINE 令牌、会话令牌。
- 邮箱一律去首尾空格、转小写后保存与比较；用 `email_validator.validate_email(..., check_deliverability=False)` 检查格式。

## Review Focus

1. 同一 LINE 身份几乎同时登录两次（用户连点）→ 两次都成功且只有一个用户与一个个人租户，不能返回 500 → Task 6 `test_concurrent_first_login_creates_one_user`。
2. 邮箱大小写与空格不同（`" A@X.com "` 与 `a@x.com`）→ 视为同一个邮箱，第二个用户注册被 409 拒绝 → Task 8 `test_email_taken_is_case_insensitive`。
3. 带着一个已过期或已退出的游客 Cookie 去 LINE 登录 → 正常登录、不做归集、不报 401 → Task 6 `test_login_with_expired_guest_cookie_skips_claim`。
4. 两个请求同时写操作日志 → 校验链仍然完整 → Task 3 `test_concurrent_writes_keep_chain_valid`。
5. LINE 令牌中没有 `email`、`name` 或 `picture` → 登录仍成功，昵称留空、不预填邮箱 → Task 6 `test_login_without_optional_claims`。

---

### Task 1: 基础：AppError、配置项、重试、数据库会话

**Files:**
- Modify: `services/api/app/errors.py`、`app/config.py`、`app/db.py`、`app/dependencies.py`、`pyproject.toml`（加 `httpx`（移到运行依赖）、`aiosmtplib`、`argon2-cffi`、`email-validator`）、`.env.example`
- Create: `services/api/app/retry.py`、`app/clock.py`
- Test: `tests/unit/test_app_error.py`、`tests/unit/test_retry.py`、`tests/unit/test_config.py`（追加）

**Interfaces:**
- Produces:
  - `class AppError(Exception)`：`__init__(self, status: int, code: str, message_key: str, fields: list[str] | None = None)`；`register_error_handlers` 把它转成 `ErrorResponse`。
  - `Settings` 新字段（全部可选）：`line_channel_id: str | None`、`line_channel_secret: SecretStr | None`、`line_login_redirect_uris: str = ""`（逗号分隔）、`smtp_host: str | None`、`smtp_port: int = 587`、`smtp_username: str | None`、`smtp_password: SecretStr | None`、`smtp_from: str | None`、`smtp_security: Literal["starttls", "ssl"] = "starttls"`。
  - `async def with_retries(call: Callable[[], Awaitable[T]], *, is_transient: Callable[[BaseException], bool], retries: int = 3, base_delay: float = 0.5, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> T`：非临时性错误立即抛出；临时性错误重试，等待 `base_delay * 2**i`；用完后抛出最后一个错误。
  - `def utcnow() -> datetime`（`app/clock.py`，带时区 UTC；测试可 monkeypatch）。
  - `def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]`（`expire_on_commit=False`）；lifespan 存到 `app.state.sessionmaker`；依赖 `async def get_db(request) -> AsyncIterator[AsyncSession]`。

- [ ] **Step 1: 写失败测试**
  - `test_app_error_renders_error_response`：测试路由抛 `AppError(409, "email_taken", "error.email_taken", ["email"])` → 409，body `code/message_key/fields/request_id` 正确。
  - `test_retries_transient_three_times`：一个总是抛临时错误的调用 → 共调用 4 次，`sleep` 收到 `[0.5, 1.0, 2.0]`，最后抛出原错误。
  - `test_no_retry_for_permanent_error`：抛非临时错误 → 只调用 1 次。
  - `test_returns_after_transient_then_success`：第 2 次成功 → 返回值，调用 2 次。
  - `test_optional_integrations_default_to_none`：只给 4 个必需变量 → `line_channel_id is None`、`smtp_host is None`、`smtp_security == "starttls"`。
- [ ] **Step 2: 运行** `uv run pytest tests/unit -q` → Expected: 上述新测试 FAIL（导入错误或断言失败）。
- [ ] **Step 3: 实现** 上面的接口；`.env.example` 列出新变量名（不填值）。
- [ ] **Step 4: 运行** `uv run pytest -q && uv run ruff check . && uv run ruff format --check .` → Expected: 全部 PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] AppError, optional LINE/SMTP settings, retry helper, db sessions`

### Task 2: 数据表、迁移与测试数据库夹具

**Files:**
- Create: `services/api/app/models/__init__.py`、`models/user.py`、`models/tenant.py`、`models/session.py`、`models/email_code.py`、`models/admin.py`、`models/audit.py`、`alembic/versions/0002_identity.py`、`tests/integration/db_fixtures.py`
- Modify: `tests/conftest.py`（导入 `db_fixtures` 中的夹具）、`alembic/env.py`（导入 `app.models` 使 metadata 完整）
- Test: `tests/integration/test_identity_schema.py`

**Interfaces:**
- Produces（表都在 `saiflow_v3`，主键 `id bigint identity`，时间列 `timestamptz`）：
  - `users`：`line_user_id text unique not null`、`display_name text null`、`avatar_url text null`、`line_email text null`（只作注册预填）、`email text unique null`、`phone text null`、`registered_at null`、`created_at`。
  - `tenants`：`kind text check in ('personal','guest')`、`owner_user_id bigint null references users`、`status text check in ('active','claimed') default 'active'`、`created_at`；部分唯一索引：`kind='personal'` 时 `owner_user_id` 唯一。
  - `customer_sessions`：`token_hash bytea unique`、`kind text check in ('guest','user')`、`user_id null references users`、`tenant_id references tenants`、`created_at`、`last_used_at`、`revoked_at null`。
  - `email_codes`：`user_id references users`、`email text`、`code_hash bytea`、`sent_at`、`expires_at`、`failed_attempts int default 0`、`used_at null`、`voided_at null`。
  - `admin_accounts`：`username text unique`、`password_hash text`、`failed_attempts int default 0`、`locked_until null`、`disabled_at null`、`created_at`；`admin_sessions`：`token_hash bytea unique`、`admin_id references admin_accounts`、`created_at`、`last_used_at`、`revoked_at null`。
  - `audit_log`：`occurred_at`、`actor_type text check in ('user','guest','admin','system')`、`actor_id text null`、`action text`、`target_type text`、`target_id text null`、`result text check in ('success','failure')`、`prev_hash bytea`、`hash bytea`；迁移中建触发器：`BEFORE UPDATE OR DELETE`（行级）与 `BEFORE TRUNCATE`（语句级）一律 `RAISE EXCEPTION 'audit_log is append-only'`。
  - 租户数据登记：凡是属于某个租户的业务表，ORM 表上设 `info={"tenant_scoped": True}` 且有 `tenant_id` 列；Task 6 的归集据此找表。本 change 中没有这种业务表。
  - 测试夹具（`tests/integration/db_fixtures.py`）：`migrated_db`（session 级：对 `db_settings` 的库执行一次 `alembic upgrade head`）、`db`（每个测试一个 `AsyncSession`；测试结束后以 `SET session_replication_role = replica` 后 `TRUNCATE … RESTART IDENTITY CASCADE` 清空本 change 的全部表）、`api`（用 `LifespanManager` 启动 `create_app(db_settings)` 的 `httpx.AsyncClient`，`base_url="https://test"`，默认带 `X-Requested-With: SaiFlow`）。
- [ ] **Step 1: 写失败测试** `test_identity_schema.py`：
  - `test_tables_exist`：上面 8 张表都在 `saiflow_v3`。
  - `test_one_personal_tenant_per_user`：同一用户插第二个 `personal` 租户 → `IntegrityError`。
  - `test_audit_log_rejects_update_and_delete`（AC-FR-SYS-003-03）：以应用连接插一行后执行 `UPDATE` 与 `DELETE` → 都抛数据库错误，行不变。
- [ ] **Step 2: 推送测试提交**，CI `backend` → Expected: 这 3 个测试 FAIL。
- [ ] **Step 3: 实现** models 与 `0002_identity.py`（`downgrade` 删除这些表与触发器函数）。
- [ ] **Step 4: 推送**，CI → Expected: 全部 PASS；`test_migrations.py` 仍通过。
- [ ] **Step 5: 提交** `[rebuild-identity] identity tables, append-only audit_log, integration db fixtures`（RED 与 GREEN 各一次提交）

### Task 3: 操作日志：写入、校验链与检查命令（FR-SYS-003）

**Files:**
- Create: `services/api/app/repositories/audit_repo.py`、`app/services/audit_service.py`、`app/cli.py`
- Test: `tests/integration/test_audit_log.py`、`tests/unit/test_audit_hash.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class AuditEvent`：`actor_type: Literal["user","guest","admin","system"]`、`actor_id: str | None`、`action: str`、`target_type: str`、`target_id: str | None`、`result: Literal["success","failure"]`。
  - `def entry_hash(prev_hash: bytes, event: AuditEvent, occurred_at: datetime) -> bytes`：`sha256(prev_hash + json.dumps({...}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())`；首条记录的 `prev_hash` 为 32 个 0 字节。
  - `async def record(db: AsyncSession, event: AuditEvent) -> None`：在调用方事务内先 `SELECT pg_advisory_xact_lock(4207001)`，读最后一条的 `hash`，再插入。调用方负责提交；失败类事件（如后台登录失败）由调用方在独立事务中写并提交。
  - `async def find_first_broken(db: AsyncSession) -> int | None`：按 `id` 顺序重算，返回第一条不符的 `id`，完整时返回 `None`。
  - 操作名（后续任务使用，固定）：`customer.login`、`customer.logout`、`guest.create`、`guest.claim`、`user.register`、`user.update_profile`、`user.change_email`、`user.email_code`、`admin.login`、`admin.lock`、`admin.create`、`admin.disable`、`admin.reset_password`。
  - 命令：`python -m app.cli audit-verify` → 完整时打印 `audit log OK (<n> entries)` 退出 0；否则打印 `audit log BROKEN at id <id>` 退出 1。（`app/cli.py` 用 `argparse` 子命令，Task 9 再加 admin 子命令。）
- [ ] **Step 1: 写失败测试**
  - 单元 `test_entry_hash_changes_with_any_field`：改任一字段或 `prev_hash`，哈希都变。
  - 集成 `test_record_links_to_previous`：写 3 条 → 第 n 条的 `prev_hash` 等于第 n-1 条的 `hash`；`find_first_broken` 返回 `None`。
  - 集成 `test_verify_detects_tampering`（AC-FR-SYS-003-04）：写 3 条后以 `SET session_replication_role = replica` 改第 2 条的 `action` → `find_first_broken == 2`；`audit-verify` 命令退出码 1 且输出含 `id 2`；未改动时退出 0。
  - 集成 `test_concurrent_writes_keep_chain_valid`（Review Focus 4）：两个独立会话各写 20 条（`asyncio.gather`）→ 共 40 条且链完整。
- [ ] **Step 2: 运行** 单元测试本机 FAIL；推送后集成测试在 CI FAIL。
- [ ] **Step 3: 实现** 上述接口。
- [ ] **Step 4: 推送**，CI → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] audit log with hash chain and audit-verify command (FR-SYS-003)`

### Task 4: 客户会话、游客会话、退出与租户访问检查

**Files:**
- Create: `services/api/app/repositories/session_repo.py`、`repositories/tenant_repo.py`、`app/services/session_service.py`、`app/services/tenant_access.py`、`app/routers/auth.py`、`app/routers/me.py`、`app/schemas/auth.py`
- Modify: `app/dependencies.py`、`app/main.py`（注册路由）
- Test: `tests/integration/test_sessions.py`、`tests/unit/test_csrf_header.py`

**Interfaces:**
- Consumes: Task 3 `record`、`AuditEvent`。
- Produces:
  - `@dataclass(frozen=True) class Principal`：`kind: Literal["guest","user"]`、`session_id: int`、`tenant_id: int`（游客为临时租户，用户为个人租户）、`user_id: int | None`。
  - `session_service`：`CUSTOMER_COOKIE = "saiflow_session"`、`CUSTOMER_IDLE = timedelta(days=30)`；`def new_token() -> str`（`secrets.token_urlsafe(32)`）、`def hash_token(token: str) -> bytes`（SHA-256）；`async def create_guest(db) -> tuple[str, Principal]`（建 `guest` 租户与会话，记 `guest.create`）；`async def create_user_session(db, user_id: int, tenant_id: int) -> str`；`async def resolve(db, token: str) -> Principal | None`（未撤销、`utcnow() - last_used_at <= CUSTOMER_IDLE`，命中则把 `last_used_at` 更新为现在）；`async def revoke(db, session_id: int) -> None`。
  - `def ensure_tenant_access(principal: Principal, tenant_id: int) -> None`：`tenant_id != principal.tenant_id` 时抛 `AppError(404, "not_found", "error.not_found")`（B-2b 扩展为成员关系）。
  - 依赖：`get_optional_principal`（读 Cookie，无效返回 None）、`get_principal`（无则 401 `unauthenticated`）、`require_user`（游客 → 401 `unauthenticated`）、`require_registered_user`（未注册 → 403 `registration_required`）、`require_csrf_header`（POST/PATCH/DELETE 缺 `X-Requested-With: SaiFlow` → 403）。
  - 接口：`POST /api/v1/auth/guest` → 200 `MeResponse`（已有有效客户会话时原样返回当前身份，不新建）；`POST /api/v1/auth/logout` → 204，撤销会话、清 Cookie，记 `customer.logout`；`GET /api/v1/me` → 200 `MeResponse`（游客与用户都可调用）。
  - `MeResponse`：`kind: Literal["guest","user"]`、`tenant_id: int`、`user_id: int | None`、`registered: bool`、`display_name: str | None`、`avatar_url: str | None`、`email: str | None`、`phone: str | None`、`email_suggestion: str | None`（未注册用户的 LINE 邮箱，其余为 None）。
- [ ] **Step 1: 写失败测试**
  - `test_create_guest_session`（AC-FR-SYS-010-01）：无 Cookie 调 `POST /auth/guest` → 200，`kind=="guest"`，库中有一个 `guest` 租户与会话；随后 `GET /me` 返回同一 `tenant_id`。
  - `test_guest_cannot_read_other_guest_tenant`（AC-FR-SYS-010-02）：测试专用路由 `GET /api/v1/_test/tenants/{tenant_id}`（调用 `ensure_tenant_access`）→ 游客 B 读 A 的租户得 404，响应不含 A 的租户号以外的数据。
  - `test_session_expires_after_30_idle_days`（AC-FR-SYS-001-06）：把 `last_used_at` 改为 30 天零 1 秒前 → `GET /me` 401。
  - `test_session_use_extends_lifetime`（AC-FR-SYS-001-07）：`last_used_at` 设为 29 天前 → `GET /me` 200，且 `last_used_at` 变为当前时间。
  - `test_logout_revokes_session`（AC-FR-SYS-001-08）：退出 204 后 `GET /me` 401。
  - 单元 `test_post_without_csrf_header_is_403`：`POST /auth/guest` 不带请求头 → 403 `csrf_header_missing`。
- [ ] **Step 2: 推送测试**，CI → Expected: FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 推送**，CI → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] customer and guest sessions, logout, tenant access guard (FR-SYS-001, FR-SYS-010)`

### Task 5: LINE 适配器（校验身份令牌、网页授权码兑换、重试）

**Files:**
- Create: `services/api/app/integrations/__init__.py`、`app/integrations/line.py`
- Modify: `app/main.py`（lifespan 中建 `httpx.AsyncClient(timeout=5)` 与 `LineClient`，设置缺失时为 `None`）、`app/dependencies.py`（`get_line_client`，为 None 时 503 `line_unavailable`）
- Test: `tests/unit/test_line_client.py`

**Interfaces:**
- Consumes: Task 1 `with_retries`。
- Produces:
  - `@dataclass(frozen=True) class LineIdentity`：`sub: str`、`name: str | None`、`picture: str | None`、`email: str | None`。
  - `class LineInvalidToken(Exception)`、`class LineUnavailable(Exception)`。
  - `class LineClient`：`__init__(self, channel_id: str, channel_secret: str | None, http: httpx.AsyncClient, sleep=asyncio.sleep)`；
    - `async def verify_id_token(self, id_token: str) -> LineIdentity`：`POST https://api.line.me/oauth2/v2.1/verify`，表单 `id_token`、`client_id=channel_id`；200 时再检查 `iss == "https://access.line.me"` 且 `aud == channel_id`，否则 `LineInvalidToken`；400 → `LineInvalidToken`；5xx、429、超时、连接错误为临时性，经 `with_retries` 重试，用完后 `LineUnavailable`。
    - `async def exchange_code(self, code: str, redirect_uri: str) -> str`：`POST https://api.line.me/oauth2/v2.1/token`（`grant_type=authorization_code`、`code`、`redirect_uri`、`client_id`、`client_secret`），返回 `id_token`；400 → `LineInvalidToken`；临时性错误同上；未配置 `channel_secret` → `LineUnavailable`。
- [ ] **Step 1: 写失败测试**（`httpx.MockTransport`，`sleep` 用记录型假函数）：
  - `test_verify_ok_returns_identity`：200 + 合法 `iss/aud` → `LineIdentity` 字段正确。
  - `test_verify_rejects_wrong_audience`、`test_verify_rejects_wrong_issuer` → `LineInvalidToken`。
  - `test_verify_400_is_invalid_without_retry`：400 → `LineInvalidToken`，只请求 1 次。
  - `test_verify_retries_5xx_then_unavailable`（AC-FR-SYS-001-05 的适配器部分）：一直 503 → 请求 4 次，`sleep` 为 `[0.5, 1.0, 2.0]`，抛 `LineUnavailable`。
  - `test_verify_timeout_is_transient`：抛 `httpx.ReadTimeout` → 同样重试后 `LineUnavailable`。
  - `test_exchange_code_returns_id_token`：200 → 返回 `id_token`；表单中带 `client_secret`。
- [ ] **Step 2: 运行** `uv run pytest tests/unit/test_line_client.py -q` → Expected: FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行** → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] LINE client: id_token verification, code exchange, retries`

### Task 6: LINE 登录、首次建用户与个人租户、游客数据归集

**Files:**
- Create: `services/api/app/repositories/user_repo.py`、`app/services/auth_service.py`、`app/services/claim_service.py`、`tests/integration/fake_line.py`（`FakeLineClient`：令牌 → `LineIdentity` 或异常）
- Modify: `app/routers/auth.py`、`app/schemas/auth.py`
- Test: `tests/integration/test_line_login.py`、`tests/integration/test_guest_claim.py`

**Interfaces:**
- Consumes: Task 4 `session_service`、`Principal`；Task 5 `LineClient` 接口；Task 3 `record`。
- Produces:
  - `POST /api/v1/auth/line`，请求 `LineLoginRequest`：`id_token: str | None`、`code: str | None`、`redirect_uri: str | None`（其他字段忽略）。恰好提供 `id_token`，或同时提供 `code` 与 `redirect_uri`；否则 400 `line_token_required`。`redirect_uri` 必须在 `line_login_redirect_uris` 中，否则 400 `validation_error`（`fields=["redirect_uri"]`）。响应 200 `MeResponse` 并设置新的客户 Cookie。
  - `async def login_with_line(db, line: LineClient, current: Principal | None, req: LineLoginRequest) -> tuple[str, User, int]`（新令牌、用户、个人租户号）：按 `sub` 找用户；没有则建用户（`display_name=name`、`avatar_url=picture`、`line_email=email`）与个人租户；已有用户只更新 `avatar_url`，未注册用户另更新 `line_email`，不改 `display_name/email/phone`；建用户时的唯一约束冲突（并发首次登录）回滚后重读该用户。`current` 为有效游客时调用归集并撤销游客会话；记 `customer.login`（有归集时另记 `guest.claim`）。
  - `def tenant_scoped_tables() -> list[Table]`：`Base.metadata.sorted_tables` 中 `info.get("tenant_scoped")` 为真的表。
  - `async def claim_guest_tenant(db, guest_tenant_id: int, personal_tenant_id: int) -> None`：在调用方事务内对每张租户数据表执行 `UPDATE … SET tenant_id = :personal WHERE tenant_id = :guest`，再把游客租户 `status` 设为 `claimed`；任一步失败整体回滚（游客会话也不撤销）。
- [ ] **Step 1: 写失败测试**（测试模块在 `Base.metadata` 上定义表 `test_tenant_items(id, tenant_id, label)`，`info={"tenant_scoped": True}`，在夹具中建表）：
  - `test_first_login_creates_user_and_personal_tenant`（AC-FR-SYS-001-01）。
  - `test_second_login_same_user`（AC-FR-SYS-001-02）：同一 `sub` 用 `id_token` 与 `code` 两种方式各登录一次 → `user_id` 相同，用户与个人租户各只有 1 个。
  - `test_invalid_token_401_creates_nothing`（AC-FR-SYS-001-03）：假客户端抛 `LineInvalidToken` → 401 `line_token_invalid`，`users`、`tenants`、`customer_sessions` 行数不变。
  - `test_dev_identity_rejected`（AC-FR-SYS-001-04）：body `{"dev_id": "u1"}` → 400 `line_token_required`，三张表行数不变。
  - `test_line_unavailable_503`（AC-FR-SYS-001-05）：抛 `LineUnavailable` → 503 `line_unavailable`，无会话。
  - `test_relogin_keeps_saved_profile`（AC-FR-SYS-014-06）：已注册用户的 `display_name` 与 LINE `name` 不同，再登录后不变。
  - `test_concurrent_first_login_creates_one_user`（Review Focus 1）：同一 `sub` 并发 2 次登录 → 都是 200，用户与个人租户各 1 个。
  - `test_login_without_optional_claims`（Review Focus 5）。
  - `test_login_with_expired_guest_cookie_skips_claim`（Review Focus 3）。
  - `test_claim_into_new_user`（AC-FR-SYS-010-03）：游客租户有 2 条 `test_tenant_items` → 登录后都属于新个人租户；旧游客 Cookie 调 `GET /me` 为 401。
  - `test_claim_into_registered_user`（AC-FR-SYS-010-04）：个人租户原有 1 条，游客 2 条 → 登录后共 3 条，原有那条内容不变。
  - `test_claim_failure_rolls_back`（AC-FR-SYS-010-05）：monkeypatch 使归集在第一张表更新后抛错 → 登录 500，游客租户的数据全部仍在原租户，游客会话仍可 `GET /me`。
- [ ] **Step 2: 推送测试**，CI → Expected: FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 推送**，CI → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] LINE login, personal tenant on first login, guest data claim (FR-SYS-001, FR-SYS-010)`

### Task 7: SMTP 发信与邮箱验证码（FR-SYS-020）

**Files:**
- Create: `services/api/app/integrations/email.py`、`app/repositories/email_code_repo.py`、`app/services/email_code_service.py`、`app/schemas/me.py`、`tests/integration/fake_email.py`（`FakeEmailSender`：记录收件人与正文，可设定为抛 `EmailUnavailable`）
- Modify: `app/routers/me.py`、`app/main.py`（SMTP 配置齐全时建 `SmtpSender`，否则 `None`）、`app/dependencies.py`（`get_email_sender`，None 时 503 `email_unavailable`）
- Test: `tests/unit/test_smtp_sender.py`、`tests/integration/test_email_code.py`

**Interfaces:**
- Consumes: Task 1 `with_retries`、`AppError`；Task 4 `require_user`。
- Produces:
  - `class EmailUnavailable(Exception)`；`class SmtpSender`：`__init__(self, host: str, port: int, username: str | None, password: str | None, sender: str, security: Literal["starttls","ssl"], send=aiosmtplib.send, sleep=asyncio.sleep)`；`async def send(self, to: str, subject: str, body: str) -> None`：`security="ssl"` 用 `use_tls=True`，否则 `start_tls=True`；`SMTPConnectError`、`SMTPServerDisconnected`、超时与 4xx 响应为临时性（重试），5xx 立即 `EmailUnavailable`，重试用完也 `EmailUnavailable`。
  - `email_code_service`：`CODE_TTL = timedelta(minutes=10)`、`RESEND_INTERVAL = timedelta(seconds=60)`、`MAX_FAILED = 5`；`def normalize_email(raw: str | None, field: str = "email") -> str`（不合格抛 400 `validation_error`，`fields=[field]`）；`async def send_code(db, sender, user_id: int, email: str) -> None`：上次成功发送距今不足 60 秒 → 429 `email_code_too_soon`；生成 `f"{secrets.randbelow(10**6):06d}"`，先发信，成功后作废该用户此前未用的码并插入新码（只存 `sha256(f"{user_id}:{email}:{code}")`），记 `user.email_code`；发信失败 → 503 `email_unavailable`，不插入。
  - `async def consume_code(db, user_id: int, email: str, code: str | None) -> None`：取该用户最新一条未作废、未使用的码；不存在、邮箱不符、过期或哈希不符 → 400 `email_code_invalid`；哈希不符时 `failed_attempts += 1`，达到 5 时作废；成功时写 `used_at`。调用方在同一事务内完成后续写入。
  - 邮件：主题 `SaiFlow verification code`，正文含验证码与"10 分钟内有效"。
  - `POST /api/v1/me/email-code`，请求 `EmailCodeRequest(email: str | None)` → 204。只限已登录用户（游客 401）。
- [ ] **Step 1: 写失败测试**
  - 单元 `test_smtp_retries_4xx_then_unavailable`（AC-FR-SYS-020-06 适配器部分）：假 `send` 一直抛 451 → 调用 4 次，`sleep` 为 `[0.5, 1.0, 2.0]`，抛 `EmailUnavailable`。
  - 单元 `test_smtp_5xx_no_retry`、`test_smtp_ssl_vs_starttls_flags`。
  - 集成 `test_send_code_ok`（AC-FR-SYS-020-01）：204，假发信器收到 1 封发往 `e@x.com` 的邮件，正文含一个 6 位数字，响应体为空。
  - `test_resend_within_60s_is_429`（AC-FR-SYS-020-02）：第二次 429，只发出 1 封，第一封的码仍可 `consume_code`。
  - `test_new_code_voids_old`（AC-FR-SYS-020-03）：把第一条的 `sent_at` 改到 61 秒前后再发 → 用第一封的码 `consume_code` 抛 400。
  - `test_code_expires_after_10_minutes`（AC-FR-SYS-020-04）。
  - `test_five_wrong_attempts_void_code`（AC-FR-SYS-020-05）。
  - `test_send_failure_is_503_and_no_code`（AC-FR-SYS-020-06）：假发信器抛 `EmailUnavailable` → 503，`email_codes` 无新行。
  - `test_smtp_not_configured_is_503`（AC-FR-SYS-020-07）：`create_app` 时不给 SMTP 配置 → 503。
  - `test_code_not_in_logs`（AC-FR-SYS-020-08）：用 `caplog` 捕获一次成功发送与一次错误提交，日志文本与 `audit_log` 全部列中都不含该验证码。
  - `test_malformed_email_is_400`：`email="not-an-email"` → 400，`fields == ["email"]`，不发信。
- [ ] **Step 2: 运行** 单元本机 FAIL；推送后集成在 CI FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 推送**，CI → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] SMTP sender with retries, email verification codes (FR-SYS-020)`

### Task 8: 注册、修改个人资料、更换邮箱（FR-SYS-014/015/016）

**Files:**
- Create: `services/api/app/services/user_service.py`
- Modify: `app/routers/me.py`、`app/schemas/me.py`、`app/repositories/user_repo.py`
- Test: `tests/integration/test_registration.py`、`tests/integration/test_profile.py`、`tests/unit/test_phone_rules.py`、`tests/integration/test_identity_audit.py`

**Interfaces:**
- Consumes: Task 7 `normalize_email`、`consume_code`；Task 4 `require_user`、`require_registered_user`；Task 3 `record`。
- Produces:
  - `def normalize_phone(raw: str | None) -> str | None`：去首尾空格；空串 → `None`；长度 > 32、含 `+ 0-9 空格 ( ) . -` 以外字符、或数字个数不在 6–15 → 400 `validation_error`（`fields=["phone"]`）。
  - `def normalize_display_name(raw: str | None) -> str`：去首尾空格后 1–128 个字符，否则 400（`fields=["display_name"]`）。
  - `POST /api/v1/me/registration`，`RegistrationRequest(email, code, display_name, phone: str | None)` → 200 `MeResponse`。先收集 `email`、`display_name`、`phone` 的格式错误一并返回 400；已注册 → 409 `already_registered`；邮箱属于他人 → 409 `email_taken`；再 `consume_code`；成功写 `email`、`phone`、`display_name`、`registered_at`，记 `user.register`。只限已登录用户（游客 401）。
  - `PATCH /api/v1/me`，`ProfileUpdate(display_name: str | None, phone: str | None)`：只改提供了的字段；`phone=""` 表示清空 → 200 `MeResponse`，记 `user.update_profile`。需已注册（未注册 403，游客 401）。
  - `POST /api/v1/me/email`，`EmailChangeRequest(email, code)`：与当前邮箱相同 → 400 `email_unchanged`；属于他人 → 409 `email_taken`；再 `consume_code`（码必须是发给新邮箱的）→ 200，记 `user.change_email`。需已注册。
  - `email` 唯一约束冲突（并发）转为 409 `email_taken`。
- [ ] **Step 1: 写失败测试**
  - `test_register_ok`（AC-FR-SYS-014-01）、`test_register_bad_code`（AC-FR-SYS-014-02：缺失、错误、过期、已使用、发给别的邮箱，五种都 400 且 `fields==["code"]`）、`test_register_field_errors`（AC-FR-SYS-014-03：空昵称、129 字符、坏邮箱、坏手机号一次提交 → 400，`fields` 含三者）、`test_register_twice_409`（AC-FR-SYS-014-04）、`test_register_email_taken_409`（AC-FR-SYS-014-05）、`test_email_taken_is_case_insensitive`（Review Focus 2）、`test_guest_cannot_register_or_edit`（AC-FR-SYS-010-06：游客调注册、`PATCH /me`、`POST /me/email` 都 401，库中无变化）。
  - 单元 `test_phone_rules`：`"+66 (81) 234-5678"` 合格；`"12345"`（5 位）、16 位数字、33 个字符、含字母 → 都 400。
  - `test_update_profile_ok`（AC-FR-SYS-015-01）、`test_clear_phone`（AC-FR-SYS-015-02）、`test_update_profile_invalid`（AC-FR-SYS-015-03）、`test_unregistered_user_cannot_edit_profile`（403）。
  - `test_change_email_ok`（AC-FR-SYS-016-01：之后用旧邮箱注册另一用户可以成功）、`test_change_to_same_email_400`（AC-FR-SYS-016-02）、`test_change_to_taken_email_409`（AC-FR-SYS-016-03）、`test_change_email_code_for_other_address_400`（AC-FR-SYS-016-04）。
  - `test_identity_audit_trail`（AC-FR-SYS-003-01）：登录 → 注册 → 改资料 → 退出 → 该用户的 `audit_log` 依次为 `customer.login`、`user.register`、`user.update_profile`、`customer.logout`，每条 `actor_type="user"`、`actor_id`、`occurred_at`、`target_type`、`result="success"` 都有值（此前的 `user.email_code` 另计，不在这 4 条中）。
- [ ] **Step 2: 推送测试**，CI → Expected: FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 推送**，CI → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] registration, profile edit, email change (FR-SYS-014, FR-SYS-015, FR-SYS-016)`

### Task 9: 平台管理员后台账号（FR-SYS-019）

**Files:**
- Create: `services/api/app/repositories/admin_repo.py`、`app/services/admin_service.py`、`app/routers/admin_auth.py`、`app/schemas/admin.py`
- Modify: `app/cli.py`（admin 子命令）、`app/dependencies.py`（`get_admin`）、`app/main.py`
- Test: `tests/integration/test_admin_auth.py`、`tests/integration/test_admin_cli.py`

**Interfaces:**
- Consumes: Task 3 `record`；Task 4 `hash_token`、`new_token`、`require_csrf_header`。
- Produces:
  - `admin_service`：`ADMIN_COOKIE = "saiflow_admin_session"`、`ADMIN_IDLE = timedelta(minutes=30)`、`MAX_FAILED = 5`、`LOCK_FOR = timedelta(minutes=15)`、`MIN_PASSWORD = 12`；口令用 `argon2.PasswordHasher()`（argon2id 默认参数）。
    - `async def create_admin(db, username: str, password: str) -> int`（口令不足 12 个字符抛 `ValueError("password must be at least 12 characters")`；用户名重复抛 `ValueError`）、`async def disable_admin(db, username) -> None`（同时撤销其全部后台会话）、`async def reset_password(db, username, password) -> None`（清零错误次数与锁定）；三者各记 `admin.create`/`admin.disable`/`admin.reset_password`（`actor_type="system"`）。
    - `async def login(db, username: str, password: str) -> str`：账号不存在时也对一个固定的假哈希做一次校验（耗时一致）；不存在、已停用、锁定中、口令错 → `AppError(401, "admin_login_failed", "admin.login_failed")`；口令错时错误次数 +1，到 5 次设 `locked_until = now + 15 min`、次数清零并记 `admin.lock`；每次失败在独立事务中记 `admin.login`（`result="failure"`，`actor_id=None`，`target_id=username`）；成功清零并记 `admin.login`（success），返回新令牌。
    - `async def resolve_admin(db, token) -> int | None`：未撤销、账号未停用、`utcnow() - last_used_at <= ADMIN_IDLE`，命中则顺延。
  - 接口：`POST /api/v1/admin/auth/login`（`AdminLoginRequest(username, password)`）→ 200 `AdminMeResponse(admin_id: int, username: str)` 并设后台 Cookie；`POST /api/v1/admin/auth/logout` → 204；`GET /api/v1/admin/me` → 200。后台接口只认后台 Cookie；客户接口只认客户 Cookie。
  - 命令（口令从标准输入读一行，不出现在命令行参数里）：`python -m app.cli admin-create <username>`、`admin-disable <username>`、`admin-reset-password <username>`；成功退出 0，失败打印原因退出 1。
- [ ] **Step 1: 写失败测试**
  - `test_admin_login_ok`（AC-FR-SYS-019-01）。
  - `test_failures_look_identical`（AC-FR-SYS-019-02）：错口令与不存在的用户名 → 都 401，`code`、`message_key` 相同。
  - `test_lock_after_five_failures`（AC-FR-SYS-019-03）：5 次错后正确口令 401；把 `locked_until` 改到过去后正确口令 200。
  - `test_password_length_and_hash`（AC-FR-SYS-019-04）：命令以 11 个字符口令退出 1 且无账号；12 个字符成功，`password_hash` 以 `$argon2id$` 开头且不含原口令。
  - `test_disabled_admin`（AC-FR-SYS-019-05）：停用后登录 401，停用前的会话调 `/admin/me` 401。
  - `test_admin_idle_30_minutes`（AC-FR-SYS-019-06）。
  - `test_sessions_not_interchangeable`（AC-FR-SYS-019-07）：客户 Cookie 调 `/admin/me` 401；后台 Cookie 调 `/me` 401。
  - `test_admin_audit_failures_and_lock`（AC-FR-SYS-003-02）：5 次错 → 5 条 `admin.login` failure 与 1 条 `admin.lock`。
  - `test_sensitive_values_not_logged`（AC-FR-SYS-003-05）：一次注册（含验证码）、一次后台登录（含口令）、一次 LINE 登录（含令牌）后，`caplog` 文本与 `audit_log` 全部文本列中都不含验证码、口令、令牌与会话 Cookie 值。
- [ ] **Step 2: 推送测试**，CI → Expected: FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 推送**，CI → Expected: PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] platform admin accounts: CLI, login, lockout, idle timeout (FR-SYS-019)`

### Task 10: 服务器命令：SMTP 自检

**Files:**
- Modify: `services/api/app/cli.py`
- Test: `tests/unit/test_cli_smtp_check.py`

**Interfaces:**
- Consumes: Task 7 `SmtpSender`。
- Produces: `python -m app.cli smtp-check <to>`：按当前环境变量建 `SmtpSender` 发一封主题 `SaiFlow SMTP check` 的邮件；成功打印 `smtp OK` 退出 0；未配置打印 `smtp not configured` 退出 1；发送失败打印 `smtp FAILED: <异常类型名>` 退出 1（不打印口令）。用途：没有前端时在服务器上验证发信配置（Task 12）。
- [ ] **Step 1: 写失败测试**：未配置 → 退出 1 且输出 `smtp not configured`；monkeypatch 发送成功 → 退出 0；发送抛 `EmailUnavailable` → 退出 1，输出不含 `SMTP_PASSWORD` 的值。
- [ ] **Step 2: 运行** → FAIL。 **Step 3: 实现。** **Step 4: 运行** → PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] smtp-check server command`

### Task 11: 部署配置、接口描述与文档同步

**Files:**
- Modify: `scripts/deploy/compose.yaml`（`saiflow-be-api` 增加 `LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_LOGIN_REDIRECT_URIS`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`、`SMTP_PASSWORD`、`SMTP_FROM`、`SMTP_SECURITY`，均写成 `${VAR:-}`）、`scripts/deploy/env.example`（只列名字）、`scripts/tests/compose-config.test.sh`（断言这 9 个变量传给后端）、`docs/30-design/openapi.json` 与 `packages/api-client/src/generated/schema.ts`（`pnpm generate:api-client` 重新生成）、`docs/deployment/README.md`（新配置项、admin 命令、`audit-verify`、`smtp-check`、LINE Developers 中需登记的地址）、`services/api/README.md`、`docs/30-design/adr/ADR-006-ai-native-workflow.md` §7（B-2 拆为 B-2a/B-2b/B-2c，版本 +0.0.1）、`docs/30-design/Data-Model.md`（新增用户、租户（最小）、会话、验证码、后台账号、操作日志实体，版本 +0.1.0）
- Test: 现有 `scripts/tests/*.test.sh`、CI `contract` job

- [ ] **Step 1: 写失败测试** `compose-config.test.sh` 新增断言 → `bash scripts/tests/compose-config.test.sh` FAIL。
- [ ] **Step 2: 修改** compose 与 env.example → 测试 PASS。
- [ ] **Step 3: 重新生成接口描述与客户端**：在仓库根执行 `pnpm generate:api-client`（同时导出 `openapi.json` 并生成 `schema.ts`）→ 提交后 `bash scripts/check-generated-clean.sh docs/30-design/openapi.json packages/api-client/src/generated` 通过；`pnpm test && pnpm lint && pnpm build` PASS。
- [ ] **Step 4: 文档同步**（上面列出的 5 份文档），`bash scripts/check-no-secrets.sh` PASS，`openspec validate rebuild-identity --strict` PASS。
- [ ] **Step 5: 提交** `[rebuild-identity] deploy config, OpenAPI and client, docs sync`；推送，CI 全部 job PASS。

### Task 12: 部署与验证（需负责人参与，每一步前确认）

- [ ] **Step 1:** 请负责人在 `/opt/saiflow/.env` 中填写 `SMTP_*`（D9：dev 先用现有 Gmail）、`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_LOGIN_REDIRECT_URIS`（填写方法在 `docs/deployment/README.md`）。
- [ ] **Step 2:** 负责人确认后触发 `Deploy` → Expected: 全部步骤成功，三个地址健康检查 `ok`，迁移到 `0002`。
- [ ] **Step 3:** 负责人在服务器上执行 `docker compose exec -T saiflow-be-api python -m app.cli admin-create <名字>`（口令从标准输入输入）→ Expected: 退出 0。
- [ ] **Step 4:** 外网验证：`POST https://saiflow-admin.aibaba.asia/api/v1/admin/auth/login`（正确口令 200、错误口令 401）；`POST https://saiflow-line2.aibaba.asia/api/v1/auth/guest` → 200 `kind=guest`；`POST /api/v1/auth/line` 带假令牌 → 401 `line_token_invalid`（证明后端确实调用了 LINE 并拒绝）。
- [ ] **Step 5:** 服务器上 `python -m app.cli smtp-check <负责人邮箱>` → `smtp OK`，负责人确认收到邮件；`python -m app.cli audit-verify` → `audit log OK`。
- [ ] **Step 6:** 写 `openspec/changes/rebuild-identity/verification.md`：每条 AC → 测试名或手工步骤 → 结果；真实 LINE 登录（需要 B-5 页面）列为"待 B-5 验证"。提交 `[rebuild-identity] verification record`。
