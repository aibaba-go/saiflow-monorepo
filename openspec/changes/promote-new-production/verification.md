# 新生产迁移与测试准备验证

日期：2026-11-17。关联 FR-PLAT-005/006、AC-FR-PLAT-005-01..08、AC-FR-PLAT-006-04、NFR-SEC-009、NFR-DATA-005。

## 当前交付边界

- 新生产 `130.94.24.117:11022` 已运行现有生产数据、配置和三个前端；旧机 `38.60.156.234:11022` 已运行独立空客户库测试服务。
- DNS 未修改。现有三个生产域名仍经旧机 HTTPS/SNI 转发到新机；生产只有新机数据库接受业务写入。
- GitHub production/test Environment 已配置，现有已提交 Deploy 的仓库级目标已改为新生产。
- 双环境 workflow、卷隔离、需求 delta 和运维说明最初仅在本地修改；2026-11-18 获授权后已提交、CI 通过并以 production 目标发布，见文末“双环境 workflow 提交与生产发布”。

## 生产迁移证据

- 源码/四个生产应用镜像版本：`f7ebd04c020151741d565c48e0509a372ed7f55c`。既有 CI `44038110352` 成功；迁移复用该已验证版本，不修改业务代码。
- 通过固定主机密钥的 SSH 复制实际运行的四个应用镜像、PostgreSQL 18、Caddy 和备份工具；配置、服务账号密钥及 TLS 资产未在输出中显示。
- 最终冻结旧 API、OCR、reminders 后，备份 `saiflow-20261117T091032Z.dump`（379478 字节），SHA256 `8f9f88e6848de4862c26d47b43497d44a0f7faa29c42e17057b646b8c45f5191`；旧机、新机与 GCS 保留备份。
- 新库恢复后，42 张表的行数/排序 JSON 内容摘要、30 个序列的 last_value/is_called 全部一致；恢复演练确认 `saiflow_v3.alembic_version` 存在。
- 新机 API、OCR、reminders、三个前端、Caddy 和 PostgreSQL 正常运行，PostgreSQL healthy；版本 `f7ebd04...`，数据库健康 `ok`。
- 三个生产域名直接以新 IP、原 Host/SNI 验证 HTTPS，均成功；保留原 DNS 的公开地址再次通过 page 200 text/html、health 200/status ok/database ok/完整 SHA 校验。
- 审计链验证 `audit log OK (894 entries)`。
- 新机后端以原服务账号实际读取一个原数据库引用的 GCS PDF：186936 字节，SHA256 `31a8bf11acbf9bc7a86b20d45fd64b1f830ed27a188f006da5eeb221ae2bb7f6`；没有输出客户文档内容，也未删除或改变对象。
- 新机以 deploy 完成备份 `saiflow-20261117T091411Z.dump`（379497 字节），上传既有 `gs://saiflow-db-backup/`；每日备份 timer active。
- `.env` 为 uid 1000/mode 600，业务 GCS key 为 uid 10001/mode 600，备份 key 为 uid 1000/mode 600；deploy Docker 配置没有 GHCR auth 或对应 credential helper。

## 测试隔离与恢复证据

- 测试镜像为 `f7ebd04c020151741d565c48e0509a372ed7f55c-test`；三个前端在旧机从该源码独立构建，生产 LIFF/LINE 公开 ID 均未进入测试静态资源。
- 测试 PostgreSQL 实际挂载 `saiflow_test_pgdata`，不是旧生产 `saiflow_pgdata`。旧生产卷已脱离运行服务，仍保留供恢复，没有删除其中数据。
- 从空库执行迁移到 `0020`；users=0、tenants=0、files=0、ocr_jobs=0、admin_sessions=0，platform_admins=1。仅复制平台管理员账号，密码不变；其 ID 序列为 last_value=1/is_called=true。
- 测试独立生成数据库角色口令和下载凭证签名密钥，不复制生产客户对象引用。
- 在实际对应容器验证：OCR worker disabled（不运行识别/清理）；reminders disabled；SMTP、LINE 频道/secret/回调、TextIn、Document AI processor/project 和 LLM key 为空。提醒日志为 `reminders disabled; review mails 0`。
- 按负责人决定共用 `saiflow-docs-dev` 业务桶；不更改 GCP IAM、桶或 LINE 控制台。共享服务账号仍有生产对象权限，不等同独立 IAM。
- 测试备份 `saiflow-20261117T092444Z.dump`（203634 字节）成功上传 `gs://saiflow-db-backup/test/`，并在临时 PostgreSQL 中通过 restore-check；每日 timer active。
- 新旧机 PostgreSQL 均无发布端口；两机监听仅 80/443/11022（另有仅 loopback 的 SSH X11 端口）。从旧机连接新机 5432、从新机连接旧机 5432 均失败。

## 浏览器与本地验证

- 生产 web-pc 和 admin 登录页在浏览器正常显示；未登录 admin/me 的 401 符合预期，没有提交客户或管理员凭据。
- 启动仅监听本机 loopback 的 SSH 预览与只读 HTTP 代理，访问测试实际容器资源：web-pc 登录页、邮箱密码/验证码模式切换及空邮箱 Send code 禁用正常；admin 登录页正常；通过预览访问 API 健康返回完整版本/database ok。
- LINE 前端资源加载成功，但自动访客初始化会 POST；只读预览刻意阻止该写入，显示错误/重试页及 501。因此没有声称 LINE 完整初始化或访客流程验证成功，也没有为了测试创建客户/访客数据。独立测试 LIFF/LINE 频道尚未配置。
- `scripts/tests/*.test.sh` 完整回归：12 套、238 passed、0 failed；workflow 静态测试 25 项，Compose 90 项。
- 默认 test/目标标签测试先失败后通过；独立卷测试 88 passed/2 failed 后 90 passed；生产转发保护先失败后通过；Environment 主机变量加载时机测试 23 passed/2 failed 后 25 passed。主机变量改在 step 级读取，避免 job 级冻结仓库生产值；GitHub 官方 variables 文档说明 Environment 变量仅在 job 开始后可用。
- `openspec validate promote-new-production --strict` 与 `git diff --check` 通过。没有重新运行全部 Python/JS 业务测试；业务源码未改，复用原成功 CI 的镜像版本。
- 代码审查代理被配置禁止，未换代理或入口绕过；完成作者自审，检查目标隔离、变量时机、镜像标签、remote-deploy 参数、卷名称和过渡代理保护。自审弱于独立审查，后续合入前仍需负责人判断。

## 执行中的恢复与清理

- 首次本机编排在恢复快照后 SSH 连接中断，失败回滚恢复旧生产 API/worker/代理与备份 timer；该快照未对外提供业务服务。随后改用旧机 Linux 上的单会话编排重新冻结并最终备份，避免以旧快照覆盖回滚后的业务写入。
- 测试初始化检查早于后端完成启动而连接拒绝；检查运行状态确认后端已健康，仅继续剩余验证，未重建测试卷、重置口令或重跑生产迁移。
- 本机出现跨 GitHub/两机/HTTPS 的短暂断连，恢复后重新复核；未修改本机代理设置或服务器防火墙。Windows 默认 python3 是不可运行的应用别名，首次本机 smoke 解析失败；用脚本支持的 `PYTHON=python` 后三个公开站点完整 smoke 成功，没有放宽 TLS 或健康标准。
- 两机迁移 scratch 已删除，临时服务器间私钥和新机的对应 authorized_keys 条目已删除。两个部署私钥验证存入各自 GitHub Secret 后，已移除本机临时私钥副本。
- 本机 root 管理密钥仍保留在 `temp/vps-migration/admin_key`，不是部署密钥；未删除用户管理服务器所需访问能力。正式移交后应由负责人放入安全位置。
- 最终迁移备份和旧生产数据卷刻意保留，不作为可自动删除的临时数据；DNS 切换确认前不移除 production-forwarding 标记。

## 执行裁定及代价

1. 保留一个平台管理员账号、既有密码，不复制管理员会话——空测试库仍可管理且不擅改密码；代价是平台管理员口令暂未实现两环境独立，测试暴露可能影响生产身份安全。
2. 旧生产卷脱离服务但保留——保留最终回退保障，不擅自擦除客户数据；代价是测试主机磁盘仍持有生产恢复数据，需要负责人后续确认清理。
3. DNS 不变期间使用旧机 HTTPS/SNI 转发——符合负责人稍后切域名的要求且保持新机唯一写入；代价是过渡期间生产入口依赖旧机，test Deploy 被保护标记拒绝。
4. 使用独立 TEST_LIFF_ID/TEST_LINE_CHANNEL_ID 名称——GitHub 不接受空变量，且不能让 test 继承仓库生产 ID；代价是配置测试频道时需维护这两个独立公开变量。
5. 只读预览拒绝自动访客写入、不调用付费 OCR 或发邮件——保留空客户库且避免生产副作用；代价是登录后的业务、LINE 原生客户端、真实识别和邮件链路未在迁移验证中覆盖。
6. 审查代理不可用时作者自审且不合入——遵守权限拒绝和无提交授权；代价是缺少独立审查及本地改动的新 CI/Actions 实证。

## 负责人下一步

- 生产 A 记录 `saiflow-app`、`saiflow-admin`、`saiflow-line2` 指向 `130.94.24.117`。
- 测试 A 记录 `dev-saiflow-app`、`dev-saiflow-admin`、`dev-saiflow-line` 指向 `38.60.156.234`。
- 若已有 AAAA 记录，也需检查其目标，避免 IPv6 继续访问旧地址；本次未检查或修改 DNS 区域配置。
- DNS 生效后验证测试 HTTPS/自动证书和生产直接入口，再清理旧机转发规则及 production-forwarding 标记；在此之前不要发布 test。
- 双环境 workflow 需要另行授权提交/推送、通过 CI 后才正式上线；生产部署目前仍使用已提交的原工作流及新生产仓库设置。
- 测试 LINE 登录需要独立频道；OCR/邮件当前关闭。开启识别/对象清理前先独立测试桶和服务账号。新生产机房位置及既有数据驻留要求尚需负责人确认。

## 测试域名调整（2026-11-17，负责人确认）

- 三个测试域名改为 `test-saiflow-app.aibaba.asia`、`test-saiflow-admin.aibaba.asia`、`test-saiflow-line.aibaba.asia`，目标仍为 `38.60.156.234`；上方 DNS 清单与运维说明已同步。
- 旧机 `.env` 与 Caddy 测试路由已修改，Caddy 配置校验通过；仅重建测试 API 和 Caddy，使实际 API 的 `WEB_PC_ORIGIN=https://test-saiflow-app.aibaba.asia` 生效，没有重建数据库或更换生产镜像。
- GitHub test Environment 的 APP_HOST、ADMIN_HOST、LINE_HOST 已更新并读回确认；production 变量、部署凭据及生产域名未更改。
- 更名前新域名状态断言失败，更名后断言通过；从运行中 Caddy 的管理配置确认三个新测试 Host 生效、三个旧测试 Host 不再匹配，HTTP 返回指向对应新域名的 HTTPS 308 跳转。
- 旧机三个生产 Host/SNI 的 HTTPS 转发检查均返回完整生产 SHA/status ok/database ok；production-forwarding 标记保留。
- DNS 未修改，测试公网 HTTPS/证书仍待负责人配置新 A 记录后复核；本次没有提交或推送。

## 测试域名再次调整（2026-11-17，负责人确认）

- 三个测试域名由 `test-saiflow-*` 改为 `dev-saiflow-app.aibaba.asia`、`dev-saiflow-admin.aibaba.asia`、`dev-saiflow-line.aibaba.asia`，目标仍为 `38.60.156.234`；`docs/deployment/README.md`（1.12.0）的地址表、DNS 清单与版本历史已同步。
- 改名前断言 `dev-saiflow-*` 在 `.env` 与 Caddyfile 中不存在（EXPECTED FAIL），改名后 `.env` 三个 HOST 均为新域名；脚本仍保留“生产转发段前缀不变”和“production-forwarding 标记必须存在”两项前置断言，异常时回写原文件。
- 仅重建 `saiflow-be-api` 与 `caddy`（`--pull never --no-deps`），未重建数据库、未更换镜像：测试 API 健康检查为 status ok/database ok/version f7ebd04c，`WEB_PC_ORIGIN=https://dev-saiflow-app.aibaba.asia`。
- 从运行中 Caddy 的管理配置确认三个 `dev-saiflow-*` Host 生效、三个 `test-saiflow-*` Host 不再匹配、三个生产 Host 保留；新域名的 80 端口请求返回指向对应 HTTPS 的 308 跳转。旧机三个生产 Host/SNI 的转发健康检查仍为 ok/ok/f7ebd04c。
- 前端调用后端使用相对 `/api`（未传 `VITE_API_BASE_URL` 构建参数），因此域名变更不需要重建前端镜像；compose 中只有 `WEB_PC_ORIGIN` 与 Caddy 的 `APP_HOST/ADMIN_HOST/LINE_HOST` 派生自这三个变量。
- GitHub test Environment 的 APP_HOST、ADMIN_HOST、LINE_HOST 已更新并读回；production 变量未更改。首次 `gh variable set` 因参数语法被拒绝（未写入任何值），改用 `--body` 后成功。
- DNS 仍未修改：公共 DoH 查询显示三条生产 A 记录仍指向 `38.60.156.234`，`dev-saiflow-*` 与 `test-saiflow-*` 均无 A 记录，因此测试域名公网 HTTPS 仍无证书（loopback SNI 检查返回 SSL 错误，属预期）。本次没有提交或推送。
- 过程记录：`temp/vps-migration/rename-dev-domains.py`、`rename-dev-domains.log`、`verify-dev-domains.sh`、`verify-dev-domains.log`。

## 双环境 workflow 提交与生产发布（2026-11-18，负责人授权"提交并在新的生产环境发布"）

- 提交前本地：`scripts/tests/*.test.sh` 12 套全部通过（workflow 25、compose 90），`check-no-secrets` 通过，`openspec validate promote-new-production --strict` 通过，`git diff --check` 通过；新 change 目录人工检查无凭据。本机无 shellcheck/Docker。
- 卷兼容：新机现有卷 `saiflow_pgdata`（project `saiflow`，volume `pgdata`）；以新 compose.yaml 在新机执行 `config` 得 `pgdata.name=saiflow_pgdata`，`--dry-run up -d --no-deps postgres` 仅显示 `Running`，无重建卷提示。
- 提交 `2cd6e4d` 的 CI `44134776958` 失败：scripts 作业 shellcheck 在 workflow 静态测试两行字面 `$` 处报 SC2016。按文件既有写法补 `# shellcheck disable=SC2016`，提交 `f7d4914`；CI `44136129828` 五个作业（backend、frontend、contract、scripts、stack）全部成功。
- 发布前公共 DoH 查询：三个生产域名 A 记录已指向 `130.94.24.117`，`dev-saiflow-app` 指向 `38.60.156.234`；生产版本为 `39af080`。
- Deploy `44137994010`（`environment=production`，`f7d4914`）成功：分支与 CI 门禁、构建推送、SSH 固定主机密钥、复制栈文件、拉取/备份/迁移/重启、三站健康、5432 外部关闭均成功；test 转发保护步骤按设计跳过。
- 发布后三个生产站点 page 200，health 为 status ok/database ok/version `f7d491438892673296e0168fa0da4976a0348e64`。
- 新机 `.env`：`IMAGE_TAG=f7d4914…-production`，`PREVIOUS_IMAGE_TAG=39af080…`；四个应用容器运行 `-production` 标签镜像；PostgreSQL 容器未重启（healthy），仍挂载 `saiflow_pgdata`；users=2、tenants=22、ocr_jobs=26，alembic `0021`。
- 测试站点未受影响：`dev-saiflow-app`、`dev-saiflow-admin` health 仍为 ok/ok/`f7ebd04c`。
- 未覆盖：旧机 `production-forwarding` 标记与过渡转发规则仍保留，因此 test Deploy 仍会被拒绝；清理需负责人确认 DNS 全部生效（含 AAAA）后另行执行。登录后业务、LINE 原生客户端与真实识别未在本次发布中复测。
