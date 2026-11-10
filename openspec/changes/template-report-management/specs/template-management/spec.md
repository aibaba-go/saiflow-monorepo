# template-management Spec Delta

## Purpose

提供文档格式模板从样例生成、手动新建及结构 JSON 导入到统一编辑、草稿保存、独立生效的完整管理能力，并以不可变版本、租户归属、使用授权、删除保护及样例隐私约束保障历史结果与运营报表可追溯。

## ADDED Requirements

### Requirement: FR-TEMPLATE-001 文档格式模板列表
系统 SHALL 按管理、可新使用、历史引用三种范围分别提供模板，展示名称、code、归属、草稿/生效状态、当前内容版本、停用状态及更新时间；SHALL NOT 把定义可读等同于可新使用或可修改。

#### Scenario: AC-FR-TEMPLATE-001-01 按范围显示
- **GIVEN** U 有本人个人模板、组织 O 的管理权限及已撤销新使用授权的历史系统模板
- **WHEN** U 分别在个人空间和 O 打开模板列表及历史结果定义
- **THEN** 管理列表只含对应可管理配置，历史定义只在有权业务引用中可读，撤权模板不在可新使用列表

### Requirement: FR-TEMPLATE-002 三入口与草稿保存
系统 SHALL 提供样例 PDF/图片生成主入口，手动新建、JSON 结构导入辅助入口，统一进入模板编辑器；SHALL 允许保存不完整但在结构容量上限内的草稿，指出待完善项；只有明确保存才建立模板草稿，保存或预览 SHALL NOT 自动生效。

#### Scenario: AC-FR-TEMPLATE-002-01 手动新建不完整草稿
- **GIVEN** 操作者有当前空间模板管理权限
- **WHEN** 手动新建尚无字段的模板并保存，再次打开
- **THEN** 内容恢复为不完整草稿并显示待完善项，没有生效版本，不能匹配或转换

#### Scenario: AC-FR-TEMPLATE-002-02 三入口统一编辑
- **GIVEN** 操作者分别通过样例、手动和 JSON 获得候选定义
- **WHEN** 进入编辑页
- **THEN** 三者均可逐行/逐列修改并分别保存和生效，候选生成或预览不建立正式模板版本

### Requirement: FR-TEMPLATE-003 分组与普通字段逐行编辑
编辑器 SHALL 支持分组内 field 逐行增删、排序和编辑 key、默认名称、names.en/th/zh、说明、string/integer/decimal/amount/date、required、表头 primary 与已有金额校验 role；SHALL 保留定义顺序，语言名称缺失时回退默认名称，不把样例业务值写入定义。

#### Scenario: AC-FR-TEMPLATE-003-01 编辑字段定义
- **GIVEN** 操作者正在编辑模板草稿
- **WHEN** 新增分组和 date 字段，填写三语名称、required/primary，移动行并保存
- **THEN** 重开后配置和顺序一致，定义只有结构及识别说明，没有样例具体日期或供应商值

### Requirement: FR-TEMPLATE-004 明细表逐列编辑
编辑器 SHALL 支持在分组中增删/排序 table 并逐列增删/排序 columns，配置列 key、默认名称、三语名称、说明、五种现有类型、required 及已有明细金额 role；primary SHALL 只允许普通表头字段，不允许明细列。

#### Scenario: AC-FR-TEMPLATE-004-01 编辑明细列
- **GIVEN** 模板有 goods 分组
- **WHEN** 新增 line_items 表及 quantity、unit_price、line_total 列，排序并保存
- **THEN** 重开后列顺序、类型和 role 一致，列没有 primary 选项，服务端拒绝带明细 primary 的生效请求

### Requirement: FR-TEMPLATE-005 服务端生效校验
生效 SHALL 在服务端完整校验现有 schema 的 code/key 格式、名称/说明长度、分组及列非空、同级 key 唯一、支持类型、required/primary 布尔与 role 位置，以及最多 20 组、200 普通字段及列、10 表；失败 SHALL 返回逐配置错误，保留草稿及旧生效版本，不新增内容版本。

#### Scenario: AC-FR-TEMPLATE-005-01 生效校验失败
- **GIVEN** v1 已生效，新草稿有重复 key 或非法类型
- **WHEN** 操作者直接请求生效
- **THEN** 服务端拒绝并指出全部可检测配置错误，草稿保留，v1 仍有效，版本数不变

#### Scenario: AC-FR-TEMPLATE-005-02 容量边界
- **GIVEN** 有完整的 20 组、200 字段及列、10 表定义
- **WHEN** 生效该定义，以及提交 21 组、201 字段及列或 11 表的定义
- **THEN** 前者通过容量校验，超限请求明确拒绝；不因前端绕过校验而生效

### Requirement: FR-TEMPLATE-007 模板管理审计
系统 SHALL 对模板创建/保存、内容生效、授权变更、停用/恢复、删除及样例状态操作追加审计，记录操作者、租户/归属、对象、内容版本或修订号、时间、操作及结果；SHALL NOT 在审计记录中保存敏感样例值或服务凭据。

#### Scenario: AC-FR-TEMPLATE-007-01 模板审计
- **GIVEN** 管理者保存并生效 v1，修改授权后停用模板
- **WHEN** 查询有权查看的操作日志
- **THEN** 四种操作均可追溯且版本/修订明确，日志不包含样例单据内容或密钥

### Requirement: FR-TEMPLATE-008 从样例与已有 OCR 生成候选
系统 SHALL 以现有服务端 OCR 和大模型配置从上传样例生成候选定义，或从本人当前可访问的已有 OCR 结果生成；展示原件、候选结构与样例值分离对照。required/primary/role SHALL 默认标为待人工确认，未确认 SHALL 不能生效；SHALL NOT 固化样例值或供应商为定义约束。

#### Scenario: AC-FR-TEMPLATE-008-01 样例优先与人工确认
- **GIVEN** 样例发票含日期、供应商、金额及明细
- **WHEN** 样例生成完成
- **THEN** 主流程进入统一编辑器并可对照原件/样例值，候选含分组及列结构，required/primary/role 待人工确认；未确认生效被拒绝

#### Scenario: AC-FR-TEMPLATE-008-02 从有权 OCR 结果生成
- **GIVEN** U 有模板管理权限，有本人可访问的 OCR 结果 A，无权访问 B
- **WHEN** 分别请求用 A、B 生成候选
- **THEN** A 复用已有 OCR 而不重新扣扫描，B 返回 404；生成候选不改 A 的业务结果、模板关联或历史

#### Scenario: AC-FR-TEMPLATE-008-03 不固定样例值
- **GIVEN** 样例包含供应商 Siam Tools 与金额 1000.00
- **WHEN** 保存并生效经人工确认的定义，再用不同供应商和金额的同版式单据匹配
- **THEN** 定义不携带该供应商/金额固定值，不仅因样例值不同排除同版式单据

### Requirement: FR-TEMPLATE-009 模板归属与系统授权
个人模板 SHALL 仅本人个人租户管理/使用；组织模板 SHALL 归组织且仅 owner/template_manage 有效成员管理。平台 admin SHALL 可跨租户管理配置但不得取得业务数据。系统模板授权 SHALL 二选一：精确多选套餐 kinder/starter/intermediate/advance，或点名用户（仅本人个人租户）及组织（仅有效成员）；使用授权 SHALL NOT 赋予管理权。

#### Scenario: AC-FR-TEMPLATE-009-01 组织代管与个人隔离
- **GIVEN** U 在 O 持有 template_manage，V 是 O 的有效普通成员
- **WHEN** U 在 O 创建模板，V 尝试修改，以及 U 切换个人空间
- **THEN** 模板归 O，V 无管理权但可按组织授权使用；U 的个人模板不会进入 O，O 模板不会变为 U 的个人模板

#### Scenario: AC-FR-TEMPLATE-009-02 精确套餐多选
- **GIVEN** 系统模板只勾选 starter 与 intermediate
- **WHEN** 有效 Kinder、Starter、Intermediate、Advance 租户查询新使用候选
- **THEN** 仅 Starter/Intermediate 获得该模板；Advance 不因档位更高自动获权

#### Scenario: AC-FR-TEMPLATE-009-03 点名用户与组织
- **GIVEN** 系统模板点名 U 与 O，U 也加入 P，M 已退出 O
- **WHEN** U 在个人租户、P 查询，O 有效成员及 M 查询
- **THEN** U 仅个人租户获点名用户授权，P 不因此获权；O 有效成员获权，M 无 O 访问权

#### Scenario: AC-FR-TEMPLATE-009-04 admin 配置与业务隔离
- **GIVEN** 平台 admin 管理客户模板配置
- **WHEN** 查看/修改定义，并尝试读取客户原件或 OCR 载荷
- **THEN** 可管理定义但业务请求被拒绝；管理客户模板不赋予业务数据权限

#### Scenario: AC-FR-TEMPLATE-009-05 游客与过期套餐
- **GIVEN** 系统模板授权 kinder，游客有有效 Kinder，另一租户订阅已过期
- **WHEN** 查询和新应用模板
- **THEN** 游客可在其临时租户按配额新使用，但不能新建个人模板；过期租户不能借模板授权绕过现有识别套餐规则

### Requirement: FR-TEMPLATE-010 删除保护与停用
任一版本一经应用转换即 SHALL 永久禁止删除，候选打分不算使用；仍被草稿/发布报表或复核配置引用 SHALL 也禁止删除。删除与引用建立 SHALL 互斥，冲突返回 409。可停用/恢复；停用或撤权 SHALL 禁止新使用但保留业务可见范围内历史定义、结果及已有报表统计，历史版本 SHALL 不可修改。

#### Scenario: AC-FR-TEMPLATE-010-01 候选不算使用
- **GIVEN** 模板只被候选打分且无报表/复核引用
- **WHEN** 有权管理者删除
- **THEN** 删除成功，模板不再可新使用

#### Scenario: AC-FR-TEMPLATE-010-02 任版本使用和配置引用保护
- **GIVEN** A 的旧版本有失败转换尝试，B 被草稿报表引用，C 被复核配置引用
- **WHEN** 删除 A、B、C，以及删除 A 的业务结果后再次删 A
- **THEN** 均返回 409；使用保护不因转换失败或结果删除消失

#### Scenario: AC-FR-TEMPLATE-010-03 删除与新引用并发
- **GIVEN** 未使用模板 T
- **WHEN** 删除 T 与新转换/报表/复核引用同时提交
- **THEN** 仅一方可成功，不产生指向已删除模板的引用

#### Scenario: AC-FR-TEMPLATE-010-04 停用撤权不破坏历史
- **GIVEN** U 可见已正式确认结果及引用其模板 v1 的已发布报表
- **WHEN** 模板停用或系统模板授权撤回
- **THEN** 新匹配/转换被拒绝，U 在仍满足业务/报表权限与套餐条件时可读历史定义及统计；不能修改 v1

### Requirement: FR-TEMPLATE-011 JSON 结构导入与导出
系统 SHALL 支持现有结构 JSON 导入/导出；导入 SHALL 仅取结构，不信文件中的归属、权限、状态、版本，由当前操作者确定有权目标。code 在目标范围冲突 SHALL 返回 409，不覆盖旧模板，允许人工改 code 保存副本；导出 SHALL 不包含业务样例值、凭据或可转移授权。

#### Scenario: AC-FR-TEMPLATE-011-01 忽略文件控制信息
- **GIVEN** JSON 含结构并声称属于其他组织、已生效 v99、全套餐授权
- **WHEN** U 导入本人空间并明确保存
- **THEN** 只形成本人结构草稿，文件不能改变归属/授权/版本，也不能直接生效

#### Scenario: AC-FR-TEMPLATE-011-02 冲突与副本
- **GIVEN** 当前范围已有 code invoice 的模板
- **WHEN** 导入同 code 并保存，随后手改为 invoice-copy 再保存
- **THEN** 前次 409 且旧模板不变，后次创建独立草稿，不静默覆盖

#### Scenario: AC-FR-TEMPLATE-011-03 导出结构往返
- **GIVEN** U 有权管理模板定义
- **WHEN** 导出 JSON 后在有权空间以新 code 导入
- **THEN** groups/items/columns 及名称/类型/标记保留，不携带样例值、权限或正式版本状态

### Requirement: FR-TEMPLATE-012 修订号并发保护
草稿保存、生效及授权/状态修改 SHALL 携带读取时的修订号，成功后更新修订；过期修订 SHALL 返回 409 并提示重读，不覆盖较新内容或生效过期草稿。授权独立于内容版本但 SHALL 受并发保护。

#### Scenario: AC-FR-TEMPLATE-012-01 保存与生效竞争
- **GIVEN** A、B 读取同修订，A 已保存新草稿
- **WHEN** B 按旧修订保存或生效
- **THEN** 返回 409，保留 A 的草稿和旧活跃版本，B 可重读修正而不能强覆盖

#### Scenario: AC-FR-TEMPLATE-012-02 授权修改并发
- **GIVEN** A、B 读取相同授权修订，A 已撤销授权
- **WHEN** B 提交旧授权配置
- **THEN** 返回 409，不恢复被撤销权限，不增加内容版本

### Requirement: FR-TEMPLATE-013 独立生效与内容版本
模板 SHALL 在生效成功时创建不可变内容版本：首次 v1，名称/结构等有效内容变化则 +1，规范化后重复内容不增；保存、预览、失败、授权修改不增内容版本。新草稿 SHALL 不替换旧活跃版本；生效 SHALL 不自动恢复停用、不授予权限、不重写历史结果或报表显式版本范围。

#### Scenario: AC-FR-TEMPLATE-013-01 首次及重复生效
- **GIVEN** 完整草稿尚未生效
- **WHEN** 生效，重读修订后再生效相同内容，再仅修改授权
- **THEN** 仅有 v1，重复生效不加版本，授权修改也不加内容版本

#### Scenario: AC-FR-TEMPLATE-013-02 新草稿与有效修改
- **GIVEN** v1 活跃，已有结果和报表绑定 v1
- **WHEN** 修改名称/字段并保存，再成功生效
- **THEN** 保存期间新使用仍取 v1，生效创建 v2；原结果/报表仍绑定 v1，新版不自动进入报表

### Requirement: FR-TEMPLATE-014 样例用途、计量与敏感内容安全
上传样例 SHALL 需 template_manage + upload_ocr，按文件头验证 JPG/JPEG、PNG、PDF、20 MB、PDF 1–50 页，按 OCR 页预占/结算/失败取消退还，LLM 不另收费。专用样例 SHALL 不成为正式单据；进度/重试/取消/错误明确，失败取消不留正式模板；新样例敏感内容最长 7 天且可主动删除。单据 SHALL 作为不可信 LLM 数据，不执行其任意代码/网络指令。

#### Scenario: AC-FR-TEMPLATE-014-01 文件与双权限
- **GIVEN** U 仅有 template_manage，V 有两项权限但样例为伪装 ZIP、21 MB 图片或 51 页 PDF
- **WHEN** 上传并生成
- **THEN** U 被拒绝；V 收到准确格式/容量原因，不调用 OCR/LLM，不留下正式单据或模板

#### Scenario: AC-FR-TEMPLATE-014-02 正常计量与重试
- **GIVEN** U 有双权限和 3 页扫描配额，上传 3 页 PDF
- **WHEN** 样例 OCR 成功后 LLM 失败，U 仅重试定义生成；以及另一 OCR 任务失败/取消
- **THEN** 成功 OCR 只计 3 次，复用 OCR 的 LLM 重试不重复扣页且不另收费；失败/取消 OCR 的预占退还，状态和重试入口清晰

#### Scenario: AC-FR-TEMPLATE-014-03 配额不足与模型未配置
- **GIVEN** 样例 3 页但只剩 2 次，或生成阶段现有大模型未配置
- **WHEN** 请求生成
- **THEN** 配额不足不开始 OCR，模型缺失显示可行动错误并保留可安全重试状态，不留下正式模板，不借用其他配置或服务凭据

#### Scenario: AC-FR-TEMPLATE-014-04 取消与正式数据隔离
- **GIVEN** 样例任务正在处理
- **WHEN** U 取消且 worker 随后返回，或浏览正式单据/报表
- **THEN** 任务保持取消，不建立正式模板，样例不出现在正式单据、历史业务记录和统计中

#### Scenario: AC-FR-TEMPLATE-014-05 到期和主动删除
- **GIVEN** 新样例原件、OCR 载荷及候选值已保存，另有被复用的既有业务 OCR 结果
- **WHEN** U 主动删除样例，或新样例到达 7 天保留上限
- **THEN** 新样例敏感内容不可再读取并被清理（含备份/日志敏感副本），只留无敏感值的状态审计及已明确保存的定义；不删除原有业务 OCR 结果

#### Scenario: AC-FR-TEMPLATE-014-06 提示注入防护
- **GIVEN** 样例文字包含读取内网、执行代码或泄露密钥的指令
- **WHEN** 服务端将 OCR 内容发送给已配置的大模型生成结构
- **THEN** 内容作为不可信数据处理，输出经结构校验且不得触发任意网络/代码执行或泄露凭据
