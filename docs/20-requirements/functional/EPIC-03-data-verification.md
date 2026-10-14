---
doc_id: EPIC-03
title: "EPIC-03 — 数据人工核验与修改"
type: epic
status: active
version: 1.1.0
updated: 2026-10-06
owner: Product Engineering
priority: P0
source: "PRD-001 §3.1 场景 3, §4.3"
related: [DM-Document, DM-ExtractedField, DM-ChangeLog, DM-ReviewRecord, API-4]
---

# EPIC-03 — 数据人工核验与修改

## 1. Epic 摘要
- **目标：** 让人员在录入或归档前确认/更正 OCR 输出（human-in-the-loop），并以可配置的 0/1/2 级复核控制数据是否可正式进入业务流程。
- **范围内：** 并排展示结果、单字段编辑、批量更正、错误红色标记、缺失字段提醒、核验确认、固定层级复核、变更/复核日志。
- **范围外：** OCR 提取本身（EPIC-02）；录入/归档（EPIC-04）；通用工作流引擎、任意审批流编排、条件分支和跨系统任务调度。
- **主要参与者：** P-01 文员、P-02 财务人员、P-04 采购专员、被授予复核权限的管理层人员。
- **关键实体：** `DM-Document`、`DM-ExtractedField`、`DM-ChangeLog`、`DM-ReviewRecord`、`DM-ReviewPolicy`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-VERIFY-001 | 将识别字段与其源图像区域并排显示 | P0 | §4.3 | FR-OCR-012 | AC-FR-VERIFY-001-01 |
| FR-VERIFY-002 | 允许编辑单个字段值 | P0 | §4.3 | FR-VERIFY-001 | AC-FR-VERIFY-002-01 |
| FR-VERIFY-003 | 允许跨多个文档/字段批量更正 | P1 | §4.3 | FR-VERIFY-002 | AC-FR-VERIFY-003-01 |
| FR-VERIFY-004 | 将校验失败或置信度低的字段标为红色 | P0 | §4.3 | FR-OCR-015 | AC-FR-VERIFY-004-01 |
| FR-VERIFY-005 | 对缺失的必填字段显示提醒 | P0 | §4.3 | FR-VERIFY-001 | AC-FR-VERIFY-005-01 |
| FR-VERIFY-006 | 提供可锁定记录的核验确认操作 | P0 | §4.3 | FR-VERIFY-002 | AC-FR-VERIFY-006-01/02 |
| FR-VERIFY-007 | 在变更日志中记录每次修改（修改前/后、用户、时间） | P0 | §4.3 | FR-VERIFY-002 | AC-FR-VERIFY-007-01 |
| FR-VERIFY-008 | 选中字段时高亮显示源边界框 | P1 | §4.3 | FR-VERIFY-001 | AC-FR-VERIFY-008-01 |
| FR-VERIFY-009 | 任一必填字段缺失或被标记时阻止确认 | P0 | §4.3 | FR-VERIFY-005 | AC-FR-VERIFY-006-02 |
| FR-VERIFY-010 | 允许按单据处理流程配置无需复核、一级复核或二级复核 | P0 | §3.1 场景 3, §4.3 | FR-SYS-002 | AC-FR-VERIFY-010-01 |
| FR-VERIFY-011 | 对配置为一级或二级复核的已核验数据创建对应级别的待复核记录 | P0 | §3.1 场景 3 | FR-VERIFY-006, FR-VERIFY-010 | AC-FR-VERIFY-011-01 |
| FR-VERIFY-012 | 仅在最终所需复核级别通过后允许数据正式进入业务流程 | P0 | §3.1 场景 3, §4.3 | FR-VERIFY-011 | AC-FR-VERIFY-012-01/02 |
| FR-VERIFY-013 | 记录每次复核决定、复核级别、复核人、时间与意见 | P0 | §3.1 场景 3 | FR-VERIFY-011 | AC-FR-VERIFY-013-01 |

## 3. 规则

### 3.1 文档、核验与复核状态

`extracted → in_review → verified → pending_review_level_1 → pending_review_level_2 → approved_for_business → entered → archived`。

- 配置为 `0` 级复核时：核验确认使状态从 `in_review → approved_for_business`。
- 配置为 `1` 级复核时：核验确认使状态进入 `pending_review_level_1`；一级通过后进入 `approved_for_business`。
- 配置为 `2` 级复核时：核验确认使状态进入 `pending_review_level_1`；一级通过后进入 `pending_review_level_2`；二级通过后进入 `approved_for_business`。
- 被拒绝的记录回到 `in_review`，并保留复核意见；重新提交会创建新的待复核记录。
- `approved_for_business` 是允许进入业务流程的唯一状态。`verified` 或待复核状态不得导出为正式业务录入。
- `verified` 记录只能由具有 `verify` 权限的用户重新打开，且重新打开会被记录。

> 本状态机仅支持固定的 0/1/2 级复核，不能配置任意分支、会签、或条件路由，因此不构成 Workflow Engine。

### 3.2 变更日志（FR-VERIFY-007）
每次编辑写入一条 `DM-ChangeLog`：`field`、`old_value`、`new_value`、`user_id`、`timestamp`、`reason (optional)`。日志只可追加并具有防篡改证据（见 `NFR-SEC`）。

### 3.3 校验门控（FR-VERIFY-009）
以下情况会阻止确认：任一必填字段为空；任一 `needs_review = true` 的字段未被处理；`amount_mismatch = true` 且未解决。

## 4. 代表性验收标准（P0）

```gherkin
Feature: EPIC-03 核验与修改

  Scenario: AC-FR-VERIFY-002-01 单字段编辑
    Given 一份待核验的 Invoice，其 total_price = 12000.00
    When 文员将 total_price 编辑为 12500.00 并保存
    Then 该字段显示新值，且创建一条 DM-ChangeLog 记录

  Scenario: AC-FR-VERIFY-006-01 确认并锁定
    Given 所有必填字段均存在且没有字段被标记
    When 文员点击 "Confirm"
    Then 文档状态变为 "verified"，且字段变为只读

  Scenario: AC-FR-VERIFY-006-02 因缺失字段阻止确认
    Given 必填字段 "invoice_number" 为空
    When 文员点击 "Confirm"
    Then 系统 SHALL 阻止确认并显示 "Missing required field: invoice_number"

  Scenario: AC-FR-VERIFY-010-01 无需复核
    Given Delivery Note 流程被配置为 0 级复核
    And 文档已完成核验确认
    Then 文档状态为 "approved_for_business"，可以进入业务流程

  Scenario: AC-FR-VERIFY-012-01 二级复核门控
    Given Invoice 流程被配置为 2 级复核
    And 一级复核已通过
    When 二级复核尚未通过时请求正式业务录入
    Then 系统 SHALL 拒绝该请求

  Scenario: AC-FR-VERIFY-012-02 二级复核通过
    Given Invoice 流程被配置为 2 级复核
    And 一级及二级复核均已通过
    When 请求正式业务录入
    Then 系统 SHALL 允许录入，且文档状态为 "approved_for_business"

  Scenario: AC-FR-VERIFY-013-01 复核日志
    Given 一级复核人员通过一份待复核文档
    When 保存复核决定
    Then 创建 DM-ReviewRecord，包含复核级别、复核人、时间、决定和意见
```

## 5. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-VERIFY-001..013 | AC-FR-VERIFY-* | `DM-ExtractedField`、`DM-ChangeLog`、`DM-ReviewRecord`、`DM-ReviewPolicy`、`API-4` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-10-06 | Product Engineering | 新增可配置 0/1/2 级复核、最终复核门控与复核日志；明确不支持 Workflow Engine |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.3 节生成初始核验需求 |
