---
doc_id: ADR-006
title: "ADR-006 — AI Native 开发模式：OpenSpec 管需求、SuperPowers 管实现，并重建代码"
type: adr
status: accepted
version: 1.2.8
updated: 2026-11-06
owner: Product Engineering
related: [WF-001, AGENTS, STD-004, STD-005, STD-006, PRD-001, ADR-008]
doc_source: manual
---

# ADR-006 — AI Native 开发模式：OpenSpec 管需求、SuperPowers 管实现，并重建代码

> 记录 SaiFlow 在 1–2 人维护条件下采用的 AI 开发模式，以及随之进行的代码重建决策。实施本 ADR 时阅读；它取代 `AI-WORKFLOW.md` v1.1.0 中基于 subagent 的阶段划分。

## 状态

accepted（2026-10-30 负责人确认）

## 上下文

### 团队与目标

- 项目由 1 人主力开发前后端，另 1 人仅在候补或紧急需求时介入。
- 负责人希望**亲自参与并逐项确认**：需求细化、架构设计、规范制定、开发方案。
- 繁重、长时间运行的编码与测试，长期希望放到夜间自动运行、早上验收；**此项优先级低，本 ADR 不实施**。
- 当前瓶颈：需求以对话方式逐步细化后直接编码，人全程陪跑，效率难以提升。

### 现状（2026-10-29 盘点）

| 问题 | 证据 |
|------|------|
| 设计的 subagent + OpenSpec 流程实际未被使用 | `openspec/changes/` 只有 10-12/13 的 2 个变更，任务已勾选但未归档；`openspec/specs/` 为空；10-16 之后的 LINE、租户、订阅、核验页均为对话直改代码 |
| 产品文档被当作开发日志 | `EPIC-06` 需求行含 localStorage、402 错误码、表名；`Architecture.md`、`Data-Model.md`、`Acceptance-Criteria.md` 版本历史记录测试条数、构建哈希、切流比例；`EPIC-06` 68 KB、AC 62 KB |
| 规范与代码不一致 | STD-006 规定 React，`apps/line-mini` 为 Vue；STD-005 规定 FastAPI 分层，`services/api` 为平铺 Flask，无 Alembic，启动时代码补列（`_ADD_COLUMNS`），进程内 worker |
| 测试底座缺失 | 后端仅 `test_auth_modes.py` 一个文件；`line-mini` 无测试；`web-pc` 为全 mock 原型 |
| PRD v3 未同步 | PRD §8 同步清单全部未勾选；v3 改变数据边界（表单数据 → Firestore）与 OCR 链路（大模型模板匹配与结构化转换） |
| 调试残留文件入库 | `services/api/sf-cookies.txt`（curl 本地 cookie 罐）已被 git 跟踪；已处理，见 §5 |
| 4 个 subagent 基本是 OpenSpec skill 的外壳 | 每个阶段需人类以“你作为 xxx”手动驱动；subagent 只回摘要，人看不到细节，与“逐项参与”的目标冲突 |

## 决策

1. **不使用项目自定义 subagent。** 所有环节在主会话内以斜杠命令与 skill 推进，人可见每一步。SuperPowers、OpenSpec 等框架内部派生的 subagent（如代码审查）及其内部定义**不干预**，照常使用；仅当框架行为与本 ADR 严重重复（如产出第二份规格或方案）时，才在项目规则中加以约束（负责人确认，2026-10-30）。
2. **OpenSpec 只管“做什么”（需求）**，**SuperPowers 只管“怎么做”（实现）**；交接点是“delta spec 经负责人确认且 `openspec validate` 通过”。
3. **`openspec/specs/` 是行为需求的唯一正本。** `docs/` 只保留产品级持久文档。
4. **按改动大小分三级**，不是每件事都走全流程。
5. **统一技术栈为 React + FastAPI**，严格按 STD-005 / STD-006；现有代码不在原地修改，**按模块重建**，旧代码仅作参考。

## 1. 目标、非目标与反目标

| 类别 | 内容 |
|------|------|
| **目标** | 负责人在每个决策点确认后再进入下一步；一个需求的过程产物都在一个 change 目录；需求只有一份正本；代码先有测试再有实现；规范与代码一致，AI 读规范不会与代码冲突 |
| **非目标** | 夜间自动运行（延后，见 §8）；多人并行协作流程；自研 OpenSpec 或 SuperPowers 的替代流程 |
| **反目标**（技术上可行也算失败） | 同一需求出现两份及以上方案或规格；`docs/` 再次写入测试条数、构建哈希、部署比例等过程信息；为了走流程而让一行 CSS 修复也写 proposal；AI 在需求阶段被 SuperPowers brainstorming 再追问一遍；change 完成后不归档 |

## 2. 工具分工与人工确认点

| 阶段 | 工具 / 命令 | 产物（位置） | 负责人确认点 |
|------|-------------|--------------|--------------|
| ① 需求澄清 | `/opsx:explore` | 无文件，或 change 内的笔记 | 需求边界、优先级（P0 限定）是否清楚 |
| ② 需求规格 | `/opsx:propose`（叠加 `saiflow-requirements`） | `openspec/changes/<change>/proposal.md`、`.../specs/<capability>/spec.md` | **逐条确认** SHALL 语句与 Gherkin AC；`openspec validate <change>` 通过 |
| ③ 实施方案 | `superpowers:writing-plans` | `openspec/changes/<change>/plan.md` | **逐项确认** 架构取舍、数据模型/接口变化、任务拆分；含权衡的决策另写 ADR |
| ④ 隔离环境 | `superpowers:using-git-worktrees` | 分支 `feat/<change>` | — |
| ⑤ 实现 | `superpowers:test-driven-development` + `superpowers:executing-plans` | `apps/**`、`packages/**`、`services/**` 代码与测试 | 计划内的检查点按 plan 约定确认 |
| ⑥ 验证与审查 | `superpowers:verification-before-completion`、`superpowers:requesting-code-review` | `openspec/changes/<change>/verification.md`（AC → 测试 → 结果） | 审阅验证结果与审查意见 |
| ⑦ 收尾 | `superpowers:finishing-a-development-branch` → `/opsx:archive` | 合并分支；delta 合并进 `openspec/specs/`；change 移入 `openspec/changes/archive/` | 确认合并；**归档是必做步骤** |

**工具规则（写入 `AGENTS.md` 与 `AI-WORKFLOW.md`）：**

- 需求阶段（①②）只用 OpenSpec；**不调用 `superpowers:brainstorming`**。SuperPowers 从 ③ `writing-plans` 开始接手，以已确认的 delta spec 为输入。项目规则优先于 skill 自带的触发要求。
- SuperPowers 的 plan **不写入** `docs/superpowers/`，固定写入 `openspec/changes/<change>/plan.md`。
- OpenSpec 的 `design.md`、`tasks.md` **不再编写**，其职能由 `plan.md` 承担；`/opsx:apply` 不再使用。
- `plan.md` 必须：引用本 change 的 FR/AC ID；遵循 STD-005 / STD-006；每个任务写明对应的测试；列出需要负责人确认的检查点。
- 验证证据（测试命令、条数、结果、部署记录）只写 `verification.md`，随 change 归档，不进 `docs/`。

## 3. 改动分级

| 级别 | 判定标准 | 流程 |
|------|----------|------|
| **S — 小修** | 不改变任何 SHALL 语句或 AC 的可观察行为：样式、文案、重构、明显缺陷修复（行为本来就已在 spec 中定义） | 直接改代码 + 测试；提交信息引用相关 FR/AC ID |
| **M — 行为变化** | 修改或新增少量 SHALL 语句/AC，不引入新实体或新接口 | ② delta spec → ③ 简短 plan（可一页）→ ⑤–⑦ |
| **L — 新功能 / 新模块** | 新能力、新实体、新接口、架构调整 | 完整 ①–⑦ |

判定不确定时，AI 必须向负责人询问级别，不得自行降级。

## 4. 需求正本与文档分层

| 内容 | 唯一正本 | 说明 |
|------|----------|------|
| 为什么做、产品范围、优先级 | `docs/10-product/`（PRD、Vision-Scope、Personas） | 产品级，不含实现细节 |
| 术语 | `docs/10-product/Glossary.md` | 不变 |
| 行为需求（FR + Gherkin AC） | `openspec/specs/<capability>/spec.md` | 保留原 `FR-*`、`AC-*` ID，追溯不断链 |
| 非功能需求 | `docs/20-requirements/non-functional/NFR.md` | 保留在 `docs/`；按 capability 引用 |
| 架构、数据模型、ADR | `docs/30-design/` | 只写当前结构与决策，不写测试与部署记录 |
| API 契约 | 后端 OpenAPI → `docs/30-design/API-Spec.md`（generated） | 不变 |
| 一次变更的过程（规格增量、方案、验证） | `openspec/changes/<change>/` | 归档后保留在 `archive/` |

**迁移规则：**

- 每重建一个模块，就把对应 EPIC 中的 FR 与 `Acceptance-Criteria.md` 中的 AC 按 PRD v3 改写为 `openspec/specs/<capability>/spec.md`（通过该模块的 change 的 delta spec 进入）。
- 被迁移的 EPIC 章节标记 `deprecated` 并链接到对应 capability；全部迁完的 EPIC 整份设为 `status: deprecated`。`Requirements-Index.md` 的“设计引用/验证方式”列改为指向 capability。
- 迁移时剔除 EPIC 中的过程信息与实现细节（存储键、日志式表述），实现细节只出现在 `plan.md` 与代码中。
- `docs/` 的版本历史只记录内容变化，**禁止**记录测试条数、构建哈希、切流比例等验证或部署证据。

## 5. 仓库配置调整（工作流部分 A）

| 对象 | 调整 |
|------|------|
| `.claude/agents/*.md`（4 个） | 移至 `.claude/archive/agents/`，不再加载；夜间自动化启用时再取回改写 |
| `.claude/skills/saiflow-architecture`、`saiflow-testing` | 移至 `.claude/archive/skills/`（职能由 plan 与 SuperPowers 验证 skill 承担） |
| `.claude/skills/saiflow-conventions` | 保留；去掉 subagent 相关描述；加入 §2 工具规则与 §3 分级 |
| `.claude/skills/saiflow-requirements` | 保留；明确产物只有 proposal + delta spec，AC 保留 `AC-FR-*` ID |
| `openspec/config.yaml` | 删除 `design`、`tasks` 规则与 `apply` 指导；`archive` 指导改为“确认 `verification.md` 全部 AC 通过后归档”；context 中补充技术栈为 React + FastAPI |
| `AGENTS.md` | §4 改为新的工具分工；新增需求阶段禁用 brainstorming、plan 位置、分级规则；§7 第 7 条按 PRD v3 数据边界更新（见 §7 B-0） |
| `AI-WORKFLOW.md` | 按本 ADR 重写为 v2.0.0：阶段表（§2）、分级（§3）、文档分层（§4）；删除 subagent registry 与“你作为 xxx”模板 |
| `Directory-Structure.md` | 登记 `legacy/`、`.claude/archive/`，以及 change 目录内的 `plan.md`、`verification.md` |
| 现有 2 个 openspec change | 不合并其 spec（描述的是将被替换的 mock 原型），直接移入 `openspec/changes/archive/`（如 CLI 支持，使用跳过 spec 合并的归档方式） |
| `services/api/sf-cookies.txt` | **已处理（2026-10-30）**：经核实是本地调试时 curl 生成的 cookie 罐，只含一条 `localhost` 会话，与设计无关；已 `git rm`，并在 `.gitignore` 中加入 `*cookies*.txt`。该文件与 `services/api/storage/{files,exports}` 下 31 个上传/导出文件只从**本分支（`chore/ai-workflow-v2`）**的历史中清除；其余分支与 tag 保持原样（负责人决定，2026-10-30） |

## 6. 技术栈与旧代码处理

- 后端：FastAPI，严格按 STD-005（分层、async、Alembic、pydantic-settings、`tests/unit` + `tests/integration`）。
- 前端：`apps/web-pc` 为 React + Ant Design；`apps/line-mini` 改为 React + Ant Design Mobile，均按 STD-006（Vitest + RTL）。
- API 契约：后端 OpenAPI 生成 `packages/api-client`，前端不手写第二份。
- **线上现状（负责人确认，2026-10-30）**：线上没有真实用户，不考虑数据迁移、服务中断和用户体验延续。现有线上服务可以随时下线；新版本按 B-1 起的部署方式重新发布。
- **旧代码**：只作参考，**不保留重新部署的能力**（Dockerfile、入口等随目录一起移走，不维护构建路径）。打 git tag `legacy-v1` 后，将现有 `services/api`、`apps/line-mini`、`apps/web-pc` 移至顶层 `legacy/`（不在 pnpm glob 内，不参与构建与测试）。`legacy/` 为只读参考：重建时可阅读，不修改、不引用、不复制未经测试的代码。新版本测试通过并运行一段时间后删除 `legacy/`，tag 保留。
- 重建认证、LINE、租户、订阅时，以 `legacy/` 中已验证的边界处理（LIFF 20 秒超时、登出锁定、游客归集等）作为参考答案：先把这些边界写成 AC 与测试，再实现。
- **部署**：现状为手工操作，即本地构建 Docker 镜像后，手工执行 `gcloud` 命令发布到 Cloud Run（负责人确认，2026-10-30）。仓库内没有部署脚本可沿用。B-1 把这套手工步骤写成 `scripts/` 下的部署脚本（构建镜像 → 推送 → `gcloud run deploy`），由人手动触发。**2026-11-02 起运行环境按 [ADR-008](ADR-008-vps-docker-hosting.md) 改为 LightNode VPS + Docker**：部署由 GitHub Actions 手动触发，构建镜像推到 GHCR，经 SSH 登录 VPS 后执行数据库迁移与 `docker compose` 更新；Cloud Run、Cloud SQL、Secret Manager 不再使用。自动部署不在本 ADR 范围内（实施者决定，已记录）。

## 7. 代码重建路线（部分 B）

每一步是一个独立的 OpenSpec change，按 §2 流程执行；B-1 同时是新流程的首次实战，结束后复盘并按需修订本 ADR 与 `AI-WORKFLOW.md`。

| 步骤 | change（暂定名） | 级别 | 内容 | 前置 |
|------|------------------|------|------|------|
| B-0 | `prd-v3-doc-sync` | M | 完成 PRD §8 中产品级部分：Glossary、Vision-Scope、NFR（大模型约束）、`AGENTS.md` 第 7 条；Architecture / Data-Model 按 v3 数据边界重写并新增 ADR（关闭 OQ-27） | A 完成 |
| B-1 | `rebuild-skeleton` | L | 新 `services/api`（FastAPI 骨架、配置、Alembic、pytest）、新 `apps/web-pc`、`apps/web-admin` 与 `apps/line-mini` 三个空壳（React、Vitest；admin 后台独立成应用，负责人 2026-10-30）、`packages/api-client` 生成脚本、CI 跑 lint/test/build、`scripts/` 手动触发的部署脚本、数据库每日备份（FR-PLAT-006） | B-0 |
| B-2a | `rebuild-identity` | M | LINE 登录与会话、游客会话与数据归集、注册与邮箱验证码、个人资料、平台 admin 后台账号、操作日志（只做后端） | B-1 |
| B-2b | `rebuild-tenant-rbac` | M | 租户访问规则、组织（申请与 admin 审批）、成员邀请与成员人数上限、角色与权限点、成员移除与 owner 转让、企业认证（只做后端；负责人 2026-11-04 取消原地升级） | B-2a |
| B-2c | `rebuild-plans-metering` | M | 套餐目录（admin 可改）、订阅与到期即停（保留历史）、免费额度（个人与组织）、扫描次数的预占与退还（B-3 调用）、用量查询、续费与开通申请、按套餐的成员人数上限（只做后端） | B-2b |
| B-2d | `rebuild-notifications` | M | 用量提醒、到期提醒、组织免费额度的到期提醒、通知中心；渠道为站内通知与邮件，由独立的提醒进程定时发送；LINE OA 消息另行接入（只做后端；负责人 2026-11-05 从 B-2c 拆出） | B-2c |
| B-3 | `ocr-pipeline-v3` | L | 上传（原件存私有 GCS）、OCR 引擎抽象、大模型模板匹配与结构化转换、识别结果存 PostgreSQL jsonb（EPIC-01/02 迁入；ADR-008） | B-2 |
| B-4 | `verify-and-export` | L | 人工确认与修正、复核、导出 Excel（EPIC-03/04 迁入） | B-3 |
| B-5a | `line-mini-account` | L | LINE 小程序：账户、租户、组织、套餐（含价格）与通知页面；后端套餐价格与查看邀请（负责人 2026-11-05：B-5 按应用拆分） | B-2 |
| B-5b | `web-admin-console` | M | admin 后台（中文/英文）：审批、组织、订阅与预占、套餐价格、系统参数、查询用户、操作日志、修改本人口令；后端补上 admin 改口令、日志与用户查询、OCR 与大模型配置（B-3 读取）（负责人 2026-11-06） | B-2 |
| B-5c | `web-pc-account` | M | web-pc 企业版（英语/泰语/中文）：LINE 网页登录、未注册用户引导到小程序注册、个人资料、租户切换、组织与成员、邀请链接与二维码、角色、owner 转让与退出、企业认证、套餐与续费申请、通知中心；只做前端（负责人 2026-11-06） | B-2 |
| B-5d 起 | （暂定） | L | 上传、识别、核验、历史等页面（各端） | B-3、B-4 |

B-2 到 B-5 的具体范围、优先级以各自 proposal 经负责人确认的版本为准。V1.0 仍只实现 P0。

**边界补充（实施者决定，已记录）：**

- **B-0** 不含行为需求，不写 delta spec，归档使用 `openspec archive --skip-specs`。B-0 不改 `EPIC-*` 与 `Acceptance-Criteria.md`（它们在 B-2～B-4 迁移时按 v3 改写进 capability）；`OCR-Pipeline.md` 的重绘放到 B-3。
- **`packages/*`**（`api-client`、`ui`、`tsconfig`）当前为空目录，保留原位，在 B-1 中建立内容，不移入 `legacy/`。
- **数据库**：新后端在 VPS 上的 PostgreSQL 中使用新的 schema，由 Alembic 从初始版本建立（ADR-008）；旧 Cloud SQL 中的 `saiflow` schema 不迁移，旧 Google Cloud 资源的下线另行决定。
- **执行顺序**：本 ADR 改为 `accepted` 后才执行部分 A；A 与 B-0 分为两个独立分支与 PR。

## 8. 延后：夜间自动运行

本 ADR 不实施。启用前须满足：

- B-1 的测试与 CI 已稳定，且至少 2 个 L 级 change 按新流程完整走通。
- `plan.md` 的写法已能做到“无人值守可执行”：每个任务有明确的完成判定与测试。

届时再决定运行位置（本机 / 云端）、取回 `.claude/archive/agents/` 改写为执行与验证角色、遇到阻塞时的记录与跳过规则、早上验收的报告形式，并另立 ADR。

## 发布分支与凭据（负责人决定，2026-10-30）

- **发布分支**：今后从 `chore/ai-workflow-v2`（及其后续分支）开发与发布；`main`、`docs/*`、`feature_ocr_*` 等其余分支与 tag 保持原样，不改写、不 force push。
- 本分支的历史经过改写（清除 cookie 文件与 31 个上传/导出文件）：与 `main` 的共同祖先是 `fb3f16e`，此后 `main` 上的 20 余个提交在本分支中是内容相同、哈希不同的改写版本。将来若要合并回 `main`，会出现重复提交与冲突，应改为用本分支替换 `main`，届时另行决定。
- **凭据**：`legacy/` 及历史中的 Cloud SQL、Firestore Mongo、MySQL、TextIn 凭据不轮换、不清理历史，风险接受（团队仅 2 人）。当前代码树中已删除两个含明文密码的 sample 文件，并清空其余凭据默认值。新代码一律通过环境变量注入（服务器上的环境变量文件，ADR-008），不得硬编码默认值。

## 考虑过的方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. 4 个 subagent + OpenSpec（现行设计） | 角色清晰、可换模型、利于将来自动化 | 每阶段需手动驱动；只回摘要，人看不到细节；实际未被使用 | 拒绝（夜间自动化时部分复用） |
| B. 只用 OpenSpec（含 design/tasks/apply） | 单一工具 | 实现阶段缺少 TDD、验证、代码审查纪律 | 拒绝 |
| C. 只用 SuperPowers | 单一工具，实现纪律强 | 缺少按能力累积的需求正本与 delta 管理 | 拒绝 |
| **D. OpenSpec 管需求 + SuperPowers 管实现 + 唯一正本 + 分级** | 需求可累积、实现有纪律、无双份文档、小改动不被流程拖慢 | 两个工具的触发规则需在项目规则中显式约束 | **采用** |
| 代码：原地改造 | 保留现有可运行系统 | v3 改动核心数据边界与 OCR 链路，原地改造量接近重写；无测试与迁移底座 | 拒绝 |
| **代码：新骨架 + 按模块重建，旧代码只读参考** | 地基合规；无用户数据迁移成本；保留旧代码中的已验证经验 | 重建期间无可上线的完整系统 | **采用** |

## 后果

- **正面影响：** 负责人在每个决策点可见可控；需求、方案、验证各有唯一位置；规范与代码一致；测试底座为将来夜间自动化铺路。
- **负面影响 / 权衡：** 重建期间没有可演示的完整系统；需求迁移到 `openspec/specs/` 需要逐模块改写；需要持续执行“归档”纪律，否则正本会过时。
- **后续风险：** OpenSpec 或 SuperPowers 升级后默认行为变化（例如 plan 默认路径、归档对 `tasks.md` 的要求），需在升级时复核本 ADR 的约束。

## 合规与约束检查

- PDPA：真实 OCR 样本仍只放 `services/api/tests/fixtures/ocr/` 且不入库；`legacy/` 不得包含 cookie、密钥或真实单据。
- 数据边界：以 ADR-008 为准（表单数据与系统数据存 PostgreSQL，对象存私有 GCS）；B-0 产出的 ADR-007 已被取代。

## 留给实施者决定

- `.claude/archive/`、`legacy/` 的具体移动方式与提交拆分。
- `openspec/config.yaml` 的具体措辞；若 OpenSpec CLI 在 validate 或 archive 时强制要求 `tasks.md`，可生成仅链接到 `plan.md` 的最小 `tasks.md`，但不得在其中重复任务内容。
- `verification.md` 的表格格式（至少包含 AC ID、测试名、结果、未覆盖说明）。
- B-1 中各依赖的具体版本与 CI 平台。

## 链接

- 现行工作流：`AI-WORKFLOW.md`（v1.1.0，将按本 ADR 重写）
- 仓库入口：`AGENTS.md`
- 规范：`docs/00-standards/Directory-Structure.md`、`Python-Backend-Structure.md`、`React-Frontend-Structure.md`
- PRD：`docs/10-product/PRD-SaiFlow.md`（§8 同步清单）

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.8 | 2026-11-06 | Product Engineering | §7 B-5c 行定名 `web-pc-account` 并写明范围（负责人 2026-11-06） |
| 1.2.7 | 2026-11-06 | Product Engineering | §7 B-5b 行定名 `web-admin-console` 并写明范围（负责人 2026-11-06） |
| 1.2.6 | 2026-11-05 | Product Engineering | §7 B-5 按应用拆分为 B-5a～B-5d（负责人 2026-11-05） |
| 1.2.5 | 2026-11-05 | Product Engineering | §7 B-2d 范围补上组织免费额度的到期提醒与独立的提醒进程（负责人 2026-11-05） |
| 1.2.4 | 2026-11-05 | Product Engineering | §7 B-2c 收窄范围，新增 B-2d `rebuild-notifications`（负责人 2026-11-05） |
| 1.2.3 | 2026-11-04 | Product Engineering | §7 B-2b、B-2c 两行按组织模型改写（取消原地升级，组织由申请与审批建立） |
| 1.2.2 | 2026-11-03 | Product Engineering | §7 B-2 按负责人决定拆为 B-2a / B-2b / B-2c，三者只做后端，页面在 B-5 |
| 1.2.1 | 2026-11-03 | Product Engineering | §7 B-1 行：三个前端空壳（新增 web-admin）与数据库每日备份 |
| 1.2.0 | 2026-11-02 | Product Engineering | 按 ADR-008：§6 部署改为 GitHub Actions + GHCR + SSH 到 VPS；§7 B-3 存储改为 PostgreSQL jsonb + GCS，数据库边界改为 VPS 上的 PostgreSQL；凭据来源改为服务器环境变量文件 |
| 1.1.1 | 2026-10-30 | Product Engineering | §7 B-2 范围按 PRD v3.2 补充用量提醒、免费额度与成员人数上限 |
| 1.1.0 | 2026-10-30 | Product Engineering | 记录负责人决定：历史清理只作用于本分支，其余分支与 tag 不变，今后从本分支发布；`legacy/` 中发现的数据库与 TextIn 凭据不轮换、不清理历史，风险接受（团队仅 2 人），当前代码树中已清空其默认值；新增“发布分支与凭据”一节 |
| 1.0.0 | 2026-10-30 | Product Engineering | 负责人审阅通过，状态改为 accepted；`sf-cookies.txt` 与 31 个已入库的上传/导出文件已从全部分支历史中清除 |
| 0.2.0 | 2026-10-30 | Product Engineering | 纳入审阅答复：线上无真实用户、旧代码不保留部署能力；部署为手工 Docker + gcloud，B-1 写成手动触发脚本；框架内部 subagent 不干预；新 schema 从零建；B-0 边界；`sf-cookies.txt` 已删除 |
| 0.1.0 | 2026-10-30 | Product Engineering | 初始草案：不使用 subagent；OpenSpec 管需求、SuperPowers 管实现；`openspec/specs/` 为需求唯一正本；三级分级；React + FastAPI 按模块重建 |
