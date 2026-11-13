# Verification：line-register-prefill

## 本地验证（2026-11-13）

- 后端 `services/api`：`ruff check`、`ruff format --check` 通过；单元测试 590 passed（含 `test_verify_reads_phone_number_when_line_shares_it`）。
- 集成测试全量 724 passed（4 个分片，库 `saiflow_test_shard1..4`，127.0.0.1:25432，`DB_APP_USER=saiflow_v3_app`），包括：
  - AC-FR-SYS-014-08：`test_line_phone_prefills_registration`（未注册用户登录取 LINE 手机号；之后 token 不带手机号时保留原值）。
  - AC-FR-SYS-014-06：`test_line_phone_never_replaces_a_registered_phone`。
  - FR-SYS-001 诊断日志：`test_login_logs_only_which_claims_line_shared`，日志只有 `line_login_claims email=True phone=True registered=False`，不含邮箱、手机号或 LINE 用户 ID。
- line-mini：vitest 400 passed（含 AC-FR-SYS-014-08 注册表单预填手机号且可修改），eslint、tsc、`vite build` 通过。
- `openspec validate line-register-prefill --strict` 通过。

## 同批 S 级小修（不改变 SHALL）

- 套餐页（FR-SYS-053）顶部加"返回首页"链接：套餐页没有底部标签栏，且常由链接直接打开。加载失败时也显示该链接。测试 `links back to home`；本地 dev（localhost:5173）核对：链接 138×40 位于左上，点击回到 `#/`。

## 上线后待确认

- 生产 API 日志中 `line_login_claims` 的 `email` / `phone` 取值，判断 LINE 是否下发邮箱与手机号（见 plan「上线后排查」）。
