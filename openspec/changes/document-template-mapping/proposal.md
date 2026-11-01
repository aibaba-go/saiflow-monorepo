# Proposal: 文档格式模板匹配与结构化映射（v2）

> v2（2026-10-30）：按用户评审决议重写。v1 备份见 `temp/template-plan/v1-backup/`（临时，不作为正式资产）。

## Why

当前 OCR 链路把 TextIn 返回的 `llm_json` 交给 DeepSeek 自由整理，结果是一棵没有契约的任意 JSON：字段名、分组和顺序每次都可能不同，无法做必填校验、按固定结构核验和导出。用户需求（`temp/模版需求.txt`，2026-10-30）要求：

1. 增加模板管理：模板由若干**分组**组成，分组内含 **KV 字段**或**表格**；字段定义包含字段名、**字段描述（很重要）**、数据类型（字符串 / 整型 / 非整数 / 金额）。
2. OCR 完成后自动选出**最匹配的一个模板**，把原始结果一一映射到模板字段，生成「基于模板的解析结果」；向前端返回 **OCR 解析结果 ID** 与基于模板的解析结果。
3. 结果页增加**模板选择框**，默认显示匹配到的模板；用户可换模板，前端把「模板 ID + OCR 解析结果 ID」交给后端重新映射。
4. 字段修改、新增、删除，以及保存、导出的能力保持不变。

产品来源：`docs/10-product/PRD-SaiFlow.md` §3.2 步骤 4–6、§4.2、§4.8；`docs/20-requirements/functional/EPIC-08-document-template-configuration.md`（本变更将改写）。

## 评审决议（2026-10-30，用户确认）

| # | 决议 | 与 PRD 的关系 |
|---|------|---------------|
| R1 | **模板管理界面暂不做**，先由运维通过后台命令行脚本维护（增删改查） | 本期只交付后台维护能力；管理界面列为 FR-TEMPLATE-006（P1） |
| R2 | 数据类型只有 4 种：`string`（字符串）、`integer`（整型）、`decimal`（非整数）、`amount`（金额）。日期按字符串原样保留，不做佛历转换 | 收窄 PRD §4.8 的类型集合 |
| R3 | 字段属性只有：`key`、显示名称、**描述**、类型，以及可选的 `required`。多语言名称、计算规则、标准化规则、主要字段延后 | 收窄 PRD §4.8 |
| R4 | 必填字段缺失时**保留结果并高亮**，补全后才允许确认，不判为「识别失败」 | 偏离 PRD §3.2「主要字段缺失即识别失败」，需同步修订 PRD |
| R5 | 只要存在可用模板，就**默认选得分最高的一个**；得分低时提示「匹配度较低，请确认模板」。只有没有可用模板时才不套用模板 | 细化 PRD §3.2「无法自动匹配」 |
| R6 | 兜底选项统一称「**不套用模板（通用结果）**」，与 PRD 的「自由格式」（P1，由大模型生成结构）区分。模板映射链路与后台维护提升为 V1.0 **P0** | EPIC-08 优先级调整，需写入 PRD 与 EPIC-08 |

## What Changes

- **模板与版本快照**：模板包含分组、KV 字段与表格。每次保存时，若内容有变化就生成一个**不可变版本快照**；模板本身只有启用 / 停用 / 软删除三种状态，映射结果固定引用某个版本。支持系统模板（所有租户只读可用）与租户模板。
- **后台维护脚本** `manage_templates.py`：支持 list / show / import（创建或更新）/ export / enable / disable / delete，导入前做完整校验，支持 `--dry-run`。提供 2 个系统内置模板种子：`system.billing_note`（Billing Note / ใบวางบิล）与 `system.tax_invoice`（Tax Invoice / ใบกำกับภาษี，含「ใบกำกับภาษี/ใบส่งของ」合并单据），依据真实样本设计；其他单据类型后续按样本补充。
- **OCR 解析结果（原始结果）不可变保存**：新增 `ocr_raw_results`，保存 TextIn `llm_json`，其 ID 即「OCR 解析结果 ID」。
- **模板映射**作为独立的异步阶段：OCR 成功后创建一条自动映射，由新增的映射 Worker 执行「大模型匹配 → 大模型转换 → 严格结构校验」。OCR 任务状态不受映射结果影响。
- **任务级结果版本保持单一序列**：每个版本标记所属映射（为空表示通用结果）；任务上记录当前映射。切换模板只移动「当前版本」指针，不复制数据；已确认的任务禁止切换。
- **结果页**：模板选择框（默认显示当前模板，按匹配得分排序，另加「不套用模板（通用结果）」）、状态提示条、按模板分组和顺序渲染、必填高亮与确认门禁；保留字段 / 表格行的增删（模板字段只能清空，不能删除）。
- **导出**：当前结果为模板结果时，按模板顺序与显示名称导出；否则沿用现有通用导出。
- **开关** `TEMPLATE_MAPPING_ENABLED`（默认关闭）：开启后跳过 DeepSeek 整理，通用结果直接使用 TextIn 原始结果；关闭时行为与当前完全一致。
- **文档**：改写 EPIC-08，修订 EPIC-02（FR-OCR-018/019/020，新增 FR-OCR-021）、EPIC-03（新增 FR-VERIFY-018/019/020）、EPIC-04（FR-ENTRY-002 导出说明）、Glossary、Acceptance-Criteria、Data-Model、OCR-Pipeline、PRD（R2–R6 决议）；新增 ADR-006、ADR-007。

## Non-goals

- 不做模板管理界面（web-pc 与 line-mini 均不做）；不做模板的 REST 写接口，写操作只能通过后台脚本完成。
- 不做 PRD 的「自由格式」（大模型生成结构，P1）、Excel 导入（P1）、界面直接录入（P2）。
- 不做日期 / 佛历标准化、多语言字段名、计算规则、字段级置信度、`doc_type` 分类。
- 不做规则匹配快速路径与「确定性转换」，第一版只走大模型。
- 不迁移 Firestore，不引入 Cloud Functions；模板与表单数据继续存 PostgreSQL（ADR-006）。
- 不新增大模型供应商与密钥，复用现有 DeepSeek 配置；按租户配置模型（OQ-22）不在本期。
- 不回溯历史任务（无原始结果的任务只能使用通用结果）。

## Capabilities

### New Capabilities

- `document-template`：模板结构、版本快照、作用域、启用 / 停用 / 软删除、后台维护脚本与只读查询接口。
- `template-mapping`：OCR 解析结果保存、自动匹配与转换、映射状态与恢复、模板切换与通用结果、结果版本归属、必填门禁、模板驱动的展示与导出、审计。

### Modified Capabilities

无（`openspec/specs/` 为空）。

## Impact

- **后端**：
  - `models.py`：新增 4 张表，`ocr_jobs` 与 `result_versions` 增加列。
  - `app.py`：`_ensure_tables` 与 `_ADD_COLUMNS`。
  - 新增 `doc_templates/`（schema 校验、匹配、转换、类型标准化；不用 `templates/`，避免与 Flask 的 Jinja 模板目录混淆）、`mapping_worker.py`、`manage_templates.py`、`templates_seed/*.json`、`routes/templates.py`。
  - 修改 `worker.py`、`routes/results.py`、`routes/exports.py`、`routes/ocr.py`（任务删除级联、任务摘要字段）、`openapi.yaml`。
- **前端（line-mini）**：`api.ts`、`structured.ts`、`components/StructuredDataView.vue`、`views/ProcessingPage.vue`、`views/ResultPage.vue`、`views/FinalResultPage.vue`、`i18n.ts`（en / th）。
- **外部调用**：每份单据增加 1 次匹配调用（只有 1 个候选模板时跳过）和 1 次转换调用，同时去掉 1 次 DeepSeek 整理。每次调用至多修复重试 1 次；每个任务的转换次数有上限。
- **兼容性**：开关关闭时零行为变化；结果接口只新增字段；历史任务继续使用通用结果。
