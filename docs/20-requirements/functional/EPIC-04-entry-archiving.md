---
doc_id: EPIC-04
title: "EPIC-04 — 多渠道录入与归档"
type: epic
status: active
version: 1.4.0
updated: 2026-11-07
owner: Product Engineering
priority: P0
source: "PRD-001 §4.4"
related: [DM-Document, DM-ArchiveRecord, API-5, API-6]
---

# EPIC-04 — 多渠道录入与归档 【核心差异化功能】

> **注意（2026-10-30）：** 本 Epic 尚未按 PRD v3 改写，与 `PRD-SaiFlow.md` v3.1 冲突时以 PRD 为准；将随 ADR-006 §7 的重建步骤迁入 `openspec/specs/`。文中引用的 `Architecture` / `Data-Model` 旧章节细节见 git tag `legacy-v1` 中的版本。

## 1. Epic 摘要
- **目标：** 将已核验的数据录入企业现有系统，并在**私有 Google Cloud Storage Bucket**中归档原始图像和结构化数据。
- **范围内（V1.0 / P0）：** Excel 自动录入、GCS 归档（双重存储、自动命名、分类对象前缀）、合并 PDF 账单包。
- **延后（P1/V2.0）：** ERP 录入和企业管理系统录入。
- **部署：** FastAPI 运行于 Cloud Run，并使用专用服务账号写入归档；见 ADR-001。
- **主要参与者：** P-01 文员、P-02 财务人员、P-03 仓库管理员。
- **关键实体：** `DM-Document`、`DM-ArchiveRecord`、`DM-ExportJob`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-ENTRY-001 | 按文档类型生成标准化 Excel 模板 | P0 | §4.4 | FR-VERIFY-006 | AC-FR-ENTRY-001-01 |
| FR-ENTRY-002 | 一键将已核验数据填入 Excel 模板 | P0 | §4.4 | FR-ENTRY-001 | AC-FR-ENTRY-002-01 |
| FR-ENTRY-003 | 将多份已核验文档批量导出至 Excel | P0 | §4.4 | FR-ENTRY-002 | AC-FR-ENTRY-003-01 |
| FR-ENTRY-004 | 允许为导出文件指定自定义保存路径 | P0 | §4.4 | FR-ENTRY-002 | AC-FR-ENTRY-004-01 |
| FR-ENTRY-005 | 同时归档原始图像和结构化数据（双重存储） | P0 | §4.4 | FR-UPLOAD-011 | AC-FR-ENTRY-005-01 |
| FR-ENTRY-006 | 对归档文件应用自动文件命名规则 | P0 | §4.4 | FR-ENTRY-005 | AC-FR-ENTRY-006-01 |
| FR-ENTRY-007 | 自动生成分类 GCS 对象前缀（按类型/日期/企业） | P0 | ADR-001 | FR-ENTRY-005 | AC-FR-ENTRY-007-01 |
| FR-ENTRY-008 | 通过经授权的后端服务账号将归档存储于私有 GCS Bucket | P0 | ADR-001 | FR-ENTRY-005 | AC-FR-ENTRY-008-01 |
| FR-ENTRY-009 | 将相关文档（PO + DN + Invoice）合并为一个账单 PDF | P1 | §3.1 | FR-VERIFY-006 | AC-FR-ENTRY-009-01 |
| FR-ENTRY-010 | 对接本地 ERP 接口并同步映射字段 | P1（V2.0） | §4.4 | FR-VERIFY-006 | AC-FR-ENTRY-010-01 |
| FR-ENTRY-011 | 支持手动与自动 ERP 同步模式 | P1（V2.0） | §4.4 | FR-ENTRY-010 | AC-FR-ENTRY-011-01 |
| FR-ENTRY-012 | 将自定义字段映射到企业管理系统 | P1（V2.0） | §4.4 | FR-ENTRY-010 | AC-FR-ENTRY-012-01 |
| FR-ENTRY-013 | 将数据导出为 JSON / CSV / Excel 以供下游集成 | P1（V2.0） | §3.1 | FR-ENTRY-002 | AC-FR-ENTRY-013-01 |
| FR-ENTRY-014 | 归档至云端文件夹（双重存储、自动命名、分类） | P2（V3.0） | §4.4 | FR-ENTRY-005 | AC-FR-ENTRY-014-01 |
| FR-ENTRY-015 | **已迁移至 `openspec/specs/exports/spec.md`（deprecated，`ocr-scan-flow`）** 在核验确认后的最终结果页提供结果查看与 Excel（XLSX）导出 | P0 | 界面调整 2026-10-17 | FR-VERIFY-016 | AC-FR-ENTRY-015-01 |

## 3. 规则

### 3.1 自动文件命名（FR-ENTRY-006）
默认模式（可配置）：
`{DocType}_{DocNumber}_{YYYYMMDD}_{Enterprise}.{ext}`
示例：`INVOICE_INV-2026-001_20260910_ACME.pdf`。无效文件名字符将被清理；冲突时添加 `-2`、`-3` 后缀。

### 3.2 分类文件夹（FR-ENTRY-007）
默认树：`<root>/<DocType>/<YYYY>/<MM>/<Enterprise>/`。可按部署配置。

### 3.3 私有 GCS 存储（FR-ENTRY-008）
- 默认归档模式 = 私有 GCS；原件和结构化归档工件只能由经授权的后端服务账号写入。
- 浏览器不得获取 GCS 凭据；对象访问必须经 API 或限时 signed URL 调解。
- 归档对象的保留与删除必须符合 PDPA 和 `NFR-SEC`。

### 3.4 ERP 对接（FR-ENTRY-010..012，V2.0）
- 可按 ERP 版本配置字段映射表；未映射字段会被忽略而非丢失。
- 同步失败将排队重试；通知用户（异常提醒，V2.0）。

### 3.5 最终结果页导出（FR-ENTRY-015）
- 最终结果页同时提供结构化结果只读查看与 Excel 导出。
- 导出以当前核验确认后的结构化结果为数据源，全部内容写入**同一个工作表**（`Result`），版式以产品样例 `sample-format.xlsx` 为准：
  - 首行为文档标题（用户语言，如 "Document information" / "ข้อมูลเอกสาร"），合并 A–B 列，16 号加粗居中；其下直接列出顶层字段。
  - 嵌套对象各成一个字段区块：空一行 + 区块标题（10 号加粗）+ 「字段名｜值」两列；表格区块：空一行 + 区块标题 + 表头 + 数据行。区块顺序与解析结果页一致。
  - 字段名与表头：浅蓝底（#E8EDFF）、主题蓝（#4A66F7）加粗、居中；字段值左对齐；表格中含长文本（>20 字符或多行）的列左对齐，其余列居中；所有数据单元格带细边框（#E3E8F0）并自动换行。
  - 字体 Microsoft YaHei；A 列宽 ≥25、B 列宽 ≥50，其余列按内容自适应；行高 22.5，多行内容按行数增高。
  - 显示名规则与结果页相同（`_` 转空格、层级以 ` / ` 连接、单词首字母大写）；空值输出为空白单元格。
- OCR 部分成功时，在工作表末尾注明缺失页。
- 所有单元格按文本写入以保留前导零；以 `=`、`+`、`-`、`@` 开头的用户可编辑文本须做公式注入防护。

## 4. 代表性验收标准（P0）

```gherkin
Feature: EPIC-04 录入与归档

  Scenario: AC-FR-ENTRY-002-01 一键填充 Excel
    Given 一份已核验的 Delivery Note
    When 文员点击 "Export to Excel"
    Then 创建一个标准化 .xlsx，其中所有映射字段均已填充

  Scenario: AC-FR-ENTRY-005-01 双重存储归档
    Given 一份已核验的 Invoice
    When 运行归档
    Then 原始图像文件和结构化数据文件（JSON/Excel）均被存储

  Scenario: AC-FR-ENTRY-006-01 自动命名
    Given 一份来自 ACME、日期为 2026-09-10 的 Invoice INV-2026-001
    When 文件被归档
    Then 其名称为 "INVOICE_INV-2026-001_20260910_ACME.<ext>"

  Scenario: AC-FR-ENTRY-008-01 私有 GCS 归档
    Given 一份已核验文档
    When 任意文档被归档
    Then 原始对象和结构化归档工件仅写入私有 GCS，且浏览器不获得 GCS 凭据

  Scenario: AC-FR-ENTRY-015-01 最终结果页导出
    Given 一份已确认且包含已编辑数量的文档
    When 用户在最终结果页点击 "Export Excel"
    Then 生成仅含一个工作表的 XLSX，字段区块与表格区块的顺序、标题与列名与解析结果页一致
    And 导出内容反映当前已确认的结构化结果
```

## 5. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-ENTRY-001..015 | AC-FR-ENTRY-* | `DM-ArchiveRecord`、`DM-ExportJob`、`API-5`、`API-6` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.4.0 | 2026-11-07 | Product Engineering | FR-ENTRY-015：待复核的单据不能导出，复核通过（或无需复核）后才能导出（变更 `review-flow`，见 `openspec/specs/exports/spec.md`） |
| 1.3.0 | 2026-11-06 | Product Engineering | FR-ENTRY-015 迁移至 `openspec/specs/`（变更 `ocr-scan-flow`），本文件中对应条目只作参考 |
| 1.2.2 | 2026-10-18 | Product Engineering | FR-ENTRY-015：XLSX 样式按产品样例 sample-format.xlsx 细化（标题合并、字体、对齐、列宽、行高） |
| 1.2.1 | 2026-10-18 | Product Engineering | FR-ENTRY-015：XLSX 导出改为单工作表，版式与解析结果页一致；更新 AC-FR-ENTRY-015-01 |
| 1.2.0 | 2026-10-17 | Product Engineering | 新增最终结果页结构化查看与 XLSX 导出（含公式注入防护） |
| 1.1.0 | 2026-10-07 | Product Engineering | 统一为私有 GCS 归档，移除本地优先和云端选择加入假设 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.4 节生成初始录入/归档需求 |
