# Verification：line-result-table-admin-lock

日期：2026-11-13。本地验证见前几节；负责人要求"提交部署"后已正式发布，见"正式发布"。

## 规格

- `openspec validate line-result-table-admin-lock --strict`：valid。
- FR-SYS-114（line-mini）与 FR-SYS-019（identity）为 MODIFIED，保留全部原有场景。

## line-mini

- `vitest run`（全量 36 个文件、398 个用例）：397 通过；每次全量运行有 1 个与本变更无关的用例因并发计时偶发失败，两次不同（`invite.test.tsx`、`devLogin.test.tsx`），单独运行都通过。
- 涉及本变更的文件单独运行：`features/auth/*`、`features/scan/result.test.tsx`，4 个文件 70 个用例全部通过。
  - AC-FR-SYS-114-01：结果页直接显示表格（`IV1`），没有 tablist、"JSON" 页签、"Copy" 按钮与 JSON 文本。
  - FR-SYS-020：注册表单预填 LINE 提供的邮箱（`email_suggestion`），邮箱 `autocomplete="email"`，手机 `type="tel"`、`autocomplete="tel"`、`inputmode="tel"`。
- `eslint src`、`tsc`：无错误。`vite build`：成功。

## 后端

- `ruff check`、`ruff format --check`：通过。
- 单元测试：590 passed，271 skipped。
- 集成测试（临时库 `saiflow_test_adminlock`，127.0.0.1:25432，测后已删除）：`test_admin_auth.py`、`test_email_login.py`、`test_registration.py` 共 46 passed。
  - AC-FR-SYS-019-03：第 5 次错误后 `admin_accounts.locked_until` 距当前时间在 4 到 5 分钟之间；到期后正确口令登录成功。

## 文档

- `docs/30-design/Data-Model.md` 2.15.1、`docs/deployment/README.md` 1.9.1：后台账号锁定 5 分钟。

## 未验证

- 真机 LINE 内的邮箱预填取决于 LINE Developers 控制台的 Email 权限与 LIFF `email` scope，本地无法验证。
- 手机键盘对 `autocomplete="tel"` 的提示依赖 iOS / Android 自动填充设置，未在真机验证。

## 正式发布（2026-11-13）

- 提交 `2b5b878`，推送到 `chore/ai-workflow-v2`；只提交本变更的文件，工作区里原有的部署脚本改动未提交。
- CI run 43334497786：contract、stack、frontend、scripts、backend 全部通过。
- Deploy run 43335461384，目标 `VPS_HOST` = 38.60.156.234。迁移前备份 `saiflow-20261113T001831Z.dump`（256928 字节），本地和 GCS 各一份。本次没有新迁移。三站 smoke-check OK。
- 部署后只读复查：
  - `saiflow-app`、`saiflow-admin`、`saiflow-line2` 的 `/api/v1/health` 都返回 `version` = `2b5b878…`、`database` = `ok`。
  - 线上 LINE 小程序主包 `index-BbudoZSH.js`：不再含 `result.tabJson`、`result.copyJson`；含 `autoComplete:"email"`、`autoComplete:"tel"`、`inputMode:"tel"`。
- 线上没有做任何写操作；后台锁定 5 分钟未在生产上触发（避免锁住真实账号），由集成测试覆盖。真机 LINE 内的邮箱预填须先在 LINE Developers 开通 Email 权限与 LIFF `email` scope。
