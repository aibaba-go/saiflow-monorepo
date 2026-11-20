---
doc_id: EPIC-08
title: "EPIC-08 — 文档格式模板配置"
type: epic
status: in-review
version: 0.3.0
updated: 2026-11-06
owner: Product Engineering
priority: P1
source: "PRD-001 §4.8"
related: [DM-DocumentTemplate, DM-TemplateFieldMapping, API-10, OCR-Pipeline]
---

# EPIC-08 — 文档格式模板配置

> **注意（2026-10-30）：** 本 Epic 尚未按 PRD v3 改写，与 `PRD-SaiFlow.md` v3.1 冲突时以 PRD 为准；将随 ADR-006 §7 的重建步骤迁入 `openspec/specs/`。文中引用的 `Architecture` / `Data-Model` 旧章节细节见 git tag `legacy-v1` 中的版本。

> 管理员通过配置界面维护不同单据版式的识别与转换规则。模板将 TextIn 输出的原始 JSON 映射为 SaiFlow 的规范字段和行项目；它不是通用工作流或业务规则引擎。

## 1. Epic 摘要

- **目标：** 让管理员能够为不同单据版式安全地配置 JSON 到关系模型的转换规则，将 OCR 结果按规范结构保存到 Cloud SQL，支撑订单跟踪、报表统计和后续 ERP 对接，无需修改应用代码。
- **范围内：** 模板列表、创建草稿、字段及行项目映射、必填和数据类型规则、标准化规则、TextIn 服务参数引用、发布/停用、版本追溯与操作日志。
- **范围外：** 可视化工作流编排、任意表达式执行、跨系统任务编排、对历史已转换数据的静默重写。
- **主要参与者：** P-07 系统管理员；转换服务自动使用已发布模板。
- **关键实体：** `DM-DocumentTemplate`、`DM-TemplateFieldMapping`、`DM-ExtractionPayload`、`DM-ConversionJob`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-TEMPLATE-001 | 向管理员展示文档格式模板列表及其名称、表单类型、版本、状态和更新时间 | P1 | §4.8 | FR-SYS-002 | AC-FR-TEMPLATE-001-01 |
| FR-TEMPLATE-002 | 允许管理员创建模板草稿，并设置模板名称、表单类型和 TextIn 解析模板或服务参数引用 | P1 | §4.8 | FR-TEMPLATE-001 | AC-FR-TEMPLATE-002-01 |
| FR-TEMPLATE-003 | 允许管理员为规范字段配置 JSONPath、目标字段、数据类型、必填规则和标准化规则 | P1 | §4.8 | FR-TEMPLATE-002 | AC-FR-TEMPLATE-003-01 |
| FR-TEMPLATE-004 | 允许管理员为重复行项目配置数组 JSONPath 及其列映射 | P1 | §4.8 | FR-TEMPLATE-003 | AC-FR-TEMPLATE-004-01 |
| FR-TEMPLATE-005 | 在发布模板前校验字段映射的 JSONPath、目标字段唯一性和数据类型兼容性 | P1 | §4.8 | FR-TEMPLATE-003/004 | AC-FR-TEMPLATE-005-01 |
| FR-TEMPLATE-006 | **已迁移至 `openspec/specs/recognition/spec.md`（deprecated，`ocr-scan-flow`）** 仅允许转换任务使用已发布且启用的模板版本 | P1 | §4.8 | FR-TEMPLATE-005 | AC-FR-TEMPLATE-006-01 |
| FR-TEMPLATE-007 | 为模板创建、修改、发布和停用记录操作日志，并为每次转换保留模板版本 | P1 | §4.8 | FR-SYS-003 | AC-FR-TEMPLATE-007-01 |

## 3. 规则

- 模板只能由具有 `admin` 权限的用户管理；其他角色只可读取被授权的转换结果。
- `doc_type`、模板版本和模板状态在发布后不可直接修改；需要变更时创建新草稿版本。
- 映射仅允许受支持的 JSONPath、类型转换和标准化规则；不得执行用户提供的脚本、SQL、网络请求或任意表达式。
- 一个已发布模板在被停用后不再接收新的转换任务；已完成转换保留原始 JSON 和模板版本。
- 发布校验失败时必须展示逐字段错误，且不得改变当前已发布版本。

## 4. 代表性验收标准

```gherkin
Feature: EPIC-08 文档格式模板配置

  Scenario: AC-FR-TEMPLATE-003-01 配置字段映射
    Given 管理员创建了一个 INVOICE 模板草稿
    When 将 JSONPath "$.invoice.no" 映射至字段 "invoice_number" 并设为必填字符串
    Then 草稿保存该字段映射，且尚未用于转换任务

  Scenario: AC-FR-TEMPLATE-004-01 配置行项目映射
    Given 一个模板草稿的原始 JSON 包含 "$.items[*]" 数组
    When 管理员配置该数组映射 product_name、quantity 和 unit_price
    Then 转换规则包含一个行项目数组映射

  Scenario: AC-FR-TEMPLATE-005-01 发布校验失败
    Given 模板草稿把两个 JSONPath 映射到同一个非重复目标字段
    When 管理员尝试发布模板
    Then 系统拒绝发布并指出重复的目标字段

  Scenario: AC-FR-TEMPLATE-006-01 使用已发布版本
    Given INVOICE 模板版本 3 已发布并启用，版本 4 仍为草稿
    When 新的 Invoice JSON 进入转换任务
    Then 任务使用版本 3，且记录 template_version = 3

  Scenario: AC-FR-TEMPLATE-007-01 模板审计
    Given 管理员发布模板版本 3
    When 查看操作日志
    Then 日志包含管理员、动作 "template_published"、模板标识、版本、时间和结果
```

## 5. 可追溯性

| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-TEMPLATE-001..007 | AC-FR-TEMPLATE-* | `DM-DocumentTemplate`、`DM-TemplateFieldMapping`、`API-10`、`OCR-Pipeline.md` |

## 6. 待决问题

- OQ-9：模板审批、版本回滚和字段映射的默认治理规则是什么？
- 是否需要支持由 TextIn 提供的模板标识之外的服务参数，并在何种情况下允许？

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 0.3.0 | 2026-11-06 | Product Engineering | FR-TEMPLATE-006 迁移至 `openspec/specs/`（变更 `ocr-scan-flow`），本文件中对应条目只作参考 |
| 0.2.0 | 2026-10-12 | Product Engineering | 对齐 PRD §4.8 扩展：在目标中明确订单跟踪、报表统计与 ERP 对接；范围内新增标准化规则 |
| 0.1.0 | 2026-10-07 | Product Engineering | 初始文档格式模板配置需求；覆盖 JSON 映射、发布、版本与审计 |
