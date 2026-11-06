## ADDED Requirements

### Requirement: FR-SYS-060 登录、会话与首页
admin 后台 SHALL 以用户名与口令登录（FR-SYS-019）。以下情况 SHALL 显示对应的提示并停在登录页：登录失败、账号被锁定、账号已停用。登录后：
- 每页 SHALL 显示当前 admin 的用户名与"退出"；
- 会话失效（30 分钟无操作或被结束）后，任何操作 SHALL 回到登录页并提示重新登录，登录后 SHALL 回到原来的页面。

首页 SHALL 显示三类待审批事项的数量：建组织申请、企业认证申请、续费与开通申请。每个数量 SHALL 可以点击，进入对应的列表。

#### Scenario: AC-FR-SYS-060-01 登录与退出
- **GIVEN** 一个用命令创建的 admin 账号 ops
- **WHEN** 用正确的口令登录，随后点击"退出"
- **THEN** 登录后显示首页与用户名 ops；退出后回到登录页

#### Scenario: AC-FR-SYS-060-02 登录失败与锁定
- **GIVEN** 登录页
- **WHEN** 输入错误的口令；或该账号已被锁定
- **THEN** 显示"用户名或口令错误"一类的提示，停在登录页；不显示该用户名是否存在

#### Scenario: AC-FR-SYS-060-03 会话失效后回到原页面
- **GIVEN** admin 在"组织"页，会话已失效
- **WHEN** admin 进行任何操作
- **THEN** 回到登录页并提示重新登录；登录后回到"组织"页

#### Scenario: AC-FR-SYS-060-04 首页的待处理数量
- **GIVEN** 有 2 条待审批的建组织申请、1 条企业认证申请、0 条续费申请
- **WHEN** admin 打开首页
- **THEN** 显示 2、1、0；点击"2"进入建组织申请列表，并只显示待审批的申请

### Requirement: FR-SYS-061 修改本人口令
已登录的 admin SHALL 可以输入当前口令、新口令与确认的新口令，修改本人口令（FR-SYS-019）。两次输入的新口令不一致、新口令少于 12 个字符、当前口令错误时，SHALL 显示对应的提示，口令不变。成功后 SHALL 提示口令已修改，当前会话保持登录。

#### Scenario: AC-FR-SYS-061-01 修改成功
- **GIVEN** 已登录的 admin
- **WHEN** 输入正确的当前口令与一个 12 个字符以上的新口令（两次一致）
- **THEN** 提示口令已修改；之后用新口令可以登录，用旧口令不能

#### Scenario: AC-FR-SYS-061-02 输入有误
- **GIVEN** 已登录的 admin
- **WHEN** 两次新口令不一致，或新口令只有 11 个字符，或当前口令错误
- **THEN** 显示对应的提示，口令不变

### Requirement: FR-SYS-062 界面语言
admin 后台 SHALL 提供中文与英文界面，默认中文。admin SHALL 可以随时切换，切换立即生效，选择 SHALL 保存在本机。界面上的所有文字 SHALL 来自两种语言的资源文件，SHALL NOT 写死在代码中。

#### Scenario: AC-FR-SYS-062-01 默认中文，可切换英文
- **GIVEN** 第一次打开 admin 后台
- **WHEN** 查看登录页，随后切换为英文
- **THEN** 登录页为中文；切换后立即显示英文，刷新后仍为英文

#### Scenario: AC-FR-SYS-062-02 资源完整
- **GIVEN** 两种语言的资源文件
- **WHEN** 检查任一语言
- **THEN** 每个界面文字在两种语言中都有对应的译文

### Requirement: FR-SYS-063 建组织申请审批
admin SHALL 可以按状态（待审批、已批准、已驳回）查看建组织申请：申请人、组织名称、联系电话、地址、提交时间，以及已处理申请的处理时间与驳回原因。对待审批的申请，admin SHALL 可以批准，或填写原因后驳回（原因必填）。处理后列表 SHALL 立即更新。

#### Scenario: AC-FR-SYS-063-01 批准
- **GIVEN** 一条待审批的申请"Siam Tools"
- **WHEN** admin 点击"批准"并确认
- **THEN** 申请移出待审批列表，出现在已批准列表；组织列表中有"Siam Tools"

#### Scenario: AC-FR-SYS-063-02 驳回须填原因
- **GIVEN** 一条待审批的申请
- **WHEN** admin 点击"驳回"，不填原因就提交；随后填写原因"联系电话无法接通"再提交
- **THEN** 第一次提示原因必填，申请不变；第二次申请变为已驳回，显示该原因

### Requirement: FR-SYS-064 组织管理
admin SHALL 可以查看组织列表（名称、状态、企业认证状态、成员人数、成立时间），并按名称查找。在组织详情中，admin SHALL 可以：
- 修改名称、联系电话与地址；
- 停用或恢复组织，停用前 SHALL 确认；
- 直接设定或取消企业认证，操作前 SHALL 确认；
- 进入该组织的订阅与预占（FR-SYS-066）。

#### Scenario: AC-FR-SYS-064-01 查找与查看
- **GIVEN** 组织"Siam Tools"与"Bangkok Trading"
- **WHEN** admin 在组织列表中输入"siam"
- **THEN** 只显示"Siam Tools"；打开后显示其资料、状态、认证状态与成员人数

#### Scenario: AC-FR-SYS-064-02 停用与恢复
- **GIVEN** 一个启用中的组织
- **WHEN** admin 点击"停用"并确认，随后点击"恢复"并确认
- **THEN** 状态先变为已停用，再变为启用

#### Scenario: AC-FR-SYS-064-03 修改资料的校验
- **GIVEN** 组织详情
- **WHEN** admin 把名称清空后保存
- **THEN** 名称输入框下显示错误提示，资料不变

### Requirement: FR-SYS-065 企业认证审核
admin SHALL 可以按状态查看企业认证申请：组织、法定名称、税号、注册地址、提交时间，以及已处理的处理时间与驳回原因。对待审批的申请，admin SHALL 可以批准，或填写原因后驳回（原因必填）。

#### Scenario: AC-FR-SYS-065-01 批准与驳回
- **GIVEN** 两条待审批的认证申请
- **WHEN** admin 批准第一条，并填写原因驳回第二条
- **THEN** 第一条的组织显示为已认证；第二条显示为已驳回及原因

### Requirement: FR-SYS-066 订阅与预占
admin SHALL 可以查看一个租户（组织，或从用户查询进入的个人租户）的：
- 订阅历史：档位、开通周期、开始与结束时间、来源；
- 预占记录：关联的识别、页数、来自免费额度与月配额的数量、月份、预占与退还时间。

admin SHALL 可以为该租户设定订阅：选择档位与开通周期，开始与结束时间可以留空（按后端的默认规则计算，FR-SYS-012），也可以填写。不符合档位规则（个人租户只能 Kinder、组织最低 Starter、有效期内不能降档）或结束时间早于开始时间时，SHALL 显示对应的提示，订阅不变。

#### Scenario: AC-FR-SYS-066-01 开通套餐
- **GIVEN** 一个没有订阅的组织
- **WHEN** admin 选择 Starter、按月，留空时间后保存
- **THEN** 订阅历史中出现一段 Starter，为期一个月，来源为 admin

#### Scenario: AC-FR-SYS-066-02 档位规则
- **GIVEN** 一个个人租户
- **WHEN** admin 选择 Starter 后保存
- **THEN** 显示档位不适用的提示，订阅不变

#### Scenario: AC-FR-SYS-066-03 查看预占
- **GIVEN** 一个有 3 条预占记录的组织
- **WHEN** admin 打开其订阅与预占
- **THEN** 显示 3 条记录，每条有页数、来源拆分、月份、预占时间，已退还的有退还时间

### Requirement: FR-SYS-067 续费与开通申请审批
admin SHALL 可以按状态查看续费与开通申请：租户、申请人、目标档位、开通周期、备注、提交时间。对待审批的申请，admin SHALL 可以批准（开始与结束时间可以留空，或填写），或填写原因后驳回（原因必填）。批准后，该租户的订阅历史 SHALL 出现对应的一段。

#### Scenario: AC-FR-SYS-067-01 批准开通
- **GIVEN** 组织 O 一条待审批的 Intermediate 按年申请
- **WHEN** admin 留空时间并批准
- **THEN** 申请变为已批准；O 的订阅历史出现一段 Intermediate，为期一年

#### Scenario: AC-FR-SYS-067-02 驳回
- **GIVEN** 一条待审批的申请
- **WHEN** admin 填写原因"未收到款项"后驳回
- **THEN** 申请变为已驳回并显示该原因

### Requirement: FR-SYS-068 套餐目录与价格
admin SHALL 可以查看四档套餐，并修改每档的每月扫描配额、成员人数上限（Kinder 固定为 1，不可修改；其他档位可设为不限）、按月价与按年价（可清空为未设定，即"联系我们"），规则见 FR-SYS-030。保存前 SHALL 确认，提示修改对已有订阅立即生效。

#### Scenario: AC-FR-SYS-068-01 修改价格与配额
- **GIVEN** 套餐目录
- **WHEN** admin 把 Intermediate 的按月价设为 1,290、每月扫描配额改为 12,000，确认后保存
- **THEN** 目录显示新的价格与配额

#### Scenario: AC-FR-SYS-068-02 Kinder 的人数上限不可改
- **GIVEN** 套餐目录
- **WHEN** admin 编辑 Kinder
- **THEN** 成员人数上限显示为 1，不可编辑

#### Scenario: AC-FR-SYS-068-03 数值有误
- **GIVEN** 编辑某一档
- **WHEN** 把价格填为负数，或配额填为 0
- **THEN** 对应输入框下显示错误提示，套餐不变

### Requirement: FR-SYS-069 系统参数
admin SHALL 可以查看并修改：个人租户的免费额度、组织的免费额度、组织开通套餐前的成员人数上限（规则见 FR-SYS-031、FR-SYS-025）。页面 SHALL 说明免费额度的修改只影响之后发放的额度。

#### Scenario: AC-FR-SYS-069-01 修改参数
- **GIVEN** 系统参数页
- **WHEN** admin 把组织的免费额度改为 200 并保存
- **THEN** 显示 200；页面说明只影响之后成立的组织

#### Scenario: AC-FR-SYS-069-02 数值有误
- **GIVEN** 系统参数页
- **WHEN** 把成员人数上限填为 0
- **THEN** 输入框下显示错误提示，参数不变

### Requirement: FR-SYS-070 查询用户
admin SHALL 可以按邮箱、昵称或用户 ID 查询用户（FR-SYS-080），查看结果中的昵称、邮箱、手机号、是否已注册、个人租户与注册时间，并 SHALL 可以进入该用户个人租户的订阅与预占（FR-SYS-066）。输入少于 2 个字符时 SHALL 提示继续输入，不发起查询。

#### Scenario: AC-FR-SYS-070-01 查询并进入个人租户
- **GIVEN** 已注册用户 Somchai，邮箱 somchai@example.com
- **WHEN** admin 输入"somchai"查询，并点击该用户的个人租户
- **THEN** 结果中有 Somchai 及其邮箱与注册时间；进入其个人租户的订阅与预占

#### Scenario: AC-FR-SYS-070-02 输入过短
- **GIVEN** 查询用户页
- **WHEN** 只输入 1 个字符
- **THEN** 提示至少输入 2 个字符，不发起查询

### Requirement: FR-SYS-071 操作日志
admin SHALL 可以按时间倒序分页查看操作日志：时间、操作者（类型与标识）、操作类型、操作对象与结果（FR-SYS-003）。admin SHALL 可以按时间范围、操作者类型、操作类型与操作对象筛选。页面 SHALL 只读。

#### Scenario: AC-FR-SYS-071-01 查看与筛选
- **GIVEN** 操作日志中有组织与套餐相关的记录
- **WHEN** admin 选择操作类型"org."并查询
- **THEN** 只显示组织相关的记录，按时间从新到旧，每条有时间、操作者、操作类型、对象与结果

#### Scenario: AC-FR-SYS-071-02 分页
- **GIVEN** 操作日志中有 120 条记录
- **WHEN** admin 查看第一页，再查看下一页
- **THEN** 第一页 50 条，下一页接着显示更早的 50 条，没有重复

### Requirement: FR-SYS-072 OCR 与大模型配置
admin SHALL 可以查看并修改 OCR 与大模型配置（FR-SYS-005）：首选引擎、备用引擎、单据重试次数、全局切换阈值、首选引擎试探间隔、大模型地址与模型名称。页面 SHALL 显示每项密钥"已配置"或"未配置"，SHALL NOT 显示密钥本身，SHALL 说明密钥在服务器的环境变量文件中修改。保存前 SHALL 确认。

#### Scenario: AC-FR-SYS-072-01 查看与修改
- **GIVEN** 默认配置
- **WHEN** admin 打开配置页，把单据重试次数改为 2，确认后保存
- **THEN** 页面先显示首选 TextIn、备用 Google Cloud Vision、重试 3 次等默认值与各密钥的配置状态；保存后显示重试 2 次

#### Scenario: AC-FR-SYS-072-02 校验
- **GIVEN** 配置页
- **WHEN** 把首选与备用设为同一引擎，或把大模型地址填为 http 开头的地址
- **THEN** 对应输入框下显示错误提示，配置不变

### Requirement: FR-SYS-073 等待、确认与错误反馈
admin 后台的每个请求与按钮 SHALL 有可见的等待状态，按钮在请求完成前 SHALL NOT 能再次提交。停用组织、设定或取消企业认证、驳回申请、设定订阅、修改套餐、修改参数与配置之前 SHALL 先确认。后端返回错误时 SHALL 按错误代码显示当前语言的提示；有字段信息的错误 SHALL 显示在对应输入框下；不认识的错误代码 SHALL 显示通用提示。

#### Scenario: AC-FR-SYS-073-01 防止重复提交
- **GIVEN** admin 批准一条申请，请求尚未完成
- **WHEN** 再次点击"批准"
- **THEN** 按钮显示等待状态且不可点击，后端只收到一次批准

#### Scenario: AC-FR-SYS-073-02 已被处理的申请
- **GIVEN** 两名 admin 同时打开同一条待审批申请，其中一人已批准
- **WHEN** 另一人点击"驳回"
- **THEN** 显示"该申请已被处理"一类的提示，列表刷新为最新状态
