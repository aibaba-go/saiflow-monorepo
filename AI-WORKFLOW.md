---
doc_id: WF-001
title: "SaiFlow — AI 协作工作流"
type: standard
status: active
version: 2.0.0
updated: 2026-10-30
owner: Product Engineering
audience: [ai-agent, engineer, pm]
doc_source: manual
---

# SaiFlow — AI 协作工作流

> 本文件是 AI（Claude Code + OpenSpec + SuperPowers）在本仓库协作方式的唯一操作性规则：**OpenSpec 管“做什么”（需求），SuperPowers 管“怎么做”（实现）**，全部在主会话内推进，负责人确认每个决策点。决策依据见 `docs/30-design/adr/ADR-006-ai-native-workflow.md`。
> 入口顺序：`AGENTS.md`（仓库入口）→ `AI-WORKFLOW.md`（本文件）→ `openspec/`（变更流程）。

## 1. 铁律

1. **过程与成果分层**：过程（变更提案 / delta spec / 方案 / 验证记录）在 `openspec/`；成果（产品级持久文档）在 `docs/`。同一内容只定义一次，其余链接。
2. **一个 change = 一个目录**：一次变更的全部过程产物都写进 `openspec/changes/<change>/`，禁止另建全局过程目录（如 `01_propose/`、`docs/superpowers/`）。
3. **需求只有一份正本**：行为需求（FR + Gherkin AC）的唯一正本是 `openspec/specs/<capability>/spec.md`。

## 2. 阶段与工具分工

交接点：delta spec 经负责人确认，且 `openspec validate <change>` 通过。

| 阶段 | 工具 / 命令 | 产物（位置） | 负责人确认点 |
|------|-------------|--------------|--------------|
| ① 需求澄清 | `/opsx:explore` | 无文件，或 change 内的笔记 | 需求边界、优先级（P0 限定）是否清楚 |
| ② 需求规格 | `/opsx:propose`（叠加 `saiflow-requirements`） | `openspec/changes/<change>/proposal.md`、`.../specs/<capability>/spec.md` | **逐条确认** SHALL 语句与 Gherkin AC；`openspec validate <change>` 通过 |
| ③ 实施方案 | `superpowers:writing-plans` | `openspec/changes/<change>/plan.md` | **逐项确认** 架构取舍、数据模型/接口变化、任务拆分；含权衡的决策另写 ADR |
| ④ 隔离环境 | `superpowers:using-git-worktrees` | 分支 `feat/<change>` | — |
| ⑤ 实现 | `superpowers:test-driven-development` + `superpowers:executing-plans` | `apps/**`、`packages/**`、`services/**` 代码与测试 | 计划内的检查点按 plan 约定确认 |
| ⑥ 验证与审查 | `superpowers:verification-before-completion`、`superpowers:requesting-code-review` | `openspec/changes/<change>/verification.md`（AC → 测试 → 结果） | 审阅验证结果与审查意见 |
| ⑦ 收尾 | `/opsx:archive`（在分支内、合并前完成）→ `superpowers:finishing-a-development-branch` | 合并分支；delta 合并进 `openspec/specs/`；change 移入 `openspec/changes/archive/` | 确认合并；**归档是必做步骤** |

## 3. 改动分级

| 级别 | 判定标准 | 流程 |
|------|----------|------|
| **S — 小修** | 不改变任何 SHALL 语句或 AC 的可观察行为：样式、文案、重构、明显缺陷修复（行为本来就已在 spec 中定义） | 直接改代码 + 测试；提交信息引用相关 FR/AC ID |
| **M — 行为变化** | 修改或新增少量 SHALL 语句/AC，不引入新实体或新接口 | ② delta spec → ③ 简短 plan（可一页）→ ⑤–⑦ |
| **L — 新功能 / 新模块** | 新能力、新实体、新接口、架构调整 | 完整 ①–⑦ |

判定不确定时，AI 必须向负责人询问级别，不得自行降级。

## 4. 文档分层与需求正本

| 内容 | 唯一正本 | 说明 |
|------|----------|------|
| 为什么做、产品范围、优先级 | `docs/10-product/`（PRD、Vision-Scope、Personas） | 产品级，不含实现细节 |
| 术语 | `docs/10-product/Glossary.md` | 术语唯一来源 |
| 行为需求（FR + Gherkin AC） | `openspec/specs/<capability>/spec.md` | 保留原 `FR-*`、`AC-*` ID，追溯不断链 |
| 非功能需求 | `docs/20-requirements/non-functional/NFR.md` | 按 capability 引用 |
| 架构、数据模型、ADR | `docs/30-design/` | 只写当前结构与决策，不写测试与部署记录 |
| API 契约 | 后端 OpenAPI → `docs/30-design/API-Spec.md`（generated） | 禁止手写第二份 |
| 一次变更的过程（规格增量、方案、验证） | `openspec/changes/<change>/` | 归档后保留在 `archive/` |

**迁移规则（旧 EPIC → capability）：**

- 每重建一个模块，就把对应 EPIC 中的 FR 与 `docs/40-acceptance/Acceptance-Criteria.md` 中的 AC 按 PRD v3 改写，经该模块 change 的 delta spec 进入 `openspec/specs/<capability>/spec.md`。
- 被迁移的 EPIC 章节标记 `deprecated` 并链接到对应 capability；全部迁完的 EPIC 整份设为 `status: deprecated`。`Requirements-Index.md` 的“设计引用 / 验证方式”列改为指向 capability。
- 迁移时剔除过程信息与实现细节（存储键、日志式表述）；实现细节只出现在 `plan.md` 与代码中。
- `docs/` 的版本历史只记录内容变化，**禁止**记录测试条数、构建哈希、切流比例等验证或部署证据。

## 5. change 目录约定

```text
openspec/changes/<change>/
├── proposal.md                    # 为什么做、范围、Non-goals（OpenSpec）
├── specs/<capability>/spec.md     # delta spec：SHALL + Gherkin AC（OpenSpec）
├── plan.md                        # 实施方案（SuperPowers writing-plans）
└── verification.md                # 验证记录：AC → 测试 → 结果
```

- `plan.md` 必须：引用本 change 的 FR/AC ID；遵循 STD-005（后端）/ STD-006（前端）；每个任务写明对应的测试；列出需要负责人确认的检查点。
- `verification.md` 至少包含：AC ID、测试名、结果、未覆盖说明。测试命令、条数、部署记录只写这里。
- **不写** OpenSpec 的 `design.md`、`tasks.md`；**不使用** `/opsx:apply`。若 CLI 强制要求 `tasks.md`，允许只含指向 `plan.md` 的链接的最小文件，不得重复任务内容。

## 6. 框架使用边界

- **需求阶段（①②）只用 OpenSpec**，不调用 `superpowers:brainstorming`。SuperPowers 从 ③ `writing-plans` 开始接手，以已确认的 delta spec 为输入。项目规则优先于 skill 自带的触发要求。
- SuperPowers 的 plan **不写入** `docs/superpowers/`，固定写入 `openspec/changes/<change>/plan.md`。
- **不使用项目自定义 subagent**（已停用的定义在 `.claude/archive/`）。SuperPowers、OpenSpec 内部派生的 subagent（如代码审查）及其内部定义照常使用、不干预；仅当框架行为与本文件严重重复（如产出第二份规格或方案）时，才在本节加以约束。
- **`/opsx:propose` 只生成到 specs 为止**：OpenSpec 官方 skill 与 `openspec status` 会提示继续生成 `design.md`、`tasks.md` 并运行 `/opsx:apply`，本项目忽略这些提示；`openspec status` 显示 `isPlanningComplete: false`、archive 报告 design/tasks 未完成均属预期。
- 不手改 OpenSpec 生成物：`.claude/commands/opsx/**`、`.claude/skills/openspec-*`。

## 7. 命令速查

```bash
# 需求（OpenSpec，主会话）
/opsx:explore                         # 澄清需求，不写代码
/opsx:propose                         # 新建 change：proposal + delta spec
openspec validate <change>          # 校验规格
/opsx:archive                         # 合并 delta 到 openspec/specs/ 并归档
openspec archive <change> --skip-specs   # 纯文档 / 基础设施 change 的归档（其 .openspec.yaml 须含 skip_specs: true）

# 实现（SuperPowers）
superpowers:writing-plans                       # 写 plan.md
superpowers:using-git-worktrees                 # 隔离分支
superpowers:test-driven-development             # 先测试后实现
superpowers:executing-plans                     # 按 plan 执行
superpowers:verification-before-completion      # 完成前验证
superpowers:requesting-code-review              # 代码审查
superpowers:finishing-a-development-branch      # 合并收尾
```

## Version History

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 2.0.0 | 2026-10-30 | Product Engineering | 按 ADR-006 重写：取消 subagent 阶段划分、subagent registry 与统一提示词模板；OpenSpec 管需求、SuperPowers 管实现；新增三级分级、文档分层与需求正本（`openspec/specs/`）、change 目录约定、框架使用边界 |
| 1.1.0 | 2026-10-12 | Product Engineering | 随 saiflow-docs 迁移更新所有文档路径：`docs/product` → `docs/10-product`，`docs/architecture` → `docs/30-design` |
| 1.0.0 | 2026-10-12 | Product Engineering | 初始 AI 协作工作流：分层、阶段↔OpenSpec 映射、subagent registry、统一提示词模板 |
