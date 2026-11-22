# reporting Specification

## Purpose
为个人和制造型小企业提供可配置报表与安全数据源：在租户授权、正式数据和发布快照边界内，支持字段筛选、原始明细分页、只读 PostgreSQL 查询以及受限静态内容卡。

## Requirements

### Requirement: FR-REPORT-019 字段条件与页面映射
设计器 SHALL 配置任意已绑定模板目录中的 string/integer/decimal/amount/date 字段条件，支持 eq/neq/in/not_in/empty/not_empty，文本 contains 与数值/日期 gt/gte/lt/lte/between。单组 SHALL 可选 AND/OR，卡片组与页面组及日期期间 SHALL 相交。页面组 SHALL 逐卡显式映射所有条件路径；无映射卡不受该组影响，不按同名猜映射。每组最多 20 条，集合最多 100 值，值最长 200 字符；缺失/非法值除空判断外不匹配，数字 0 不为空。服务端 SHALL 验证路径、类型、操作和值，所有路径和值以参数绑定；条件在聚合及筛选范围诊断前执行。document 只读表头，table 只读同一表的当前行及表头，不跨表。预览、发布查看及 CSV SHALL 使用同一条件。

#### Scenario: AC-FR-REPORT-019-01 聚合前且精确
- **GIVEN** 正式单据金额为 0、10.00、20.00，配置金额 gte 10.00
- **WHEN** sum/avg/count 查询
- **THEN** 得到 30.00/15.00/2，0 不被当成空；未正式或其他租户单据始终不纳入

#### Scenario: AC-FR-REPORT-019-02 显式映射与类型
- **GIVEN** 页面条件显式映射到 A/B，C 没有映射
- **WHEN** 预览、发布查看及 CSV，或提交错误类型/其他表字段/缺少映射
- **THEN** A/B 按映射条件过滤，C 保持自身条件；错误请求定位卡片/路径并拒绝，不猜同名字段

#### Scenario: AC-FR-REPORT-019-03 逻辑与边界
- **GIVEN** 日期期间及字段 AND/OR 条件、缺失或非法数值日期
- **WHEN** 查询 eq/neq/contains/in/not_in/between/empty/not_empty
- **THEN** 日期期间与条件相交，集合和比较类型正确，非法值不误匹配，所有用户输入仅为绑定参数

### Requirement: FR-REPORT-020 静态内容卡
设计器 SHALL 支持 image 与 html 静态卡，不需要模板/指标，不参与筛选、查询和 CSV。图片 SHALL 使用不可变资产 ID，组织私有存储，读取重新检查当前租户与管理权或已发布引用和查看权；仅接受真实 JPEG/PNG，最多 5 MiB 和 16 百万像素，禁止 SVG/PDF/任意 URL。HTML SHALL 在服务端按白名单清洗，最多 20,000 字符，禁用脚本、事件、表单、外部资源和内嵌 iframe；浏览器 SHALL 使用空 sandbox、无引用信息和拒绝外部资源的 CSP。外部页面 SHALL 单独选择 HTTPS 模式，只接受服务器配置的允许 origin，禁止用户名密码及平台自身 origin，不发送平台凭据；浏览器空 sandbox 与 no-referrer，目标拒绝 iframe 时不绕过。

#### Scenario: AC-FR-REPORT-020-01 图片隔离
- **GIVEN** O 的授权管理者上传有效图片并发布，其他组织也有图片
- **WHEN** 重开报表或伪造其他组织资产 ID，或上传 SVG/超限图片
- **THEN** 读取稳定 O 资产，跨租户/未发布无查看依据/非法格式拒绝；图片不调用统计或 CSV

#### Scenario: AC-FR-REPORT-020-02 HTML 与网页边界
- **GIVEN** 输入含 script、onclick、form、img 外部资源、嵌套 iframe 或不允许的页面来源
- **WHEN** 保存、发布与展示
- **THEN** 保存内容服务端清洗危险元素属性，预览/展示空 sandbox 和 CSP 阻止执行/外部请求；不允许的外部来源拒绝

#### Scenario: AC-FR-REPORT-020-03 媒体铺满及设计器重选
- **GIVEN** 设计器中已有图片、HTML 或允许来源的 HTTPS 页面卡片
- **WHEN** 调整卡片尺寸、切换到其他卡片后再点击页面内容区域，或新增图片卡片
- **THEN** 图片与页面容器铺满标题以下正文，不额外添加卡片内边距或 HTML body 外边距；新增图片默认等比裁切铺满，仍可选择完整显示且不改已有图片适配设置；设计模式点击页面区域选中卡片且 iframe 不抢占鼠标/Tab，查看模式仍允许页面交互；标题、sandbox、CSP、来源限制沿用原规则，外部页面自身留白不由平台改写

### Requirement: FR-REPORT-021 页面及图表外观
系统 SHALL 保存并一致呈现主题预设、页面背景、卡片圆角 0–24、间距 8–32、阴影开关及白/淡色背景。bar SHALL 可切换 vertical/horizontal，line 可切换填充，六种原图型及 image/html 均可使用；不改变原精确值、负值和 null 缺口语义。操作文本 SHALL 支持各端已有语言。

#### Scenario: AC-FR-REPORT-021-01 保存与跨端
- **GIVEN** 已配置横条、主题、圆角间距、图片及 HTML
- **WHEN** 保存重开、发布并在 PC/LINE 查看
- **THEN** 样式内容沿用配置，PC 网格与 LINE 栈顺序不变；null 不补零/连线，显示精度不改精确值

### Requirement: FR-DATA-001 数据源管理
系统 SHALL 提供模板与 PostgreSQL 数据源目录、管理界面及服务端授权接口。租户报表管理者 SHALL 管理本租户外部 PostgreSQL 连接，不扩大现有组织 Starter+ 门槛。模板来源 SHALL 复用现有模板版本目录与授权。平台 admin SHALL 管理连接并且独占系统内置 system-pg 来源；客户接口 SHALL 不列出、不授权直接查询该来源。引用中的来源 SHALL 不可删除，修改连接 SHALL 不改变已发布查询定义。

#### Scenario: AC-FR-DATA-001-01 来源隔离
- **GIVEN** A/B 有各自 PostgreSQL 来源，平台存在 system-pg
- **WHEN** A 管理者列出来源、伪造 B 或 system-pg ID，或删除发布引用来源
- **THEN** 只显示 A 获准来源，其他来源和被引用删除均拒绝；平台 admin 可见 system-pg

#### Scenario: AC-FR-DATA-001-02 管理端操作及内置保护
- **GIVEN** admin 打开数据源管理，尚未选择或已选择组织
- **WHEN** 选择组织并新增、读回、编辑、测试及删除外部 PostgreSQL 来源，或请求修改/删除 system-pg
- **THEN** 未选择组织时明确说明外部连接归属及新增条件；选择后可完成 CRUD，空密码编辑保留秘密、引用删除拒绝；内置系统 PG 始终只读，前后端均拒绝修改和删除

### Requirement: FR-DATA-002 PostgreSQL 连接与秘密
PostgreSQL 来源 SHALL 配置名称、主机、端口、数据库、用户名、密码与 TLS，支持测试连接。秘密 SHALL 仅服务端加密保存，密钥来自服务器环境文件，不进入代码、响应或日志；空密码更新 SHALL 保留原秘密。外部连接 SHALL 默认要求证书校验，拒绝未获服务器允许的环回、私网、链路本地及元数据目标，连接到已经校验的地址防止 DNS 重绑定。系统 PG SHALL 使用独立最小权限只读账号，仅访问受限 reporting 视图，禁止访问身份、会话、密码、秘密和原始 OCR 表。

#### Scenario: AC-FR-DATA-002-01 秘密与网络边界
- **GIVEN** 输入有效或私网/元数据/无效 TLS 连接
- **WHEN** 保存、读回、测试连接并触发错误
- **THEN** 有效配置可测试，未允许目标拒绝，响应与日志无明文密码；TLS 校验不被静默降级

### Requirement: FR-DATA-003 只读 SQL 数据集
授权设计者 SHALL 为 PostgreSQL 来源编写单条只读 SELECT 查询并发现结果字段。服务端 SHALL 解析并拒绝写入、DDL、多语句、锁、管理命令及未批准的危险函数；数据库只读事务、连接超时、10 秒语句超时、最大返回行数及服务端分页共同限制执行。源、SQL 与字段绑定 SHALL 保存到报表发布快照；客户查看 SQL 卡仅执行已发布定义，不允许提交新 SQL、来源或权限参数。系统 PG 直接查询 SHALL 仅接受平台 admin，会话权限每次重验。

#### Scenario: AC-FR-DATA-003-01 查询与发布边界
- **GIVEN** 合法 SELECT、写 CTE、多个语句或危险函数
- **WHEN** 测试、保存、发布及伪造客户数据查询
- **THEN** 只读查询返回类型化字段与分页，危险语句拒绝；查看者不能替换发布 SQL 或使用 system-pg

#### Scenario: AC-FR-DATA-003-02 数据库选表与 SQL
- **GIVEN** 已获准来源的设计者选择关系数据库
- **WHEN** 浏览数据库表/视图并选表，或切换手写 SQL 后运行发现字段
- **THEN** 表目录只返回连接账号可 SELECT 的非系统表/视图，沿用租户/管理/全量数据权限与连接限制；标识符正确转义，选表生成单条只读 SELECT，模式/表/SQL 与字段写入发布快照；改来源、表或 SQL 清除过期字段，迟到结果不能复原旧绑定；目录或查询失败可重试，system-pg 目录仅 admin 可用且只含受限 reporting 视图，不能作为客户自定义报表绕过数据范围

### Requirement: FR-REPORT-022 原始明细表与字段
table 卡 SHALL 显示不聚合的原始记录，支持配置显示字段及每页 5–100 条。模板来源 SHALL 支持每单据表头或同一明细表逐行，保留重复值及缺失 null；不要求聚合指标、分组或序列。服务端 SHALL 先执行现有授权、模板版本、正式数据及字段筛选，再以确定顺序分页并返回总数；预览与查看 SHALL 分别对当前草稿和发布定义执行，翻页不修改配置。CSV SHALL 使用同一字段与数据范围导出所有记录，超出 50,000 条拒绝而非静默截断。

#### Scenario: AC-FR-REPORT-022-01 明细分页
- **GIVEN** 12 条记录含重复金额，设置每页 5 条与两个字段
- **WHEN** 读取第 1/2/3 页、切换字段、预览及 CSV
- **THEN** 分别返回 5/5/2 行与总数 12，重复记录保留，未选择字段不返回，CSV 覆盖 12 行且无聚合列

### Requirement: FR-REPORT-023 PostgreSQL 报表绑定
报表卡 SHALL 可选模板或获准 PostgreSQL 来源。PostgreSQL 来源 SHALL 以查询结果字段配置图表维度、指标或原始明细字段；静态卡不需要任何来源。报表查看、导出与设计预览 SHALL 保留原权限和修订/发布边界；来源停用或查询失败 SHALL 返回明确错误，不展示其他租户或过期结果。

#### Scenario: AC-FR-REPORT-023-01 SQL 卡生命周期
- **GIVEN** 一个 PostgreSQL 来源及绑定字段的卡片
- **WHEN** 测试查询、配置图表/明细、保存、发布并查看/分页
- **THEN** 结果字段可配置，发布定义与草稿独立，来源无权或不可用不返回旧数据
