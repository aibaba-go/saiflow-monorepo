---
doc_id: AGENTS
title: "SaiFlow monorepo — AI 代理入口"
type: index
status: active
version: 2.3.0
updated: 2026-10-26
audience: [ai-agent, engineer, pm]
---

# SaiFlow monorepo — AI 代理入口

> **所有 AI 编码代理和工程师必须先阅读本文件。** 本文件是 SaiFlow monorepo 的唯一入口，说明仓库结构、文档读取顺序与协作方式。无需扫描整个仓库。

## 1. 产品一句话说明

**SaiFlow — “We turn paper into process.”（将纸张变为流程。）**

面向泰国 SME 制造企业的纸质单据 OCR 数字化录入系统。识别采购订单（PO）、送货单（Delivery Note）、发票（Invoice）、收据（Receipt）、贷项通知单（Credit Note）与税务收据（Tax Receipt）；由人工核验后，录入并归档至本地 ERP、Excel 与文件夹。部署于 Google Cloud（Cloud Run、私有 GCS、Firestore、Cloud Functions、Secret Manager）。

## 2. 入口与读取顺序（渐进式加载）

按需、按序读取，避免一次性加载无关上下文。

| 步骤 | 当前任务 | 必须读取 |
|------|----------|----------|
| 0 | 任何任务 | `AGENTS.md`（本文件） |
| 1 | 理解协作方式、阶段与角色 | `AI-WORKFLOW.md` |
| 2 | 理解目录与文档放置规则 | `docs/00-standards/Directory-Structure.md` |
| 3 | 理解产品为什么做、要做什么 | `docs/10-product/PRD-SaiFlow.md`、`Vision-Scope.md` |
| 4 | 理解业务术语 | `docs/10-product/Glossary.md`（术语唯一来源） |
| 5 | 实现某项功能 | `docs/20-requirements/functional/<EPIC-xx>.md` |
| 6 | 设计数据、接口或 OCR 流程 | `docs/30-design/Data-Model.md`、`API-Spec.md`、`OCR-Pipeline.md`、`Architecture.md` |
| 7 | 编写测试或判断完成条件 | `docs/40-acceptance/Acceptance-Criteria.md` |
| 8 | 处理性能、安全、兼容性等约束 | `docs/20-requirements/non-functional/NFR.md` |

产品、需求、设计、架构与验收标准均位于本仓库 `docs/` 下（唯一根）。旧 `saiflow-docs` 已废弃，内容已完成迁移。

**禁止臆造需求：** 若某行为未被 `FR-*` 或 `NFR-*` 明确说明，则不属于既定需求；必须向用户确认，不得自行假设。

## 3. 仓库结构

顶层目录与每层职责见 `docs/00-standards/Directory-Structure.md`。速览：

```text
saiflow-monorepo/
├── AGENTS.md / CLAUDE.md / AI-WORKFLOW.md  # 入口与协作
├── apps/            # JS/TS 可部署应用（pnpm）：web-pc、line-mini
├── packages/        # JS/TS 共享库（pnpm）：api-client、ui、tsconfig
├── services/        # 后端（Python，pnpm 不扫描）：api（FastAPI）
├── openspec/        # 变更流程与行为契约（原生布局）
├── docs/            # 产品级持久文档（00/01/10/20/30/40）
├── scripts/         # 仓库级脚本（含部署自动化）
├── temp/            # 临时产物（禁止作为正式资产）
└── .claude/         # Claude Code 配置（agents / skills / commands）
```

**默认命令隔离（硬约束）：** `pnpm-workspace.yaml` 只 glob `apps/*` 与 `packages/*`；Python 命令（`uvicorn`/`pytest`/`ruff`/`alembic`）一律在 `services/api/` 内执行。新增顶层目录时必须确认不破坏该隔离。

## 4. AI 协作入口

- **工作流细则** → `AI-WORKFLOW.md`（铁律、阶段↔OpenSpec 映射、subagent registry、统一提示词模板、DoR/DoD）。
- **角色（subagent）** → `.claude/agents/`：`requirement-analyst`、`architect`、`coder`、`tester`。
- **能力（skill）** → `.claude/skills/`：OpenSpec 官方 `openspec-*`（复用，勿改）+ 项目叠加 `saiflow-*`。
- **变更流程** → `openspec/changes/<change>/`；行为契约沉淀到 `openspec/specs/`。

人类用**统一薄提示词**驱动，复杂度沉淀到 skill 与 subagent 定义中。产物即契约：阶段之间靠文件交接，subagent 只回摘要。

## 5. 临时文件约定（必须遵守）

AI 开发、分析、转换、调试、测试过程中产生的所有临时文件，都必须置于仓库根的 **`./temp/`** 下。

- 包括但不限于：解析/解压产物、转换中间文件、调试输出、一次性脚本、测试样本、截图、下载缓存与日志。
- 禁止在 `docs/`、`openspec/`、`apps/`、`packages/`、`services/` 或仓库根创建临时文件。
- `./temp/` 不作为正式资产目录；完成后应删除不再需要的内容，需要保留的产物应移入对应正式目录并说明用途。

## 6. ID 快速索引

| 前缀 | 含义 | 示例 |
|------|------|------|
| `EPIC-xx` | 一组相关功能 | `EPIC-02` |
| `FR-<domain>-nnn` | 功能需求 | `FR-OCR-004` |
| `NFR-<cat>-nnn` | 非功能需求 | `NFR-PERF-001` |
| `AC-<reqid>-nn` | 验收标准 | `AC-FR-OCR-004-01` |
| `DM-<entity>` | 数据模型实体 | `DM-Document` |
| `API-<n>` | API 端点 | `API-3` |
| `ADR-nnn` | 架构决策记录 | `ADR-001` |

## 7. AI 代理硬规则

1. **可追溯性：** 每个代码修改都必须映射到至少一个 `FR-*` 或 `NFR-*`。
2. **原子性：** 一次只实现一个需求，不得混合无关行为。
3. **术语一致性：** 必须使用 `Glossary.md` 的精确定义和名称。
4. **验收优先：** 编码前必须先读取对应的 `AC-*` 验收标准。
5. **禁止范围蔓延：** 初始版本 V1.0 只包含 P0；不得提前实现 P1/P2/P3 功能。
6. **同步更新文档：** 改变系统行为时，必须更新源需求、相关设计、验收标准及版本历史（`docs/20-requirements`、`docs/30-design`、`docs/40-acceptance` 等）。
7. **云端数据边界：** 原件存私有 GCS、TextIn 原始 JSON 存 Firestore、关系数据存自建 PostgreSQL 17（`odoo.saiflow`，ADR-005）；仅服务端可访问云资源与 TextIn 凭据，必须符合 PDPA 与 `NFR-SEC-*`。
8. **临时文件隔离：** 所有临时产物必须置于 `./temp/`。
9. **过程与成果分层：** 过程产物写 `openspec/changes/<change>/`，产品级成果写 `docs/`；同一内容只定义一次，其余链接。
10. **勿手改生成物：** `.claude/commands/opsx/**` 与 `.claude/skills/openspec-*` 由 OpenSpec 生成，升级时会被覆盖；通过 `openspec update` 更新，不手工编辑。

## 8. 变更前检查清单

- [ ] 已确认需求范围与优先级；V1.0 仅实现 P0。
- [ ] 已阅读对应 `FR-*` / `NFR-*` 与 `AC-*`。
- [ ] 已检查相关数据模型、API、OCR 流程与安全约束。
- [ ] 已确定临时产物将存放在 `./temp/`。
- [ ] 已为行为变化规划文档与测试更新，并确认产物落位符合 `Directory-Structure.md`。

## Version History

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 2.3.0 | 2026-10-26 | Product Engineering | 关系数据库由 Cloud SQL 切换为自建 PostgreSQL 17（ADR-005），更新产品说明与云端数据边界 |
| 2.2.0 | 2026-10-12 | Product Engineering | 完成 saiflow-docs 内容迁移；`docs/` 成为 SaiFlow 唯一文档根，旧 `saiflow-docs` 废弃 |
| 2.1.0 | 2026-10-12 | Product Engineering | 文档唯一根收敛：`docs/` 统一继承 saiflow-docs 00/01/10/20/30/40 分层；读取路径从 `../saiflow-docs` 改为本仓库 `docs/` |
| 2.0.0 | 2026-10-12 | Product Engineering | 重建为 monorepo 入口：新增目录结构、AI 协作入口、默认命令隔离与生成物禁改规则 |
| 1.0.0 | 2026-10-07 | Product Engineering | monorepo AI 代理上下文地图初版 |
