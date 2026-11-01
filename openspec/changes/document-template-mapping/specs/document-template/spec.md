# Spec Delta（v2）

## Purpose

定义文档格式模板的结构、校验、版本快照、作用域与后台维护方式。模板是 OCR 结果映射、核验展示与导出的统一字段契约（PRD §4.8；评审决议 R1–R3、R6 见 `proposal.md`）。

## ADDED Requirements

### Requirement: 模板结构

一份模板 SHALL 由有序的「分组」组成，每个分组包含有序的「项」，项为 KV 字段（`kind = field`）或表格（`kind = table`）。模板 MUST 包含 `code`、名称、描述与至少 1 个分组；每个分组 MUST 包含 `key`、名称、描述与至少 1 项；每张表格 MUST 包含至少 1 列。系统 SHALL 保留分组、项与列的配置顺序。

#### Scenario: 含 KV 字段与表格的模板导入成功

- **GIVEN** 模板文件包含分组「单据信息」（2 个 KV 字段）与分组「货品清单」（1 张 4 列的表格）
- **WHEN** 运维执行 `manage_templates.py import --file invoice.json --yes`
- **THEN** 模板创建成功并生成版本 1
- **AND** 读取该版本时，分组、字段与列的顺序与文件一致

#### Scenario: 空分组被拒绝

- **GIVEN** 模板文件中某个分组的 `items` 为空数组
- **WHEN** 运维执行 `validate` 或 `import`
- **THEN** 系统拒绝该模板，并报告错误路径 `groups[<i>].items`

### Requirement: 字段与列定义

每个 KV 字段与表格列 SHALL 只定义以下属性：`key`、显示名称 `name`、描述 `description`、数据类型 `type`，以及可选的 `required`。`type` MUST 为 `string`、`integer`、`decimal`、`amount` 之一，缺省为 `string`；`required` 缺省为 `false`。系统 SHALL 把描述作为大模型匹配与转换的主要依据。日期类字段 SHALL 使用 `string` 类型并原样保留。

#### Scenario: 非法数据类型

- **GIVEN** 模板中字段 `invoice_date` 的 `type` 为 `"date"`
- **WHEN** 运维执行 `validate`
- **THEN** 系统拒绝该模板，指出路径 `groups[0].items[1].type`
- **AND** 错误信息列出合法类型 `string / integer / decimal / amount`

#### Scenario: 缺省类型与必填

- **GIVEN** 模板中某字段未声明 `type` 与 `required`
- **WHEN** 模板导入成功
- **THEN** 该字段在版本快照中为 `type = string`、`required = false`

### Requirement: 键名、唯一性与上限校验

系统 MUST 在写库前完整校验模板，并一次返回全部错误及其路径。校验规则：

- 分组、字段、表格、列的 `key` MUST 匹配 `^[a-z][a-z0-9_]{0,63}$`；`code` MUST 匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`。
- 分组 key 在模板内唯一；字段 key 与表格 key 在同一分组内唯一（二者不得重名）；列 key 在同一表格内唯一。
- 分组 ≤ 20 个；字段与列合计 ≤ 200 个；表格 ≤ 10 张；`name` ≤ 100 字符；`description` ≤ 500 字符，模板级 `description` ≤ 1000 字符。

#### Scenario: 多处错误一次返回

- **GIVEN** 模板中存在重复的分组 key `document`，且某列 key 为 `Unit Price`
- **WHEN** 运维执行 `validate`
- **THEN** 系统同时报告两处错误及各自路径
- **AND** 不连接数据库、不写入任何数据

#### Scenario: 字段与表格同名

- **GIVEN** 同一分组内存在字段 `items` 与表格 `items`
- **WHEN** 运维执行 `import`
- **THEN** 系统拒绝导入并报告重名路径

### Requirement: 版本快照

系统 SHALL 为模板维护只增不改的版本快照。每次导入时，系统 MUST 计算规范化内容（名称、描述、分组）的 SHA-256：哈希变化时新增版本号并把模板的当前版本指向它；哈希未变时 MUST NOT 新增版本或修改任何数据。已存在的版本快照 MUST NOT 被修改或删除。

#### Scenario: 内容变化生成新版本

- **GIVEN** 模板 `system.invoice` 当前为版本 1
- **WHEN** 运维修改某字段描述后再次 `import`
- **THEN** 系统生成版本 2 并设为当前版本
- **AND** 版本 1 的快照内容保持不变

#### Scenario: 重复导入幂等

- **GIVEN** 模板 `system.invoice` 当前为版本 2
- **WHEN** 运维用相同文件再次 `import`
- **THEN** 系统报告「内容未变化」，不生成新版本、不写审计

### Requirement: 模板作用域与租户隔离

模板 SHALL 分为系统模板（`tenant_id` 为空，对所有租户只读可用）与租户模板（仅该租户可用）。对某个 OCR 任务可用的模板 MUST 限于系统模板与该任务所属租户的模板。同一作用域内未删除模板的 `code` MUST 唯一。

#### Scenario: 其他租户的模板不可见

- **GIVEN** 租户 A 有租户模板 T，用户属于租户 B
- **WHEN** 用户查询自己任务的模板选项
- **THEN** 结果不包含模板 T
- **AND** 用户以 T 的 ID 请求套用模板时返回 409 `TEMPLATE_UNAVAILABLE`

#### Scenario: 不同作用域允许同 code

- **GIVEN** 已存在系统模板 `invoice`
- **WHEN** 运维以 `--tenant-id 5` 导入 `code = invoice` 的模板
- **THEN** 导入成功，两个模板分别存在

### Requirement: 启用、停用与软删除

模板 SHALL 具有 `ENABLED` / `DISABLED` 状态，并支持软删除。停用或删除的模板 MUST NOT 参与新的自动匹配，也 MUST NOT 出现在模板选项中；但已引用其版本的映射结果 MUST 仍可读取、编辑、确认与导出。软删除后，同作用域内 MAY 重新导入相同 `code` 的新模板。

#### Scenario: 停用后历史结果仍可用

- **GIVEN** 任务 J 的当前结果来自模板 T 的版本 2
- **WHEN** 运维执行 `disable --id T`
- **THEN** 新任务的自动匹配不再选择 T
- **AND** 任务 J 的结果页仍按 T 版本 2 的结构展示，且可保存、确认与导出

### Requirement: 后台维护脚本

本期 SHALL 通过后台命令行脚本 `manage_templates.py` 维护模板，提供 `list`、`show`、`validate`、`import`、`export`、`enable`、`disable`、`delete`、`seed` 命令。写操作 MUST 在写库前完成校验，MUST 默认二次确认（`--yes` 跳过），`import` 与 `seed` MUST 支持 `--dry-run`。脚本 MUST NOT 输出数据库密码或其他凭据。每次实际写入 SHALL 记录审计（`template.created / versioned / enabled / disabled / deleted`，来源为 `cli`）。系统 MUST NOT 提供模板的 REST 写接口；模板管理界面不在本期范围（R1，FR-TEMPLATE-006，P1）。

`validate` MUST 不连接数据库；非法 import MUST 在数据库访问前失败。`--dry-run` 只保证无写入，MAY 连接数据库，不是离线校验。

#### Scenario: 试运行不写库

- **GIVEN** 一份合法的新模板文件
- **WHEN** 运维执行 `import --file po.json --dry-run`
- **THEN** 脚本输出「将创建模板 / 将生成版本 1」
- **AND** 数据库中没有新增模板、版本或审计记录

#### Scenario: 种子导入幂等

- **GIVEN** `templates_seed/` 下有 2 个系统模板文件（`billing_note.json`、`tax_invoice.json`），且已执行过一次 `seed`
- **WHEN** 运维再次执行 `seed --yes`
- **THEN** 2 个模板均报告「内容未变化」，不产生新版本

### Requirement: 模板版本只读查询

系统 SHALL 提供 `GET /api/v1/templates/versions/{version_id}` 返回用于预览/渲染的版本视图（名称、有序分组/字段/列），MUST 裁剪各层 description。内部不可变快照 MUST 保留完整 description 供模型匹配/转换，公开裁剪 MUST NOT 改变内部快照。系统版本对有效会话（含游客）可读；租户版本仅该租户成员可读，否则返回404；停用或删除的历史版本仍可读。

#### Scenario: 读取已停用模板的版本

- **GIVEN** 模板 T 已停用，版本 V 属于 T
- **WHEN** 已登录用户请求 `GET /api/v1/templates/versions/V`
- **THEN** 返回 200 与版本快照

#### Scenario: 跨租户读取被拒绝

- **GIVEN** 版本 V 属于租户 A 的模板
- **WHEN** 租户 B 的用户请求该版本
- **THEN** 返回 404
