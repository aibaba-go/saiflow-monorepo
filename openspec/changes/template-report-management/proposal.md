# Proposal：模板管理与报表设计、展示

## Status

范围已确认，按负责人最新要求形成 delta specs 与 `plan.md`，属于 L 级新能力变更。模板配置和报表仍为 P1；D9 明确授权本次完整 P1 实施，不修改全产品 V1.0/P0 范围。本轮交付仅为规划产物，不编码、不执行生产操作、不调用付费服务、不提交、不归档。规格严格校验结果由本轮交付报告说明，不把尚未执行的业务/UI/部署测试写成通过。

D1–D7 保留；D8 新增样例优先入口，D9 明确实施授权与自主默认。原 Report Design 草案的“建议/待 Rn”内容已收敛至本次 delta specs 与下面的 Resolved Decisions；冲突时以最新决策及 SHALL/AC 为准。按 AI-WORKFLOW §5/§6 只写 specs + plan.md，不生成 design.md/tasks.md，不用 opsx apply。正式规格及 strict validate 完成前不启动代码实现。

## Why

负责人要求模板与报表全部落地，并在后续实施阶段部署至 `38.60.156.234`，持续进行全功能与 UI 测试、发现问题后修复和回归，中间不询问。模板应优先从样例 PDF/图片生成，手动新建和 JSON 结构导入作为辅助入口；报表从文档格式模板字段设计运营指标，预览、发布后在 PC 与 LINE 小程序展示。

来源：[PRD §4.8](../../../docs/10-product/PRD-SaiFlow.md#48-文档格式模板配置模块)、[PRD §4.7](../../../docs/10-product/PRD-SaiFlow.md#47-运营报表模块)、[EPIC-08](../../../docs/20-requirements/functional/EPIC-08-document-template-configuration.md)、[EPIC-07](../../../docs/20-requirements/functional/EPIC-07-operational-reporting.md)。迁移保留 FR-TEMPLATE-001..005/007 与 FR-REPORT-001..004 的追溯诉求，但不恢复旧 JSONPath、Cloud SQL 投影或 TextIn 私有解析模板配置。

## Existing Baseline

- [recognition](../../specs/recognition/spec.md) 已有 FR-TEMPLATE-006、FR-OCR-019/020/024；需要完整修改 006/019 的候选授权与生效条件，不能仅前端过滤。
- [schema.py](../../../services/api/app/ocr/templates/schema.py) 和 [template.py](../../../services/api/app/models/template.py) 支持 groups/items/columns，string/integer/decimal/amount/date、names en/th/zh、required、仅表头 primary 与金额 role；最大 20 组、200 字段及列、10 表。字段正本仍是代码，不另建字段 schema 文档。
- [tenancy](../../specs/tenancy/spec.md) 按当前租户和有效成员隔离；无 data_browse 只能处理本人单据；owner 全权限；本次增加 report_manage，不改变其他权限语义。
- [billing](../../specs/billing/spec.md) 保留 kinder/starter/intermediate/advance 档位、价格、扫描预占与退还规则。样例 OCR 按页正常计量，LLM 不另收费。
- [ResultVersion/OcrJob](../../../services/api/app/models/document.py) 保存 JSONB 结构化结果；正式报表不能仅看 confirmed_at，必须按 confirmed_version_id 精确关联正式结果及自身 mapping。
- [line-mini FR-SYS-056](../../specs/line-mini/spec.md) 报表页当前占位，本次替换为真实已发布报表，保留底部导航的组织/有效 Starter+/report_view 条件。
- `verify-template-custom-fields` 仅编辑单据额外字段，不改变共享模板，不把额外字段自动列为报表指标。本次不编辑任何其他 change。

## What Changes

### 模板管理

样例生成、手动新建、JSON 结构导入统一进入可逐行/逐列修改的编辑器；支持不完整草稿保存、独立生效、不可变内容版本、修订号并发 409、JSON 导出、删除保护、停用、归属及两种系统授权。样例原件和候选值分离对照，人工确认 required/primary/role；新样例不成为正式单据，敏感内容最长保留 7 天。

### 报表设计与展示

采用原生网格，多图表页面，PC 设计/展示、LINE 单列展示；组织有效 Starter+，owner/report_manage 管理，report_view 查看。完整实现 bar/line/pie/donut/metric/table；每图一个模板、一个指标，整页可多模板，单据或单张明细粒度；显式版本集合，稳定路径及同类型兼容，不自动跨路径映射或纳入新版。后端对有权限的正式业务 JSONB 安全提取、numeric 聚合并返回诊断；发布不可变配置快照，打开/手动刷新动态查询，授权内 CSV 导出，不缓存跨范围统计。

## Confirmed Decisions

### D1：组织模板管理可以授权成员

负责人选择“允许授权成员”：沿用现有角色机制，owner 默认可管理，也可通过“模板管理”权限授权组织成员新增、修改和删除本组织模板。成员在组织中创建的模板归组织，不归其个人。

模板使用授权不等于模板管理授权；平台创建且授权给租户使用的模板，不因使用授权而自动成为租户可修改的模板。平台管理员可跨租户管理模板配置，但不因此取得客户原件、OCR 载荷或业务数据（T2 已决）。

### D2：模板保存与生效分离

负责人于 2026-11-10 明确要求“模板可以保存，但只有生效后才可以使用，需要增加一个生效的操作”，随后要求将生效逻辑写入 D2。本决策替代此前的“保存即生效”；模板提供独立的“保存”“生效”操作，不新增审批流程。

- **保存**：保存编辑内容为可继续修改的草稿，不改变当前生效版本，不因每次保存而递增正式内容版本号。首次保存但尚未生效的模板不能用于正式匹配或转换；已有模板的新草稿同样不能替代其生效版本参与使用。
- **生效**：服务端重新校验模板结构、字段类型、必填及主要字段等配置；校验通过并生效成功后，形成不可变的内容版本，才允许在既有授权范围内使用。这里检查的是模板配置，不把样例中的具体字段值是否填写视为模板结构校验。
- **首次生效与版本递增**：首次生效为 v1；相对于当前生效版本存在有效内容修改时，再次生效创建下一版本，版本号加一。仅保存、取消、校验失败或重复生效相同内容，不增加正式内容版本号。
- **修改已生效模板**：修改内容先保存为新草稿，旧生效版本继续可用；新草稿生效成功后，后续新的匹配或转换使用新版。已有结果继续引用原模板版本，不重写历史单据、模板快照或已保存的报表版本范围（FR-TEMPLATE-006、D7）。
- **失败保护**：生效失败时保留已保存草稿，不替换或破坏原生效版本；失败反馈指出需要修正的配置。
- **授权与停用**：生效不等于授权，不改变 D1/D4 的归属与权限边界。停用或撤销授权禁止新匹配/转换；业务数据范围内已有结果及历史报表仍可使用原定义读取，不以历史版本绕过新使用校验（T1/T6/R3 已决）。

各创建入口统一进入编辑、保存草稿、预览检查与生效流程，保存和预览均不能替代生效。保存/生效必须携带修订号，过期请求 409；允许不完整草稿，生效完整校验。名称和结构属内容版本，授权独立，不增加内容版本（T4 已决）。

### D3：模板定义仅导入 JSON

负责人选择“JSON 模板文件”：复用现有模板 JSON 结构，导入后进入同一编辑页面检查、修改并保存。不新增 Excel 定义模板版式；导入填写好的 Excel 业务单据不属于本次模板定义导入。

D8 样例入口不等于新增定义文件格式。JSON 只导入结构，不信文件中的归属、权限、状态和版本；code 冲突返回 409，操作者可手动改 code 保存副本，不静默更新已有模板。支持结构 JSON 导出（T5 已决）。

### D4：个人模板与点名用户授权仅用于个人空间

负责人选择“仅个人空间”：个人创建及平台管理员单独授权给用户的模板，仅在该用户本人的个人租户中使用，不随用户加入组织或切换组织而成为组织可用模板。

组织单据使用本组织模板、平台授权给本组织的模板或按本组织套餐可用的模板。选中组织即面向该组织的有效成员；选中单个用户不等于选中其所属组织。

系统授权二选一：套餐精确多选 kinder/starter/intermediate/advance（不递归包含高档）；点名用户与组织多选（用户只在本人个人租户、组织只对有效成员）。游客不享有个人/点名用户管理能力，但可使用其有效 Kinder 被套餐授权的系统模板，仍受扫描配额约束。

### D5：删除与停用

负责人同意：任一版本已被应用转换，或仍被报表、复核配置引用，模板不得删除。仅作为匹配候选被打分不算使用；转换尝试即建立不可撤销的使用保护，不能因失败或后来删除结果释放“曾使用”保护。

已使用模板可停用，停止新使用，保留历史模板版本及记录。未被应用转换且不存在上述引用的模板可删除。删除与转换/报表/复核引用建立必须事务互斥，不能通过并发绕过保护。

### D6：报表采用原生网格看板

负责人同意“原生网格看板”：报表页面包含多张图表卡片，PC 保留设计布局，LINE 每行一张图表。

设计器采用顶部操作区、左侧组件区、中间布局区、右侧配置区；添加图表、拖动、调整宽高，选中后配置数据与样式；顶部提供名称、保存草稿、预览、发布。发布展示不显示编辑工具。LINE 使用同一发布定义，按 PC y、x、稳定卡片标识排序，不另维护移动端定义。

React-Grid-Layout 与 ECharts 为实施候选，须核验当前 React 兼容、许可、尺寸和包体积；选择原生网格不代表未验证依赖已安装。复制卡片、撤销重做、多轴、多指标、跨图联动钻取不属于本次授权。

### D7：模板自动字段映射与受控 SQL 聚合

负责人要求对 JSONB 解析映射与 SQL 分组统计给出建议，并确认“按此方案更新设计文档”。保留以下方向：

- `result_versions.structured` JSONB 为业务正本；遍历模板版本 groups/items/columns 自动推导字段目录，用户选字段名称而非手填路径，不另维护手工 schema。
- 后端将字段、分组、聚合、筛选编译为受控参数化 SQL；先筛选有权访问的正式确认结果，再在 PostgreSQL 内提取/安全转换/分组聚合。浏览器只接收图表结果和必要诊断，不接全部 JSON 自行统计，不提交任意 SQL。
- 单据粒度与单张明细表粒度分开；表头可作为明细分组/日期筛选，指标只能取明细列；不重复累计单据合计，不跨模板 JOIN，不同时展开多张明细表。
- 显式选择单个或多个模板版本；按结果自身绑定解析；稳定路径和相同类型兼容，业务含义由设计者显式确认，不按同名猜迁移，不自动含新版。
- 类型转换保留有效值和诊断；非法数值/日期/超两位 amount 排除且给出数量与原因，空值不当 0；日期佛历/DMY、THB 标记/千分位沿用一致标准化规则，不改历史 JSON，不混加币种/单位，不取绝对值。
- 首期按需查询 JSONB；投影表、预聚合表、物化视图仅为后续候选，本次不创建。SQL 编译器/转换函数/索引及执行计划验证见 plan.md。

#### D7.1 正式结果与字段路径

`ocr_jobs.confirmed_version_id = result_versions.id` 且 `result_versions.job_id = ocr_jobs.id`；仅 `review_status = 'CONFIRMED' AND official_at IS NOT NULL` 入选。结果通过自身 `mapping_id` 关联 `template_mappings`，再检查 mapping 的 job_id 一致，按自身 template_version_id 及所选模板版本过滤。不回退 current/is_current/current_mapping_id；无 mapping 的通用结果不推断纳入。

普通字段路径 `[group_key, field_key]`；明细数组 `[group_key, table_key]`，展开后取 column_key。服务端从版本目录派生并回查白名单，路径/筛选值/版本集合绑定为参数，聚合与日期粒度仅选择允许项；租户/user/data_browse 来自认证上下文，不信浏览器 `can_browse_all`。

#### D7.2 SQL 说明示例（保留，未执行）

以下保留原供应商金额汇总说明，仅接受规范两位以内金额；不是最终编译器或已验证 SQL。正式实现还须统一千分位、THB 与日期标准化、完整诊断、所选多版本、混合单位检查、10 秒 statement_timeout 与 1000 groups 超限处理。

```sql
WITH extracted AS (
    SELECT
        r.structured #>> ARRAY['seller', 'name'] AS supplier,
        r.structured #>> ARRAY['summary', 'net_total'] AS raw_amount
    FROM ocr_jobs j
    JOIN result_versions r
      ON r.id = j.confirmed_version_id AND r.job_id = j.id
    JOIN template_mappings m
      ON m.id = r.mapping_id AND m.job_id = j.id
    WHERE j.tenant_id = :tenant_id
      AND j.review_status = 'CONFIRMED'
      AND j.official_at IS NOT NULL
      AND m.template_version_id = :template_version_id
      AND (:can_browse_all OR j.created_by_user_id = :user_id)
), typed AS (
    SELECT supplier,
        CASE
            WHEN raw_amount ~ '^-?[0-9]+([.][0-9]{1,2})?$'
             AND pg_input_is_valid(raw_amount, 'numeric')
            THEN raw_amount::numeric
        END AS amount
    FROM extracted
)
SELECT supplier, SUM(amount) AS total_amount
FROM typed
WHERE amount IS NOT NULL
GROUP BY supplier;
```

单一 template_version_id 与常量路径是说明性简化，不限制正式多版本；CASE 保护转换，不依赖 WHERE 先求值。示例省略独立诊断及日期筛选，不能只过滤后宣称完整。实际 PostgreSQL 版本与 pg_input_is_valid 的软错误支持必须在隔离数据库验证。

单张明细从已经受限的正式结果 b 展开：

```sql
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(b.structured #> ARRAY['goods', 'line_items']) = 'array'
        THEN b.structured #> ARRAY['goods', 'line_items']
        ELSE '[]'::jsonb
    END
) AS item(row_data)
```

非数组/非对象行给结构诊断，空数组不制造行，非全空对象明细才计数。单据指标不因展开重复；不同单据同金额都应计入，不用 SUM(DISTINCT) 修补错误粒度。

技术参考：[PostgreSQL JSON](https://www.postgresql.org/docs/17/functions-json.html)、[输入类型校验](https://www.postgresql.org/docs/17/functions-info.html)。原公开文档核对不代表目标 SQL 或数据库已测试。

### D8：样例 PDF/图片生成是主流程

优先入口为上传样例 PDF/PNG/JPEG，经服务端现有 OCR 与大模型配置生成候选定义；也可从本人当前可访问的已有 OCR 结果生成。手动新建、结构 JSON 导入为辅助入口，全部进入同一编辑器和保存/生效流程。

新上传样例沿用真实已有格式、20 MB 与 PDF 1–50 页限制，需要 template_manage + upload_ocr 和现扫描配额；OCR 按页正常预占/结算，失败/取消退还 OCR 预占，LLM 不另收费。仅重试定义生成而复用已有 OCR 不重复扣扫描；OCR 重试遵循现有新任务规则。

原件/样例值与候选结构分离对照，不固化示例金额、供应商或其他业务值；required/primary/role 默认待人工确认，未确认禁止生效。失败/取消不得留下正式模板；只有操作者明确保存才生成草稿。专用样例不进入正式单据、历史业务列表或正式报表；新样例敏感原件、载荷及候选值最长保留 7 天且可主动删除，不影响已有业务结果自身保留策略。LLM 把单据内容视为不可信数据，不执行任意网络、代码或单据中的指令。

### D9：本次 P1 实施授权与自主默认

负责人最新要求授权后续完整实现、部署 `38.60.156.234` 及全功能/UI 循环修复回归，中间不询问；以下默认决策可直接执行，但不授权无关功能、Git 提交/推送、改权限系统配置或手改生成 skills。本轮仍仅规划，不实际连接服务器或调用外部付费服务。

检查点以 plan 中的自动门禁与证据审阅执行，不反复确认已决问题；若遇凭据、权限拒绝、PDPA 未获批准或隔离环境缺失，停止对应外部/生产动作，继续可安全完成的工作并明确阻塞，不绕过保护、不冒充通过。后续只对指定环境按既有部署流程操作，先备份、验证迁移和回滚路径，再切换并反复验收；生产不清表、不使用测试数据库 fixture、不为 UI 演示生成无关客户业务数据。

## Resolved Decisions（替代 Open Questions）

| 原问题 | 已确认默认决策 |
|---|---|
| T1/T6 历史与新使用 | 业务范围内可读历史模板定义/结果；停用、撤权、改档阻止新使用，但不破坏既有报表历史统计；组织套餐到期仍遵守报表有效 Starter+ 入口，不因模板历史读取解除套餐门槛。 |
| T2 平台管理 | admin 可跨租户管理模板/组织报表配置，无客户真实原件/载荷/统计预览权限；配置预览仅合成数据。 |
| T4 草稿与版本 | 不完整草稿可存；完整服务端生效校验；修订号 409；名称/结构计内容，授权独立；首次 v1、有效内容生效 +1、相同内容不增。 |
| T5 JSON | 结构导入/导出；忽略文件权限/归属/版本，操作者确定目标；code 冲突 409，手改副本，不覆盖。 |
| T7 端与 key | PC 个人/组织管理、admin 跨租户配置；LINE 不提供模板设计器；改 key 是新内容版本，不改历史或自动映射报表。 |
| R1 主体 | 报表仅有效 Starter+ 组织；owner/report_manage 可设计、保存、预览、发布、撤销发布、删除；report_view 查看；平台 admin 只管配置。 |
| R2 组合 | 每图一个模板/一个指标，页面可多模板；单据/单张明细两种 grain，不 JOIN。 |
| R3 版本 | 显式单/多版本，同路径同类型且设计者确认含义，不自动跨路径或包含新版本；保留历史授权定义用于已有报表。 |
| R4 图表与配置 | bar/line/pie/donut/metric/table 全实现；sum/avg/min/max/count；一个分类字段生成多系列；day/month/year，期间两端含边界，默认本年，可固定期间及整页覆盖；标题/颜色/图例/轴/标签，显示精度 0–6，单位/币种明示，可按模板分类币种/单位字段分组；标题不自动翻译。 |
| R5 无效与混合 | count 单据/非全空明细，avg 仅有效值；空不作 0，未知分类独立项，空时间桶 null；非法数值/日期、超两位 amount 排除并诊断；混合币种/单位未分开则拒绝汇总；pie/donut 在配置及查询发现负值拒绝，不取绝对值。 |
| R6 数据范围 | report_view 不含 data_browse 时仅本人统计；预览、诊断、CSV 同范围，不共享跨范围缓存。 |
| R7 生命周期 | 不完整 draft 可保存；离页提醒、并发 409；发布完整校验，不合法整页拒绝且旧发布保留；不可变配置快照，撤销发布后不可查看，删除保留必要审计。数据打开/手动刷新查询，不存固定统计快照。 |
| R8 LINE | 按 PC 从上到下、同排从左到右、标识稳定排序，全宽单列。 |
| R9 边界 | 授权内 CSV 聚合导出（另需现有 export 权限）；无公开共享、联动钻取、自动刷新、共享缓存、投影/预聚合；10 秒 statement 超时、最多 1000 groups、30 cards/page，明确错误而非截断。 |

## Capabilities

### New Capabilities

- `template-management`：FR-TEMPLATE-001..005/007 迁移，008–014 新增样例、归属/授权、删除保护、JSON、并发、生效版本及样例隐私安全。
- `reporting`：FR-REPORT-001..004 保留诉求，005–018 新增设计、版本目录、正式数据、粒度、聚合、期间、精度诊断、单位、样式、生命周期、刷新、CSV、限制与跨端布局。

### Modified Capabilities

- `recognition`：FR-TEMPLATE-006、FR-OCR-019 完整 block，保留既有场景，授权候选取代全部模板；手动/自动新使用都服务端检查。
- `tenancy`：完整修改 FR-SYS-002 增加第 14 个权限点，新增 FR-SYS-139 的 report_manage 管理语义，保留默认角色和数据范围。
- `line-mini`：完整修改 FR-SYS-056 替换报表占位，保留其他底部导航行为。
- `web-pc`：新增 FR-SYS-140 模板入口和 FR-SYS-141 报表设计/展示入口。
- `web-admin`：新增 FR-SYS-142 模板配置和 FR-SYS-143 组织报表配置管理。

已检查 openspec 及 docs 的 FR-SYS 编号，当前最大 138，本次使用 139–143，无复用冲突。billing 档位、价格、计量契约不改。

## Impact

后端扩展模板实体、草稿/生效/授权与引用保护，新样例实体及 worker、报表实体/路由/服务/受控 SQL；前端纯编辑器和图表 renderer 共享，业务 context 留各应用，API-client 从 OpenAPI 生成。计划迁移 0014（模板/样例）与 0015（报表），主会话统一处理 main/__init__ 注册。实施细节和逐项 FR/AC 测试映射见 [plan.md](plan.md)。

继承 NFR-SEC-002/003/004/005/007/009/010/012、NFR-DATA-004/005/006、STD-005/006/008；专用样例可删除且最长 7 天，与正式不可变 OCR 载荷分开存储，不能向原业务载荷保护开后门。实体层/术语和迁移链接的产品文档同步在后续实施收尾处理，本轮不编辑 docs 或配置，不手写第二份 API 契约。

## Non-goals

- 不重写历史单据或模板版本，不自动合并个人与组织数据，不自动迁移跨路径字段。
- 不恢复 JSONPath、任意 SQL/脚本/表达式/网络执行，不引入完整 BI 服务。
- 不实现 Excel 业务导入、界面直接业务录入、ERP 集成、多指标/多轴、卡片复制/撤销重做、公开链接、联动钻取、自动刷新或共享统计缓存。
- 不新增投影表、预聚合表、物化视图、跨模板 JOIN 或多明细笛卡尔展开。
- 不修改其他 change、AGENTS、权限设置/config 或生成 skills；不自动提交/推送。本轮不实施、部署、归档；后续指定服务器部署授权仅按 D9 和 plan 安全门禁生效。

## Handoff

本轮编写 proposal、七份能力 delta specs 与 checkbox plan，并运行 `openspec validate template-report-management --strict`。业务单测、DB 集成、浏览器/UI、真实 OCR/LLM 与部署均待实施验证；CLI 的 design/tasks 未完成属于仓库预期，不补重复文件，不运行 opsx apply。
