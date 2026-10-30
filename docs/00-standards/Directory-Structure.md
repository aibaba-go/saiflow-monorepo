---
doc_id: STD-004
title: "SaiFlow monorepo — 目录结构与文档地图"
type: standard
status: active
version: 2.6.0
updated: 2026-10-30
owner: Product Engineering
doc_source: manual
---

# SaiFlow monorepo — 目录结构与文档地图

本标准定义 **SaiFlow monorepo 的目录结构**，以及每份文档的存放位置。结构遵循两条主线：

- **运行时/工具链分家**：JS/TS 与 Python 各居其位，任何工具的默认命令互不干扰。
- **过程与成果分层**：变更过程在 `openspec/`，产品级持久知识在 `docs/`。

> 自 V2.4.0 起，monorepo 的 `docs/` 统一为 SaiFlow 文档的**唯一根目录**。原 `saiflow-docs` 目录已废弃，内容已完成迁移。

---

## 1. 目录树

```text
saiflow/
├── AGENTS.md                              # AI 仓库入口（优先阅读）
├── CLAUDE.md                              # Claude Code 入口（转发 AGENTS.md）
├── AI-WORKFLOW.md                         # AI 协作工作流（阶段与确认点、改动分级、框架使用边界）
├── README.md
├── .claudeignore                          # Claude Code 索引排除列表（node_modules / 构建产物 / 临时文件等）
├── pnpm-workspace.yaml  package.json      # JS 工作区根（glob: apps/*, packages/*）
│
├── apps/                                  # JS/TS 可部署应用（pnpm）
│   ├── web-pc/                            # React + AntDesign PC 端
│   └── line-mini/                         # Line MiniApp 端
├── packages/                              # JS/TS 共享库（pnpm）
│   ├── api-client/                        # 由 OpenAPI 生成，两前端共用（generated）
│   ├── ui/                                # 共享 UI 组件（manual）
│   └── tsconfig/                          # 共享 TS 配置（manual）
├── services/                              # 后端（Python，pnpm 不扫描）
│   └── api/                               # FastAPI；自包含 pyproject.toml / app/ / tests/ / alembic/
│
├── openspec/                              # 变更流程与行为契约（原生布局；产物多为 generated）
│   ├── config.yaml                        # OpenSpec 配置（manual）
│   ├── specs/<capability>/                # 当前行为契约（generated，由 sync 阶段产出）
│   └── changes/<change>/                  # 进行中变更（proposal.md / specs/ / plan.md / verification.md）
│       └── archive/                       # 已归档变更
│
├── docs/                                  # 产品级持久文档（SaiFlow 文档唯一根；除 API-Spec 外均为 manual）
│   ├── 00-standards/                      # 文档与结构标准（manual；含 STD-005 / STD-006 / STD-007）
│   ├── 01-templates/                      # 文档模板（manual）
│   ├── 10-product/                        # 产品级设计：vision / roadmap / personas / glossary / PRD（manual）
│   ├── 20-requirements/                   # 原子化 FR / NFR（manual）
│   │   ├── functional/<EPIC-xx>.md
│   │   └── non-functional/NFR.md
│   ├── 30-design/                         # 架构、数据模型、接口、OCR 流程、ADR（API-Spec 为 generated，其余 manual）
│   └── 40-acceptance/                     # Gherkin 验收标准（manual）
│
├── scripts/                               # 仓库级脚本（含部署自动化）
├── legacy/                                # 旧代码只读参考（ADR-006），不参与构建，不被新代码引用
├── temp/                                  # 临时产物（禁止作为正式资产）
└── .claude/                               # Claude Code 配置
    ├── archive/                           # 已停用的 agent 与 skill（ADR-006），不被加载
    ├── skills/                            # skill 定义
    └── commands/                          # 斜杠命令
```

---

## 2. 分层职责

| 层 | 位置 | 回答的问题 | 受众 | 粒度 |
|----|------|-----------|------|------|
| 入口 | `AGENTS.md`、`AI-WORKFLOW.md` | 去哪读、怎么协作 | 人 + AI | 导航 |
| 能力 | `.claude/skills/` | “怎么做” | AI | 流程与纪律 |
| 变更 | `openspec/` | “这次改什么” | AI + 开发 | 提案 / 规格 / 方案 / 验证 |
| 成果 | `docs/` | “产品是什么” | PM + 开发 | 持久知识 |

---

## 3. 放置规则

1. **新增业务能力** → 通过 OpenSpec 变更（`openspec/changes/<change>/`），能力契约沉淀到 `openspec/specs/`。
2. **新增数据实体或接口** → 新增数据实体在 `docs/30-design/Data-Model.md` 登记实体层；字段级结构以代码（ORM 模型 + Alembic）为唯一来源，不在文档中重复；接口契约见规则 5；变更级设计写在对应变更的 `plan.md`。
3. **产品级设计** → `docs/10-product/`（面向整体产品，非单个需求）。
4. **单需求设计** → 对应变更内的 `plan.md`，不进 `docs/`。
5. **对外 API 契约** → 由后端 OpenAPI 生成后发布到 `docs/30-design/API-Spec.md`，**禁止手写第二份**。
6. **含权衡的技术决策** → `docs/30-design/adr/ADR-nnn-*.md`。
7. **新增术语** → `docs/10-product/Glossary.md`；其余文档链接引用。
8. **不得**跨层重复定义——应改为链接。
9. **原始 PRD / 样本单据** → 不作为本仓库顶层目录：
   - 原始 PRD 输入（外部 `.docx`）的产品级结论沉淀为 `docs/10-product/PRD-SaiFlow.md`；禁止在仓库根另开 `prd/`。
   - OCR 真实样本单据属**敏感数据**，置于 `services/api/tests/fixtures/ocr/` 并加入 `.gitignore`；禁止在仓库根另开 `samples/`，避免真实泰文商业单据进入版本库（PDPA 边界）。
10. **部署与基础设施** → 暂**不设**顶层基础设施目录，也**不设** `docs/deployment/`（当前无内容）：人读的部署/运维说明未来落在 `docs/deployment/`，部署自动化脚本放 `scripts/`。待真正引入 IaC（Terraform/Pulumi）或需要运维手册时，再新建 `docs/deployment/` 或语义化顶层目录（如 `terraform/`），并回到本标准登记，避免留下长期空壳。
11. **端到端测试（E2E）** → 暂**不设**顶层 `e2e/`。跨应用 E2E 是必要层（上传→OCR→核验→录入→归档 跨越两个前端与后端），但其技术栈与粒度尚未定；落地时按以下之一归位，并回到本标准登记：
    - 作为 **pnpm 工作区成员**：新增顶层 `e2e/` 并写入 `pnpm-workspace.yaml`（保持 JS 依赖可解析）；
    - 或**按应用**建 `apps/<app>-e2e`，由 `apps/*` 天然覆盖。
    > 关键约束：E2E 若为 JS 测试，必须落在 pnpm 工作区 glob（`apps/*`、`packages/*` 或显式新增 `e2e`）之内，否则根 `pnpm install` 与 `pnpm -r test` 都不会触及它。
12. **旧代码** → `legacy/`：重建前的代码（git tag `legacy-v1`）只读参考，不在 pnpm glob 内，不参与构建、测试与部署；新版本测试通过并运行一段时间后删除（ADR-006 §6）。

---

## 4. 命名约定

- 目录：小写、kebab-case（`web-pc`、`line-mini`、`api-client`）。
- 文档：kebab-case，`.md`（`domain-model.md`、`ai-workflow.md`）。
- 应用包名：`@saiflow/<name>`（`@saiflow/web-pc`、`@saiflow/line-mini`），使 `pnpm --filter` 与物理路径解耦。
- 每份文件只承载一个概念；文件超过约 500 行时拆分。

---

## 5. 默认命令隔离（硬约束）

- `pnpm-workspace.yaml` **只** glob `apps/*` 与 `packages/*`；`services/` 不在其内。
- 任何 Python 命令（`uvicorn`、`pytest`、`ruff`、`alembic`）在 `services/api/` 内执行。
- 新增顶层目录时，必须确认不会让某个工具的默认递归/发现范围扫到另一条工具链。

---

## Version History

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 2.6.0 | 2026-10-30 | Product Engineering | 规则 2：数据模型只登记实体层，字段以代码为唯一来源（ADR-007） |
| 2.5.0 | 2026-10-30 | Product Engineering | 按 ADR-006：新增 `legacy/`（规则 12）与 `.claude/archive/`；删除 `.claude/agents/` 执行层；change 目录产物改为 proposal / specs / plan / verification；规则 2、4 的变更级设计改写入 `plan.md` |
| 2.4.6 | 2026-10-12 | Product Engineering | 新增 `docs/00-standards/Document-Source-Guide.md`（STD-007）；目录树增加 `(manual)` / `(generated)` 标注；引用 STD-001 v1.0.2 的 `doc_source` 字段 |
| 2.4.5 | 2026-10-12 | Product Engineering | 新增 `docs/00-standards/React-Frontend-Structure.md`（STD-006），定义 `apps/*`、`packages/*` 目录结构与强制约定 |
| 2.4.4 | 2026-10-12 | Product Engineering | 新增 `docs/00-standards/Python-Backend-Structure.md`（STD-005），定义 `services/api/` 目录结构与强制约定 |
| 2.4.3 | 2026-10-12 | Product Engineering | 统一文件命名：`AI_WORKFLOW.md` 重命名为 `AI-WORKFLOW.md`（下划线改中线）；全仓引用同步更新 |
| 2.4.2 | 2026-10-12 | Product Engineering | 新增 `.claudeignore`，并在目录树中登记；Claude Code 默认排除 node_modules / 构建产物 / 临时文件 / Python 缓存 |
| 2.4.1 | 2026-10-12 | Product Engineering | 完成 saiflow-docs 内容迁移；删除空目录 `docs/deployment/` 与 `docs/guides/`；更新说明与规则 9/10 |
| 2.4.0 | 2026-10-12 | Product Engineering | `docs/` 统一为 SaiFlow 文档唯一根：重命名 doc_id 为 STD-004（避免与旧 saiflow-docs STD-002 冲突）；移除 `product/`、`architecture/`、`api/`，新增 `01-templates`、`10-product`、`20-requirements`、`30-design`、`40-acceptance`；调整放置规则 2/3/5/6/7/9 |
| 2.3.0 | 2026-10-12 | Product Engineering | 移除顶层 `e2e/`：E2E 归属延后，落地时纳入 pnpm 工作区或按应用归位；新增放置规则 11 |
| 2.2.0 | 2026-10-12 | Product Engineering | 移除顶层 `infra/`：暂不引入 IaC，部署说明归 `docs/deployment/`、脚本归 `scripts/`；新增放置规则 10 |
| 2.1.0 | 2026-10-12 | Product Engineering | 移除顶层 `prd/`、`samples/`：PRD 归来源仓库，OCR 样本归服务测试夹具；新增放置规则 9 |
| 2.0.0 | 2026-10-12 | Product Engineering | 改为 monorepo（apps/packages/services）视角；确立过程/成果分层与默认命令隔离约束 |
| 1.1.0 | 2026-10-02 | Product Engineering | 目录编号改为 00、01、10、20、30、40 |
| 1.0.0 | 2026-09-10 | Product Engineering | 初始目录结构与文档地图 |
