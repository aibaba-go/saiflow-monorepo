---
name: saiflow-conventions
description: SaiFlow 仓库通用协作约定（入口顺序、工作流、术语、输出目录、临时文件、范围、与 OpenSpec / SuperPowers 的关系）。任何环节开始前都应遵循；它叠加在 OpenSpec 与 SuperPowers 官方 skill 之上，不重造其流程。
---

# SaiFlow 通用约定

## 入口与分层
- 入口顺序：`AGENTS.md` → `AI-WORKFLOW.md` → `openspec/`。
- 分层：**过程**产物在 `openspec/changes/<change>/`；**成果**文档在 `docs/`。同一内容只定义一次，其余链接。

## 工作流
- 阶段与确认点、改动分级、框架使用边界见 `AI-WORKFLOW.md` §2、§3、§6：OpenSpec 管需求，SuperPowers 从 `writing-plans` 起管实现；需求阶段不调用 `superpowers:brainstorming`。
- 方案写 `openspec/changes/<change>/plan.md`，验证记录写 `openspec/changes/<change>/verification.md`；测试条数、构建哈希、部署记录不写入 `docs/`。
- `legacy/` 只读：可阅读参考，不修改、不被新代码引用。

## 输出与范围
- 所有阶段产物只写 `openspec/changes/<change>/`，禁止另建全局过程目录（如 `01_propose/`、`docs/superpowers/`）。
- 范围：V1.0 只实现 P0，禁止提前实现 P1/P2。
- 临时文件一律置于 `./temp/`，不作为正式资产。

## 术语与追溯
- 术语只用 `docs/10-product/Glossary.md` 的精确名称。
- 每个行为必须可追溯到需求/规格；缺口记为 open question，禁止臆造需求。
- 提交/PR 必须引用变更名。

## 与工具的关系
- **复用** OpenSpec 与 SuperPowers 官方 skill，只做**叠加约束**，不复制其步骤，不干预其内部定义。
- 目录结构不得干扰各工具默认命令：`pnpm` 仅覆盖 `apps/*`+`packages/*`；Python 命令在 `services/api/` 内执行（B-1 重建前该目录为空；不得在 `legacy/` 内执行命令）。
