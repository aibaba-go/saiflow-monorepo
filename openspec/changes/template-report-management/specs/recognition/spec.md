# recognition Spec Delta

## MODIFIED Requirements

### Requirement: FR-TEMPLATE-006 已发布的文档格式模板
系统 SHALL 保存文档格式模板及不可变版本，包含名称/识别说明、分组表头字段的 key/多语言名/类型/required/primary/说明及明细列/类型/required。已发布在本变更指成功生效；新匹配/转换 SHALL 仅使用当前租户有权、已生效、未停用未删除版本，并在应用时再检查。结果 SHALL 记录具体版本，后续修改不影响历史。SHALL 幂等预置 main templates_seed 的 Tax Invoice 与 Billing Note，显式授权全部四档套餐，内容不变不新增版本。配置管理见 template-management。

#### Scenario: AC-FR-TEMPLATE-006-01 预置模板
- **GIVEN** 新部署的系统
- **WHEN** 列出可选模板，并再次执行预置
- **THEN** 列出 Tax Invoice 与 Billing Note 各一个已发布版本；再次预置后版本数不变

#### Scenario: AC-FR-TEMPLATE-006-02 结果记录模板版本
- **GIVEN** 任务 J 按 Tax Invoice 版本 1 转换
- **WHEN** 之后发布了 Tax Invoice 版本 2
- **THEN** J 的结果仍标为版本 1，内容不变

#### Scenario: AC-FR-TEMPLATE-006-03 草稿与旧活跃版本
- **GIVEN** 模板 v1 已生效且授权，v2 仍为新草稿
- **WHEN** 新匹配或手动应用模板
- **THEN** 使用 v1，不使用 v2；首次仅草稿模板不进入候选

#### Scenario: AC-FR-TEMPLATE-006-04 应用时重新检查权限
- **GIVEN** U 曾取得候选 T，之后 T 停用或授权撤回
- **WHEN** U 直接提交自动/手动新转换请求，包括请求历史生效版本
- **THEN** 服务端拒绝新使用且原结果保留；历史业务定义仍可按数据可见范围读取

### Requirement: FR-OCR-019 大模型匹配模板
识别成功后系统 SHALL 用 ocr-settings 大模型在当前租户有权新使用、已生效且未停用未删除的候选中打匹配度，提供原始结果及每候选名称/识别特征/字段摘要；只有一个候选也打分。最高达到 70% SHALL 自动转换（FR-OCR-020）；无候选、低于 70%、自动转换缺主要字段，或大模型未配置/不可用 SHALL 使用自由格式（通用结果，FR-OCR-023），进入待核验且不作为错误提示。用户 SHALL 仍可更换有权生效模板或保留自由格式；候选打分不算应用使用，自动/手动应用均重新校验授权。

#### Scenario: AC-FR-OCR-019-01 自动匹配
- **GIVEN** 一张泰国增值税发票识别成功，大模型已配置，Tax Invoice 的匹配度为 92%，当前租户有权使用该生效模板
- **WHEN** 系统匹配模板
- **THEN** 匹配到 Tax Invoice，并自动开始转换，任务显示"模板匹配中"

#### Scenario: AC-FR-OCR-019-02 匹配不上时用自由格式
- **GIVEN** 一张送货单识别成功，有权的 Tax Invoice 与 Billing Note 的匹配度都低于 70%
- **WHEN** 匹配结束
- **THEN** 任务进入"待核验"，结果页按自由格式显示，没有错误提示；"更换模板"中可以选择 Tax Invoice 或 Billing Note

#### Scenario: AC-FR-OCR-019-03 自动转换缺少主要字段
- **GIVEN** 一张单据自动匹配到有权的 Billing Note（匹配度 85%）
- **WHEN** 自动转换完成，结果缺少 Billing Note 的主要字段（总金额）
- **THEN** 结果页按自由格式显示，没有"转换失败"的提示；"更换模板"中仍可以选择 Billing Note

#### Scenario: AC-FR-OCR-019-04 没有模板
- **GIVEN** 当前没有任何已发布的模板
- **WHEN** 一张单据识别成功
- **THEN** 不调用大模型做匹配，结果直接按自由格式显示

#### Scenario: AC-FR-OCR-019-05 只评分授权候选
- **GIVEN** 存在已生效的 A/B、未生效草稿 C、停用 D；当前租户仅有权用 A
- **WHEN** 匹配及打开更换模板
- **THEN** 只对 A 打分并供新应用，B/C/D 不提供给大模型或可选列表，只有一个 A 仍评分

#### Scenario: AC-FR-OCR-019-06 模型不可用或没有有权候选
- **GIVEN** 大模型未配置/不可用，或系统有模板但当前租户无有权候选
- **WHEN** OCR 完成
- **THEN** 直接使用通用结果进入待核验，无错误提示；可保留自由格式，有有权候选时仍可手动选择转换
