# ai-workflow-v2

## Why

原 AI 工作流依赖 4 个项目自定义 subagent，实际未被使用，且与负责人“逐项参与每个决策点”的目标冲突；规范与现有代码不一致，产品文档混入了过程信息。背景与决策见 `docs/30-design/adr/ADR-006-ai-native-workflow.md`（§上下文、§决策）。

## What Changes

- 归档 `.claude/agents/` 下 4 个 agent，以及 `saiflow-architecture`、`saiflow-testing` 两个 skill，移至 `.claude/archive/`。
- 将 `AI-WORKFLOW.md` 重写为 v2.0.0：OpenSpec 管需求、SuperPowers 管实现、三级分级、`openspec/specs/` 为需求唯一正本。
- `AGENTS.md`、`saiflow-conventions`、`saiflow-requirements`、`openspec/config.yaml` 改为指向新流程。
- 在 STD-004、STD-007 中登记 `legacy/`、`.claude/archive/`、`plan.md`、`verification.md`。
- 现有代码（`services/api`、`apps/web-pc`、`apps/line-mini`）打 tag `legacy-v1` 后移入只读的 `legacy/`。
- 归档两个旧 change，不合并其 spec。

## Non-goals

- 不含 ADR-006 部分 B（代码重建）。
- 不含夜间自动运行。
- 不修改 `AGENTS.md` 第 7 条云端数据边界（属于 B-0 `prd-v3-doc-sync`）。
- 不包含行为需求，因此不写 delta spec。
