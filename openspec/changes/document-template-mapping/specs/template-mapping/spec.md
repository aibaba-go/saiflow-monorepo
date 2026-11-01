# Spec Delta（v2）

## Purpose

把 OCR 解析结果（原始结果）按文档格式模板匹配并转换为可核验的「基于模板的解析结果」，支持在结果页切换模板或使用「不套用模板（通用结果）」，并保持现有的编辑、保存、确认与导出能力（用户需求 `temp/模版需求.txt`；PRD §3.2 步骤 4–6；评审决议 R4–R6 见 `proposal.md`）。

## ADDED Requirements

### Requirement: OCR 解析结果保存

OCR 任务成功时，系统 SHALL 在保存结果版本 v1 的同一事务中，不可变保存 TextIn 返回的 `llm_json`（OCR 解析结果，即原始结果），并以其 ID 作为 `raw_result_id`。原始结果 MUST 在任何后续处理（DeepSeek 整理、模板转换、人工编辑）之前被深拷贝保存，MUST NOT 被任何接口修改。没有原始结果的历史任务 MUST 只能使用通用结果。

#### Scenario: 新任务保存原始结果

- **GIVEN** 模板映射开关为关闭
- **WHEN** 一份文件 OCR 成功
- **THEN** 系统保存一条原始结果，内容等于 TextIn `llm_json`
- **AND** v1 通用结果与当前行为一致（DeepSeek 整理后的 JSON）

#### Scenario: 历史任务无原始结果

- **GIVEN** 任务 J 在本功能上线前完成，没有原始结果
- **WHEN** 用户请求为 J 套用模板
- **THEN** 系统返回 409 `RAW_RESULT_MISSING`，当前结果不变

### Requirement: 模板映射开关

系统 SHALL 提供开关 `TEMPLATE_MAPPING_ENABLED`，缺省为关闭。关闭时，除保存原始结果外，OCR 链路与结果接口行为 MUST 与本变更之前一致，映射 Worker MUST NOT 启动，`apply-template` MUST 返回 409 `TEMPLATE_MAPPING_DISABLED`。开启时，系统 MUST NOT 调用 DeepSeek 整理，v1 通用结果 SHALL 直接使用原始结果，并在存在可用模板时创建自动映射。

#### Scenario: 开启后跳过 DeepSeek

- **GIVEN** 开关为开启，且 DeepSeek 已配置
- **WHEN** 一份文件 OCR 成功
- **THEN** 系统不调用 DeepSeek 整理
- **AND** v1 通用结果等于原始结果

#### Scenario: 关闭时拒绝套用模板

- **GIVEN** 开关为关闭
- **WHEN** 用户请求 `POST /api/v1/ocr/jobs/{job_id}/apply-template`
- **THEN** 返回 409 `TEMPLATE_MAPPING_DISABLED`

### Requirement: 自动匹配

开关开启且 OCR 成功时，系统 SHALL 从该任务可用（系统模板或本租户模板、启用、未删除）的模板当前版本中选出一个模板：

- 0 个候选：MUST NOT 创建自动映射，结果页提示「暂无可用模板」。
- 1 个候选：MUST 直接选中，不调用大模型，匹配得分记为空。
- ≥ 2 个候选：SHALL 调用大模型，按模板名称与描述打分，MUST 选得分最高的一个；输出中的模板版本 ID MUST 属于候选白名单。

得分低于 `TEMPLATE_LOW_SCORE_THRESHOLD`（缺省 0.7）时，系统 SHALL 仍套用该模板并标记「匹配度较低」。映射的成功或失败 MUST NOT 改变 OCR 任务状态。

#### Scenario: 多个候选选最高分

- **GIVEN** 可用模板为 PO、Delivery Note、Invoice、Receipt，且上传的是发票
- **WHEN** OCR 成功且大模型返回 Invoice 0.92、Receipt 0.40
- **THEN** 系统选择 Invoice 并生成基于模板的解析结果
- **AND** 记录得分 0.92 与 top-3 候选

#### Scenario: 低得分仍套用并提示

- **GIVEN** 大模型返回的最高得分为 0.55
- **WHEN** 映射完成
- **THEN** 结果页套用得分最高的模板，并显示「匹配度较低，请确认模板」

#### Scenario: 只有一个候选时不调用大模型

- **GIVEN** 该任务只有 1 个可用模板
- **WHEN** OCR 成功
- **THEN** 系统直接选中该模板进入转换，不发起匹配调用

#### Scenario: 匹配输出非法

- **GIVEN** 大模型两次返回的 ranking 都不含白名单内的 ID
- **WHEN** 匹配阶段结束
- **THEN** 映射为 `FAILED / MATCH_FAILED`
- **AND** OCR 任务仍为成功，当前结果仍为通用结果

### Requirement: 模板结构化转换

系统 SHALL 以原始结果与固定的模板版本为输入，调用大模型生成基于模板的解析结果，结果形状为 `{分组 key: {字段 key: 标量, 表格 key: [{列 key: 标量}]}}`。系统 MUST 按模板逐项取值：文档中找不到的值填 `null`，模板外的键丢弃并计数，单表最多 500 行。系统 MUST NOT 推算或计算原文中不存在的数值。原始结果紧凑 JSON 超过 60,000 字符时，映射 MUST 失败为 `RAW_TOO_LARGE`，MUST NOT 截断后转换。

#### Scenario: 找不到的字段为 null

- **GIVEN** 模板含字段 `document.tax_id`，原始结果中没有税号
- **WHEN** 转换成功
- **THEN** 结果中 `document.tax_id` 为 `null`

#### Scenario: 模板外的键被丢弃

- **GIVEN** 大模型输出包含模板未定义的键 `document.foo`
- **WHEN** 系统做结构校验
- **THEN** 结果中不包含 `foo`，丢弃键计数加 1

### Requirement: 类型标准化

转换结果 SHALL 按字段类型标准化，且 MUST NOT 引入浮点漂移（解析时数值按字符串读取）：

- `string`：去首尾空白，空串转为 `null`。
- `integer`：去掉千分位、空格与币种符号后为整数 → JSON 整数。
- `decimal`：同样清洗后为数字 → 规范化字符串，不舍入。
- `amount`：同 `decimal`，小数不足 2 位补齐到 2 位；超过 2 位不舍入并记警告 `amount_precision`。

无法转换时 MUST 保留原文字符串并记警告 `type_mismatch`。`null` 不算类型错误。

#### Scenario: 金额标准化

- **GIVEN** 字段 `total` 类型为 `amount`，大模型输出 `"฿1,234.5"`
- **WHEN** 系统做类型标准化
- **THEN** 结果值为 `"1234.50"`，结果页显示 `1,234.50`

#### Scenario: 类型不符保留原文

- **GIVEN** 字段 `quantity` 类型为 `integer`，大模型输出 `"สิบ"`
- **WHEN** 系统做类型标准化
- **THEN** 结果值保持 `"สิบ"`，并在 `validation.type_warnings` 中记 `type_mismatch`

### Requirement: 映射失败处理

匹配或转换阶段遇到网络错误、超时、429、5xx 或非法输出时，系统 SHALL 在等待 2 秒后重试 1 次（每阶段最多 2 次调用）；仍失败 MUST 将映射置为 `FAILED` 并记录错误码（`MATCH_FAILED`、`LLM_TIMEOUT`、`LLM_UNAVAILABLE`、`LLM_INVALID_OUTPUT`、`RAW_TOO_LARGE`、`MAPPING_INTERRUPTED`）与可读原因。映射失败 MUST NOT 改变任务的当前结果，用户 SHALL 可重试、选择其他模板或使用通用结果。

#### Scenario: 切换失败不影响当前结果

- **GIVEN** 当前结果来自模板 A
- **WHEN** 用户切换到模板 B，转换两次都超时
- **THEN** 映射 B 为 `FAILED / LLM_TIMEOUT`
- **AND** 当前结果仍为模板 A 的结果，结果页显示失败提示与「重试 / 选择其他模板 / 不套用模板」

### Requirement: 异步映射与恢复

映射 SHALL 由独立的映射 Worker 异步执行，状态为 `PENDING → MATCHING → CONVERTING → READY / FAILED`；Web 请求 MUST NOT 同步调用大模型。Worker MUST 以条件更新认领 `PENDING` 映射，保证多实例下同一映射只被处理一次。`MATCHING` 或 `CONVERTING` 超过 10 分钟未更新的映射 MUST 被置为 `FAILED / MAPPING_INTERRUPTED`。每个任务新建的映射（含自动映射，复用已就绪映射不计）MUST NOT 超过 `TEMPLATE_MAX_MAPPINGS_PER_JOB`（缺省 5），超出返回 409 `MAPPING_LIMIT_REACHED`。映射 MUST NOT 消耗月页额度。

#### Scenario: 多实例只处理一次

- **GIVEN** 两个实例的映射 Worker 同时轮询到同一个 `PENDING` 映射
- **WHEN** 双方执行认领
- **THEN** 只有一方认领成功并调用大模型

#### Scenario: 卡住的映射被恢复

- **GIVEN** 映射 M 处于 `CONVERTING`，且 11 分钟未更新（实例被重启）
- **WHEN** 恢复任务运行
- **THEN** M 变为 `FAILED / MAPPING_INTERRUPTED`，任务的 pending 映射被清空

#### Scenario: 超过映射次数上限

- **GIVEN** 任务 J 已有 5 个映射
- **WHEN** 用户选择一个尚未生成过的模板
- **THEN** 返回 409 `MAPPING_LIMIT_REACHED`，不创建映射

### Requirement: 套用模板与切回

用户 SHALL 通过 `POST /api/v1/ocr/jobs/{job_id}/apply-template` 选择模板或切回 READY 映射。系统 MUST 校验原始结果归属（404）、模板可用性及当前版本冲突（409）；请求形状以 API-Spec/源 OpenAPI 为准。

- 已有同一模板当前版本的 `READY` 映射且未指定 `force`：SHALL 同步切换并返回 200 与结果，MUST NOT 调用大模型。
- 同一模板版本的映射正在处理：SHALL 将其设为 pending 并返回 202。
- 其他情况：SHALL 新建 `MANUAL` 映射并设为 pending，返回 202。

切换 MUST 只移动当前版本指针，不复制数据/升版；目标映射上次保存的编辑 MUST 原样恢复，可返回旧版本号。失败重试 SHALL 显式传 force=true，MUST NOT 复用旧 READY，仍受处理中复用与映射次数上限限制。

#### Scenario: 已有成功结果时重试失败映射

- **GIVEN** 同一模板有旧 READY 与最近 FAILED 映射
- **WHEN** 用户点击失败重试，以正确 expected_version 及 force=true 套用
- **THEN** 未超上限且无处理中映射时创建新尝试并返回202，而非200复用旧 READY

#### Scenario: 选择新模板异步生成

- **GIVEN** 当前结果来自模板 A，任务从未用模板 B 映射过
- **WHEN** 用户选择模板 B
- **THEN** 返回 202 与 `PENDING` 映射；转换成功后模板 B 的结果成为当前结果

#### Scenario: 切回已生成的模板保留编辑

- **GIVEN** 用户曾在模板 A 的结果中修改了发票号并保存，之后切换到模板 B
- **WHEN** 用户再选回模板 A
- **THEN** 返回 200，当前结果为模板 A 上次保存的版本，包含修改后的发票号
- **AND** 不发起大模型调用

#### Scenario: 原始结果 ID 不属于该任务

- **GIVEN** `raw_result_id` 属于另一个任务
- **WHEN** 用户请求套用模板
- **THEN** 返回 404，不创建映射

### Requirement: 映射结果自动生效

映射 `READY` 时系统 SHALL 生成一个归属该映射的新结果版本。仅当以下条件全部满足时，该版本 MUST 成为当前结果：任务的 pending 映射仍为该映射；任务的当前版本仍是映射创建时的基准版本；任务未确认。否则该版本 SHALL 只保留为「已生成，可切换」，仅 pending 仍指向本映射时才清空，MUST NOT 覆盖新 pending 或用户正在查看/编辑的结果。

#### Scenario: 用户期间保存过编辑

- **GIVEN** 自动映射正在转换，用户在通用结果上保存了一次编辑
- **WHEN** 映射变为 `READY`
- **THEN** 当前结果仍为用户编辑后的通用结果
- **AND** 模板选项中该模板标记为「已生成」，可一键切换

### Requirement: 不套用模板（通用结果）

用户 SHALL 能在模板选择框中选择「不套用模板（通用结果）」，通过 `POST /api/v1/ocr/jobs/{job_id}/use-generic` 同步切换到通用结果的最新版本，并清空 pending 映射。该操作 MUST NOT 调用大模型；每次合法显式选择 MUST 记录 template.generic_selected，即使已通用也审计但不新增结果版本。通用结果保持现有编辑/确认/导出能力，未确认时仍可再选择模板。

#### Scenario: 转换失败后使用通用结果

- **GIVEN** 自动映射失败，当前为通用结果
- **WHEN** 用户选择「不套用模板（通用结果）」
- **THEN** 系统记录该选择，不调用大模型，结果页按通用结果渲染并可确认

#### Scenario: 从通用结果切回模板

- **GIVEN** 当前为通用结果，模板 A 的映射为 `READY`
- **WHEN** 用户选择模板 A
- **THEN** 同步切换为模板 A 的最新版本，通用结果仍保留可切回

### Requirement: 结果版本归属与编辑

每个结果版本 SHALL 记录所属映射（为空表示通用结果），任务内版本号保持单一序列，新版本号 MUST 为该任务 `max(version) + 1`。保存编辑（PATCH）生成的新版本 MUST 归属当前映射。当前为模板结果时，系统 MUST 先做结构补齐：缺失的模板字段补 `null`，表格行补齐模板列；模板外新增的字段与行 MUST 原样保留。乐观并发（`expected_version`）与审计行为 MUST 不变。

#### Scenario: 切回后保存不撞版本号

- **GIVEN** 任务 J 有版本 1（通用）、2（模板 A）、3（模板 B），当前为版本 2
- **WHEN** 用户在模板 A 结果上保存编辑
- **THEN** 新版本号为 4，归属模板 A 的映射

#### Scenario: 删除模板字段后被补齐

- **GIVEN** 当前为模板结果，客户端提交的内容缺少模板字段 `document.invoice_no`
- **WHEN** 系统保存
- **THEN** 新版本中 `document.invoice_no` 为 `null`
- **AND** 用户新增的模板外字段 `document.remark_2` 被保留

### Requirement: 确认后锁定模板

任务确认后，系统 MUST 拒绝套用模板、切换映射与切换到通用结果，返回 409 `state_conflict`（`results.already_confirmed`）。确认后完成的映射 MUST NOT 自动生效。

#### Scenario: 确认后切换被拒绝

- **GIVEN** 任务 J 已确认
- **WHEN** 用户请求套用另一个模板
- **THEN** 返回 409，当前结果不变

### Requirement: 必填字段确认门禁

当前为模板结果时，模板中 `required = true` 的字段为空（或表格中已有行的必填列为空）MUST NOT 判为识别失败；结果 SHALL 保留并高亮缺失项。带 `confirm = true` 的保存请求中存在必填缺失时，系统 MUST 返回 422 `invalid_argument`，`field_errors` 每项为 `{field: "structured.<路径>", reason: "required"}`，且 MUST NOT 写入版本或确认。草稿保存 MUST NOT 受门禁限制。通用结果不适用此门禁。

#### Scenario: 缺失必填阻止确认

- **GIVEN** 模板结果中必填字段「发票号」为空
- **WHEN** 用户点击 Continue
- **THEN** 前端高亮并滚动到「发票号」；若请求到达后端，返回 422 且 `field_errors` 含 `structured.document.invoice_no`

#### Scenario: 补全后可以确认

- **GIVEN** 用户补全了「发票号」
- **WHEN** 用户点击 Continue
- **THEN** 系统保存并确认，流程与现状一致

### Requirement: 模板驱动展示

当前为模板结果时，结果页 SHALL 按模板的分组、项与列的顺序，以模板显示名称渲染字段与表格，并对必填字段显示星标、为空时标红。模板字段 MUST NOT 提供删除操作，只能清空；模板外字段排在模板字段之后，保留现有的新增与删除能力；表格行的新增与删除 MUST 保持可用。当前为通用结果时 MUST 沿用现有渲染。最终结果页 SHALL 以只读方式复用相同渲染并显示模板名，历史列表 SHALL 显示模板名标签。

#### Scenario: 按模板顺序渲染

- **GIVEN** 当前结果来自 Invoice 模板
- **WHEN** 用户打开结果页
- **THEN** 字段按模板分组与顺序显示模板名称，「发票号」带必填星标
- **AND** 「发票号」没有删除按钮

### Requirement: 结果页模板选择框

结果页 SHALL 提供模板选择框，默认显示当前模板，当前为通用结果时显示「不套用模板（通用结果）」。选项 SHALL 依次为：推荐模板（带匹配得分）、其他可用模板（已生成过的标「已生成」）、「不套用模板（通用结果）」，每项可预览分组与字段名。切换前存在未保存修改时，系统 SHALL 提示「保存并切换 / 取消」。映射处理中 SHALL 显示「正在套用模板…」并禁止编辑，每 2 秒轮询，最长 10 分钟。

#### Scenario: 有未保存修改时切换

- **GIVEN** 用户修改了字段但未保存
- **WHEN** 用户在选择框中选择另一个模板
- **THEN** 弹出「保存并切换 / 取消」；选择保存后先保存草稿，再发起切换

### Requirement: 结果查询

结果读取接口 SHALL 在现有字段之外返回：`raw_result_id`、`current_mapping`（模板 ID、名称、版本、来源、得分、是否低得分）、`template_schema`、`pending_mapping`、`latest_failed_mapping`、`template_available` 与 `validation`（`required_missing`、`type_warnings`）。当前为通用结果时，`current_mapping` 与 `template_schema` MUST 为 `null`。系统 SHALL 提供 `GET /api/v1/ocr/jobs/{job_id}/template-options` 返回可用模板（按自动匹配得分排序，第一项标为推荐）与该任务已有映射的摘要。任务列表摘要 SHALL 新增 `template_name`。

#### Scenario: 读取通用结果

- **GIVEN** 任务 J 当前为通用结果
- **WHEN** 前端读取结果
- **THEN** 响应包含 `raw_result_id`，`current_mapping` 与 `template_schema` 为 `null`

### Requirement: 按模板导出

创建导出 MUST 绑定创建时当前结果版本，不提供任意版本选择参数。正式格式 SHALL 为 XLSX/CSV/TXT/JSON。模板 XLSX/CSV 按有序分组、字段/列显示名称、类型输出，金额千分位且至少两位小数，超过两位不舍入/截断；人工 extras 保留。JSON MUST 原样 structured、application/json、.json，不进行模板显示名/类型投影。TXT 与通用 XLSX/CSV MUST 保持旧行为，导出 MUST 包含已保存编辑。

#### Scenario: JSON 原样下载与 TXT 兼容

- **GIVEN** 当前结构包含模板/通用结果、人工新增前导零字符串与长精度小数
- **WHEN** 用户创建并下载 format=JSON
- **THEN** 返回 application/json 与 .json，解析内容与当前 structured 完全一致
- **AND** TXT 仍使用原 text/plain/.txt 行为

#### Scenario: 导出模板结果

- **GIVEN** 当前结果来自 Invoice 模板，用户修改并保存了合计金额
- **WHEN** 用户导出 XLSX
- **THEN** 文件按模板分组顺序输出显示名称与值，合计金额为修改后的值并显示为 `1,234.50` 格式

### Requirement: 任务删除级联

删除 OCR 结果 SHALL 保留任务行，在同任务锁事务内删除 results/raw/mappings 并清空指针。MappingWorker MUST 各阶段前后重读任务及原始快照/映射/基础结果关联，关联已清理 MUST 中止，不以任务行不存在为唯一判据，不作迟到写入。

#### Scenario: 删除处理中的任务

- **GIVEN** 任务 J 的映射处于 `CONVERTING`
- **WHEN** 用户删除 J 的结果
- **THEN** J 行保留，results/raw/mappings 与指针已清理；Worker 完成调用后检测关联已删除，不写入结果版本

### Requirement: 审计、匹配反馈与数据保护

系统 SHALL 记录审计动作 `template.applied`（含自动生效）、`template.switched`（含切回）、`template.generic_selected`、`template.mapping_failed`，内容包含操作人、租户、任务、映射、模板版本、来源、结果与时间。任务确认时，系统 SHALL 记录一次 `template.match_feedback`，包含自动匹配的模板版本与最终确认时的模板版本。日志与审计 MUST NOT 记录单据内容；大模型调用 SHALL 复用现有 DeepSeek 供应商，不扩大数据外发范围。

#### Scenario: 记录匹配反馈

- **GIVEN** 自动匹配为模板 A，用户切换到模板 B 后确认
- **WHEN** 确认成功
- **THEN** 审计中 `template.match_feedback` 同时记录 A 与 B 的模板版本
