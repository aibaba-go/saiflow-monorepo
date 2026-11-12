# Plan：customer-email-login

负责人 2026-11-12 要求注册增加密码，登录支持 LINE、邮箱密码与邮箱验证码，并支持用邮箱验证码重置密码；LINE 小程序与 web-pc 同步。已确认的规则见 proposal，规格见 delta。

## 方案选择

- **密码与锁定放在 `users` 上**：增加 `password_hash`、`password_failed_attempts` 与 `password_locked_until`，不另建表。客户与平台管理员各自一张表，口令互不相通。哈希沿用管理员口令的 argon2（`argon2-cffi`，已在依赖中），校验放在线程中执行。邮箱未注册时也做一次假哈希校验，使响应耗时一致。
- **验证码增加 `purpose` 列**：取值 `verify`、`login`、`reset`，已有记录为 `verify`。
  - 每个所属用户同时只有一个有效码，60 秒限制与作废规则沿用现有实现，不分用途。
  - `consume_code` 增加 `purpose` 参数，用途不符按无效处理，不计入错误次数。
  - 注册与更换邮箱传 `verify`。
  - 邮件标题与正文按用途区分。
- **免会话接口集中在 `/api/v1/auth`**：沿用 CSRF 请求头。四个接口共用一个按来源 IP 的滑动窗口限流器（30 次 / 10 分钟，IPv6 按 /64），放在 `app.state.auth_limiter`。超限时先于任何数据库查询返回 429。
  - `POST /auth/email-code {email, purpose: login|reset}` 返回 204。
  - `POST /auth/password {email, password}` 返回 `MeResponse`，并设置 cookie。
  - `POST /auth/email-login {email, code}` 返回 `MeResponse`，并设置 cookie。
  - `POST /auth/password-reset {email, code, password}` 返回 `MeResponse`，并设置 cookie。
- **复用建会话的逻辑**：从 `login_with_identity` 抽出 `open_user_session(db, user, personal_tenant_id, current, method)`，负责归集游客数据、替换本设备会话、建会话与审计。LINE 与三种邮箱方式都调用它，审计 `customer.login` 时记录 `method`。重置密码在同一事务内先使该用户的全部会话失效，再建会话。
- **并发**：密码登录与重置用 `SELECT ... FOR UPDATE` 锁住用户行，避免并发输错时漏计次数或绕过锁定。锁定在第 5 次错误时写入，并清零计数。
- **LINE 小程序**：
  - `useSession` 增加 `loginOpen` 与 `loginReturnTo`，以及 `openLogin(returnTo)`。
  - 原来调用 `startLogin` 的入口（"我的"、`useRequireRegistered`、邀请、结果页确认）都改为 `openLogin`；OA 的 `register` 入口保持直接走 LINE 登录。
  - 面板中的"LINE 登录"调用原 `startLogin(returnTo)`。
  - 邮箱方式成功后，与 LINE 登录共用"刷新身份、回到原页面"的收尾逻辑；未注册的 LINE 用户仍弹出注册框。
  - 关闭面板时清除结果页"登录后确认"的标记。
- **web-pc**：
  - `LoginPage` 在"用 LINE 登录"下增加"邮箱密码 / 邮箱验证码"两个页签和"忘记密码"链接。
  - 新增不在 `RequireUser` 内的 `/reset-password` 页，携带 `next` 参数，只接受同站路径。
  - 邮箱登录请求用 `own401`，避免 401 被当作会话过期而跳转。

## 步骤

| # | 内容 | 追溯 | 文件 |
|---|---|---|---|
| 1 | 迁移 0019：`users` 增加三列；`email_codes.purpose`（`text not null default 'verify'`，带 check 约束） | FR-SYS-152、FR-SYS-156、FR-SYS-020 | `alembic/versions/0019_customer_password.py`、`models/user.py`、`models/email_code.py` |
| 2 | 密码规则与哈希：`validate_password`、`hash_password`、`verify_password`，并带假哈希 | FR-SYS-152 | `services/password_service.py`、`tests/unit/test_password_service.py` |
| 3 | 验证码用途：`send_code(..., purpose)` 区分邮件内容；`consume_code(..., purpose)`；注册与更换邮箱传 `verify` | FR-SYS-020 | `services/email_code_service.py`、`services/user_service.py`、`routers/me.py`、`services/dev_login_service.py` |
| 4 | 注册必填密码：后端校验规则并保存哈希；注册请求增加 `password` | FR-SYS-014 | `services/user_service.py`、`schemas/me.py`、`routers/me.py` |
| 5 | 抽出 `open_user_session`；新增邮箱密码登录、邮箱验证码登录、重置密码与免会话发码；锁定；审计 | FR-SYS-001、FR-SYS-010、FR-SYS-149、FR-SYS-150、FR-SYS-151、FR-SYS-156 | `services/auth_service.py`、`services/customer_password_auth.py`（新增）、`services/session_service.py`、`routers/auth.py`、`schemas/auth.py` |
| 6 | 来源 IP 限流器与依赖注入 | FR-SYS-157 | `main.py`、`dependencies.py`、`config.py` |
| 7 | 集成测试：AC-001-11、AC-010-08、AC-014-01/02/03/07、AC-020-10/11/12、AC-149-01..04、AC-150-01..04、AC-151-01..05、AC-152-01..03、AC-156-01..03、AC-157-01；同时修改受影响的现有注册与验证码测试 | 同上 | `tests/integration/test_email_login.py`（新增）、`test_registration*.py`、`test_email_code*.py` 等 |
| 8 | 重新生成契约 | FR-PLAT-004 | `docs/30-design/openapi.json`、`packages/api-client/src/generated/schema.ts` |
| 9 | 小程序注册框增加密码与确认密码，在前端校验规则与一致性 | FR-SYS-042 | `features/auth/RegisterDialog.tsx`、`features/auth/passwordRule.ts`（新增） |
| 10 | 小程序登录面板、重置密码视图与错误提示；入口改为 `openLogin`；关闭时清除确认标记 | FR-SYS-041、FR-SYS-153、FR-SYS-154、FR-SYS-158 | `features/auth/LoginSheet.tsx`（新增）、`session.ts`、`useRequireRegistered.ts`、`pages/MyPage.tsx`、`features/invite/InvitePage.tsx`、`features/scan/confirm.ts`、`App.tsx`、样式、三语资源、`auth.test.tsx` |
| 11 | web-pc 登录页签与"忘记密码"；`/reset-password` 页 | FR-SYS-090、FR-SYS-155 | `pages/LoginPage.tsx`、`auth/ResetPasswordPage.tsx`（新增）、`auth/session.ts`、`App.tsx`、三语资源、`auth.test.tsx` |
| 12 | 文档：PRD §4.9 的登录方式表；Data-Model 中的 users 与 email_codes | FR-SYS-001 | `docs/10-product/PRD-SaiFlow.md`、`docs/30-design/Data-Model.md` |

## 验证

- 后端：单元测试、全部集成测试（`saiflow_test_*`）与迁移测试；ruff。
- 前端：line-mini 与 web-pc 的 vitest、lint、tsc 与 build；web-admin 的 tsc（检查共享契约）。
- 浏览器端到端：在本机隔离环境（dev 登录、假邮件）完成以下流程。
  - 小程序："登录 / 注册"打开面板 → 邮箱密码登录 → 退出 → 邮箱验证码登录 → 忘记密码重置；结果页"确认"从面板登录后继续确认。
  - web-pc：三种登录方式与重置密码页。
- 结果写入 `verification.md`。不提交、不部署，等待"提交并部署"。
