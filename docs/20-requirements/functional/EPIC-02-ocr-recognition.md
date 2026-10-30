---
doc_id: EPIC-02
title: "EPIC-02 — 多类型文档 OCR 识别"
type: epic
status: active
version: 1.3.1
updated: 2026-10-29
owner: Product Engineering
priority: P0
source: "PRD-001 §4.2"
related: [DM-Document, DM-LineItem, DM-ExtractedField, DM-ExtractionPayload, DM-ConversionJob, API-2, OCR-Pipeline]
---

# EPIC-02 — 多类型文档 OCR 识别

> **核心模块。** 识别每一种支持的文档类型，提取其必需字段，处理泰语/英语/中文混合文本，对置信度评分，并将低置信度输出标记为需要人工核验。字段定义位于 `docs/30-design/Data-Model.md`；本 epic 定义必须识别的内容及规则。

## 1. Epic 摘要
- **目标：** 将预处理后的文档图像经 TextIn 转换为可审计的原始 JSON，并映射为带置信度评分的结构化字段数据。
- **范围内：** 文档类型处理、TextIn 调用、原始 JSON 保存、按类型字段提取、表格/行项目提取、混合语言识别、置信度评分、金额纠错、Cloud Functions 转换、失败重试和低置信度标记。
- **范围外：** 人工更正 UI（EPIC-03）、主数据映射与 3-way match（V2.0）、模板配置界面（EPIC-08）、批量 Dataflow 实现。
- **主要参与者：** 系统（自动）；P-01/P-02/P-04 使用结果。
- **关键实体：** `DM-Document`、`DM-ExtractionPayload`、`DM-ConversionJob`、`DM-ExtractedField`、`DM-LineItem`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-OCR-001 | 在提取前确定/接受文档类型 | P0 | §4.2 | FR-UPLOAD-006 | AC-FR-OCR-001-01 |
| FR-OCR-002 | 从 **Purchase Order（订单）**中提取必需字段 | P0 | §4.2 | FR-OCR-001 | AC-FR-OCR-002-01 |
| FR-OCR-003 | 从 **Delivery Note** 中提取必需字段 | P0 | §4.2 | FR-OCR-001 | AC-FR-OCR-003-01 |
| FR-OCR-004 | 从 **Invoice** 中提取必需字段 | P0 | §4.2 | FR-OCR-001 | AC-FR-OCR-004-01 |
| FR-OCR-005 | 从 **Receipt** 中提取必需字段 | P0 | §4.2 | FR-OCR-001 | AC-FR-OCR-005-01 |
| FR-OCR-006 | 从 **Bill** 中提取必需字段 | P1 | §4.2 | FR-OCR-001 | AC-FR-OCR-006-01 |
| FR-OCR-007 | 从 **Credit Note** 中提取必需字段 | P1 | §4.2 | FR-OCR-001 | AC-FR-OCR-007-01 |
| FR-OCR-008 | 从 **Tax Receipt / Withholding Tax** 中提取必需字段 | P1 | §4.2 | FR-OCR-001 | AC-FR-OCR-008-01 |
| FR-OCR-009 | 从 **Delivery Instruction** 中提取固定字段与自由文本 | P2 | §4.2 | FR-OCR-001 | AC-FR-OCR-009-01 |
| FR-OCR-010 | 将多行 / 嵌套项目表提取为结构化行项目 | P0 | §4.2 | FR-OCR-001 | AC-FR-OCR-010-01 |
| FR-OCR-011 | 识别同一文档中混合的泰语 / 英语 / 简体及繁体中文 | P0 | §4.2 | FR-OCR-001 | AC-FR-OCR-011-01 |
| FR-OCR-012 | 为每个提取字段生成置信度评分（0.0–1.0） | P0 | §3.2 P2.1 | FR-OCR-002 | AC-FR-OCR-012-01 |
| FR-OCR-013 | 应用金额纠错（行总额与文档总额、税款计算） | P0 | §4.2 | FR-OCR-010 | AC-FR-OCR-013-01/02 |
| FR-OCR-014 | 检测并捕获签字区域是否存在 | P1 | §4.2 | FR-OCR-001 | AC-FR-OCR-014-01 |
| FR-OCR-015 | 将置信度低于阈值的字段标记为需要人工核验 | P0 | §3.1 | FR-OCR-012 | AC-FR-OCR-015-01 |
| FR-OCR-016 | 将日期、数字和货币（THB）标准化为规范格式 | P0 | §3.1 | FR-OCR-002 | AC-FR-OCR-016-01 |
| FR-OCR-017 | 将预处理后的文档提交至 TextIn API，并关联文档与所选模板的服务参数；调用失败时按 §4.5 在同一任务内实施有界自动重试 | P0 | §4.2 | FR-UPLOAD-006、FR-TEMPLATE-006 | AC-FR-OCR-017-01/02 |
| FR-OCR-018 | 将 TextIn 返回的完整原始 JSON、请求关联信息和处理状态保存至 Firestore | P0 | §4.2 | FR-OCR-017 | AC-FR-OCR-018-01 |
| FR-OCR-019 | 在 Firestore 原始 JSON 创建后，通过 Cloud Functions 按已发布模板将其转换并写入 Cloud SQL | P0 | §4.2 | FR-OCR-018、FR-TEMPLATE-006 | AC-FR-OCR-019-01 |
| FR-OCR-020 | 对转换任务实施幂等写入、失败状态记录和可重试处理，且不重复创建关系数据 | P0 | §4.2 | FR-OCR-019 | AC-FR-OCR-020-01 |

## 3. 按文档类型列出的必需字段

> 规范字段名称/类型只在 `docs/30-design/Data-Model.md`（`DM-ExtractedField`、`DM-LineItem`）中定义一次。下表列出每种类型需要哪些字段。

### 3.1 订单 / Purchase Order（FR-OCR-002）
`order_number`、`supplier_name`、`demander_name`、`contact_person`、`contact_info`、`product_name`、`quantity`、`unit_price`、`total_price`、`order_date`、`delivery_date`、`signature_info`、`remarks`。

### 3.2 Bill（FR-OCR-006）
`bill_number`、`reconciliation_cycle`、`amount`、`tax_fee`、`settlement_method`、`reconciliation_enterprise`、`signature_confirmation`、`arrears_remarks`。

### 3.3 Delivery Note（FR-OCR-003）
`delivery_note_number`、`associated_order_number`、`delivery_enterprise`、`receiving_enterprise`、`product_list`、`delivery_quantity`、`outbound_time`、`logistics_info`、`signature_confirmation`。

### 3.4 Invoice（FR-OCR-004）
`invoice_number`、`order_number`、`supplier_name`、`demander_name`、`contact_person`、`contact_info`、`product_name`、`quantity`、`unit_price`、`total_price`、`order_date`、`delivery_date`、`tax_amount`、`signature_info`、`remarks`。

### 3.5 Credit Note（FR-OCR-007）
`credit_note_number`、`reconciliation_cycle`、`amount`、`tax_fee`、`settlement_method`、`reconciliation_enterprise`、`signature_confirmation`、`arrears_remarks`。

### 3.6 Receipt（FR-OCR-005）
`receipt_number`、`payer_name`、`payee_name`、`amount`、`payment_date`、`payment_method`、`reference_number`。

### 3.7 Tax Receipt / Withholding Tax（FR-OCR-008）
`tax_receipt_number`、`withholding_rate`、`withholding_amount`、`payer_tax_id`、`payee_tax_id`、`tax_period`、`certified_amount`。

### 3.8 Delivery Instruction（FR-OCR-009）
固定字段 + **自由文本**：`distribution_requirements`、`special_product_instructions`、`after_sales_remarks`、`packaging_requirements`（非结构化提取）。

## 4. 规则

### 4.1 识别准确性与容错（FR-OCR-002..009）
- 每个字段携带 `value`、`confidence`、`source_bbox`（边界框）、`raw_text`。
- 字段容错：通过按字段的校验字典容忍常见 OCR 混淆（O/0、l/1、泰语元音标记）；如有歧义，降低置信度而非猜测。
- 准确性目标（V1.0 基线）：样本集（`thai-sample-forms-for-ocr/`）上字段级准确率 ≥ **85%**；按字段类型衡量。精确目标 = PRD OQ-1。

### 4.2 金额纠错（FR-OCR-013）
- 重新计算 `line_total = quantity × unit_price`（容差 ±0.01 THB）。
- 重新计算 `document_total = Σ line_total (+ tax − discount)`。
- 如果识别总额与重新计算的总额相差超出容差 → 设置 `amount_mismatch=true`，降低受影响字段的置信度，并标记以供核验（EPIC-03）。

### 4.3 多语言（FR-OCR-011）
- 按文本区域检测文字系统（泰语 / 拉丁文 / CJK）；路由至相应的语言模型。
- 在 `raw_text` 中保留原始文字系统；在 `value` 中存储标准化值。

### 4.4 置信度与标记（FR-OCR-012、FR-OCR-015）
- 默认核验阈值：`confidence < 0.85` → `needs_review = true`。
- 阈值可按文档类型和字段配置（见 `NFR-DATA`）。

### 4.5 TextIn、Firestore 与转换（FR-OCR-017..020）
- FastAPI 仅通过服务端调用 TextIn；认证信息仅从 Secret Manager 注入，浏览器不得获得凭据。
- 原始 TextIn JSON 在写入 Firestore 后不得被转换过程覆盖；每个载荷必须关联 `document_id`、模板标识/版本、供应商请求标识和处理时间。
- Firestore 创建事件是默认的 Cloud Functions 触发源；函数按模板映射更新 Cloud SQL 中的 `DM-Document`、`DM-ExtractedField` 和 `DM-LineItem`。
- 转换必须以 `document_id` 与原始载荷版本作为幂等键；重试只能更新同一转换结果，不能重复插入字段或行项目。
- Dataflow 仅用于经批准的批量回填、重处理或高吞吐场景；其输出必须遵守相同的模板版本、幂等和审计规则。

**TextIn 调用失败的有界自动重试（FR-OCR-017；AC-FR-OCR-017-02）：** 上述 FastAPI / Firestore / Cloud Functions 历史架构段保留；当前 Flask `OcrWorker` / Prompt v2 路径见 [OCR-Pipeline §3.1](../../30-design/OCR-Pipeline.md#31-当前-flask--ocrworker--prompt-v2-调用路径)。本次已实现以下契约并通过隔离验证，尚未发布；验证范围和限制见 OCR-Pipeline §3.1。

- 「最多重试 3 次」指首次调用 1 次 + 额外最多 3 次，总调用次数最多 4 次；第 1/2/3 次重试前分别退避 2/4/8 秒。仅在现有 `services/api/worker.py` 的 TextIn 调用循环执行，HTTP 客户端及适配器不另加重试层。
- 可重试：网络/超时、HTTP 408/429/5xx、业务限流 `429`/`458`/`459`/`40306`、基础服务故障 `30203`、业务 `500..599`、无效响应 JSON、缺失或无效 `llm_json`（`-1`）。不重试：余额不足 `40003`、鉴权/权限/参数等明确永久错误及本地程序异常；明确永久错误优先停止，不被 HTTP 5xx 或限流文案覆盖，不因泛捕获异常就一律重试。
- HTTP 状态与业务 `code` 分开判断：HTTP 失败即使业务 `code=200` 也不是成功，按 HTTP 错误分类；HTTP 成功（2xx）但业务 `code` 失败仍按业务错误分类。仅 HTTP 成功、业务 `code=200` 且 `llm_json` 有效才是成功。
- 自动重试沿用同一 job、原件字节、文件名、页参数与 Prompt；不重新上传、不创建新 job/result、不因失败尝试发通知或额外累计 SaiFlow 月页额度。成功后仅一次结果持久化/后处理及既有完成通知，不为各尝试分别写结果。
- 任何一次成功立即停止重试；额外 3 次重试耗尽只将同一 job 落为 `FAILED`，保留最后一次错误代码和消息，不产生成功结果或完成通知。明确不可重试错误则立即失败，不用尽重试次数。
- 每次调用 TextIn 前必须重新读取并检查取消请求及既有终态（包括退避期间发生的取消、另一实例已落 CANCELLED/FAILED）；停止后续调用，不覆盖既有终态，不进入成功结果持久化/后处理。状态推进和结果持久化事务须锁行刷新，避免并发取消被覆盖。
- Worker 启动恢复仅对超过 10 分钟无进展、尚未开始供应商调用的 PREPROCESSING 阶段条件恢复入队；PROCESSING/POSTPROCESSING 的供应商结果不确定，保守标记 FAILED/VENDOR_UNCERTAIN，不自动重新入队以重置重试预算。10 分钟是保守恢复阈值，不是 HTTP 总时长上限；需要时由用户显式 Retry。
- 供应商 POST 超时可能已受理且扣费；未观察到供应商幂等键，不承诺 TextIn 只受理/扣费一次，只保证本应用自动重试不重复生成结果或额外累计 SaiFlow 月页额度。
- 自动重试不同于用户手动 Retry/rerun：前者在同一 job 内继续，后者按 AC-FR-OCR-020-02 创建新任务并关联原任务。本轮不改用户手动 rerun、API、数据库、认证、DeepSeek 或部署行为。

### 4.6 取消任务（FR-OCR-020）
- 处理页点击「Cancel task」先弹出确认框（「Keep processing」/「Cancel task」），确认后才调用 `POST /api/v1/ocr/jobs/{id}/cancel`；任务在弹框期间结束则确认框自动关闭。
- 已取消的任务显示为「OCR 处理失败」，可在结果页 Retry 重新识别。

## 5. 代表性验收标准（P0）

```gherkin
Feature: EPIC-02 OCR 识别

  Scenario: AC-FR-OCR-003-01 提取 Delivery Note 字段
    Given 样本 "ใบส่งของ ช้าง.pdf"（Delivery Note）
    When 使用 doc_type = DELIVERY_NOTE 运行 OCR 提取
    Then 字段 delivery_note_number、receiving_enterprise、product_list、
         delivery_quantity 和 outbound_time 均已填充，且每个字段都有置信度评分

  Scenario: AC-FR-OCR-010-01 多行表格提取
    Given 一份含 5 行项目表的 Delivery Note
    When 运行 OCR 提取
    Then 系统 SHALL 返回 5 条 DM-LineItem 记录，每条包含产品、数量和金额

  Scenario: AC-FR-OCR-011-01 混合语言识别
    Given 一份包含泰语、英语和中文文本的文档
    When 运行 OCR 提取
    Then 每个区域均以其自身文字系统识别并保留在 raw_text 中

  Scenario: AC-FR-OCR-013-02 金额不匹配检测
    Given 一份 Invoice，其打印总额与 Σ(quantity × unit_price) 相差 5.00 THB
    When 运行金额纠错
    Then 系统 SHALL 设置 amount_mismatch = true，并将该 Invoice 标记以供核验

  Scenario: AC-FR-OCR-015-01 低置信度标记
    Given 一个提取结果的 confidence 为 0.60 的字段
    When 提取完成
    Then 该字段 SHALL 被标记为 needs_review = true（阈值 0.85）

  Scenario: AC-FR-OCR-017-02 TextIn 调用失败的有界自动重试
    Given 一个已存在的 OCR job，原件、文件名、页参数与 Prompt 已确定
    When TextIn 调用发生网络/超时、HTTP 408/429/5xx、业务限流 429/458/459/40306、基础服务故障 30203、业务 500..599，或无效响应 JSON/缺失或无效 llm_json（-1）
    Then 仅 services/api/worker.py 执行首次 1 次加额外最多 3 次重试，总调用次数最多 4 次
    And 第 1/2/3 次重试前分别退避 2/4/8 秒，HTTP 客户端及适配器不另加重试
    And 每次沿用同一 job、原件字节、文件名、页参数与 Prompt
    And 自动重试不重新上传、不创建新 job/result、不因失败尝试发通知或额外累计 SaiFlow 月页额度
    Given HTTP 成功但业务 code 失败，或 HTTP 失败但业务 code=200
    Then 均不得视为成功，前者按业务错误分类，后者按 HTTP 错误分类
    And 仅 HTTP 成功（2xx）、业务 code=200 且 llm_json 有效才是调用成功
    Given 任一次遇到余额不足 40003、鉴权/权限/参数等明确永久错误，或本地程序异常
    Then 立即停止自动重试并将同一 job 标记 FAILED，保留该错误，不产生成功结果或完成通知
    Given 任一次调用成功且任务未被取消
    Then 立即停止重试，不再调用 TextIn，仅一次结果持久化/后处理及既有完成通知
    Given 首次及额外 3 次重试均为可重试失败，且任务未被取消
    Then 只将同一 job 标记 FAILED 并保留最后一次错误代码和消息，不产生成功结果或完成通知
    Given 任务在退避期间或下一次重试调用前被请求取消
    When Worker 在每次重试调用 TextIn 前重新读取并检查取消状态
    Then 沿用既有取消处理，不再调用供应商，不产生成功结果/后处理或完成通知
    Given 另一实例已将任务标记为 CANCELLED 或其他终态
    Then 停止本实例的后续调用和结果写入，不覆盖既有终态
    Given Worker 启动恢复发现超过 10 分钟无进展的 PROCESSING/POSTPROCESSING 任务
    Then 保守标记 FAILED/VENDOR_UNCERTAIN，不自动重新入队以重置重试预算
    And 仅尚未开始供应商调用的 PREPROCESSING 阶段允许条件恢复入队；状态推进与结果写入锁行刷新，不覆盖并发取消或终态
    Given 供应商 POST 超时且没有已确认的供应商幂等键
    Then 不承诺供应商未受理或只扣费一次，仅保证本应用自动重试不重复生成结果或额外累计 SaiFlow 月页额度
    And 自动重试不同于用户手动 Retry/rerun，后者仍按 AC-FR-OCR-020-02 创建新任务并关联原任务

  Scenario: AC-FR-OCR-018-01 保存 TextIn 原始 JSON
    Given 已完成预处理的 Invoice 和已发布的 INVOICE 模板版本 3
    When 系统调用 TextIn 并收到结构化 JSON 响应
    Then Firestore 保存完整响应、document_id、模板版本和供应商请求标识

  Scenario: AC-FR-OCR-020-01 幂等转换重试
    Given document_id 对应的 Firestore 原始 JSON 已成功转换一次
    When Cloud Functions 对同一载荷版本重试
    Then Cloud SQL 中仅保留一组该文档的字段和行项目，且转换状态保持成功

  Scenario: AC-FR-OCR-020-02 失败任务可读原因与重试
    Given 一个 status=FAILED 且 error_code=TEXTIN_ERROR_40003 的 OCR 任务
    When 用户从 History 打开该任务
    Then 系统显示本地化的失败原因与 Retry 操作，而非 404
    When 用户点击 Retry
    Then 系统创建新的 QUEUED 任务（parent_job_id 指向原任务）并进入处理页

  Scenario: AC-FR-OCR-020-03 取消任务需确认
    Given 一个处理中的 OCR 任务，用户位于处理页
    When 用户点击 "Cancel task"
    Then 系统弹出确认框，此时任务未被取消
    When 用户点击 "Keep processing"
    Then 确认框关闭，任务继续处理
    When 用户再次点击 "Cancel task" 并在确认框中确认
    Then 系统取消该任务
```

## 6. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-OCR-001..020 | AC-FR-OCR-* | `DM-Document`、`DM-ExtractionPayload`、`DM-ConversionJob`、`DM-ExtractedField`、`DM-LineItem`、`API-2`、`OCR-Pipeline.md` |

## 7. 开放问题
- OQ-1：基于经验的各字段准确性目标与置信度阈值（PRD 第 7 节）。
- OQ-7：TextIn API 的区域、数据跨境处理依据、认证方式、限流、回调或同步调用参数是否已通过安全与法务确认？
- OQ-8：哪些批量规模、延迟或重处理场景需要启用 Dataflow，而非默认 Cloud Functions 事件处理？

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.3.1 | 2026-10-29 | Product Engineering | FR-OCR-017 / AC-FR-OCR-017-02：首次+最多 3 次重试、2/4/8 秒、错误分层、取消/终态、保守恢复不重排未知供应商结果、锁行刷新及扣费边界；284 项新增+366 项既有隔离回归通过；不改手动 rerun/API/数据库，未发布，真实厂商与数据库并发未验收 |
| 1.3.0 | 2026-10-18 | Product Engineering | 取消任务前需确认（AC-FR-OCR-020-03） |
| 1.2.0 | 2026-10-17 | Product Engineering | 新增失败任务可读原因与重试验收场景（厂商余额不足等失败不再显示 404） |
| 1.1.0 | 2026-10-07 | Product Engineering | 新增 TextIn 调用、Firestore 原始 JSON、Cloud Functions 转换及幂等重试需求 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.2 节生成初始 OCR 识别需求 |
