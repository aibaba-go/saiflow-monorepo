# reporting Spec Delta

## Purpose

让有效 Starter 及以上组织的授权人员按文档格式模板字段设计、预览和发布运营报表，并在 PC 与 LINE 小程序查看同一配置下动态计算的正式业务统计，保证版本含义、数据粒度、精度、异常诊断与租户数据范围一致且可审计。

## ADDED Requirements

### Requirement: FR-REPORT-001 运营报表访问
报表 SHALL 仅对启用组织的有效 Starter/Intermediate/Advance 订阅开放；report_view 有效成员及 owner SHALL 可访问已发布报表列表和详情，个人/游客不开放。直接请求 SHALL 执行与入口相同的套餐/权限校验；report_manage 不自动赋予 report_view。

#### Scenario: AC-FR-REPORT-001-01 管理层访问报表
- **GIVEN** 组织 O 有有效 Starter，U 是持有 report_view 的有效成员
- **WHEN** U 打开运营报表入口
- **THEN** 显示 O 的已发布报表列表并可查看，不显示其他组织报表或未发布草稿

#### Scenario: AC-FR-REPORT-001-02 入口与直接请求一致
- **GIVEN** 个人租户、游客、套餐过期组织或无 report_view 成员
- **WHEN** 打开菜单或直接请求已发布统计
- **THEN** 菜单不提供查看入口，请求被拒绝；不返回统计数据

### Requirement: FR-REPORT-002 已配置指标与统计期间
展示 SHALL 使用设计者发布的指标、图表及样式，不自行假设默认业务指标；SHALL 显示实际统计期间、模板及显式版本范围、粒度、单位/币种、数据可见范围与诊断，区分无数据、排除值、字段配置错误及查询失败。

#### Scenario: AC-FR-REPORT-002-01 展示指标及实际范围
- **GIVEN** 已发布报表按模板 v1 的金额字段统计本年
- **WHEN** 有权用户打开
- **THEN** 显示配置指标、本年起止日期、v1、单据粒度、明示币种/单位及本人或全组织范围，无数据不显示伪造数值

### Requirement: FR-REPORT-003 授权数据范围
所有统计、预览、诊断及 CSV SHALL 服从当前租户有效成员和业务数据范围；无 data_browse 时只统计本人提交单据。report_view/report_manage、模板授权或平台配置管理 SHALL NOT 扩大业务数据范围；平台 admin SHALL 不得预览客户真实统计；SHALL 不共享跨范围缓存。

#### Scenario: AC-FR-REPORT-003-01 授权范围限制
- **GIVEN** U 仅可访问组织 A，本人有正式单据，A 另有他人单据，B 也有单据
- **WHEN** 无 data_browse 的 U 查看、预览及导出报表
- **THEN** 结果和诊断只来自 U 在 A 的单据，不包含 A 他人或 B 数据；直接请求 B 返回 404

#### Scenario: AC-FR-REPORT-003-02 owner 统计不得共享给普通成员
- **GIVEN** owner 查询过全组织统计，M 只有 report_view 而无 data_browse
- **WHEN** M 打开相同报表及期间
- **THEN** 重新按 M 本人范围查询，不复用 owner 的结果，显示本人数据范围

#### Scenario: AC-FR-REPORT-003-03 平台 admin 配置不授予预览
- **GIVEN** 平台 admin 正在管理 O 的报表配置
- **WHEN** 请求真实统计或 CSV，及打开配置效果预览
- **THEN** 真实统计/导出被拒绝，效果预览仅使用明确标识的合成数据

### Requirement: FR-REPORT-004 报表状态及访问审计
系统 SHALL 对创建/保存、发布/撤销发布、删除追加状态审计，对展示、设计预览、手动刷新及 CSV 访问记录访问者、租户、报表/发布版本、时间、类型和结果（含拒绝/失败）；SHALL 不记录客户原始值、SQL 参数中的敏感内容或凭据。

#### Scenario: AC-FR-REPORT-004-01 记录报表访问
- **GIVEN** U 打开一份运营报表并成功加载
- **WHEN** 查询操作日志
- **THEN** 日志包含 U、租户、报表及发布标识、访问时间与成功结果

#### Scenario: AC-FR-REPORT-004-02 状态与失败访问
- **GIVEN** 管理者保存/发布/撤销发布，另一查询超时
- **WHEN** 查询日志
- **THEN** 各操作和失败访问均可追溯，但不含敏感单据值或任意 SQL 文本

### Requirement: FR-REPORT-005 PC 报表设计与管理
有效 Starter+ 组织的 owner/report_manage 成员 SHALL 可在 PC 创建、设计、保存、预览、发布、撤销发布和删除本组织报表。设计器 SHALL 提供顶部操作、左侧图表组件、可拖动/缩放网格及右侧数据/样式配置；SHALL 完整支持 bar/line/pie/donut/metric/table，每图一个指标，允许添加/删除卡片。

#### Scenario: AC-FR-REPORT-005-01 全类型设计
- **GIVEN** U 有 report_manage 且组织订阅有效
- **WHEN** 分别添加六种图表，修改数据/样式、拖动/缩放并保存
- **THEN** 六种类型均可配置，重开后配置与布局一致；不因实现未完成将任一种保留为占位

#### Scenario: AC-FR-REPORT-005-02 管理与查看分离
- **GIVEN** M 仅有 report_view，N 仅有 report_manage
- **WHEN** M 提交发布请求，N 进行草稿预览和尝试已发布查看
- **THEN** M 无管理权；N 可预览本人数据范围的草稿，但不因管理权自动获得已发布查看权

### Requirement: FR-REPORT-006 派生字段目录与显式版本
每图 SHALL 绑定一个模板及显式单/多版本集合，整页可多模板。字段目录 SHALL 从版本定义派生，引用稳定分组/字段/表/列路径并回查类型；多版本只允许同路径同类型，含义须设计者显式确认。SHALL 不按同名跨路径映射、不含新版本、不接纳模板外临时字段。已有报表历史定义读取 SHALL 不因模板撤权/停用失效，新绑定仍需新使用授权。

#### Scenario: AC-FR-REPORT-006-01 单图单模板与版本集合
- **GIVEN** 页面有模板 A v1/v2 图和模板 B v3 图，设计者确认 A 的同路径同类型含义一致
- **WHEN** 发布，随后 A 生效 v3
- **THEN** 两图可共存，A 图只统计 v1/v2，v3 不自动纳入，不能在一张图跨模板关联

#### Scenario: AC-FR-REPORT-006-02 类型及路径不兼容
- **GIVEN** v1 summary.total 为 amount，v2 改为 string 或移到 totals.total
- **WHEN** 尝试把两个版本纳入同图，或伪造路径/类型/临时字段
- **THEN** 服务端拒绝并指出受影响图表及字段，不按同名猜迁移或自动修复历史 JSON

#### Scenario: AC-FR-REPORT-006-03 历史授权延续但禁止新绑定
- **GIVEN** 已发布图表已绑定授权时的系统模板 v1
- **WHEN** 模板停用或撤权后打开该图，并尝试创建新的同模板图或增加未绑定版本
- **THEN** 历史图在业务/报表权限内仍可统计，新增绑定被拒绝；只读旧定义不授予新使用权

### Requirement: FR-REPORT-007 正式业务数据精确选择
报表 SHALL 仅统计 review_status 为 CONFIRMED 且 official_at 非空的单据，按 confirmed_version_id 精确关联结果并验证结果 job_id 一致，再按该结果自身 mapping 及其 job_id 一致取实际 template_version_id。每单据只取其正式结果；无正式结果 SHALL 不回退 current。通用结果、OCR 原载荷、样例及其他历史结果 SHALL 不纳入模板报表。

#### Scenario: AC-FR-REPORT-007-01 待复核及草稿排除
- **GIVEN** A 已最终复核，B 仅 confirmed_at 非空但待复核，C 无正式版本却有 current 草稿
- **WHEN** 查询运营报表
- **THEN** 仅 A 纳入，B/C 排除，不回退草稿或累计旧结果

#### Scenario: AC-FR-REPORT-007-02 关联一致与自身 mapping
- **GIVEN** A 的 confirmed_version_id 错指其他 job，B 结果 mapping 属于另一 job，C 的 current_mapping 与正式结果 mapping 不同
- **WHEN** 查询
- **THEN** A/B 不纳入，C 仅按正式结果自身 mapping 的模板版本解析；不能读取另一个 job 的值

### Requirement: FR-REPORT-008 单据或单张明细粒度
数据粒度 SHALL 为单据或单张明细表；单据每正式结果一行，明细仅展开选定表的对象行，表头可作分组/日期筛选而指标仅明细列。SHALL 不 JOIN 模板或展开多张明细，不重复累计表头金额，不用 SUM(DISTINCT) 掩盖重复；非数组/非对象结构 SHALL 诊断，空表不制造行。

#### Scenario: AC-FR-REPORT-008-01 表头不重复求和
- **GIVEN** 两张单据总额都为 1000，各有两条 600/400 明细
- **WHEN** 单据 sum 总额，以及明细 sum 行金额按表头供应商分组
- **THEN** 单据总额 2000，明细总额也为 2000；明细不能选表头总额作指标，不能 DISTINCT 丢掉相同金额单据

#### Scenario: AC-FR-REPORT-008-02 异常及空明细
- **GIVEN** 所选表分别为空数组、非数组、含非对象行及全空对象行
- **WHEN** 明细查询
- **THEN** 空表不生成行，结构异常返回同权限范围诊断，非对象与全空行不计数，不展开第二张表

### Requirement: FR-REPORT-009 聚合与多系列
每图 SHALL 仅一个指标，支持 sum/avg/min/max/count；非 count 指标仅目录中 integer/decimal/amount，count 计符合筛选的正式单据或所选表非全空有效对象明细。avg SHALL 仅以有效数值为分母，空值不作 0；多系列 SHALL 只按该模板一个分类字段生成，不引入多指标/多轴/任意公式。

#### Scenario: AC-FR-REPORT-009-01 数值与计数
- **GIVEN** 单据指标为 10、20、空、非法文字；明细有两个非全空对象及一个全空对象
- **WHEN** 查询五种聚合和明细 count
- **THEN** sum=30、avg=15、min=10、max=20，单据 count=4（不因无数值排除有效单据），明细 count=2；数值非法值有诊断

#### Scenario: AC-FR-REPORT-009-02 分类多系列与类型校验
- **GIVEN** 模板包含供应商分类、date 日期及 amount 金额
- **WHEN** 配置按日期和供应商分类的多系列；或将 string 指标求和/添加第二指标
- **THEN** 前者用同模板一个分类字段形成系列，后者服务端拒绝并定位错误

### Requirement: FR-REPORT-010 日期期间与整页覆盖
时间轴/时间筛选 SHALL 只使用模板 date 字段，粒度 day/month/year，起止日期均包含边界，不作日期时区偏移；默认本年（泰国当前年份），可配置固定期间，整页日期覆盖 SHALL 一致作用于各图已配置 date 字段，无 date 图明确标为不适用。非法日期及缺失日期 SHALL 排除并诊断；起止倒置 SHALL 拒绝。

#### Scenario: AC-FR-REPORT-010-01 默认与边界
- **GIVEN** 当前泰国年份为 2026，图表有 date 字段
- **WHEN** 首次查询，或设固定 2026-01-01 至 2026-12-31
- **THEN** 默认本年，两端日期都计入，day/month/year 按业务日期分桶，不以 confirmed_at 替代选定字段

#### Scenario: AC-FR-REPORT-010-02 整页覆盖及不适用
- **GIVEN** 页面两图各配置自己的 date 字段，第三图无 date 字段
- **WHEN** 应用整页期间，或提交结束早于开始
- **THEN** 两图按相同期间覆盖，第三图明确显示不适用而不伪称已过滤；倒置期间拒绝

### Requirement: FR-REPORT-011 安全转换、精度与诊断
JSONB SHALL 由服务端受控参数化查询安全转换并在数据库以 numeric 聚合，不用浮点、不改历史；沿用千分位、THB 标记及佛历/DMY 日期规则。非法数值/日历日期、超两位 amount SHALL 排除，返回同授权/筛选范围的 count/reasons；空不当 0，未知分类独立项，空时间桶为 null 不补 0。任意 SQL/路径/运算符 SHALL 拒绝。

#### Scenario: AC-FR-REPORT-011-01 精确金额及历史格式
- **GIVEN** 数值 0.10、0.20、฿ 1,234.50、THB 2,000.00、บาท 10.00，日期 01/10/2569
- **WHEN** 查询并汇总，随后读取原 JSON
- **THEN** 数值聚合为精确 3244.80，日期解析为 2026-10-01；原 JSON 未被改写，不经浮点累计

#### Scenario: AC-FR-REPORT-011-02 排除与有效平均
- **GIVEN** amount 为 10.00、空、12.345、约一万，另有日期 31/02/2026
- **WHEN** 统计金额及日期图
- **THEN** 有效金额只有 10.00，avg=10.00，超精度/非法金额/非法日期被排除并给出数量与原因；空值不作 0

#### Scenario: AC-FR-REPORT-011-03 未知分类与空时间桶
- **GIVEN** 有效指标对应缺失分类，本年 2 月没有符合数据
- **WHEN** 查询分类及按月时间图
- **THEN** 缺失分类显示独立未知项，2 月桶的无数值为 null，不伪造为零

#### Scenario: AC-FR-REPORT-011-04 SQL 注入与权限参数伪造
- **GIVEN** 客户端提交任意 SQL、未授权路径或 can_browse_all=true
- **WHEN** 查询统计
- **THEN** 任意 SQL/路径被拒绝，权限标记不被采用，所有提取和诊断只在服务端认证范围内执行

### Requirement: FR-REPORT-012 币种单位与负值
设计 SHALL 明示指标币种/单位，可绑定模板分类币种/单位字段并分组；有混合币种/单位且未按两者分开汇总 SHALL 拒绝，不转换或静默混加。bar/line/metric/table SHALL 保留负值；pie/donut SHALL 在配置/预览及查询发现负值时拒绝，不取绝对值、不静默隐藏。

#### Scenario: AC-FR-REPORT-012-01 混合单位阻止汇总
- **GIVEN** 数据含 THB/USD，或数量 kg/pcs，已绑定币种/单位分类字段
- **WHEN** 不分单位求和，以及改为按币种/单位分组
- **THEN** 前者明确拒绝，后者分别给出各组及标签；固定标注 THB 不能掩盖绑定字段中的 USD

#### Scenario: AC-FR-REPORT-012-02 饼环负值拒绝
- **GIVEN** 正式指标含负值 -20 与正值 100
- **WHEN** 配置/预览 pie/donut，或已发布后新增负值再次查询
- **THEN** 配置/预览及查询均明确拒绝该比例图；切 bar/line 时可显示 -20，不取绝对值

### Requirement: FR-REPORT-013 图表样式配置
设计器 SHALL 支持图表标题、颜色、图例、坐标轴、数值标签（对适用图型）、显示精度 0–6 与单位/币种；显示舍入 SHALL 不改变后台聚合值。报表标题 SHALL 由用户输入且不自动翻译；界面操作/错误和模板名称 SHALL 沿用各端语言及默认名称回退。

#### Scenario: AC-FR-REPORT-013-01 样式与精度
- **GIVEN** 聚合值为 1.234567，设计者设精度 2 和 THB，并配置标题/颜色/图例/轴/标签
- **WHEN** 预览并发布查看，随后读取查询结果
- **THEN** 展示 1.23 THB 和已配置样式，查询值仍为 1.234567；精度 -1 或 7 被拒绝

#### Scenario: AC-FR-REPORT-013-02 切语言不翻译业务标题
- **GIVEN** 报表标题为用户输入泰文，字段只有默认名称和 en 名称
- **WHEN** PC/LINE 切中文，admin 切英文
- **THEN** 各端操作文字按现有语言范围显示，业务标题保持原文，缺少字段译名时回退默认名称

### Requirement: FR-REPORT-014 草稿、预览与发布生命周期
报表 SHALL 允许不完整草稿保存并标记问题；预览不发布且服从业务范围。发布 SHALL 完整校验权限、模板版本、字段/类型、期间、布局/数量与样式配置合法性，任一卡不合法整页拒绝并保留旧发布；真实数据混合单位/负值 SHALL 在有权预览及查询时检查，不授予 admin 真实统计权。成功 SHALL 建立不可变配置快照，新草稿不改旧发布；保存/发布/撤销/删除 SHALL 修订号并发 409，离页 SHALL 提醒未保存改动。

#### Scenario: AC-FR-REPORT-014-01 不完整草稿与失败保护
- **GIVEN** 页面已有有效发布 P1，新草稿有未选指标的卡片
- **WHEN** 保存草稿并尝试发布
- **THEN** 草稿可恢复且标记问题，发布整页拒绝并定位卡片，PC/LINE 仍使用 P1

#### Scenario: AC-FR-REPORT-014-02 不可变发布及撤销删除
- **GIVEN** 管理者完成有效草稿
- **WHEN** 发布 P2，再编辑草稿、撤销发布并删除报表
- **THEN** 编辑不改 P2，撤销后已发布访问不可用；删除后列表/详情不可用，必要状态/访问审计保留，不删业务单据

#### Scenario: AC-FR-REPORT-014-03 并发与离页
- **GIVEN** A、B 读同修订，A 已保存；B 有未保存改动
- **WHEN** B 保存/发布/撤销/删除，或离开编辑页
- **THEN** 旧修订请求 409 而不覆盖 A；离页提示，取消离页时保留编辑内容

### Requirement: FR-REPORT-015 动态查询与手动刷新
发布 SHALL 仅固定不可变配置而非数据快照；打开及手动刷新 SHALL 按当前有权正式数据重新查询，显示实际期间和查询状态。SHALL 不自动刷新、不做共享统计缓存；刷新失败 SHALL 明确标识失败/旧数据，不把旧数据冒充已刷新。

#### Scenario: AC-FR-REPORT-015-01 动态数据而非固定快照
- **GIVEN** 发布时有两张正式单据，之后一张完成最终复核
- **WHEN** 用户打开或手动刷新
- **THEN** 新正式单据按显式模板版本及期间加入；未操作时不后台定时刷新

#### Scenario: AC-FR-REPORT-015-02 刷新错误
- **GIVEN** 页面已显示一次成功数据
- **WHEN** 手动刷新超时
- **THEN** 显示失败和可重试操作；如保留旧图则标识旧数据，不声称刷新成功

### Requirement: FR-REPORT-016 授权内聚合 CSV 导出
持有 report_view 及现有 export 权限的用户 SHALL 可将已发布报表聚合结果导出 CSV，范围/期间/版本/诊断与查看一致；SHALL 不导出原始单据或无权数据。配置及查询限制 SHALL 同样适用，超时/超限不输出伪完整文件；文本单元 SHALL 防止电子表格公式执行。

与 FR-ENTRY-015 一致，为在不带会话的下载器中打开（Android 的 LINE 内置浏览器），用户 SHALL 可为某张已发布卡片的 CSV 换取 60 秒有效的下载凭证，凭证签名绑定租户、报表、卡片、期间覆盖、用户与会话，且不在服务端存储；兑换时 SHALL 重新检查会话有效、套餐门槛及 report_view/export 权限并按当前正式数据重新查询。凭证过期、被篡改、会话结束或权限不再满足时 SHALL 返回 404。

#### Scenario: AC-FR-REPORT-016-01 同范围导出
- **GIVEN** U 有 report_view/export 但无 data_browse，页面使用整页期间覆盖
- **WHEN** 导出 CSV
- **THEN** 文件仅含 U 的同期间聚合、分组、模板版本、单位及诊断，不含他人原始记录；无 export 时拒绝

#### Scenario: AC-FR-REPORT-016-02 CSV 安全
- **GIVEN** 分类名称以 =、+、-、@ 开始，另一图查询超过限制
- **WHEN** 导出
- **THEN** 文本分类被安全转义而不执行公式，数值仍保留正确符号；超限图使导出明确失败，不冒充完整

#### Scenario: AC-FR-REPORT-016-03 下载凭证
- **GIVEN** U 有 report_view/export，为某卡片换取了下载凭证
- **WHEN** 60 秒内用该凭证下载，或在凭证过期、被篡改、U 退出登录或失去 export 后下载
- **THEN** 前者得到与页面同期间同范围的 CSV；后者均返回 404，不泄露报表是否存在

### Requirement: FR-REPORT-017 查询与页面容量限制
统计 SHALL 在服务端以 10 秒 statement 超时约束执行，单图最多 1000 分组（含系列组合），页面最多 30 卡片；超时/超限 SHALL 返回明确错误及收窄范围提示，不截断冒充完整。SHALL 不引入公开共享链接、跨图联动钻取、投影/预聚合或任意用户查询执行。

#### Scenario: AC-FR-REPORT-017-01 分组边界
- **GIVEN** 查询分别产生 1000 和 1001 个分组
- **WHEN** 请求图表或 CSV
- **THEN** 1000 可完整返回，1001 明确超限并提示缩小范围，不返回截断为 1000 的伪完整结果

#### Scenario: AC-FR-REPORT-017-02 超时与卡片边界
- **GIVEN** 一个统计 statement 持续超过 10 秒，草稿分别有 30/31 张卡片
- **WHEN** 查询及保存/发布
- **THEN** 超时中止并提示；30 张在合法时可发布，31 张容量校验拒绝，不靠前端限制

### Requirement: FR-REPORT-018 PC 与 LINE 同配置展示
PC SHALL 按发布网格位置/尺寸展示只读卡片，预览与展示配置含义一致；LINE SHALL 使用相同发布配置和统计口径按 PC y、x、稳定卡片标识顺序全宽单列排列，每行一图，不提供设计器。各图 SHALL 对尺寸变化重排，并提供完整长标签读取与加载/空/错误状态，遵循现有 UI/可访问性约束。

#### Scenario: AC-FR-REPORT-018-01 跨端布局和排序
- **GIVEN** PC 第一排有左 A/右 B，第二排有 C，配置已发布
- **WHEN** 打开 PC 预览/展示及 LINE
- **THEN** PC 保持网格且展示不含编辑工具，LINE 依次 A/B/C 每行一图，同权限/期间统计一致

#### Scenario: AC-FR-REPORT-018-02 窄屏与长标签
- **GIVEN** LINE 320px 屏宽，长泰语分类标签和六种图表
- **WHEN** 查看并改变可用宽度
- **THEN** 图表按尺寸重排，不靠无限缩小字体，长标签可完整读取，按钮/错误状态和页面不产生遮挡或不可操作内容
