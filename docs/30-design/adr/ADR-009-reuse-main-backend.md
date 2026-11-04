---
doc_id: ADR-009
title: "ADR-009 — 复用 main 分支后端的代码逻辑与数据库设计"
type: adr
status: accepted
version: 1.0.0
updated: 2026-11-04
owner: Product Engineering
related: [ADR-006, ADR-008, DM-File, DM-OcrJob, DM-ExtractionPayload, DM-FormDocument, DM-DocumentTemplate, NFR-SEC-002, NFR-SEC-010]
doc_source: manual
---

# ADR-009 — 复用 main 分支后端的代码逻辑与数据库设计

> 本 ADR 规定重建（分支 `chore/ai-workflow-v2`）如何复用 main 分支上已在内部演示通过的后端，覆盖范围是"上传 → OCR → 结果格式化 → 保存 → 导出"。它是 B-2b、B-2c、B-3、B-4 编写方案时的依据。它细化 ADR-006 §6 与 AGENTS.md 第 11 条"不复制未经测试的代码"在 main 代码上的适用方式。

## 状态

accepted（2026-11-04，负责人确认）

## 上下文

- 重建期间，main 上由另一位同事继续开发后端。后端用 Flask 3 + Flask-SQLAlchemy 编写，平铺在 `services/api/`，是 `legacy/` 那份代码的延续。
- 已完成并在内部演示通过的流程：上传、OCR（TextIn Prompt 抽取，可选用 DeepSeek 二次整理）、结果版本与核验、模板映射（EPIC-08）、XLSX/CSV 导出。
- 负责人决定：
  - 后端继续在本分支上重建（FastAPI，ADR-006、ADR-008）；
  - **只保留 main 的代码逻辑**，不延续接口约定，因为前端将要重构，接口由 AI 按需求重新设计；
  - main 数据库中的数据没有价值，不做数据迁移。
- main 的数据库设计快照：main 分支 `docs/30-design/db-export/`。其中 `01_schema.sql` 有 24 张表，由 `models.py` 离线生成；`02_base_data.sql` 是套餐与系统模板。它使用 schema `saiflow`，与重建的 `saiflow_v3` 互不影响。
- main 的代码依据的需求版本早于当前的 v3 需求，例如 `quota.py` 注明依据 PRD v1.4。

## 决策

### 1. 代码按三类处理

| 类别 | main 模块 | 做法 |
|---|---|---|
| **A. 连同测试原样迁入** | `textin/`（client、adapter、config、errors、field_extractor）；`doc_templates/` 中的 schema、normalize、matcher、converter、llm；`deepseek.py` | 这些模块不依赖 Flask 与数据库。配置改为从环境变量注入（FR-PLAT-003：不得带凭据默认值）；外部调用改为异步，或在线程中执行；对应测试一并迁入并跑通 |
| **B. 业务规则照搬，代码重写** | 上传三段式与状态机（`routes/files.py`）；OCR 任务、worker 与恢复（`routes/ocr.py`、`worker.py`）；结果版本与修改冲突（`routes/results.py`）；模板套用与切换（`routes/templates.py`、`mapping_worker.py`、`doc_templates/` 中的 repository、service、views）；导出与下载票据（`routes/exports.py`）；套餐、额度与提醒（`plans.py`、`quota.py`、`subscriptions.py`、`reminders.py`）；企业、成员与申请（`routes/companies.py`、`routes/applications.py`、`workspace.py`） | 用 FastAPI + 异步 SQLAlchemy + Alembic 重写。main 的测试改用 PostgreSQL 运行，作为行为清单：先看着它们失败，再实现到通过 |
| **C. 不延续** | 身份与会话（`auth.py`、`routes/auth.py`、`routes/me.py` 的身份部分）；建表方式（启动时 `create_all` + `ALTER`、`setup_db.py`）；Firebase 存储；Web 进程内的 worker 线程；开发用身份（`dev_id`）；兼容旧结果的逐页路径（`page_results`、`normalize_response`） | 身份与会话用 B-2a 的实现；存储用私有 GCS（ADR-008）；worker 作为独立进程运行；旧结果路径因数据无价值而删除 |

### 2. 业务表结构一比一沿用，只允许下列调整

B-3、B-4 的业务表沿用 main 的表名、列名与含义：`files`、`ocr_jobs`、`ocr_raw_results`、`result_versions`、`document_templates`、`document_template_versions`、`template_mappings`、`exports`。

除下表外不改结构。每一项调整都必须写进对应 change 的 `plan.md`，并有测试覆盖。

| # | 调整 | main 现状 | 重建 | 必须同步改的代码逻辑 |
|---|---|---|---|---|
| T1 | 时间带时区 | `TIMESTAMP WITHOUT TIME ZONE`，代码中大量使用 `.replace(tzinfo=None)` | `timestamptz`，统一用 `app.clock.utcnow()` | 删掉所有 `.replace(tzinfo=None)`；"泰国自然日"与"泰国自然月"一律显式换算到 `Asia/Bangkok` |
| T2 | 用空值代替空字符串 | `error_code`、`error_message`、`reject_reason`、`vendor_request_id`、`match_reason` 等为 `NOT NULL` 且用 `''` 表示"没有" | 可为空，"没有"即 NULL | `== ''` 与 `!= ''` 改为 `is None` 判断；序列化时 NULL 输出为 null |
| T3 | 状态加约束 | 状态是 `VARCHAR` 且无约束 | 每个状态列加 CHECK 约束，值沿用 main 的状态名 | 状态值只能来自一处常量定义 |
| T4 | JSON 改为 JSONB | `params`、`capability`、`structured`、`payload`、`groups`、`candidates`、`warnings` 等用 `JSON` | `jsonb` | jsonb 不保留键的顺序，凡依赖键顺序的逻辑（如导出列序）必须改用显式顺序 |
| T5 | 补外键 | `ocr_jobs.parent_job_id`、`current_mapping_id`、`pending_mapping_id`，`result_versions.mapping_id`，`document_templates.current_version_id` 没有外键 | 补外键；有循环引用的列使用 `DEFERRABLE INITIALLY DEFERRED` | 同一事务内的写入顺序按外键调整 |
| T6 | 补索引 | 缺 `exports.result_version_id`、`template_mappings.raw_result_id` 等外键列上的索引 | 外键列一律建索引 | 无 |
| T7 | 原始识别结果不可改 | `ocr_raw_results` 只写一次，但只靠代码约定 | 用数据库触发器禁止 UPDATE 与 DELETE（做法同 `audit_log`），应用账号只有 SELECT 与 INSERT 权限（NFR-SEC-010） | 测试数据清理沿用操作日志的方式 |
| T8 | 对象存储路径 | `storage_path` 存本地绝对路径或 Firebase 对象名 | 存 GCS 对象名 | 下载一律由后端代理；不生成匿名 URL |
| T9 | 删除旧结果路径 | `page_results` 与按页编辑 | 不建这张表 | 结果读写只走 `structured` |

ID 类型保持不变：文件、任务、结果版本、导出、映射的 ID 用 36 位字符串（UUID 文本）；用户与租户的 ID 用 bigint（与 B-2a 一致）。

### 3. 代码中依赖表结构的隐藏假设

迁移 B 类代码时，下列每一条都要有对应的 PostgreSQL 测试：

1. **ID 类型：** 文件、任务等的 ID 按字符串拼接存储路径、比较与输出。
2. **时间与空字符串：** 见 T1、T2。
3. **游客也是用户：** main 的游客是 `users` 表中的一行（`line_provider='guest'`），归集游客数据时逐表改写 `created_by_user_id` 等字段并删除游客用户。重建版的游客没有用户行，归集由 B-2a 的 `claim_service` 按 `tenant_id` 完成。凡是记录"由谁创建"的列，游客期间的写法要在 B-3 中重新确定：可以为空，或者记为游客会话所属的租户。
4. **当前版本唯一：** 依赖 `result_versions (job_id) WHERE is_current` 上的部分唯一索引；切换当前版本必须在同一事务中先取消旧的、再设新的。
5. **防重复提交：** `ocr_jobs.idempotency_key` 在全系统唯一，不区分租户。B-3 需要决定是否改为每个租户内唯一。
6. **行锁：** 结果修改、模板切换与映射生效在任务行上串行执行（`SELECT … FOR UPDATE`）。main 的测试用 SQLite 运行，行锁在测试中没有真正生效过，所以重建时需要补并发测试。
7. **额度按页数汇总：** 本月用量按 `ocr_jobs.page_count` 实时汇总，FAILED 与 CANCELLED 不计。B-2c 要和 v3 需求中的一次性免费额度（`DM-FreeQuota`）一起重新确定。

### 4. 与 v3 需求不一致时，以需求为准

main 的实现与当前 v3 需求（`docs/10-product`、`docs/30-design/Data-Model.md`）的已知差异：

| v3 需求 | main 现状 | 处理 |
|---|---|---|
| 表单文档 `DM-FormDocument`：每份单据一条，包含核验修改记录与一级、二级复核记录 | 结果版本挂在任务上，没有复核流程 | B-4 在 `result_versions` 之上增加单据与复核，不改变版本机制 |
| 一次性免费额度 `DM-FreeQuota` | 明确不设免费档 | B-2c 定 |
| 系统参数 `DM-SystemSetting`：OCR 首选与备用引擎、切换参数 | 只接了 TextIn | B-3 定 |
| 角色与权限点 `DM-Role` | `memberships.role` 只是一个字符串 | B-2b 定 |
| 一个用户可以拥有多个租户（个人租户与团队租户） | `tenants.owner_user_id UNIQUE` | B-2b 定（负责人 2026-11-04：届时再定） |
| 订阅历史 | `subscriptions` 每个租户一行，续费时覆盖 | B-2c 定（负责人 2026-11-04：届时再定） |

### 5. 基础数据

main 的 `02_base_data.sql` 是配置而不是业务数据，作为重建的初始数据保留，内容为 4 个套餐、2 个系统模板及其 4 个版本。B-2c（套餐）与 B-4（模板）分别把它写成 Alembic 数据迁移，写入时用内容哈希与版本号保证可以重复执行。

### 6. main 后端的后续开发

- main 的后端从此只修演示环境的 bug，不再增加功能；新功能在本分支按 OpenSpec 流程开发。
- 以下四个安全问题不得带入重建，并建议在 main 上尽快处理：
  - TextIn 凭据写死在 `config.py` 的默认值中，并且已经推送到 GitHub：需要轮换。
  - 31 个上传文件提交在 `services/api/storage/` 中：涉及 PDPA。
  - `POST /file-imports` 可以访问内网：要拦截私有地址，并逐次检查重定向的目标。
  - `SECRET_KEY` 带有默认值，而下载票据用它签名。

## 后果

- **收益：**
  - 已经验证过的业务规则、TextIn 与模板相关的约 1800 行纯逻辑代码及其测试，可以直接复用；
  - 表结构不变，main 的测试可以当作行为清单；
  - 结构调整都写在清单里，容易排查。
- **代价：**
  - B 类代码约 3000 行需要按新架构重写；
  - 隐藏假设 3、5、7 需要在对应 change 里重新决定；
  - 增加复核流程、多引擎切换等 v3 需求，工作量超出 main 现有的范围。
- **风险：** 迁移时漏掉某条隐藏假设。控制办法是"先迁测试、看着它失败，再迁代码"，每条调整与假设都必须有 PostgreSQL 测试覆盖。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-11-04 | Product Engineering | 初版：三类代码处理方式、业务表沿用与调整清单 T1–T9、隐藏假设、与 v3 需求的差异、基础数据与 main 后续开发 |
