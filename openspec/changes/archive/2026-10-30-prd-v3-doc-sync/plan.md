# PRD v3 产品级文档同步 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 proposal 中确认的 11 项决定、权限点清单与开放问题决议写进产品级文档，完成 PRD §8 中产品级同步，并把设计文档按“中”深度重写为 v3 目标架构。

**Architecture:** 纯文档变更（`skip_specs: true`）。先改 PRD（上游），再改术语、范围与画像、NFR，然后写存储边界 ADR-007，以它为依据重写 Architecture 与 Data-Model，最后修订标准与入口规则。每个任务以“改前检查应失败、改后检查应通过”的 grep 检查作为验证。

**Tech Stack:** Markdown、git、`openspec` CLI 1.10.0。

**Spec:** `openspec/changes/prd-v3-doc-sync/proposal.md`；上游 `docs/10-product/PRD-SaiFlow.md` v3.0.0；流程 `AI-WORKFLOW.md` v2.0.0。

## Global Constraints

- 在当前分支 `chore/ai-workflow-v2` 上直接提交（负责人决定：只改当前分支）；不推送。
- 每份被修改的 `docs/` 文档：更新 frontmatter `version` / `updated: 2026-10-30`，版本历史追加一行；**版本历史只写内容变化，不写测试条数、构建哈希、部署记录**。
- 产品文档（PRD、Vision-Scope、Personas、Glossary、NFR）**不写实现细节**：不出现表名、字段名、接口路径、错误码、环境变量。
- `Data-Model.md` 只写实体层：**不写字段表**（字段以代码为唯一来源）。
- 术语：新文档中用到的领域术语必须在 `Glossary.md` 中有定义。
- 不改 `EPIC-*` 与 `Acceptance-Criteria.md` 的正文（只加 Task 1 规定的提示框）；不改 `OCR-Pipeline.md`；不动 `legacy/`。
- 新 ADR 编号为 `ADR-007`，放在 `docs/30-design/adr/`。
- 所有临时文件放 `./temp/`。

## Review Focus

1. **读者仍按旧 EPIC 实现**：EPIC-06 等仍描述旧角色（clerk/finance/reviewer）与旧实现，AI 读 EPIC 会与 PRD 新章节冲突 → Task 1 给受影响 EPIC 加“以 PRD v3.1 为准”的提示框，并用 grep 检查。
2. **实现细节渗入产品文档**：写 PRD §4.9 时顺手带入 `tenant_id`、`402`、`subscriptions` 等 → Task 1、2、4 各有一条“不含实现标识符”的 grep 检查。
3. **入站链接失效**：EPIC-06、Acceptance-Criteria、Requirements-Index 引用 `Architecture §5/§6`、`Data-Model §2.13.1`，重写后这些章节不再含旧内容 → Task 1 的提示框写明“旧章节引用指向 tag `legacy-v1` 中的版本”；Task 6、7 保留 §5、§6 标题编号。
4. **术语遗漏**：PRD 新章节用了 Glossary 未定义的词 → Task 2 的检查逐个核对术语清单。
5. **ADR 与设计文档不一致**：Architecture / Data-Model 的存储归属与 ADR-007 不同 → Task 7 的检查逐个核对实体的存储位置与 ADR-007 表格一致。

---

### Task 1: PRD 新增 §4.9“账户、租户与计费”，并同步 §4、§4.6、§7、§8

**Files:**
- Modify: `docs/10-product/PRD-SaiFlow.md`（§4 能力表、§4.6、新增 §4.9、§7、§8、frontmatter、版本历史）
- Modify（仅在 H1 后加提示框）: `docs/20-requirements/functional/EPIC-01-document-upload.md`、`EPIC-02-ocr-recognition.md`、`EPIC-03-data-verification.md`、`EPIC-04-entry-archiving.md`、`EPIC-06-system-base.md`、`EPIC-08-document-template-configuration.md`

**Interfaces:**
- Produces: PRD v3.1.0；锚点 `§4.9 账户、租户与计费`（Task 2–7 引用）；PRD §4.9 中使用的术语清单（Task 2 消费）。

- [ ] **Step 0: 记录起点** — `git rev-parse --short HEAD`，记为 `CHANGE_BASE`（Task 9 使用）。

- [ ] **Step 1: 改前检查**

Run: `grep -c '账户、租户与计费' docs/10-product/PRD-SaiFlow.md`
Expected: `0`

- [ ] **Step 2: 写 §4.9**（放在 §4.8 之后、§5 之前），小节如下，内容取自 proposal 第 1 项：
  - `#### 用户与租户`：决定 4、5、6（用户与租户多对多、个人租户不能邀请、升级为企业 = 另建企业租户、企业认证两种开通方式、游客临时租户）。
  - `#### 注册与登录`：决定 7、8、9（两个注册入口走同一流程、内部唯一用户身份与关联身份、同一 LINE Provider、三入口的登录方式）。
  - `#### 角色与权限`：决定 2、3 与**权限点清单表**（原样照录 proposal 表格与两条说明）。
  - `#### 套餐与计量`：决定 1（四档套餐及每月页数、首月 Kinder、到期即停、线下续费与升级、同档可续、生效中不可降档、到期提醒节点）。
  - `#### 使用入口`：决定 10、11（三入口职责表；web-pc 企业版 V1.0 范围）。
- [ ] **Step 3: §4 能力表** 新增一行：`| 账户、租户与计费 | EPIC-06（需更新） | P0 | 用户与租户、注册与登录、角色与权限点、套餐与月页计量、到期提醒；见 §4.9 |`；“基础系统”行摘要去掉“账户/权限、登录/注册”，改为“操作日志、语言切换、系统参数配置”。
- [ ] **Step 4: §4.6 系统参数表**：“OCR 引擎”行改为“首选与备用两个引擎（TextIn / Google Cloud Vision API）及优先级，由平台 admin 配置，全系统共用”；新增三行：`单据重试次数`、`全局切换阈值`、`首选引擎试探间隔`（说明按 proposal OQ-12 决议）；“大模型地址”“大模型 AppKey”行说明末尾加“全系统一组，由平台 admin 配置”。
- [ ] **Step 5: §7**：OQ-12、OQ-21、OQ-22、OQ-27 从 7.2 移入 7.3“已决议”，决议文字照录 proposal 第 3 项表格；7.1/7.2 中 OQ-4、OQ-7 的“是否阻塞？”改为“是（投产前）”。
- [ ] **Step 6: §8**：已在本 change 中完成的条目打勾（Glossary、Vision-Scope、NFR、Architecture/Data-Model 与 ADR、AGENTS 第 7 条）；EPIC、OCR-Pipeline、Acceptance 三条保持未勾，并在行末注明“随 B-2～B-4 迁入 `openspec/specs/`（ADR-006 §7）”。
- [ ] **Step 7: 版本** `version: 3.1.0`，`updated: 2026-10-30`；版本历史追加 `3.1.0 | 新增 §4.9 账户、租户与计费（11 项决定与权限点清单）；§4.6 OCR 双引擎切换参数；关闭 OQ-12/21/22/27`。
- [ ] **Step 8: EPIC 提示框**：6 份 EPIC 的 H1 下一行插入：

```markdown
> **注意（2026-10-30）：** 本 Epic 尚未按 PRD v3 改写，与 `PRD-SaiFlow.md` v3.1 冲突时以 PRD 为准；将随 ADR-006 §7 的重建步骤迁入 `openspec/specs/`。文中引用的 `Architecture` / `Data-Model` 旧章节细节见 git tag `legacy-v1` 中的版本。
```

- [ ] **Step 9: 改后检查**

Run: `grep -c '账户、租户与计费' docs/10-product/PRD-SaiFlow.md; grep -nE 'tenant_id|subscriptions|402|PLAN_EXPIRED|user_tenant|/api/v1' docs/10-product/PRD-SaiFlow.md; grep -L '以 PRD 为准' docs/20-requirements/functional/EPIC-0{1,2,3,4,6,8}-*.md`
Expected: 第一条 ≥ `2`；第二条无输出；第三条无输出。

- [ ] **Step 10: Commit**（连同 `openspec/changes/prd-v3-doc-sync/` 下的 `.openspec.yaml`、`README.md`、`proposal.md`、`plan.md`）— `git commit -m "[prd-v3-doc-sync] PRD 3.1.0: add §4.9 accounts, tenants and billing; close OQ-12/21/22/27; flag EPICs pending v3 rewrite"`

---

### Task 2: Glossary 补充术语

**Files:**
- Modify: `docs/10-product/Glossary.md`（§1、§3、§4、frontmatter、版本历史）

**Interfaces:**
- Consumes: Task 1 PRD §4.9 用到的术语。

- [ ] **Step 1: 改前检查**

Run: `for t in 结构化文件导入 界面直接录入 'Google Cloud Vision API' 大模型模板匹配 大模型结构化转换 字段置信度 置信度阈值 'Confirm all' 正式业务数据 人工确认 主要字段 隐藏模板标识 自由格式 租户 个人租户 企业租户 游客 平台管理员 owner 默认角色 权限点 套餐 月页额度 企业认证 关联身份; do grep -q "\*\*$t" docs/10-product/Glossary.md || echo "missing: $t"; done`
Expected: 列出缺失项（至少 20 条）。

- [ ] **Step 2: 写入**：数据入口与 OCR 链路术语进 §3；租户与计费术语进 §1；`平台管理员（admin）`、`owner`、`默认角色`、`权限点` 进 §4 并删除 §4 中 `clerk`、`finance`、`reviewer` 作为预设角色的表述（改为“由 owner 在运行期自定义的角色示例”）。修订“原始识别载荷”（不限 TextIn）、“文档格式模板”（大模型匹配与转换的依据）、“JSONPath 映射”（标注“v3 不再使用”，保留词条以便追溯）。
- [ ] **Step 3: 版本** `version: 1.2.0`；版本历史追加一行。
- [ ] **Step 4: 改后检查**：重跑 Step 1 命令 → 无输出；`grep -nE 'tenant_id|subscriptions|/api/' docs/10-product/Glossary.md` → 无输出。
- [ ] **Step 5: Commit** — `git commit -m "[prd-v3-doc-sync] Glossary 1.2.0: v3 intake/LLM terms, tenants, roles and billing"`

---

### Task 3: Vision-Scope 与 Personas

**Files:**
- Modify: `docs/10-product/Vision-Scope.md`（§3.1、§3.3、§4、§5）
- Modify: `docs/10-product/Personas.md`（§1 表、§2 P-07、新增游客画像）

- [ ] **Step 1: 改前检查** — `grep -cE '租户|游客|web-pc' docs/10-product/Vision-Scope.md docs/10-product/Personas.md` → 两份均为 `0`。
- [ ] **Step 2: Vision-Scope**
  - §3.1 范围内新增 3 条：“三个使用入口：LINE 小程序、web-pc 企业版（数据浏览与管理操作）、web-pc admin 后台”“账户与租户：游客试用、LINE 注册与登录、个人与企业租户、运行期自定义角色”“计费：四档套餐、按月页数计量、到期即停、线下续费、到期提醒”；“Excel 自动录入”一条改为“OCR 结果导出 Excel（与导入模板版式一致）”。
  - §3.3 范围外新增：“在线支付”“按租户配置 OCR 引擎与大模型”“web-pc 报表、应收应付跟踪、异常识别（见 §4）”。
  - §5 第 3 条存储描述改为 v3 边界（原件 GCS、表单数据 Firestore、系统数据 Cloud SQL），链接 ADR-007。
  - `version: 1.2.0`；版本历史追加一行。
- [ ] **Step 3: Personas**
  - §1 表：P-07 改名“平台管理员（admin）”，类型“内部”，场景“开通/关闭租户、企业认证审核、线下收款后修改余额与有效期、配置 OCR 与大模型”；新增 `P-08 企业所有者（owner）`（核心，成员与角色管理、套餐申请、企业认证申请）与 `P-09 游客`（间接，免登录试用至确认）。
  - §2 补 P-08、P-09 详细画像（特征、场景、痛点、需求、待完成任务，各 1 行）；P-05 企业所有者保留为“间接、监督者”，并注明“在系统中通常担任 owner（P-08）”。
  - `version: 1.2.0`；版本历史追加一行。
- [ ] **Step 4: 改后检查** — Step 1 命令两份均 ≥ `1`；`grep -c 'P-08\|P-09' docs/10-product/Personas.md` ≥ `4`。
- [ ] **Step 5: Commit** — `git commit -m "[prd-v3-doc-sync] Vision-Scope/Personas 1.2.0: three entry points, tenants and billing, platform admin vs owner, guest"`

---

### Task 4: NFR 补充约束

**Files:**
- Modify: `docs/20-requirements/non-functional/NFR.md`

**Interfaces:**
- Produces: `NFR-SEC-011`、`NFR-SEC-012`、`NFR-REL-005`、`NFR-PERF-009`、`NFR-COMPAT-008`（Task 6 引用）。

- [ ] **Step 1: 改前检查** — `grep -cE 'NFR-SEC-011|NFR-SEC-012|NFR-REL-005|NFR-PERF-009|NFR-COMPAT-008' docs/20-requirements/non-functional/NFR.md` → `0`。
- [ ] **Step 2: 写入**（按各节现有条目格式）：

| ID | 陈述（系统必须……） |
|----|--------------------|
| NFR-SEC-011 | 平台 admin 后台使用与客户账号隔离的独立账号；口令以强单向哈希存储，连续失败达到阈值后锁定；admin 的每次写操作写入操作日志。短信 OTP 在接入短信平台后补充 |
| NFR-SEC-012 | 发送到大模型与 OCR 服务的单据内容仅由服务端调用；更换模型或引擎时由人工确认其 PDPA 合规（PRD §3.6） |
| NFR-REL-005 | OCR 引擎按 PRD §4.6 与 OQ-12 决议执行两层切换：单据级重试后改用备用引擎；首选引擎全局连续失败达到阈值时整体切换并按间隔试探恢复；只统计服务层面的失败 |
| NFR-PERF-009 | 记录每份单据的 OCR 与大模型调用次数与耗时，供 OQ-20 设定成本上限与性能基线 |
| NFR-COMPAT-008 | LINE OA、LIFF 小程序与 web-pc 的 LINE 登录必须属于同一个 LINE Provider，使同一用户在各入口得到相同的 LINE 身份 ID |

- [ ] **Step 3: 版本** `version: 1.2.0`；版本历史追加一行。
- [ ] **Step 4: 改后检查** — Step 1 命令 → `5`；`grep -nE '/api/|tenant_id|[A-Z_]{6,}_ENABLED' docs/20-requirements/non-functional/NFR.md | grep -E 'SEC-011|SEC-012|REL-005|PERF-009|COMPAT-008'` → 无输出。
- [ ] **Step 5: Commit** — `git commit -m "[prd-v3-doc-sync] NFR 1.2.0: admin auth, LLM/OCR data handling, OCR failover, call metrics, LINE provider"`

---

### Task 5: ADR-007 存储边界

**Files:**
- Create: `docs/30-design/adr/ADR-007-v3-storage-boundary.md`（按 TPL-07）

**Interfaces:**
- Produces: 存储归属表（Task 6、7 照用，不得另行定义）。

- [ ] **Step 1: 改前检查** — `ls docs/30-design/adr/ADR-007-* 2>&1` → `No such file`。
- [ ] **Step 2: 写 ADR-007**，`status: accepted`，`related: [PRD-001, OQ-21, OQ-27, ADR-001, ADR-006]`。“决策”节为以下归属表（**本计划的设计决定，请负责人在审阅 plan 时确认**）：

| 数据 | 存储 | 说明 |
|------|------|------|
| 原始单据、导入文件、导出文件、头像等对象 | 私有 GCS | 只存对象；元数据在 Cloud SQL |
| 表单数据：每份单据一个文档，含结构化结果、结果版本、状态（待核验 / 待复核 / 正式业务数据，OQ-21 同一文档状态字段）、核验修改记录、复核记录 | Firestore | 报表方式 A 直接查询“正式业务数据”状态 |
| 原始识别载荷（OCR 引擎原始 JSON） | Firestore | 按载荷版本不可变 |
| 用户与关联身份、租户、企业及认证、成员关系、角色与权限点分配、邀请 | Cloud SQL | 系统数据 |
| 套餐目录、订阅、续费/升级与企业认证申请、到期提醒记录、站内通知 | Cloud SQL | 月页计量依赖识别任务记录 |
| 文件元数据、识别任务（状态、页数、所用引擎）| Cloud SQL | 识别任务是处理与计量数据，不是表单数据 |
| 文档格式模板及其版本、系统参数（OCR 引擎与切换参数、大模型配置引用、阈值）| Cloud SQL | 密钥本体在 Secret Manager |
| 操作日志（审计） | Cloud SQL | 仅追加 |
| 平台 admin 账号 | Cloud SQL | 与客户账号分表隔离 |
| 报表数据（方式 B，后续） | Cloud SQL（经 Dataflow ETL） | OQ-8，非 V1.0 |

  “后果”节写明：取代 Architecture v2 中“Cloud SQL 保存模板化关系投影、Cloud Functions 转换”的设计；关闭 OQ-27；`AGENTS.md` 第 7 条据此修订。
- [ ] **Step 3: 改后检查** — `grep -cE '^\| .* \| (私有 GCS|Firestore|Cloud SQL)' docs/30-design/adr/ADR-007-v3-storage-boundary.md` → ≥ `9`；`grep -c 'OQ-27' ...` ≥ `1`。
- [ ] **Step 4: Commit** — `git commit -m "[prd-v3-doc-sync] ADR-007: v3 storage boundary (closes OQ-27)"`

---

### Task 6: Architecture.md 重写为 v3 目标架构（3.0.0）

**Files:**
- Modify: `docs/30-design/Architecture.md`（正文整体重写；保留 frontmatter `doc_id` 与旧版本历史行）

**Interfaces:**
- Consumes: Task 5 存储归属表；Task 4 NFR ID。

- [ ] **Step 1: 改前检查** — `grep -cE 'Cloud Functions（Firestore 触发）|JSONPath|psycopg|index-[A-Za-z0-9]{6,}\.js' docs/30-design/Architecture.md` → ≥ `1`。
- [ ] **Step 2: 按下列章节重写**（保留 §0–§7 编号，以免入站链接的章节号错位）：

| 章节 | 内容 |
|------|------|
| §0 技术基线 | 只列技术选型（FastAPI、React、Ant Design / Ant Design Mobile、Cloud Run、Cloud SQL PostgreSQL、Firestore、GCS、Secret Manager、LINE LIFF/OA、TextIn / Google Cloud Vision、可配置大模型），不写版本号与驱动 |
| §1 架构原则 | 保留原 6 条中仍成立的；“原始数据与投影分离”改为“表单数据与系统数据分离（ADR-007）” |
| §2 组件概览 | mermaid 图：三个入口 → 一个后端 API（Cloud Run）→ OCR 引擎（首选/备用）、大模型、Firestore、Cloud SQL、GCS |
| §3 组件与职责映射 | 表：组件 → 职责 → 相关 PRD 章节；删除旧 §3.1（品牌等待细节），以一行“交互规范见 NFR-USAB-004”代替 |
| §4 端到端数据流 | 按 PRD §3.1 五阶段 + §3.2 OCR 链路；标注 OCR 两层切换（NFR-REL-005） |
| §5 部署模型 | 只写拓扑：每个入口与后端的 Cloud Run 服务、手动触发的部署脚本（ADR-006 §6）；不写切流与哈希 |
| §6 安全性与可靠性 | 原则层：身份模型（内部用户 ID + 关联身份，NFR-COMPAT-008）、三入口认证方式（NFR-SEC-011）、租户隔离、密钥只在服务端、审计；不写超时毫秒数、存储键与具体流程 |
| §7 架构决策 | 列 ADR-001、ADR-005（reverted）、ADR-006、ADR-007 及一句话结论 |

- [ ] **Step 3: 版本** `version: 3.0.0`；版本历史追加 `3.0.0 | 按 PRD v3 与 ADR-007 重写为 v3 目标架构；旧实现细节见 tag legacy-v1`。
- [ ] **Step 4: 改后检查** — Step 1 命令 → `0`；`grep -c '^## [0-7]\.' docs/30-design/Architecture.md` → `8`；`grep -c 'ADR-007' docs/30-design/Architecture.md` ≥ `2`。
- [ ] **Step 5: Commit** — `git commit -m "[prd-v3-doc-sync] Architecture 3.0.0: v3 target architecture"`

---

### Task 7: Data-Model.md 重写为实体层（2.0.0）

**Files:**
- Modify: `docs/30-design/Data-Model.md`（正文整体重写；保留 `doc_id` 与旧版本历史行）

**Interfaces:**
- Consumes: Task 5 存储归属表。

- [ ] **Step 1: 改前检查** — `grep -cE '^\| *(id|tenant_id|created_at) *\|' docs/30-design/Data-Model.md` → ≥ `1`（存在字段表）。
- [ ] **Step 2: 按下列结构重写**：
  - 开头说明块：“本文件只描述实体层；字段级结构以代码（ORM 模型 + Alembic 迁移）为唯一来源（ADR-007、STD-004 规则 2）。”
  - §1 实体关系概览：mermaid `erDiagram`，只画实体与关系，不带属性。
  - §2 实体清单：一张表，列 `实体 ID | 用途 | 存储 | 归属 | 关键关系 | 生命周期`。实体 ID 沿用 `DM-<Entity>`：`DM-User`、`DM-UserIdentity`、`DM-Tenant`、`DM-Enterprise`、`DM-Membership`、`DM-Role`、`DM-Invitation`、`DM-Plan`、`DM-Subscription`、`DM-Application`、`DM-PlanReminder`、`DM-Notification`、`DM-File`、`DM-OcrJob`、`DM-DocumentTemplate`、`DM-SystemSetting`、`DM-OperationLog`、`DM-AdminAccount`（Cloud SQL）；`DM-FormDocument`、`DM-ExtractionPayload`（Firestore）；`DM-StoredObject`（GCS）。存储列必须与 ADR-007 一致。
  - §3 枚举：只列产品级枚举（`DocumentType`、表单状态、租户类型、订阅状态、套餐档位、权限点）的取值名称。
  - §4 数据保留与隐私：保留原 §5 内容，存储位置按 ADR-007 修订。
  - 删除原 §2.1–§2.14 与 §4“字段到文档类型的映射”（字段映射由模板定义）。
- [ ] **Step 3: 版本** `version: 2.0.0`；版本历史追加 `2.0.0 | 改为实体层（字段以代码为唯一来源）；按 ADR-007 的 v3 存储边界重列实体；旧字段级内容见 tag legacy-v1`。
- [ ] **Step 4: 改后检查** — Step 1 命令 → `0`；`grep -oE 'DM-[A-Za-z]+' docs/30-design/Data-Model.md | sort -u | wc -l` ≥ `21`；对 ADR-007 表中每类数据，在实体清单中找到对应实体且存储列相同（逐行人工核对，结果记入 `verification.md`）。
- [ ] **Step 5: Commit** — `git commit -m "[prd-v3-doc-sync] Data-Model 2.0.0: entity-level model per ADR-007"`

---

### Task 8: 标准、模板与入口规则

**Files:**
- Modify: `docs/00-standards/Directory-Structure.md`（放置规则 2）
- Modify: `docs/00-standards/Document-Source-Guide.md`（§3.1 `Data-Model.md` 行）
- Modify: `docs/01-templates/TPL-04-data-model.md`
- Modify: `AI-WORKFLOW.md`（§4 表“架构、数据模型、ADR”行）
- Modify: `AGENTS.md`（§1 产品描述的存储部分、§7 第 7 条）

- [ ] **Step 1: 改前检查** — `grep -c '代码为唯一来源' docs/00-standards/Directory-Structure.md docs/00-standards/Document-Source-Guide.md docs/01-templates/TPL-04-data-model.md AI-WORKFLOW.md` → 均为 `0`；`grep -c 'ADR-007' AGENTS.md` → `0`。
- [ ] **Step 2: 修订**
  - STD-004 规则 2 改为：“新增数据实体 → 在 `docs/30-design/Data-Model.md` 登记实体层；字段级结构以代码（ORM 模型 + Alembic）为唯一来源，不在文档中重复；变更级设计写在对应变更的 `plan.md`。”`version: 2.6.0`。
  - STD-007 `Data-Model.md` 行说明改为“实体层，人工维护；字段以代码为唯一来源”。`version: 1.2.0`。
  - TPL-04：删除字段表示例，改为“实体清单表（实体 ID | 用途 | 存储 | 归属 | 关键关系 | 生命周期）+ 不带属性的 erDiagram + 枚举名称”。`version: 1.1.0`。
  - `AI-WORKFLOW.md` §4 表“架构、数据模型、ADR”行说明追加“数据模型只写实体层，字段以代码为唯一来源”。`version: 2.1.0`。
  - `AGENTS.md` §1 与 §7 第 7 条：存储描述改为“原件存私有 GCS；表单数据（含原始识别载荷与结构化结果）存 Firestore；系统数据存 Cloud SQL PostgreSQL 18.6（实例 `saiflow-dev` / `postgres.saiflow`）；见 ADR-007”，其余句子不变。`version: 3.1.0`。
  - 以上每份文档版本历史追加一行。
- [ ] **Step 3: 改后检查** — Step 1 两条命令：前者均 ≥ `1`，后者 ≥ `2`。
- [ ] **Step 4: Commit** — `git commit -m "[prd-v3-doc-sync] standards: fields live in code; AGENTS rule 7 per ADR-007"`

---

### Task 9: 收尾检查、验证记录与归档

**Files:**
- Create: `openspec/changes/prd-v3-doc-sync/verification.md`

- [ ] **Step 1: 全量检查**
  - 版本历史无过程证据：`git diff <CHANGE_BASE>..HEAD -- docs AGENTS.md AI-WORKFLOW.md | grep '^+|' | grep -nE '[0-9]+ 项|通过|哈希|切流|index-[A-Za-z0-9]+\.js'` → 无输出（`CHANGE_BASE` 见 Task 1 Step 0）。
  - 相对链接存在：对本 change 修改过的文件提取 `](相对路径)`，逐个 `test -e`，缺失项为 0。
  - `openspec validate prd-v3-doc-sync` → `valid`。
- [ ] **Step 2: 写 `verification.md`**：表格 `检查项 | 命令 | 结果`，覆盖 Task 1–8 的改后检查与 Review Focus 5 条结论；Task 7 的逐行核对结果列在此处。
- [ ] **Step 3: 归档** — `openspec archive prd-v3-doc-sync --skip-specs -y`
- [ ] **Step 4: Commit** — `git commit -m "[prd-v3-doc-sync] verification record; archive change"`
- [ ] **Step 5: 交付** — 使用 `superpowers:finishing-a-development-branch`；按负责人决定，保持在当前分支、不推送。
