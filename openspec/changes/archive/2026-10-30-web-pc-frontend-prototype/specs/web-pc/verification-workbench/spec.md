# Delta Spec: web-pc/verification-workbench

## Purpose

Web PC 原型的核心能力：人工核验工作台。将单据原图与 Mock OCR 结果并排展示，支持字段编辑、低置信度标记、确认门控与 0/1/2 级复核流程；并包含跨文档批量更正（P1）。所有数据由 Mock 层驱动。

## ADDED Requirements

### Requirement: 并排展示核验视图

系统 SHALL 对每份待核验单据并排展示原图与 OCR 提取结果：头部字段（如单据编号、日期、企业、金额）与行项目表，每个字段 SHALL 显示其置信度。（来源：FR-VERIFY-001、FR-OCR-012/010）

#### Scenario: 打开核验视图

- **WHEN** 用户从队列或列表打开一份已完成 OCR 的 Invoice
- **THEN** 页面左侧显示原图，右侧显示头部字段与行项目表，每字段带置信度

### Requirement: 单字段编辑与变更日志

系统 SHALL 允许对单个字段进行编辑；保存后字段立即显示新值，且系统 SHALL 追加一条变更记录，包含字段名、修改前值、修改后值、操作用户与时间。核验视图中 SHALL 可查看该单据的变更日志列表。（来源：FR-VERIFY-002/007）

#### Scenario: 编辑字段并记录日志

- **WHEN** 文员将 total_price 从 12000.00 修改为 12500.00 并保存
- **THEN** 字段显示 12500.00，且变更日志新增一条记录（total_price、12000.00 → 12500.00、操作用户、时间）

### Requirement: 字段标记与缺失提醒

系统 SHALL 将校验失败或低置信度字段以红色标记（needs_review）；必填字段为空时 SHALL 显示明确的缺失提醒。（来源：FR-VERIFY-004/005）

#### Scenario: 低置信度字段标红

- **WHEN** 打开一份 total_price 置信度低于阈值的单据
- **THEN** 该字段以红色标记呈现，并带有"需人工确认"提示

#### Scenario: 缺失必填字段提醒

- **WHEN** 单据的必填字段 invoice_number 为空
- **THEN** 该字段显示缺失提醒，且出现在待处理标记列表中

### Requirement: 确认门控与锁定

系统 SHALL 在任一必填字段为空、或任一被标记（needs_review）字段未被处理时阻止确认，并显示原因（如 "Missing required field: invoice_number"）；确认通过后单据状态 SHALL 变为 verified 且字段变为只读。（来源：FR-VERIFY-006/009）

#### Scenario: 缺失字段阻止确认

- **WHEN** 必填字段 invoice_number 为空时用户点击 "Confirm"
- **THEN** 系统阻止确认并显示 "Missing required field: invoice_number"

#### Scenario: 确认后锁定只读

- **WHEN** 所有必填字段存在且无未处理标记时用户点击 "Confirm"
- **THEN** 单据状态变为 verified，所有字段变为只读

### Requirement: 0/1/2 级复核流程

系统 SHALL 按当前复核策略（按单据类型配置）驱动复核流程：0 级时确认后直接进入 approved_for_business；1/2 级时确认后创建对应待复核记录并进入 pending_review 状态。提供待复核列表，复核人可"通过"或"拒绝"（拒绝回到 in_review 并保留意见）；每次复核决定 SHALL 记录级别、复核人、时间与意见。仅最终级别通过后单据 SHALL 显示为 approved_for_business（可进入业务录入）。（来源：FR-VERIFY-010/011/012/013）

#### Scenario: 0 级复核直接通过

- **WHEN** Delivery Note 配置为 0 级复核且文员完成核验确认
- **THEN** 单据状态显示为 approved_for_business，可进行 Excel 录入

#### Scenario: 二级复核门控

- **WHEN** Invoice 配置为 2 级复核，仅一级复核通过时用户尝试执行业务录入
- **THEN** 系统显示单据仍处于 pending_review_level_2，录入入口不可用

#### Scenario: 复核拒绝打回

- **WHEN** 一级复核人对单据选择"拒绝"并填写意见
- **THEN** 单据状态回到 in_review，意见显示在复核记录中，重新提交后生成新的待复核记录

#### Scenario: 复核日志可见

- **WHEN** 复核人通过一份待复核单据
- **THEN** 复核记录列表新增条目，含复核级别、复核人、时间、决定与意见

### Requirement: 跨文档批量更正（P1）

系统 SHALL 支持选择多份单据并对同一字段批量应用相同更正；每份被更正的单据 SHALL 分别记录变更日志。（来源：FR-VERIFY-003）

#### Scenario: 批量修正字段值

- **WHEN** 用户选中 3 份单据，将 enterprise 字段统一改为 "ACME" 并提交
- **THEN** 3 份单据的该字段均更新为 "ACME"，且各新增一条变更日志
