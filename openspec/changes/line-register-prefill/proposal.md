# Proposal：LINE 注册预填手机号，并记录 LINE 是否返回邮箱与手机号

## Why

负责人于 2026-11-13 反馈：LINE 小程序的注册表单仍然带不出 LINE 的邮箱和手机号。负责人要求参考旧项目 `temp/saiflow-monorepo-20261104` 修复，并说明旧项目里默认邮箱和手机号都能带出来。

对照旧项目（`services/api/routes/auth.py` 的 `auth_line`、`_upsert_line_user`，`apps/line-mini/src/components/RegisterDialog.vue`）：

- **邮箱**：两边做法相同。都由服务端校验 LIFF ID token，取其中的 `email` 声明，作为未注册用户的注册预填值。旧项目写入 `user.email`，新项目写入 `user.line_email` 并通过 `/me.email_suggestion` 返回。
- **手机号**：旧项目还读取 ID token 的 `phone_number` 声明，写入未注册用户的 `phone`，注册表单用它作默认值。新项目没有读取，这是两边唯一的行为差异。
- **旧项目的模拟资料**：旧项目开启本地开发登录时会随机生成手机号和邮箱（`_dev_line_profile`），在开发环境下看起来"都能带出来"。新项目的开发登录使用一个固定身份（NFR-DEV-002）。

LINE 只在两种情况下把邮箱放进 ID token：渠道已开通 Email address permission，且 LIFF 应用勾选了 `email` scope 并经用户授权。手机号只提供给 LINE 特别批准的渠道。生产环境当前是否返回这两项，现有日志看不出来。

## What Changes

变更分级为 M：修改一条 SHALL 并新增 AC。

- `identity`：**修改 FR-SYS-014 的"预填与覆盖"**。
  - 手机号预填值 SHALL 只取经校验 LINE 身份令牌中的手机号，SHALL NOT 信任客户端声明的手机号。
  - 未注册用户登录时，若 LINE 返回了手机号，就记为预填值；LINE 未返回时保留原值。已注册用户不受影响（AC-014-06 不变）。
  - 新增 AC-FR-SYS-014-08，覆盖手机号预填与"未返回不清空"。
- **安全诊断日志**：LINE 登录成功时写一条服务端日志，只记录 LINE 是否返回了邮箱和手机号（是/否），不记录具体值。用于判断生产上预填为空的原因。这是可观测性改进，不改变接口与行为契约，归 FR-SYS-001。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `identity`：修改 FR-SYS-014。

## Impact

- 后端：
  - `app/integrations/line.py`：`LineIdentity` 增加 `phone`，取自 `phone_number`。
  - `app/services/auth_service.py`：未注册用户登录时，LINE 提供手机号则写入 `users.phone`；记录诊断日志。
  - 测试：`tests/unit/test_line_client.py`、`tests/integration/fake_line.py`、`tests/integration/test_line_login.py`。
- line-mini：注册表单已用 `me.phone` 作手机号默认值，不改代码，只补测试 `features/auth/auth.test.tsx`。
- 接口：`/me` 字段不变；未注册用户的 `phone` 现在可能带有 LINE 提供的值。
- 数据库：无迁移，沿用 `users.phone`。
- 文档：`docs/30-design/Data-Model.md`（DM-User 的 phone 预填来源）。
- 归档顺序：本变更的 FR-SYS-014 基于 `customer-email-login` 中的版本，须在 `customer-email-login` 归档之后再归档。

## Non-goals

- 不读取本机手机号。网页与 LIFF 都没有这个能力，只保留 `autocomplete="tel"` 的键盘提示。
- 不代替负责人在 LINE Developers 控制台开通 Email 权限、勾选 LIFF `email` scope，也不申请手机号权限。
- 不改开发登录的固定身份，不引入随机模拟资料。
- 不改已注册用户的资料，不改换邮箱、换手机号流程。
