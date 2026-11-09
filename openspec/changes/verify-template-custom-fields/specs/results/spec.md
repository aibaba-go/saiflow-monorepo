# Spec Delta

## MODIFIED Requirements

### Requirement: FR-VERIFY-015 结构化结果的版本化修改
每个识别任务 SHALL 有一个"当前结果"，即其当前所用模板（或通用结果）下的最新版本。读取结果 SHALL 返回以下内容：
- 当前结构化数据与版本号；
- 所用模板版本及其字段定义（通用结果没有模板）；
- 缺失的必填字段；
- 正在进行或最近失败的模板转换。

有权修改的用户 SHALL 可以提交完整的结构化数据保存为草稿：
- 可以改字段值，增删表头字段（通用结果），增删明细行；模板结果还 SHALL 允许在已有分组中新增、修改和删除模板未定义的额外表头字段；
- 额外字段只属于当前结果，SHALL NOT 修改文档格式模板的字段定义或版本；
- 内容有变化时 SHALL 生成新版本，旧版本保留不变；
- 内容没有变化时 SHALL NOT 生成新版本。

提交 SHALL 带上所基于的版本号：不是当前版本时，SHALL 返回 409 `version_conflict`，不保存。

模板结果保存时，SHALL 按模板补齐缺失的字段（值为空），模板外的内容原样保留。新增额外字段的名称、值以及删除额外字段的结果 SHALL 在后续读取当前版本时保持一致；新增或删除额外字段 SHALL 按 FR-VERIFY-007 记录修改。

修改与确认本人提交的结果需要"核验与确认"权限，处理他人提交的结果需要"核验他人单据"权限（FR-SYS-002）。游客可以修改自己的结果。额外字段的编辑 SHALL 同样遵守 FR-VERIFY-006 的确认后锁定和 FR-VERIFY-009 的确认门控。

#### Scenario: AC-FR-VERIFY-015-01 保存草稿生成新版本
- **GIVEN** 任务 J 的当前结果为版本 2，发票号为 "IV-001"
- **WHEN** U 基于版本 2 把发票号改为 "IV-002" 并保存
- **THEN** 当前结果为版本 3，发票号 "IV-002"；版本 2 仍保留原值

#### Scenario: AC-FR-VERIFY-015-02 并发修改冲突
- **GIVEN** U 与 V 都基于版本 3 打开了 J
- **WHEN** V 先保存，U 随后基于版本 3 保存
- **THEN** U 收到 409 `version_conflict`，U 的修改未保存，当前结果为 V 保存的版本 4

#### Scenario: AC-FR-VERIFY-015-03 增删明细行
- **GIVEN** J 的货品明细有 3 行
- **WHEN** U 删除第 2 行并新增一行后保存
- **THEN** 当前结果的货品明细为 3 行，内容为保存后的内容

#### Scenario: AC-FR-VERIFY-015-04 权限
- **GIVEN** 组织 O 的成员 M 只有"核验与确认"
- **WHEN** M 保存本人提交的结果；以及保存他人提交的结果
- **THEN** 前者成功；后者被拒绝（看不到时为 404，看得到但无权时为 403）

#### Scenario: AC-FR-VERIFY-015-05 保存模板额外字段并重新读取
- **GIVEN** J 使用模板 T，当前版本为 2，已有 Document 分组，T 未定义 Remark 字段
- **WHEN** U 基于版本 2 在 Document 中新增 Remark，值为 "Pay next week"，保存后重新读取 J
- **THEN** 当前版本为 3，Document 包含 Remark 和原样的值；版本 2 不变；T 的定义和版本不变；修改记录包含该字段从空到 "Pay next week" 的改动

#### Scenario: AC-FR-VERIFY-015-06 删除额外字段与不变保存
- **GIVEN** J 的当前版本为 3，Document 含额外字段 Remark
- **WHEN** U 删除 Remark 并保存，再用保存返回的版本及相同内容再次保存
- **THEN** 第一次保存生成版本 4，重新读取时不含 Remark，模板字段仍被补齐，修改记录包含 Remark 的删除；第二次保存仍为版本 4

#### Scenario: AC-FR-VERIFY-015-07 额外字段不绕过锁定与必填门控
- **GIVEN** J 的模板必填 Date 为空，Document 中有额外字段 Remark，U 已注册且当前租户套餐有效
- **WHEN** U 保存 Remark 后确认；以及对另一个已确认或待复核的任务修改额外字段
- **THEN** 前者草稿可保存但确认返回 422 并指出 Date；后者返回 409，结果不变
