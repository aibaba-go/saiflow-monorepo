---
doc_id: EPIC-04
title: "EPIC-04 — 多渠道录入与归档"
type: epic
status: active
version: 1.4.0
updated: 2026-11-03
owner: Product Engineering
priority: P0
source: "PRD-001 §4.4"
related: [DM-Document, DM-ArchiveRecord, API-5, API-6]
---

# EPIC-04 — 多渠道录入与归档 【核心差异化功能】

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
| FR-ENTRY-002 | 一键导出当前已保存核验数据；模板结果 XLSX/CSV 按固定模板分组、项与列顺序及显示名、金额类型输出，模板外字段追加；正式 format=JSON 原样输出 structured，application/json MIME、.json 下载；通用及 TXT 旧行为不变 | P0 | §4.4；模板映射批准 D15 | FR-ENTRY-001、FR-VERIFY-019 | AC-FR-ENTRY-002-01/02/03 |
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
| FR-ENTRY-015 | 在核验确认后的最终结果页提供结果查看与 Excel（XLSX）导出；Android LINE 内置浏览器经限时下载票据在系统浏览器下载 | P0 | 界面调整 2026-10-17；Android 导出修复 2026-11-03 | FR-VERIFY-016 | AC-FR-ENTRY-015-01/02 |

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
- 下载交付（2026-11-03）：
  - 同一最终结果页内重复点击复用已生成且距过期超过 1 分钟的导出，不重复创建导出记录；复用的导出失效（404/409）时自动重新生成一次。
  - iOS、桌面及非 LINE 浏览器沿用会话 Cookie 下载（`GET /exports/{id}/download`）。
  - Android LINE 内置浏览器会把附件交给不带会话 Cookie 的系统下载器且页面无反馈，因此改为：以会话 + CSRF 换取 **60 秒限时下载票据**，经 `liff.openWindow({external:true})` 在系统浏览器打开下载，页面提示文件保存到「下载/Downloads」并可在通知栏或文件 App 查看。
  - 票据由后端签名、不落库，绑定导出、用户与签发会话；兑换时重新校验会话、账号状态、任务归属与导出状态，任一不满足按不存在处理。有效期内允许下载器重复请求同一文件，不能取其他导出。文件仍经后端代理下发，浏览器不获得存储凭据或存储 URL（符合 §3.3 的限时 URL 调解）。

### 3.6 按模板导出（FR-ENTRY-002）

- 当前 ResultVersion.mapping_id 非空时，读取映射固定引用的模板版本，不使用模板族最新版本；XLSX/CSV 按分组、项、列顺序输出模板显示名称，字段为「显示名称 | 值」，表头为列显示名。
- amount 按类型而非键名显示千分位与至少两位小数，超过两位不舍入，原始存储值不改；模板外字段追加所在组末尾，导出含用户已保存编辑。XLSX 延续单一 Result 工作表与既有样式/公式防护；通用结果继续 §3.5 原规则。
- 创建导出正式支持 `format=JSON`，下载 MIME 为 `application/json`、扩展名为 `.json`；原样输出指定结果版本的 structured，包含已保存 extras，保留键顺序、JSON 类型与数值精度，不加信封、显示名替换或金额格式化。TXT 仍沿用旧行为，不作为 JSON 别名。本期不交付 Excel 导入、隐藏导入标识或导出回导流程，见 [API-Spec §4](../../30-design/API-Spec.md#4-尚未对齐的契约差异)。
- 已确认验证范围及尚待补测的导出场景见 [汇总验收](../../40-acceptance/Acceptance-Criteria.md)，不以验收定义代替测试或部署结果。

## 4. 代表性验收标准（P0）

```gherkin
Feature: EPIC-04 录入与归档

  Scenario: AC-FR-ENTRY-002-01 一键填充 Excel
    Given 一份已核验的 Delivery Note
    When 文员点击 "Export to Excel"
    Then 创建一个标准化 .xlsx，其中所有映射字段均已填充

  Scenario: AC-FR-ENTRY-002-02 按固定模板导出已保存编辑
    Given 当前结果为模板版本 2，用户已保存合计金额为 "1234.50"
    When 导出 XLSX 或 CSV
    Then 按版本 2 分组/项/列顺序及显示名输出，金额为 "1,234.50"
    And 模板外字段追加所在组末尾，模板升版不改变此次导出

  Scenario: AC-FR-ENTRY-002-03 正式 JSON 导出与 TXT 兼容
    Given 指定已保存结果版本为通用或模板结果，含人工 extras、前导零字符串及多位小数
    When 以 format=JSON 创建导出并下载
    Then 下载 MIME 为 application/json、文件扩展名为 .json，内容原样为该版本 structured
    And 保留键顺序、JSON 类型、数值精度与 extras，不加信封、不替换显示名或格式化金额
    When 以 format=TXT 导出同一结果
    Then 沿用旧 TXT 行为，不改成 JSON 格式别名，既有通用 XLSX/CSV 导出亦不变

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

  Scenario: AC-FR-ENTRY-015-02 Android LINE 内置浏览器导出
    Given 用户在 Android 手机的 LINE 内打开已确认文档的最终结果页
    When 点击 "Export Excel"
    Then 前端换取 60 秒限时下载票据并在系统浏览器打开，XLSX 以附件下载，页面提示文件保存位置
    And 票据无需会话 Cookie，但签名被改、超过 60 秒、会话已注销、账号停用或无任务访问权时一律返回 404
    And 连续点击复用同一导出记录；iOS 与桌面仍用会话 Cookie 下载且行为不变
```

## 5. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-ENTRY-001..015 | AC-FR-ENTRY-* | `DM-ArchiveRecord`、`DM-ExportJob`、`API-5`、`API-6` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.4.0 | 2026-11-03 | Product Engineering | FR-ENTRY-015：Android LINE 内置浏览器导出改为 60 秒限时下载票据 + 系统浏览器下载（票据签名不落库、兑换时重新鉴权），页面内重复点击复用导出；新增 AC-FR-ENTRY-015-02 |
| 1.3.1 | 2026-10-31 | Product Engineering | FR-ENTRY-002/AC-03改为正式JSON格式、application/json MIME与.json下载；原样structured保留类型/精度/顺序/extras，不改TXT旧行为，验证与补测边界单列 |
| 1.3.0 | 2026-10-31 | Product Engineering | FR-ENTRY-002同步固定模板版本顺序/显示名/金额类型、保存extras、通用兼容与JSON原样；不新增Excel导入/隐藏标记 |
| 1.2.2 | 2026-10-18 | Product Engineering | FR-ENTRY-015：XLSX 样式按产品样例 sample-format.xlsx 细化（标题合并、字体、对齐、列宽、行高） |
| 1.2.1 | 2026-10-18 | Product Engineering | FR-ENTRY-015：XLSX 导出改为单工作表，版式与解析结果页一致；更新 AC-FR-ENTRY-015-01 |
| 1.2.0 | 2026-10-17 | Product Engineering | 新增最终结果页结构化查看与 XLSX 导出（含公式注入防护） |
| 1.1.0 | 2026-10-07 | Product Engineering | 统一为私有 GCS 归档，移除本地优先和云端选择加入假设 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.4 节生成初始录入/归档需求 |
