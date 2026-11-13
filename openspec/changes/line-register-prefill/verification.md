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

## CI、部署与生产核验（2026-11-13）

- 业务提交 `0131856`（注册预填与诊断日志）与 `3bb9db3165cac7acead120317b0398bf5e67d65d`（套餐页返回首页与本地验证），已推送并经 `git ls-remote` 确认远端为 `3bb9db3…`。CI run `43347711471` 对该 SHA 结论 success。
- 手动触发标准 Deploy run `43348607899`（workflow_dispatch，SHA 精确一致），结论 success（`temp/deploy-43348607899.log`）：迁移前备份 `saiflow-20261113T020042Z.dump`（257435 bytes）已上传 `gs://saiflow-db-backup/`；本次无新迁移；`remote-deploy: done (3bb9db3…)`；三站健康与数据库端口外部关闭步骤通过。未改 GitHub 变量、LIFF 或频道配置。
- 发布后只读核验（02:02:37 UTC，`temp/line-register-prefill/production-check.json`，passed）：三站健康接口 HTTP 200、`status=ok`、`database=ok`、版本均为 `3bb9db3…`；LINE 站首页脚本 `/assets/index-SMNbSy8I.js` 含 `Back to home` / `返回首页` / `กลับหน้าหลัก` 与样式类 `back-home`。
- 限制：未在原生 LINE 内实际登录，`line_login_claims` 生产日志与真实 LINE 手机号下发仍待下节确认。

## 上线后待确认

- 生产 API 日志中 `line_login_claims` 的 `email` / `phone` 取值，判断 LINE 是否下发邮箱与手机号（见 plan「上线后排查」）。
