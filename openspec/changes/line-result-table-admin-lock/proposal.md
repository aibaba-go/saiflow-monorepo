# Proposal：LINE 结果页只保留表格视图；后台账号锁定改为 5 分钟

## Why

负责人于 2026-11-13 提出（附 LINE 小程序截图）：

1. "verify result 页面 table 和 json 格式选择去掉，仅适用 Table 格式即可"。目前小程序结果页在原件下方有"表格 / JSON"切换（FR-SYS-114），JSON 视图对现场用户没有用处，还占一行。
2. 注册时 Email 默认取 LINE 的邮箱，Phone 默认取本机手机号。
3. 确认管理后台账号与手机端账号同步，并把后台的锁定时间也改为 5 分钟。客户账号已在 `customer-email-login` 中改为连续 5 次口令错误锁定 5 分钟（FR-SYS-156），后台账号仍是 15 分钟（FR-SYS-019）。

## What Changes

变更分级为 M：改两条 SHALL 及其 AC。

- `line-mini`：**修改 FR-SYS-114**。结果页只提供"表格"与"原件"两个视图，去掉"JSON"视图与"复制"。AC-FR-SYS-114-01 保留标题，内容改为"结果页没有表格 / JSON 切换，也没有 JSON 文本与复制"。
- `identity`：**修改 FR-SYS-019**。后台账号连续 5 次口令错误后锁定 **5 分钟**（原 15 分钟）。AC-FR-SYS-019-03 同步修改。其余条款不变。

不改规格的部分：

- **注册 Email 默认值**：FR-SYS-020 已规定预填 LINE 授权提供的邮箱，已经实现（登录时保存 ID token 的 `email`，`/me` 返回 `email_suggestion`）。邮箱为空是因为 LINE Developers 控制台未开通 Email 权限，或 LIFF 应用未勾选 `email` scope。这是平台配置问题，不改代码。
- **注册 Phone 默认值**：网页与 LIFF 都无法读取本机号码，LINE 也不向普通渠道提供手机号，所以无法实现"自动读取"。只为输入框加 `autocomplete="tel"` 与 `inputmode="tel"`，让手机键盘提示本机号码（iOS 自动填充）；邮箱框加 `autocomplete="email"`。这是不改变行为契约的 S 级改进，归 FR-SYS-020。
- **账号同步**：后台账号与客户账号按 FR-SYS-019 刻意隔离，不能互相登录。后台"用户"页读的是同一个数据库中的客户用户，所以手机端注册的用户在后台实时可见。这一点不需要改动。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `line-mini`：修改 FR-SYS-114。
- `identity`：修改 FR-SYS-019。

## Impact

- line-mini：`features/scan/ResultPage.tsx`（去掉切换、JSON 视图与复制）、对应样式与三语资源、`result.test.tsx`；`components/Field`（`autoComplete`、`inputMode`）、`features/auth/RegisterDialog.tsx`。
- 后端：`services/admin_service.py` 的 `LOCK_FOR`，`tests/integration/test_admin_auth.py`。
- 文档：`docs/deployment/README.md`、`docs/30-design/Data-Model.md`（DM-AdminAccount）中的 15 分钟。
- 接口、数据库结构、web-pc、web-admin 界面：无变化。

## Non-goals

- 不改 web-pc 结果页的视图。
- 不合并后台账号与客户账号，不让两者互相登录。
- 不通过短信或运营商接口获取手机号。
