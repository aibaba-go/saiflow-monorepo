# Proposal：管理员以用户身份进入 web-pc（代登录）

## Why

负责人于 2026-11-12 要求：管理后台"用户"列表的每条记录上增加一个按钮，点击后直接以该用户身份进入系统，无需用户名密码。用途是排查客户反馈、复现客户看到的页面。

目前客户只能经 LINE 登录（FR-SYS-001），平台管理员无法看到客户视角，只能靠截图沟通。

## What Changes

- 变更分级：L。新增鉴权入口与会话类型，有迁移 `0018_impersonation`，涉及后端、web-admin、web-pc。
- `identity`：新增 FR-SYS-145 管理员代登录链接、FR-SYS-148 代登录会话。
  - 平台管理员为一个**已注册**用户签发一次性进入链接：60 秒内有效、只能用一次，数据库只存其 SHA-256。
  - 在 web-pc 打开链接即换成该用户的会话。会话记录发起的管理员；闲置 30 分钟或开始后 2 小时结束；管理员账号停用后立即失效。
  - 签发与进入都写操作日志（操作者为管理员，对象为用户）；不写入票据或会话值。
  - `GET /api/v1/me` 增加 `impersonated`，标明当前会话是否为代登录。
  - 进入时不归集游客数据；同一浏览器原有的客户会话被替换，用户自己在其他设备上的会话不受影响。
- `web-admin`：新增 FR-SYS-146。已注册用户的行上有"以此用户登录"，确认后在新标签页打开 web-pc；未注册用户不显示该按钮。
- `web-pc`：新增 FR-SYS-147。`/impersonate` 页兑换链接；代登录期间每页顶部显示醒目横幅"管理员代登录：正在以 {name} 的身份操作"与"结束代登录"；链接无效或过期时说明原因。
- 部署：后端新增配置 `WEB_PC_ORIGIN`（compose 中取 `https://${APP_HOST}`），用于生成链接；未配置时签发接口返回 503。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `identity`：新增 FR-SYS-145、FR-SYS-148。
- `web-admin`：新增 FR-SYS-146。
- `web-pc`：新增 FR-SYS-147。

## 归档顺序

FR-SYS-146 依赖 `admin-line-feedback-fixes` 修改后的 FR-SYS-070（用户页默认列出全部用户）。本变更 SHALL 在 `admin-line-feedback-fixes` 之后归档。

## Impact

- 后端：迁移 `0018_impersonation`（新表 `impersonation_tickets`，`customer_sessions.impersonated_by_admin_id`）；`models/impersonation.py`、`models/session.py`；`services/impersonation_service.py`、`session_service.py`、`me_service.py`；`routers/admin_query.py`、`routers/auth.py`；`schemas/auth.py`；`config.py`；集成测试。
- 契约：重新生成 `docs/30-design/openapi.json` 与 `packages/api-client/src/generated/schema.ts`。
- web-admin：`pages/UsersPage.tsx`、测试、中英资源。
- web-pc：`auth/ImpersonatePage.tsx`、`layout/AppLayout.tsx`、`App.tsx`、样式、三语资源与测试。
- 部署：`scripts/deploy/compose.yaml`；本地 `scripts/dev/local-env.sh`。

## Non-goals

- 不提供 LINE 小程序内代登录（LINE 内会话来自 LIFF，另立变更）。
- 不限制代登录期间可做的操作；代登录会话与用户本人权限相同。期间的业务操作在操作日志中仍记为该用户，可经会话关联到发起的管理员。
- 不通知用户本人，不提供用户侧授权开关。
- 不支持代登录游客或未注册用户。
