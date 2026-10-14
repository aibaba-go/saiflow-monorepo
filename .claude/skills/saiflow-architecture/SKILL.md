---
name: saiflow-architecture
description: SaiFlow 架构设计纪律。产出变更级 design.md，涉及取舍时记录 ADR，保证设计可追溯到 proposal/spec。配合 architect subagent 使用。
---

# 架构设计纪律

## 输入
- `openspec/changes/<change>/proposal.md` 与 `.../specs/**`
- `docs/30-design/**`（持久架构、数据模型、既有 ADR）

## 要求
- 设计必须**可追溯到** proposal/spec 中的需求，不得引入未被要求的行为。
- 数据实体与接口**只定义一次**：`docs/30-design` 为持久成果，change 内为本次增量。
- 含权衡的架构决策写入 `docs/30-design/adr/ADR-<nnn>-<slug>.md`（Context / Decision / Consequences）。
- 数值、单位、容差必须明确（如 `±0.01 THB`、`300 DPI`、`5 s`）。
- 不得在设计中重复定义需求；应链接到 spec。

## 产物
- `openspec/changes/<change>/design.md`（必要时含 ADR）。
- `openspec validate --change <change>` 通过。
