# Plan：line-result-table-admin-lock

负责人 2026-11-13 的三项要求，规则见 proposal，规格见 delta（FR-SYS-114、FR-SYS-019）。

## 方案选择

- **结果页**：删除 `tab` 状态与切换条，原件下方固定渲染 `StructuredDataView`；同时删除 `copyJson`、`copied` 状态、JSON `<pre>`，以及不再使用的样式与三语键。
- **后台锁定**：`admin_service.LOCK_FOR` 改为 5 分钟；`MAX_FAILED` 不变；不需要迁移（`locked_until` 在锁定时计算）。
- **注册输入提示**：`Field` 增加可选的 `autoComplete`、`inputMode` 并透传给 `Input`；注册邮箱用 `email`，手机用 `tel`。

## 任务

| # | 任务 | 需求 | 文件 |
|---|------|------|------|
| 1 | 结果页去掉表格 / JSON 切换与 JSON 视图，清理样式与三语键 | FR-SYS-114 | `apps/line-mini/src/features/scan/ResultPage.tsx`、样式、`i18n` |
| 2 | 测试 AC-114-01：没有切换、JSON 与复制 | FR-SYS-114 | `apps/line-mini/src/features/scan/result.test.tsx` |
| 3 | 后台锁定 5 分钟，测试锁定时长 | FR-SYS-019 | `services/api/app/services/admin_service.py`、`tests/integration/test_admin_auth.py` |
| 4 | 文档中的 15 分钟改为 5 分钟 | FR-SYS-019 | `docs/deployment/README.md`、`docs/30-design/Data-Model.md` |
| 5 | 注册邮箱、手机的自动填充提示 | FR-SYS-020 | `apps/line-mini/src/components/Field/index.tsx`、`features/auth/RegisterDialog.tsx` |
| 6 | line-mini vitest、eslint、tsc、build；后端 ruff、单元与集成测试（临时 `saiflow_test_*` 库，测后删除） | NFR | — |
