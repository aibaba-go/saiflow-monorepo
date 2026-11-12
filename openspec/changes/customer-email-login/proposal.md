# Proposal：客户邮箱密码登录、邮箱验证码登录与重置密码

## Why

负责人于 2026-11-12 提出以下需求。

- LINE 小程序的注册框增加"密码"与"确认密码"。
- 登录支持三种方式：LINE 登录、邮箱密码登录，以及邮箱验证码登录。后两种只对已注册用户开放。
- 增加通过邮箱验证码重置密码的功能。
- web-pc 企业版同步提供上述三种登录方式与重置密码。web-pc 仍不提供注册。

目前客户只能经 LINE 登录（FR-SYS-001；PRD §4.9"注册与登录"的登录方式表）。用户不在 LINE 内、或不方便在电脑上扫码授权时，就无法进入 web-pc。

负责人同时确认了以下规则：

- **密码规则**：8 到 64 个字符，至少包含一个字母和一个数字；两次输入必须一致。
- **未注册的邮箱**：登录或重置密码时明确提示"该邮箱未注册"。
- **连续输错**：
  - 连续 5 次输错密码后锁定 5 分钟，锁定期间仍可用邮箱验证码登录。
  - 重置密码成功后，该用户的其他会话全部失效，当前设备直接登录。
- **LINE 小程序的登录入口**：点击"登录 / 注册"或结果页的"确认 / Continue"时，弹出登录面板。
  - "LINE 登录"为主按钮。
  - 下方切换"邮箱密码"与"邮箱验证码"。
  - 底部为"忘记密码"。
  - 登录后回到原页面。

## What Changes

变更分级为 L：新增鉴权入口、迁移 `0019_customer_password`，涉及后端、line-mini 与 web-pc。

### `identity`

- **修改 FR-SYS-001**：客户会话除 LINE 登录外，还可经邮箱密码、邮箱验证码或重置密码建立。新用户仍只能由 LINE 登录创建。
- **修改 FR-SYS-010**：任何一种登录方式都会归集游客数据。
- **修改 FR-SYS-014**：注册时密码必填并须符合密码规则，只保存密码的强单向哈希。
- **修改 FR-SYS-020**：
  - 验证码增加用途：注册与更换邮箱用"验证邮箱"，另有"登录"与"重置密码"。
  - "登录"与"重置密码"用途的验证码不需要会话，只能发往已注册用户的邮箱，并按来源 IP 限流。
  - 每个验证码只能用于其用途。
- **新增**：
  - FR-SYS-149 邮箱密码登录：各种失败的响应，以及未设置密码时的提示。
  - FR-SYS-156 密码连续错误锁定：连续 5 次输错锁定 5 分钟。
  - FR-SYS-157 免会话身份请求的来源 IP 限流。
  - FR-SYS-150 邮箱验证码登录。
  - FR-SYS-151 通过邮箱验证码重置密码：重置后其他会话失效，当前设备登录。
  - FR-SYS-152 客户密码规则与存储。

### `line-mini`

- **修改 FR-SYS-041**：所有需要登录的入口改为弹出登录面板（FR-SYS-153）。LINE OA 的 `register` 入口仍直接走 LINE 登录。
- **修改 FR-SYS-042**：注册框增加"密码"与"确认密码"。
- **新增**：FR-SYS-153 登录面板、FR-SYS-154 重置密码视图、FR-SYS-158 登录与重置的错误提示。

### `web-pc`

- **修改 FR-SYS-090**：登录页提供"用 LINE 登录"，以及"邮箱密码"与"邮箱验证码"两种表单，并有"忘记密码"入口。
- **新增 FR-SYS-155**：重置密码页。

### 产品文档

PRD §4.9 的登录方式表同步修改。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `identity`
  - 修改：FR-SYS-001、FR-SYS-010、FR-SYS-014、FR-SYS-020。
  - 新增：FR-SYS-149 至 FR-SYS-152、FR-SYS-156、FR-SYS-157。
- `line-mini`
  - 修改：FR-SYS-041、FR-SYS-042。
  - 新增：FR-SYS-153、FR-SYS-154、FR-SYS-158。
- `web-pc`
  - 修改：FR-SYS-090。
  - 新增：FR-SYS-155。

## Impact

### 后端

- **迁移 `0019_customer_password`**：
  - 为 `users` 增加 `password_hash`、`password_failed_attempts`、`password_locked_until`。
  - 为 `email_codes` 增加 `purpose`，已有记录为 `verify`。
- **代码**：
  - 模型：`models/user.py`、`models/email_code.py`。
  - 服务：`services/password_service.py`（新增）、`email_code_service.py`、`auth_service.py`、`user_service.py`。
  - 路由：`routers/auth.py`。
  - Schema：`schemas/auth.py`、`schemas/me.py`。
  - 其他：`rate_limit.py`、`main.py`。
- **测试**：新增和修改集成测试。

### 契约

重新生成 `docs/30-design/openapi.json` 与 `packages/api-client/src/generated/schema.ts`。

### 前端

- **line-mini**：
  - 新增登录面板与重置密码视图。
  - 修改注册框。
  - 改动入口：`session.ts`、`MyPage`、`useRequireRegistered`、`InvitePage`、`confirm.ts`。
  - 三语资源与测试。
- **web-pc**：`LoginPage`、新增 `/reset-password` 页、三语资源与测试。

### 文档

- `docs/10-product/PRD-SaiFlow.md` §4.9 的登录方式表。
- `docs/30-design/Data-Model.md` 中 users 与 email_codes 两项。

## Non-goals

- 不提供没有 LINE 身份的纯邮箱账号。新用户仍只能经 LINE 登录创建，再在 LINE 小程序中注册。
- web-pc 仍不提供注册表单（FR-SYS-091 不变）。
- 不在个人资料中提供"修改密码"。已注册用户需要设置或更换密码时，使用"忘记密码"。
- 不对本变更前已注册、尚未设置密码的用户做强制补设。他们可以继续用 LINE 或邮箱验证码登录，也可以通过重置密码设置密码。
- 不提供"记住我"、二次验证或短信验证码。
- 不改变平台管理员后台账号的登录（FR-SYS-019）。
