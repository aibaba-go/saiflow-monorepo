## ADDED Requirements

### Requirement: NFR-DEV-001 本地开发与服务隔离
本地开发环境 SHALL 使用显式开发配置、独立开发身份及独立数据目标。线上配置 SHALL NOT 默认启用开发模式。本地启动 SHALL 只监听回环地址；外部服务凭据 SHALL 只从专用本地环境输入，不读取生产部署环境文件，不回退到线上服务。恢复的 saiflow 业务数据库 SHALL NOT 被自动化测试迁移、清空或重置角色。未配置独立 GCS/OCR/LLM/SMTP 时 SHALL 保持明确的不可用或等待状态，不以模拟成功替代真实业务。

#### Scenario: AC-NFR-DEV-001-01 默认隔离
- **GIVEN** 没有提供开发模式标志
- **WHEN** 启动正常后端或构建客户前端
- **THEN** LINE 登录按原有流程工作，没有免认证的开发入口

#### Scenario: AC-NFR-DEV-001-02 不读取线上凭据
- **GIVEN** 本地专用开发环境缺少 OCR、GCS 或 SMTP 配置
- **WHEN** 启动本地服务并请求需要该服务的业务
- **THEN** 不读取线上环境文件，不发往线上存储或邮箱，保持已有未配置错误或 worker 空闲状态

### Requirement: NFR-DEV-002 受限独立开发登录
开发登录 SHALL 只有后端明确设置 development、显式开启免 LINE 登录、数据目标通过独立目标校验且请求来自回环地址时才可用。SHALL 使用固定保留的开发身份，SHALL NOT 接受任意用户标识或 impersonate 已有 LINE 身份。前端 SHALL 同时要求 Vite 开发模式、显式本地开关、当前回环主机且同源 API；生产构建 SHALL 禁用该分支。开发登录 SHALL 生成真实用户会话，保留 CSRF、租户权限、注册状态、套餐、保存版本、确认锁定、登出及审计规则，SHALL NOT 赋予 admin 权限。初始化开发账号 SHALL 幂等且只作用于独立数据目标。

#### Scenario: AC-NFR-DEV-002-01 本地真实会话
- **GIVEN** 明确开启开发模式且专用数据库已经初始化
- **WHEN** 用户在本地 PC 登录或启动小程序
- **THEN** 无 LINE 联合登录跳转，进入固定独立开发账号，业务 API 使用真实会话与权限

#### Scenario: AC-NFR-DEV-002-02 非本地失败关闭
- **GIVEN** 生产环境、非回环请求或未允许的数据目标
- **WHEN** 请求开发登录或开启不安全配置
- **THEN** 开发身份不被创建且不获得会话，启动校验或请求明确失败

#### Scenario: AC-NFR-DEV-002-03 任意身份不可指定
- **GIVEN** 已开启安全开发模式
- **WHEN** 请求携带其他用户标识或普通未验证 token
- **THEN** 不取得对应用户会话，只有保留开发 token 可访问固定开发身份

### Requirement: NFR-DEV-003 测试数据保护
数据库集成测试 SHALL 只对显式配置的一次性数据库执行破坏性操作，并在任何连接、迁移、角色重置或清表前校验数据库名及回环目标。数据库名 SHALL 使用专用测试前缀。开发业务库、恢复库 saiflow 及线上地址 SHALL 被拒绝，即使 REQUIRE_INTEGRATION 开启也 SHALL NOT 绕过保护。缺少一次性数据库时 SHALL 明确报告跳过或失败，不宣称集成测试通过。

#### Scenario: AC-NFR-DEV-003-01 禁止共享库
- **GIVEN** TEST_DB_NAME 为 saiflow 或目标为共享远程服务器
- **WHEN** 执行数据库集成测试
- **THEN** 在首次数据库连接前拒绝，数据库内容与角色均不改变

#### Scenario: AC-NFR-DEV-003-02 独立测试运行
- **GIVEN** 独立本地集群中的专用一次性测试库且显式开启测试
- **WHEN** 执行迁移及全量集成测试
- **THEN** 测试只修改该集群，开发和线上业务数据不变
