# Plan：line-register-prefill

负责人 2026-11-13 反馈注册表单带不出 LINE 邮箱和手机号，要求参考旧项目 `temp/saiflow-monorepo-20261104` 修复。原因与规则见 proposal，规格见 delta（FR-SYS-014）。

## 方案选择

- **手机号来源**：与旧项目一致，取经校验 ID token 的 `phone_number` 声明，截断到 32 个字符。`LineIdentity` 增加 `phone: str | None = None`，默认值保证开发登录与测试替身的现有构造不变。
- **存放位置**：沿用 `users.phone`，不加列、不迁移。旧项目同样把 LINE 手机号写进未注册用户的 `phone`。注册时 `user_service.register` 会用提交值覆盖它；已注册用户不写（AC-014-06）。LINE 未返回时不清空（AC-014-08）。邮箱仍按原方式每次登录刷新 `line_email`，行为不变。
- **前端**：`RegisterDialog` 已经用 `me.phone` 作默认值，只补测试。
- **诊断日志**：在 `login_with_identity` 中用 logger `app.auth` 写一条 `line_login_claims`，字段为 `email`、`phone`（布尔值）与 `registered`。不记录邮箱、手机号、令牌或 LINE 用户 ID。用于在生产上判断 LINE 是否返回了这两项。

## 任务

| # | 任务 | 需求 | 文件 |
|---|------|------|------|
| 1 | `LineIdentity.phone` 取自 `phone_number`；单元测试 | FR-SYS-014 | `app/integrations/line.py`、`tests/unit/test_line_client.py` |
| 2 | 未注册用户登录时写入 LINE 手机号，未返回不清空，已注册不改；集成测试 AC-014-08 与 AC-014-06 | FR-SYS-014 | `app/services/auth_service.py`、`tests/integration/fake_line.py`、`tests/integration/test_line_login.py` |
| 3 | 登录诊断日志只记是否返回邮箱和手机号；测试日志不含具体值 | FR-SYS-001 | `app/services/auth_service.py`、`tests/integration/test_line_login.py` |
| 4 | 注册表单默认手机号测试 | FR-SYS-014 | `apps/line-mini/src/features/auth/auth.test.tsx` |
| 5 | DM-User 的 phone 预填来源 | FR-SYS-014 | `docs/30-design/Data-Model.md` |
| 6 | 后端 ruff、单元与集成测试（临时 `saiflow_test_*` 库，测后删除）；line-mini vitest、eslint、tsc；`openspec validate --strict` | NFR | — |

## 上线后排查

部署后让测试账号在 LINE 内用 `?entry=register` 登录一次，再查看 API 日志中的 `line_login_claims`：

- `email=false`：LINE 没有返回邮箱。需在 LINE Developers 开通 Email address permission，在 LIFF 应用勾选 `email` scope，然后重新授权登录。
- `phone=false`：渠道没有手机号权限。普通渠道无法获得，只能手填（键盘有 `autocomplete="tel"` 提示）。
