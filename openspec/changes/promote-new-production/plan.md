# 新服务器晋升生产 Implementation Plan

> 使用 executing-plans 在本会话内执行。负责人已确认方案、共享桶、暂不改 DNS、允许停机；没有明确提交/推送授权。

**Goal:** 新机承担现有生产，旧机成为独立空库测试，等待负责人切换 DNS。

**Architecture:** 保持 Docker Compose/PostgreSQL 18/Caddy/GCS 边界。新机复制已验证生产镜像和 TLS 资产；最终备份恢复后成为唯一生产写入点，旧机 Caddy 过渡转发生产流量。GitHub production/test Environment 分开配置。

**Tech Stack:** Bash、SSH、Docker Compose、PostgreSQL、Caddy、GitHub CLI、OpenSpec。

**Spec:** specs/platform-baseline/spec.md；FR-PLAT-005/006、NFR-SEC-009、NFR-DATA-005。

## Global Constraints

- 凭据不进 git、不在输出中显示、不长期保存镜像仓库令牌；临时产物仅在 temp/。
- 不更改生产域名，不修改 DNS、GCP 或 LINE 控制台，不调用付费识别。
- 不在迁移成功和恢复验证前清空旧数据库；生产对象不删除。
- 测试库为空，REMINDERS_ENABLED=false、OCR_WORKER_ENABLED=false；清空 SMTP 与 LINE 服务端凭据。
- 双环境 workflow 未提交前，现有仓库级部署配置继续表示唯一生产。

## Review Focus

- DNS 尚指旧机：旧机需以正确 TLS SNI 转发新机，不能形成代理循环。
- 数据最终一致性：停止所有旧写入进程后导出；恢复后比对全部表的行数和内容摘要。
- 证书与凭据复制：仅通过已固定主机密钥的 SSH，权限保留且后端能读自己的 GCS key。
- 共用业务桶：测试库无生产对象引用，识别清理与邮件副作用关闭；测试上传不代表完整识别可用。
- 双环境构建：标签按目标隔离，默认 test；保持 CI 和手动部署门禁。

### Task 1: 访问、原生产镜像和配置准备（FR-PLAT-005-04/05/06）
- [x] 验证两机 root 公钥访问、deploy 登录以及 GitHub 管理权限。
- [x] SSH 加密传输当前运行的四个应用镜像、PostgreSQL 和 Caddy 镜像及备份工具；新机比对镜像 ID。
- [x] 复制生产 .env、GCS key 和 stack 文件；关闭新机后台任务直至迁移完成；检查权限，不打印凭据。

### Task 2: 最终备份、恢复及唯一写入切换（FR-PLAT-006-01/04）
- [x] 停止旧 API、OCR、reminders；旧域名暂时维护响应；最终备份本地与 GCS。
- [x] 新机 PostgreSQL 建立角色后从备份恢复；42 张表逐表 count/内容 MD5 与旧机静止快照一致，序列状态一致。
- [x] 复制 Caddy TLS 资产；新机以原生产 Host/SNI 逐站验证 HTTPS 与版本。
- [x] 旧机原生产域名改为代理新机；再次检查三个公开地址、版本与数据库连通性。
- [x] 新生产审计链、原件读取、每日备份/恢复演练、端口隔离检查。

### Task 3: 旧机空库测试（FR-PLAT-005/006）
- [x] 保留最终备份，停旧 PostgreSQL；原生产 pgdata 卷保留不删除，新建测试卷并初始化/migrate。
- [x] 配置三测试域名；业务桶暂共享，备份加 test/ 前缀；关闭真实 LINE、SMTP、reminders、OCR/清理。
- [x] 保留生产过渡代理规则；验证旧机测试内部服务、数据库、端口、无客户数据及备份恢复；通过只读 SSH 预览验证三个测试前端。
- [ ] 负责人切换 DNS 后验证测试域名公网 HTTPS，并在生产 DNS 生效后移除旧机转发标记与规则。

### Task 4: 双环境部署与运维说明（AC-FR-PLAT-005-07/08）
**Files:** .github/workflows/deploy.yml、scripts/tests/workflow-config.test.sh、docs/deployment/README.md、docs/30-design/adr/ADR-008-vps-docker-hosting.md。
- [x] 先增加默认 test、Environment、目标隔离镜像标签的失败静态测试。
- [x] 最小修改 workflow，运行静态测试及已有脚本回归。
- [x] 创建 production/test Environment，写入各自变量与 SSH Secrets；仓库级变量与 Secrets 指向新生产。
- [x] 更新 ADR/运维说明，记录验证及未覆盖项。未明确授权时不提交、推送或触发新 workflow。

## Completion Boundary

负责人收到新生产可用、旧机测试空库准备完成和 DNS 待切换清单。双环境 workflow 提交、测试域名与 LINE 测试频道仍未就绪时明确标注，不声称全部发布闭环完成。
