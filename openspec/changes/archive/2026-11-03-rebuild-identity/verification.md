# rebuild-identity（B-2a）— 验证记录

> 日期：2026-11-03。环境：dev（LightNode VPS），部署提交 `9d82c05`。
> 自动化测试在本机（Docker 中的 PostgreSQL 18）与 GitHub Actions `CI`（`REQUIRE_INTEGRATION=1`）中运行；部署后的外网检查由负责人与 AI 共同执行。

## 1. 运行记录

| 项目 | 链接 | 结果 |
|------|------|------|
| CI（`9d82c05`，含最终审查修复） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41644557426 | 5 个 job 全部成功 |
| 部署（`9d82c05`） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41645214271 | 全部步骤成功，三个地址 smoke-check 通过，迁移到 `0002` |
| 后端测试 | 本机 `uv run pytest -q` | 142 passed |

## 2. 验收标准对照

测试文件均在 `services/api/tests/`。

| AC | 验证方式 | 结果 |
|----|---------|------|
| AC-FR-SYS-001-01 首次登录创建用户与个人租户 | `integration/test_line_login.py::test_first_login_creates_user_and_personal_tenant` | 通过 |
| AC-FR-SYS-001-02 再次登录找到同一用户 | `test_line_login.py::test_second_login_same_user`（LIFF 令牌与网页授权码两种方式） | 通过 |
| AC-FR-SYS-001-03 无效令牌被拒绝 | `test_line_login.py::test_invalid_token_401_creates_nothing`；`unit/test_line_client.py`（受众、签发方、400） | 通过；真实 LINE 校验待补充配置（第 3 节） |
| AC-FR-SYS-001-04 模拟身份被拒绝 | `test_line_login.py::test_dev_identity_rejected` | 通过 |
| AC-FR-SYS-001-05 LINE 临时不可用 | `test_line_client.py::test_verify_retries_5xx_then_unavailable`（4 次调用，间隔 0.5/1/2 s）、`test_line_login.py::test_line_unavailable_503` | 通过 |
| AC-FR-SYS-001-06 30 天未使用失效 | `integration/test_sessions.py::test_session_expires_after_30_idle_days` | 通过 |
| AC-FR-SYS-001-07 使用后顺延 | `test_sessions.py::test_session_use_extends_lifetime`、`integration/test_review_fixes.py::test_customer_cookie_refreshed_on_use`（每次使用都重发 30 天的 Cookie） | 通过 |
| AC-FR-SYS-001-08 退出 | `test_sessions.py::test_logout_revokes_session` | 通过 |
| AC-FR-SYS-010-01 建立游客会话 | `test_sessions.py::test_create_guest_session`；外网 `POST /api/v1/auth/guest` → 200 `kind=guest` | 通过 |
| AC-FR-SYS-010-02 游客数据只本人可见 | `test_sessions.py::test_guest_cannot_read_other_guest_tenant` | 通过 |
| AC-FR-SYS-010-03 登录后归集到新用户 | `integration/test_guest_claim.py::test_claim_into_new_user` | 通过 |
| AC-FR-SYS-010-04 登录后归集到已注册用户 | `test_guest_claim.py::test_claim_into_registered_user` | 通过 |
| AC-FR-SYS-010-05 归集失败不留下部分结果 | `test_guest_claim.py::test_claim_failure_rolls_back` | 通过 |
| AC-FR-SYS-010-06 游客不能使用登录用户的接口 | `integration/test_registration.py::test_guest_cannot_register_or_edit`、`integration/test_email_code.py::test_guest_cannot_request_code` | 通过 |
| AC-FR-SYS-014-01 注册成功 | `test_registration.py::test_register_ok` | 通过 |
| AC-FR-SYS-014-02 缺少或错误的验证码 | `test_registration.py::test_register_bad_code`、`test_used_code_cannot_register_again` | 通过 |
| AC-FR-SYS-014-03 必填与格式校验 | `test_registration.py::test_register_field_errors`、`unit/test_phone_rules.py` | 通过 |
| AC-FR-SYS-014-04 重复注册 | `test_registration.py::test_register_twice_409`、`test_review_fixes.py::test_registered_user_resubmitting_bad_body_gets_409` | 通过 |
| AC-FR-SYS-014-05 邮箱已被他人使用 | `test_registration.py::test_register_email_taken_409`、`test_email_taken_is_case_insensitive` | 通过 |
| AC-FR-SYS-014-06 再次登录不覆盖资料 | `test_line_login.py::test_relogin_keeps_saved_profile` | 通过 |
| AC-FR-SYS-020-01 发送成功 | `test_email_code.py::test_send_code_ok` | 通过；真实发信待补充配置（第 3 节） |
| AC-FR-SYS-020-02 60 秒内重发 | `test_email_code.py::test_resend_within_60s_is_429`、`test_review_fixes.py::test_double_tap_send_code_sends_once` | 通过 |
| AC-FR-SYS-020-03 新码使旧码作废 | `test_email_code.py::test_new_code_voids_old` | 通过 |
| AC-FR-SYS-020-04 过期 | `test_email_code.py::test_code_expires_after_10_minutes` | 通过 |
| AC-FR-SYS-020-05 输错 5 次作废 | `test_email_code.py::test_five_wrong_attempts_void_code` | 通过 |
| AC-FR-SYS-020-06 发信临时失败 | `unit/test_smtp_sender.py::test_smtp_retries_4xx_then_unavailable`、`test_email_code.py::test_send_failure_is_503_and_no_code` | 通过 |
| AC-FR-SYS-020-07 发信未配置 | `test_email_code.py::test_smtp_not_configured_is_503` | 通过 |
| AC-FR-SYS-020-08 验证码不进日志 | `test_email_code.py::test_code_not_in_logs` | 通过 |
| AC-FR-SYS-015-01/02/03 修改个人资料 | `integration/test_profile.py::test_update_profile_ok`、`test_clear_phone`、`test_update_profile_invalid` | 通过 |
| AC-FR-SYS-016-01/02/03/04 更换邮箱 | `test_profile.py::test_change_email_ok`、`test_change_to_same_email_400`、`test_change_to_taken_email_409`、`test_change_email_code_for_other_address_400` | 通过 |
| AC-FR-SYS-019-01 登录成功 | `integration/test_admin_auth.py::test_admin_login_ok`；外网：负责人用服务器命令建的 `admin` 账号登录 → 200，再用该会话 `GET /api/v1/admin/me` → 200 | 通过 |
| AC-FR-SYS-019-02 失败不透露用户名是否存在 | `test_admin_auth.py::test_failures_look_identical`；外网：错误口令与不存在的用户名都返回 401 `admin_login_failed` | 通过 |
| AC-FR-SYS-019-03 连续 5 次错误锁定 | `test_admin_auth.py::test_lock_after_five_failures`、`test_review_fixes.py::test_parallel_wrong_passwords_still_lock` | 通过 |
| AC-FR-SYS-019-04 口令长度与存储 | `integration/test_admin_cli.py::test_password_length_and_hash` | 通过 |
| AC-FR-SYS-019-05 停用的账号 | `test_admin_auth.py::test_disabled_admin` | 通过 |
| AC-FR-SYS-019-06 后台会话 30 分钟无操作失效 | `test_admin_auth.py::test_admin_idle_30_minutes`、`test_review_fixes.py::test_admin_cookie_refreshed_on_use` | 通过 |
| AC-FR-SYS-019-07 两种会话互不通用 | `test_admin_auth.py::test_sessions_not_interchangeable` | 通过 |
| AC-FR-SYS-003-01 记录身份操作 | `integration/test_identity_audit.py::test_identity_audit_trail` | 通过 |
| AC-FR-SYS-003-02 记录失败的后台登录与锁定 | `test_admin_auth.py::test_admin_audit_failures_and_lock` | 通过 |
| AC-FR-SYS-003-03 应用不能修改或删除记录 | `integration/test_identity_schema.py::test_audit_log_rejects_update_and_delete` | 通过 |
| AC-FR-SYS-003-04 检查出被改动的记录 | `integration/test_audit_log.py::test_verify_detects_tampering`（`audit-verify` 命令退出 1 并指出 id） | 通过；服务器上运行结果见第 3 节 |
| AC-FR-SYS-003-05 不记录敏感值 | `test_admin_auth.py::test_sensitive_values_not_logged`、`test_review_fixes.py::test_unknown_admin_username_not_stored` | 通过 |

另有 5 条计划中的 Review Focus 测试（并发首次登录、邮箱大小写、过期游客 Cookie 登录、并发写操作日志、LINE 缺少可选字段）全部通过。

## 3. 部署后的外网检查

| 检查 | 结果 |
|------|------|
| `POST https://saiflow-line2.aibaba.asia/api/v1/auth/guest`，再带 Cookie `GET /api/v1/me` | 200 `kind=guest`；200 |
| 不带 `X-Requested-With: SaiFlow` 的 `POST` | 403 |
| 用假令牌 `POST /api/v1/auth/line` | 503 `line_unavailable`（服务器尚未配置 LINE，符合预期） |
| admin 后台：不存在的用户名、错误口令、正确口令 | 401 / 401 / 200 |
| 服务器 `audit-verify`（2026-11-04，负责人以 root 在 `/opt/saiflow` 运行） | `audit log OK (9 entries)`：校验链完整 |

### 待补充配置后验证

负责人决定 `/opt/saiflow/.env` 中的 LINE 与 SMTP 配置稍后填写（`docs/deployment/README.md` §2.6）。填写并重新部署后补做：

1. 用假令牌 `POST /api/v1/auth/line` → 期望 401 `line_token_invalid`（证明后端确实调用了 LINE 并拒绝）。
2. 服务器上 `python -m app.cli smtp-check <负责人邮箱>` → 期望 `smtp OK`，负责人确认收到邮件。

### 待 B-5 验证

真实 LINE 账号的登录（LIFF 与 web-pc）与完整注册流程需要 B-5 的页面；web-pc 授权码登录的 `state` 校验由 B-5 前端负责。

## 4. 过程中发现并修复的问题

| 发现 | 修复 | 提交 |
|------|------|------|
| 会话 Cookie 只在登录时下发，"30 天/30 分钟无操作才失效"实际变成从登录起算 | 每次通过认证的响应都重发带新有效期的 Cookie | `9d82c05` |
| 并发的错误口令请求会丢失失败计数，绕过锁定 | 登录时对账号行加锁 | `9d82c05` |
| 口令校验在事件循环中同步执行，大量登录请求会拖慢所有用户 | 放到线程中执行 | `9d82c05` |
| 连点两次"发送验证码"可绕过 60 秒限制并使已发出的码失效 | 同一用户的发送逐个进行 | `9d82c05` |
| 已注册用户提交内容有误时返回 400 而非 409 | 先判断是否已注册 | `9d82c05` |
| 不存在的用户名（可能是误填的口令）写入了操作日志 | 不存在的账号不记录用户名 | `9d82c05` |
| 负责人的 admin 口令出现在对话中 | 用 `admin-reset-password` 重设 | —（服务器操作） |
