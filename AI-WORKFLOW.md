---
doc_id: WF-001
title: "SaiFlow — AI 协作工作流"
type: standard
status: active
version: 1.1.0
updated: 2026-10-12
owner: Product Engineering
audience: [ai-agent, engineer, pm]
---

# SaiFlow — AI 协作工作流

> 本文件定义 AI（Claude Code + OpenSpec + SuperPowers）在本仓库的协作方式：**分层、阶段、subagent、统一提示词**。
> 人类用**统一薄提示词**驱动；复杂度沉淀到 `skill` 与 `subagent` 定义中。
> 入口顺序：`AGENTS.md`（仓库入口）→ `AI-WORKFLOW.md`（本文件，工作流细则）→ `openspec/`（变更流程）。

## 1. 三条铁律

1. **过程与成果分层**：过程（变更提案 / delta spec / 任务）在 `openspec/`；成果（产品级持久文档）在 `docs/`。同一内容只定义一次，其余链接。
2. **一个 change = 一个目录**：任何阶段的产物都写进 `openspec/changes/<change>/`，禁止另建全局过程目录（如 `01_propose/`）。
3. **产物即契约，摘要只给人**：阶段之间靠**文件**交接；subagent 只向主代理回**摘要**（产物清单 + 关键结论 + 阻塞项），不回传细节。

## 2. 分层与载体

| 层 | 载体 | 回答 | 说明 |
|----|------|------|------|
| 入口 | `AGENTS.md`、`AI-WORKFLOW.md` | 去哪读、怎么协作 | 导航与工作流 |
| 能力 / 流程 | `.claude/skills/`（skill） | “怎么做” | 项目约定与环节纪律；可被 subagent 预载 |
| 执行 / 隔离 | `.claude/agents/`（subagent） | “谁来做” | 角色 + 工具白名单 + 独立上下文 + 模型 |
| 变更流程 | `openspec/` | “这次改什么” | 提案 → 设计 → 任务 → 实现 → 归档 |
| 成果文档 | `docs/` | “产品是什么” | 持久知识：`00/01/10/20/30/40` + deployment/guides |

**使用规则：**

- OpenSpec 官方已提供 6 个 skill（`openspec-propose`、`openspec-apply-change`、`openspec-update-change`、`openspec-sync-specs`、`openspec-archive-change`、`openspec-explore`）——**复用，勿重造**。
- 项目约束放在**叠加 skill**（`saiflow-conventions` 等）中，只补充“项目特有纪律”，不复制 OpenSpec 步骤。
- **仅当**需要「上下文隔离 / 工具权限收窄 / 并行 / 换模型」时才用 subagent；纯知识型环节用 skill 即可。
- **subagent 不能调用斜杠命令**（`/opsx:*` 是主会话的用户级触发器）。subagent 通过 **Bash 调用 `openspec` CLI**，或经 `skills:` 预载流程。
- 分段只能沿**产物边界**切（每个边界处必须有自包含产物文件），否则会退化为“传话游戏”。

## 3. 阶段 ↔ OpenSpec 映射

| 阶段 | 角色（subagent） | 人类入口（斜杠） | 底层 CLI | 输入 | 产物 |
|------|------------------|------------------|----------|------|------|
| 需求分析 | `requirement-analyst` | `/opsx:propose` | `openspec new change` / `openspec instructions proposal\|spec` / `openspec validate` | `docs/10-product/**`、`docs/20-requirements/**`、变更名 | `openspec/changes/<change>/proposal.md`、`.../specs/<capability>/spec.md` |
| 架构设计 | `architect` | `/opsx:update` | `openspec instructions design` / `openspec validate` | `proposal.md`、delta `spec.md`、`docs/30-design/**` | `.../design.md`；必要时 `docs/30-design/adr/ADR-*.md` |
| 编码 | `coder` | `/opsx:apply` | `openspec instructions tasks` / `openspec status` | `design.md`、`tasks.md` | `apps/**`、`packages/**`、`services/**` 代码 + 单测 |
| 测试 / 验证 | `tester` | （测试命令）+ `openspec validate` | `pytest` / `vitest`、`openspec validate` | `tasks.md`、验收标准（AC） | 测试报告（摘要）、validate 结论 |
| 同步 / 归档 | 人类 / 主代理 | `/opsx:sync` → `/opsx:archive` | `openspec sync` / `openspec archive` | 已完成的 change | 主 specs 更新 + `changes/archive/` |

> 小任务可跳过知识型阶段（如直接 `coder`）；阶段不是强制流水线。

## 4. Subagent Registry

| agent | 阶段 | tools | skills | model | 输入 | 产物 |
|-------|------|-------|--------|-------|------|------|
| `requirement-analyst` | 需求分析 | Read, Grep, Glob, Write, Edit, Bash | `saiflow-conventions`, `saiflow-requirements` | `inherit` | docs/10-product + docs/20-requirements + change 名 | proposal.md + delta spec |
| `architect` | 架构设计 | Read, Grep, Glob, Write, Edit, Bash | `saiflow-conventions`, `saiflow-architecture` | `inherit` | proposal + spec + docs/30-design | design.md（+ADR） |
| `coder` | 编码 | Read, Grep, Glob, Edit, Write, Bash | `saiflow-conventions` | `sonnet` | design.md + tasks.md | 代码 + 单测 |
| `tester` | 测试 / 验证 | Read, Grep, Glob, Bash（只读 + 跑命令） | `saiflow-conventions`, `saiflow-testing` | `sonnet` | tasks.md + AC | 测试报告（摘要） |

> 说明：
> - `tools` 用工具名；若你的 Claude Code 版本支持作用域语法，可将 Bash 收窄为 `Bash(openspec:*)`、`Bash(pytest:*)` 等。
> - `model` 别名为示例（`inherit`/`sonnet`/`opus`/`haiku`），以你本机版本可用值为准；机械阶段可换更便宜的模型以真正降本。
> - `skills` 中的 `saiflow-*` 为待创建的项目叠加 skill（放入 `.claude/skills/`）。

## 5. 统一人类提示词模板

人类只需按下面模式说话（其余交给定义）：

```text
你作为 <角色 / agent 名>，
输入：<文件或目录，默认 openspec/changes/<change>/ 加相关 docs 路径>。
在你的能力与工具范围内完成本职，产物写入 <目标目录，默认 openspec/changes/<change>/>。
完成后只回报摘要（产物清单 + 关键结论 + 阻塞项）。
```

**示例：**

```text
你作为 requirement-analyst，输入 docs/10-product/PRD-SaiFlow.md，
产出本次变更 ocr-field-confidence 的 proposal 与 delta spec，写入 openspec/changes/ocr-field-confidence/。
```

## 6. 交接契约（DoR / DoD）

| 阶段 | 就绪（DoR，输入齐备） | 完成（DoD，产物合规） |
|------|------------------------|------------------------|
| 需求分析 | 变更名确定；产品诉求可定位到 docs/10-product 或 docs/20-requirements | proposal + spec 存在；每条需求 ≥1 条 Gherkin AC；`openspec validate` 通过 |
| 架构设计 | proposal + delta spec 已就绪 | design.md 与 proposal/spec 一致；涉及架构决策已记 ADR |
| 编码 | design.md + tasks.md 已就绪 | tasks 全部完成；lint/build/单测通过；提交引用 `<change>` |
| 测试 / 验证 | 代码就绪 + AC 可枚举 | 测试已运行；结果映射到 AC；失败项与阻塞项已列明 |

## 7. 命令速查

```bash
# OpenSpec 变更流程（人类入口，主会话）
/opsx:explore      # 探索 / 澄清想法（不写代码）
/opsx:propose      # 新建变更并生成全部产物
/opsx:update       # 修订已有变更的规划产物
/opsx:apply        # 实现 tasks
/opsx:sync         # delta 合并到主 specs
/opsx:archive      # 归档完成的变更

# 底层 CLI（subagent 通过 Bash 调用）
openspec new change <name>
openspec status --change <name> --json
openspec instructions <artifact> --change <name> --json
openspec validate --change <name>
openspec sync
openspec archive
```

## 8. 常见误区

| 误区 | 纠正 |
|------|------|
| 由 subagent 调用 `/opsx:propose` | 不成立；subagent 走 `openspec` CLI 或预载 skill |
| 为每个环节都建 subagent | 纯知识型环节用 skill 即可；subagent 只用于需要隔离/权限/并行的环节 |
| 把 OpenSpec 步骤抄进自研 skill | 应叠加约束，复用官方 skill |
| 依赖 subagent 摘要做交接 | 交接必须用产物文件；摘要只给主代理/人类看进度 |
| 认为“开新上下文 = 省 token” | 省的是主上下文压力；总 token 常上升，除非配合模型分档 |
| 重写一套 `saiflow-propose` 流程 | 报错/漂移的根源；只做增量约束 |

## Version History

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1.1.0 | 2026-10-12 | Product Engineering | 随 saiflow-docs 迁移更新所有文档路径：`docs/product` → `docs/10-product`，`docs/architecture` → `docs/30-design` |
| 1.0.0 | 2026-10-12 | Product Engineering | 初始 AI 协作工作流：分层、阶段↔OpenSpec 映射、subagent registry、统一提示词模板 |
