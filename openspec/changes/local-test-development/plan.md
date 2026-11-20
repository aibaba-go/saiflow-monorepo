# 隔离本地开发实施方案

## 授权与需求
NFR-DEV-001/002/003、NFR-SEC-002/003/009/012、STD-005/006，2026-11-09 负责人授权自主实施，不写线上及恢复库已有业务数据。

## 方案
正常部署环境默认无开发登录。专用本地显式配置 APP_ENV=development 和 DEV_LOGIN_ENABLED，校验允许独立数据库名/目标；开发登录沿用 /auth/line 契约，以保留 token 换固定 dev 身份，不接受用户ID，router 检查回环来源、CSRF，仍生成原始服务真实会话。原生 CLI 幂等创建独立开发用户/租户及注册信息，不授予admin。客户端 config 仅 DEV+开关+loopback+同源 API 启用；mini 用受限本地 LIFF adapter，PC 提供真实开发登录，不访问 LINE。

开发服务监听127.0.0.1:8010，客户 dev 5173/5174，避免现有8000打印软件。独立环境模板只列变量不填线上秘密，不读生产 .env。测试必须在独立本地PG集群/saiflow_test_*库；恢复81.68.72.120/saiflow不自动迁移或执行清表。环境可用性先验证，不以安装假设推进。

## 任务
- [x] Settings fail-closed、保留dev identity/回环guard、CLI seed；unit测试默认关闭/不安全目标/任意token/非loopback与真实注册会话。
- [x] 两客户端本地 config/登录适配与Vite proxy；测试开发启用与生产关闭，正常登录/登出回归。
- [x] 可重复本地启动/检查脚本与独立环境模板；配置隔离DB、防集成测试误写guard；测试危险目标在连接前拒绝。
- [x] 实际启动隔离数据服务，执行unit/integration与浏览器真实登录；第三方服务缺凭据时明确未配置，不用线上凭据；verification.md保存AC→测试及缺口。

## 检查点
无可用独立第三方配置时不得启动共享OCR/reminders，不把真实OCR/SMTP链路勾为通过。全部测试必须先确认host/db/role隔离；不提交/部署。
