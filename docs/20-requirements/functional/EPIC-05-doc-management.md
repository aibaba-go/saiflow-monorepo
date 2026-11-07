---
doc_id: EPIC-05
title: "EPIC-05 — 文档管理与检索"
type: epic
status: active
version: 1.1.0
updated: 2026-11-07
owner: Product Engineering
priority: P1
source: "PRD-001 §4.5"
related: [DM-Document, DM-ArchiveRecord, API-7]
---

# EPIC-05 — 文档管理与检索

## 1. Epic 摘要
- **目标：** 让用户查找、预览和管理已归档文档，并避免重复。
- **范围内：** 分类、搜索（编号/日期/企业/类型/关键词）、预览、历史记录查询、重复检测与去重。
- **优先级说明：** 基础管理/搜索为 P1（V2.0）；高级检索与可追溯性为 P2.3（V3.0）。为支持归档（EPIC-04），V1.0 提供最小的“列表 + 打开”能力。
- **主要参与者：** 所有核心用户画像；P-05 所有者（监督）。
- **关键实体：** `DM-Document`、`DM-ArchiveRecord`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-MGMT-001 | **由 web-pc 单据库覆盖（FR-SYS-130，按阶段、模板、建立日期筛选，`openspec/specs/web-pc/spec.md`，`web-pc-ocr`）** 按类型、企业和日期对文档分类 | P0 | §4.5 | FR-ENTRY-005 | AC-FR-MGMT-001-01 |
| FR-MGMT-002 | 按编号检索文档 | P1 | §4.5 | FR-MGMT-001 | AC-FR-MGMT-002-01 |
| FR-MGMT-003 | 按日期 / 日期范围检索文档 | P1 | §4.5 | FR-MGMT-001 | AC-FR-MGMT-003-01 |
| FR-MGMT-004 | 按企业检索文档 | P1 | §4.5 | FR-MGMT-001 | AC-FR-MGMT-004-01 |
| FR-MGMT-005 | 按文档类型检索文档 | P1 | §4.5 | FR-MGMT-001 | AC-FR-MGMT-005-01 |
| FR-MGMT-006 | **由 web-pc 单据详情覆盖（FR-SYS-131，`openspec/specs/web-pc/spec.md`，`web-pc-ocr`）** 预览文档（原始图像 + 提取数据） | P0 | §4.5 | FR-ENTRY-005 | AC-FR-MGMT-006-01 |
| FR-MGMT-007 | 查询文档的历史处理记录 | P2 | §4.5 | FR-VERIFY-007 | AC-FR-MGMT-007-01 |
| FR-MGMT-008 | 按文档文本包含的关键词搜索 | P2 | §4.5 | FR-OCR-002 | AC-FR-MGMT-008-01 |
| FR-MGMT-009 | 检测重复文档（相同编号/类型/企业） | P1 | §4.5 | FR-OCR-002 | AC-FR-MGMT-009-01 |
| FR-MGMT-010 | 去重：合并或标记重复记录 | P2 | §4.5 | FR-MGMT-009 | AC-FR-MGMT-010-01 |

## 3. 规则
- **重复键（FR-MGMT-009）：** `(doc_type, doc_number, enterprise)`；如存在匹配项，在录入前警告用户，并提供关联而非创建的选项。
- **搜索（FR-MGMT-002..005）：** 可组合的筛选条件（AND）。结果分页（默认 20）。
- **关键词搜索（FR-MGMT-008）：** 对提取字段的 `raw_text` 进行全文搜索；支持泰语/英语/中文 token。

## 4. 代表性验收标准

```gherkin
Feature: EPIC-05 管理与检索

  Scenario: AC-FR-MGMT-002-01 按编号检索
    Given 已归档的 Invoice 存在
    When 用户搜索编号 "INV-2026-001"
    Then 在 2 秒内返回匹配文档

  Scenario: AC-FR-MGMT-009-01 重复检测
    Given 来自 ACME 的 Invoice "INV-2026-001" 已归档
    When 再次上传相同 Invoice
    Then 系统 SHALL 在创建新记录前警告 "Possible duplicate"
```

## 5. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-MGMT-001..010 | AC-FR-MGMT-* | `DM-Document`、`DM-ArchiveRecord`、`API-7` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-11-07 | Product Engineering | FR-MGMT-001、006 由 web-pc 单据库与单据详情覆盖（变更 `web-pc-ocr`）；按企业分类未做（V1.0 没有企业主数据） |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.5 节生成初始管理/检索需求 |
