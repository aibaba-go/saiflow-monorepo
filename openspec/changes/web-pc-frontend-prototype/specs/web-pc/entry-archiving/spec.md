# Delta Spec: web-pc/entry-archiving

## Purpose

为 Web PC 前端原型提供 Excel 录入与归档的界面能力：按单据类型生成标准化模板、一键填充、批量导出，并以 Mock 方式展示双重存储归档记录与自动命名规则，供评审录入/归档流程交互。

## ADDED Requirements

### Requirement: Excel 模板与一键填充

系统 SHALL 提供按单据类型选择标准化 Excel 模板并一键填充已核验（approved_for_business）单据数据的功能；原型 SHALL 生成可下载的 .xlsx 文件，其中映射字段均已填充。（来源：FR-ENTRY-001/002）

#### Scenario: 一键填充导出

- **WHEN** 文员选择一份已批准的 Delivery Note 并点击 "Export to Excel"
- **THEN** 系统生成并下载 .xlsx 文件，其中所有映射字段已填充

#### Scenario: 非批准状态单据不可录入

- **WHEN** 用户选择一份仍处于 pending_review 状态的单据尝试导出
- **THEN** 系统禁止该操作并提示单据尚未通过复核

### Requirement: 批量导出与保存路径

系统 SHALL 支持将多份已批准单据批量导出至同一 Excel 文件；并 SHALL 允许用户在设置或导出对话框中指定自定义保存路径（原型中记录该设置并回显）。（来源：FR-ENTRY-003/004）

#### Scenario: 批量导出多份单据

- **WHEN** 用户勾选 5 份已批准单据并点击批量导出
- **THEN** 系统生成一个包含 5 条记录的 .xlsx 文件

#### Scenario: 自定义保存路径生效

- **WHEN** 用户将导出保存路径设置为指定目录后再次导出
- **THEN** 导出对话框回显该路径作为默认保存位置

### Requirement: 归档记录展示（Mock 双重存储）

系统 SHALL 在单据归档后展示归档记录：原始图像与结构化数据两类工件（双重存储）；归档文件名 SHALL 按规则 `{DocType}_{DocNumber}_{YYYYMMDD}_{Enterprise}.{ext}` 生成并可在界面预览；分类前缀 SHALL 按类型/日期/企业树形展示。原型仅展示 Mock 归档结果，不实际写入 GCS。（来源：FR-ENTRY-005/006/007）

#### Scenario: 双重存储归档记录可见

- **WHEN** 一份已批准单据完成 Mock 归档
- **THEN** 界面显示该单据的原始图像归档件与结构化数据归档件两类记录

#### Scenario: 自动命名预览

- **WHEN** 一份来自 ACME、日期为 2026-09-10 的 Invoice INV-2026-001 被归档
- **THEN** 界面展示归档文件名 "INVOICE_INV-2026-001_20260910_ACME.<ext>"

#### Scenario: 分类前缀树展示

- **WHEN** 用户查看归档记录的分类视图
- **THEN** 记录按单据类型/年/月/企业的层级树组织展示
