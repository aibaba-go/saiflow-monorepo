## ADDED Requirements

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

### Requirement: FR-REPORT-021 页面及图表外观
系统 SHALL 保存并一致呈现主题预设、页面背景、卡片圆角 0–24、间距 8–32、阴影开关及白/淡色背景。bar SHALL 可切换 vertical/horizontal，line 可切换填充，六种原图型及 image/html 均可使用；不改变原精确值、负值和 null 缺口语义。操作文本 SHALL 支持各端已有语言。

#### Scenario: AC-FR-REPORT-021-01 保存与跨端
- **GIVEN** 已配置横条、主题、圆角间距、图片及 HTML
- **WHEN** 保存重开、发布并在 PC/LINE 查看
- **THEN** 样式内容沿用配置，PC 网格与 LINE 栈顺序不变；null 不补零/连线，显示精度不改精确值
