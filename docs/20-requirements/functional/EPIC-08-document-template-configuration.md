---
doc_id: EPIC-08
title: "EPIC-08 — 文档格式模板配置"
type: epic
status: active
version: 1.0.3
updated: 2026-11-01
owner: Product Engineering
priority: P0
source: "PRD-001 §3.2/4.8; document-template-mapping v2 R1–R6（2026-10-30 已批准）"
related: [DM-DocumentTemplate, DM-DocumentTemplateVersion, DM-TemplateFieldMapping, API-10, OCR-Pipeline, ADR-006, ADR-007]
---

# EPIC-08 — 文档格式模板配置

> 文档格式模板是 OCR 模板映射、人工核验展示与导出的字段契约。V1.0 后台命令行维护与映射为 P0；模板管理界面 FR-TEMPLATE-006 为 P1，不在本期交付。术语见 [Glossary](../../10-product/Glossary.md)。

## 1. Epic 摘要

- **目标：** 运维无需修改应用代码即可维护有序分组、KV 字段及表格；系统固定引用不可变版本生成基于模板的解析结果。
- **范围内：** 后台命令行维护、结构校验、系统与租户作用域、启用/停用/软删除、不可变版本、只读版本查询、种子定义与审计。
- **范围外：** 模板管理 UI、模板 REST 写接口、路径规则映射、日期/佛历转换、多语言字段名配置、计算规则、标准化规则配置、主要字段、doc_type 分类；Excel 导入与自由格式为 P1，界面直接录入为 P2。
- **主要参与者：** 运维（CLI）；持有效会话的用户读取授权模板与任务结果（含游客）。本期不新增系统管理员角色。
- **存储：** PostgreSQL `json` 保留键顺序，见 [Data-Model](../../30-design/Data-Model.md) 与 [ADR-006](../../30-design/adr/ADR-006-relational-template-storage.md)。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-TEMPLATE-001 | 通过后台 CLI 提供 list/show/export，列表含 id、code、名称、作用域、状态、当前版本、更新时间；支持系统/租户及已删除筛选 | P0 | §4.8 R1/R6 | — | AC-FR-TEMPLATE-001-01 |
| FR-TEMPLATE-002 | 按作用域与 code 幂等导入模板；规范化名称、描述、分组的 SHA-256 变化时新增不可变版本，否则不写入；提供两份系统模板种子 | P0 | §4.8 R1/R6 | FR-TEMPLATE-005 | AC-FR-TEMPLATE-002-01/02/03 |
| FR-TEMPLATE-003 | 定义有序分组与 KV 字段；字段仅含 key、name、description、type、可选 required，描述用于大模型匹配与转换 | P0 | §4.8 R2/R3 | FR-TEMPLATE-002 | AC-FR-TEMPLATE-003-01/02 |
| FR-TEMPLATE-004 | 在有序分组中定义有序表格及列；列采用同一字段属性契约，保存分组、项与列顺序 | P0 | §4.8 R2/R3 | FR-TEMPLATE-003 | AC-FR-TEMPLATE-004-01 |
| FR-TEMPLATE-005 | 写库前完整校验结构、key/code、唯一性、类型与上限，一次报告全部路径错误；validate 不连接数据库 | P0 | §4.8 R2/R3 | — | AC-FR-TEMPLATE-005-01/02 |
| FR-TEMPLATE-006 | 后续提供模板管理界面；本期 web-pc 与 line-mini 均不实现，也不提供模板 REST 写接口 | P1 | §4.8 R1 | FR-TEMPLATE-001..005/007 | AC-FR-TEMPLATE-006-01（P1） |
| FR-TEMPLATE-007 | 提供系统与租户隔离、启用/停用/软删除及授权只读版本查询；历史版本仍可使用；实际 CLI 写操作与映射固定版本可审计 | P0 | §4.8 R1/R6 | FR-TEMPLATE-002、FR-SYS-003 | AC-FR-TEMPLATE-007-01/02/03/04 |

## 3. 规则

### 3.1 结构与校验（FR-TEMPLATE-003..005）

- 模板含 `code`、`name`、`description`、`groups`；分组含 `key`、`name`、`description`、`items`；项为 `kind=field` 或 `kind=table`，表格含 `columns`。每层至少一项（模板至少一组、每组至少一项、每表至少一列）。结构唯一设计见 [Data-Model §2.5](../../30-design/Data-Model.md#25-模板-schemadm-ocrrawresult-与-dm-templatemapping)。
- `type` 只有 `string / integer / decimal / amount`，缺省 `string`；`required` 缺省 `false`。日期用 string 原样保留，不做佛历转换。一个显示名称可写为 English / ไทย，不是多语言配置。
- key 正则 `^[a-z][a-z0-9_]{0,63}$`；code 正则 `^[a-z0-9][a-z0-9._-]{0,63}$`。组 key 在模板内唯一；字段与表格 key 在组内共同唯一；列 key 在表内唯一。
- 分组 ≤20、字段与列合计 ≤200、表格 ≤10；name ≤100 字符；description ≤500 字符，模板级 ≤1000。
- 不执行用户脚本、SQL、表达式或网络请求；本期不定义任何路径映射规则。

### 3.2 版本、作用域与状态（FR-TEMPLATE-002/007）

- 模板状态 `ENABLED / DISABLED`，`deleted_at` 表示软删除；不设草稿/发布流程。内容变化新增版本并移动 `current_version_id`，相同内容不升版、不写审计。版本只增不改，不删除。
- `tenant_id=null` 为系统模板，所有租户只读可用；租户模板仅本租户可用。任务候选为系统+本租户、启用、未删除的当前版本。
- 同作用域未删除 code 唯一，部分索引 `(COALESCE(tenant_id,0), code) WHERE deleted_at IS NULL`。软删除后允许重新导入同 code 的新模板。
- 停用、软删除或升版不影响已有映射固定引用的旧版本；旧结果仍可读取、编辑、确认、导出。系统版本对有效游客会话可读，跨租户版本读取返回 404，套用不可用模板返回 409 `TEMPLATE_UNAVAILABLE`。
- 内部不可变版本保留模板、分组、项和列的完整 description，供模型匹配与转换使用；GET 版本对前端裁剪各层 description，没有公开描述字段需求，公开视图不修改内部快照。字段与列 type 的 API YAML/JSON 镜像均为 string/integer/decimal/amount。

### 3.3 CLI 与种子（FR-TEMPLATE-001/002/005/007）

`services/api/manage_templates.py` 提供 `list / show / validate / import / export / enable / disable / delete / seed`。show 可指定版本；export 输出当前 JSON。import 按 `(作用域,code)` 创建或升版；未指定租户时为系统作用域。写操作默认二次确认（`--yes` 跳过），import/seed 支持 `--dry-run`，不打印凭据。

首批种子仅为 `system.billing_note`（Billing Note / ใบวางบิล）与 `system.tax_invoice`（Tax Invoice / ใบกำกับภาษี，含税务发票/送货单合并单据）。两种子已获业务批准，正式 CLI validate 均通过；其他类型仍待样本补充。2026-10-31 经用户授权已 seed 至共享库（系统作用域、ENABLED、版本 1）并随模板映射上线。2026-11-01 按用户要求，两种子各层 description 改为英文（泰文标签原样保留以便模型对照原文；code、name、分组/字段/列的 key、type、required 不变），模板级描述开头一句写明最具区分度的特征，以适配匹配目录 120 字符截断；正式 CLI validate 通过；同日经用户确认已 seed 至共享库，两模板当前版本均为 2（ENABLED，只读核验结构与名称未变、无残留中文），新建映射使用英文描述，历史映射仍绑定版本 1。

实际写操作审计 `template.created / versioned / enabled / disabled / deleted`，操作人为空、来源 `cli`；无变化或 dry-run 不写审计。本地与线上共用数据库，必须保持 `TEMPLATE_MAPPING_ENABLED=false`；仅 validate 无数据库访问，dry-run 不等于不连接数据库。

## 4. 验收与可追溯性

完整 Gherkin AC 唯一定义于 [Acceptance-Criteria §7](../../40-acceptance/Acceptance-Criteria.md#7-epic-08--文档格式模板配置)。以上每项 FR 均有对应 AC；P1 管理 UI 验收不作为 V1.0 完成门禁。映射行为另见 [EPIC-02](EPIC-02-ocr-recognition.md)、[EPIC-03](EPIC-03-data-verification.md)、[EPIC-04](EPIC-04-entry-archiving.md)；只读接口索引见 [API-Spec](../../30-design/API-Spec.md)。

## 5. 验证与发布边界

- 两种子已获业务批准，正式 CLI validate 均通过；其他单据样本仍待补充；2026-10-31 已 seed 至共享库并上线。
- API YAML 与 JSON 镜像的四类型已对齐；内部保留 description、公开 GET 裁剪描述是最终契约而非差异，核对见 [API-Spec §4](../../30-design/API-Spec.md#4-尚未对齐的契约差异)。
- 2026-10-31 隔离 SQLite/mock 后端 816 项通过，真实 LLM 质量/耗时/token 基线未运行；0.7 保持初始阈值。共享库仅 transaction_read_only=on 下 SELECT，重复当前版本任务数 0，无 DDL/写入。发布记录（迁移、seed、切流）见 [Architecture §5](../../30-design/Architecture.md#5-部署模型)；详细验证边界见 [汇总验收](../../40-acceptance/Acceptance-Criteria.md)。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.3 | 2026-11-01 | Product Engineering | 两个系统种子的 description 全部改为英文（结构与 key 不变，泰文标签保留）；863 项隔离后端测试与 validate 通过；经用户确认于同日导入共享库，两模板均升为版本 2（ENABLED，只读核验通过），历史映射仍绑定版本 1 |
| 1.0.2 | 2026-10-31 | Product Engineering | 两个系统种子经授权 seed 至共享库并随模板映射发布；真实模型基线仍待验 |
| 1.0.1 | 2026-10-31 | Product Engineering | 对齐API四类型与内部description/公开裁剪；记录两种子业务批准/正式validate、816隔离后端及共享库只读SELECT证据，保留真实基线/seed/部署边界 |
| 1.0.0 | 2026-10-31 | Product Engineering | 同步已批准 document-template-mapping v2：CLI/版本/结构/隔离/审计 P0，管理 UI P1；撤销旧路径映射与发布草稿契约，明确两份种子 |
| 0.2.0 | 2026-10-12 | Product Engineering | 对齐 PRD §4.8 扩展：在目标中明确订单跟踪、报表统计与 ERP 对接；范围内新增标准化规则 |
| 0.1.0 | 2026-10-07 | Product Engineering | 初始文档格式模板配置需求；覆盖 JSON 映射、发布、版本与审计 |
