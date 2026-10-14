---
doc_id: EPIC-07
title: "EPIC-07 — 运营报表"
type: epic
status: in-review
version: 0.1.0
updated: 2026-10-06
owner: Product Engineering
priority: P1
source: "PRD-001 §1.2, §3.1 场景 3, §4.7"
related: [DM-Document, DM-OperationLog, API-9]
---

# EPIC-07 — 运营报表

## 1. Epic 摘要

- **目标：** 让管理层通过报表查看企业数字化流程的运营指标，用于监控、跟踪、统计和分析。
- **范围内：** 授权管理层访问报表；展示已配置的运营指标；按授权范围筛选；记录报表访问。
- **范围外：** 通用 BI 平台、自定义公式编辑器、实时流式分析、预测分析、工作流分析引擎。
- **主要参与者：** 管理层、被授予报表查看权限的人员。
- **关键实体：** `DM-Document`、`DM-OperationLog`、待定义的 `DM-ReportDefinition`。

> 当前尚未确定具体指标、统计口径、时间粒度、筛选维度和导出格式。它们必须先解决 PRD OQ-5，才能将本 Epic 从 `in-review` 改为 `active` 并开始实现。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-REPORT-001 | 允许具有报表查看权限的管理层访问运营报表入口 | P1 | PRD §3.1 场景 3 | FR-SYS-002 | AC-FR-REPORT-001-01 |
| FR-REPORT-002 | 展示企业已配置的运营指标及其统计期间 | P1 | PRD §1.2, §4.7 | FR-REPORT-001, OQ-5 | AC-FR-REPORT-002-01 |
| FR-REPORT-003 | 根据用户授权范围限制报表可见数据 | P1 | PRD §4.7 | FR-SYS-002 | AC-FR-REPORT-003-01 |
| FR-REPORT-004 | 记录报表访问人与访问时间 | P1 | PRD §1.2 | FR-SYS-003 | AC-FR-REPORT-004-01 |

## 3. 规则与边界

- 指标定义由管理层确认后配置；系统不得自行假设“运营指标”的名称、计算公式或目标阈值。
- 报表只读取已授权的业务数据；不得绕过 RBAC 或暴露无权限的单据内容。
- 本 Epic 仅提供指标查看能力，不会创建、分派或推进审批任务，不构成 Workflow Engine。

## 4. 验收标准草案

```gherkin
Feature: EPIC-07 运营报表

  Scenario: AC-FR-REPORT-001-01 管理层访问报表
    Given 管理层用户具有 report_view 权限
    When 用户打开运营报表入口
    Then 系统显示该用户可访问的报表列表

  Scenario: AC-FR-REPORT-003-01 授权范围限制
    Given 用户仅被授权查看企业 A 的运营数据
    When 用户打开运营报表
    Then 报表中不包含企业 B 的数据

  Scenario: AC-FR-REPORT-004-01 记录报表访问
    Given 管理层用户打开一份运营报表
    When 报表成功加载
    Then 操作日志包含用户、报表标识、访问时间和结果
```

## 5. 待决问题

- OQ-5：运营报表必须提供哪些指标、统计口径、时间粒度、筛选维度和导出格式？
- 报表是否需要导出；若需要，支持哪些格式？
- 报表数据是否仅基于已正式进入业务流程的数据，还是也包含待复核数据？

## 6. 可追溯性

| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-REPORT-001..004 | AC-FR-REPORT-* | `DM-ReportDefinition`（待设计）、`API-9`（待设计） |

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 0.1.0 | 2026-10-06 | Product Engineering | 根据产品定位新增运营报表 Epic；指标口径待管理层确认 |
