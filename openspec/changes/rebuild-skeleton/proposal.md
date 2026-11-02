## Why

旧代码已移入 `legacy/`，`services/`、`apps/`、`packages/*` 都是空的，仓库里没有 CI，过去的部署只能在一位同事的电脑上手工操作（ADR-006 §6）。B-2 起的每个功能都需要一个可测试、可构建、可部署的基础，所以先重建骨架：后端、三个前端空壳、自动生成的接口客户端、CI、手动触发的部署，以及数据库的每日备份（ADR-006 §7 B-1）。运行环境按 ADR-008：LightNode VPS（曼谷）上的 Docker Compose。

## What Changes

- **新后端 `services/api`**：FastAPI 骨架，按 `docs/00-standards/Python-Backend-Structure.md` 分层；配置只从环境变量读取；Alembic 在 PostgreSQL 的 schema `saiflow_v3` 中从空白基线开始；pytest 单元与集成测试；健康检查；统一错误响应。
- **三个前端空壳**（React + TypeScript + Vite，按 `docs/00-standards/React-Frontend-Structure.md`）：
  - `apps/line-mini`：LINE 小程序（Ant Design Mobile）；
  - `apps/web-pc`：用户 PC 版（web-pc 企业版，Ant Design）；
  - `apps/web-admin`：admin 后台（Ant Design）。**新增**：负责人于 2026-10-30 决定 admin 后台独立成应用、独立部署。
  每个空壳只有一个页面，通过接口客户端调用健康检查并显示结果。
- **共享包**：`packages/api-client` 从后端接口描述自动生成；`packages/tsconfig` 共享 TypeScript 配置；`packages/ui` 只建空包结构。
- **CI（GitHub Actions）**：每次推送到 `chore/ai-workflow-v2` 和每个 PR 都运行后端 lint 与测试（使用临时 PostgreSQL）、前端 lint、测试与构建、接口客户端一致性检查、脚本测试，并在 CI 中用 Docker Compose 启动整套服务做一次端到端健康检查。
- **部署**：GitHub Actions 手动触发 → 构建 4 个镜像并推送到 GHCR → 经 SSH（端口 11022，账号 `deploy`）登录 VPS → 用当次有效的令牌登录 GHCR 拉取镜像、用完退出 → 执行数据库迁移 → `docker compose` 更新服务 → 对后端与三个前端地址做健康检查。Caddy 为三个子域名自动申请 HTTPS 证书。
- **数据库备份**：每天导出一次，VPS 本地保留 7 天，导出完成后立即复制到 GCS 的数据库备份桶（桶内保留 30 天）。
- **一次性配置**：
  - VPS：负责人以 root 在服务器上执行一次初始化脚本（安装 Docker、建 `deploy` 账号与部署目录、建只有管理员可读的环境变量文件）；
  - GCP：负责人或同事在 Cloud Shell 中执行一次脚本（建备份桶与生命周期规则、建只授予备份桶写入权限的服务账号）；
  - GitHub：把部署所需的值填入仓库 Secrets 与 Variables。
  说明写在 `docs/deployment/README.md`。
- **文档同步**：
  - ADR-006 §7：B-1 改为三个前端空壳；
  - Architecture §0、§5：admin 后台为独立应用与独立容器；三个子域名；
  - `Directory-Structure.md`：新增 `apps/web-admin`、`.github/`、`docs/deployment/`（规则 10 启用）；
  - `ID-Conventions.md`：新增领域代码 `PLAT`（平台基线）。

## Capabilities

### New Capabilities

- `platform-baseline`：所有后续功能共用的平台基线行为，包括健康检查、统一错误响应、配置与凭据加载、前端只经生成的接口客户端调用后端、只能手动触发且只部署通过 CI 的提交、数据库每日备份。需求编号 `FR-PLAT-001` 起。

### Modified Capabilities

（无。`openspec/specs/` 目前为空。）

## Non-goals

- 登录、游客、租户、套餐、计量（B-2）；上传、OCR、大模型、对象存储业务桶（B-3）；核验、复核、导出（B-4）；任何业务页面（B-5）。
- 自动部署（推送后自动发布）；多套环境（只有一台 VPS 作为 dev 环境）。
- 旧 Google Cloud 资源（Cloud Run 服务、Cloud SQL 实例）的下线；旧数据迁移。
- 集中日志与告警（OQ-29）、VPS 上的静态加密（OQ-30）。
- `packages/ui` 的组件内容；国际化文案（只预留机制，不翻译）。

## Product sources

- `docs/30-design/adr/ADR-008-vps-docker-hosting.md`（运行环境、凭据、部署、备份）。
- `docs/30-design/adr/ADR-006-ai-native-workflow.md` §6（技术栈、API 契约、部署、凭据）、§7（B-1 范围、新 schema）。
- `docs/30-design/Architecture.md` §0（技术基线）、§5（部署模型）、§6（安全性与可靠性）。
- `docs/20-requirements/non-functional/NFR.md`：NFR-SEC-003（最小权限）、NFR-SEC-009（凭据存放）、NFR-USAB-004（错误本地化且可操作）、NFR-REL-001（依赖不可用时给出明确失败状态）、NFR-DATA-005（每日备份）。
- `docs/00-standards/Python-Backend-Structure.md`、`React-Frontend-Structure.md`、`Directory-Structure.md`。
- 负责人决定（2026-10-30）：部署走 GitHub Actions 手动触发；web-pc 拆为用户 PC 版与 admin 后台；新服务用新名字。负责人决定（2026-11-03）：见 D6–D10。

## Decisions（负责人确认）

| # | 问题 | 结论 |
|---|------|------|
| D1 | 服务命名（2026-10-30） | `saiflow-<be 或 fe>-<目录名>`：`be` 对应 `services/`，`fe` 对应 `apps/`，最后一段与目录名相同。B-1 的 4 个服务为 `saiflow-be-api`、`saiflow-fe-web-pc`、`saiflow-fe-web-admin`、`saiflow-fe-line-mini`；镜像与 Docker Compose 服务同名。后端按角色命名（将来如有 `worker`、`jobs` 由对应 change 决定），不按业务拆分微服务 |
| D2 | 新 schema 名（2026-10-30） | `saiflow_v3` |
| D3 | 运行环境（2026-11-02，ADR-008） | LightNode VPS，曼谷机房，Ubuntu 24.04；唯一的 dev 环境 |
| D4 | 一次性配置（2026-11-03） | VPS 初始化由负责人以 root 执行一次；GCP 备份桶与服务账号由负责人或同事在 Cloud Shell 中执行一次 |
| D5 | 外部服务重试（2026-10-30，留给后续） | 所有外部服务（OCR、大模型、LINE 消息、邮件）的临时性错误（超时、对方服务报错、限流）重试 3 次，间隔逐次加长；内容层面的错误不重试。OCR 重试后按 PRD §4.6 切换备用引擎，其余服务重试后标记失败并记录日志。B-1 不调用外部服务，不写入本 change 的需求；在 B-2（LINE、邮件）与 B-3（OCR、大模型）的需求中写成验收标准。OCR 单据重试次数默认 3 次已写入 PRD §4.6（v3.2.1） |
| D6 | 域名（2026-11-03） | 主域名 `aibaba.asia`；`saiflow-app.aibaba.asia` → web-pc 企业版；`saiflow-admin.aibaba.asia` → admin 后台；`saiflow-line.aibaba.asia` → LINE 小程序。每个子域名下的 `/api` 由 Caddy 转给后端，前端与后端同源 |
| D7 | 数据库备份（2026-11-03） | 纳入 B-1；验证时实际做一次从备份恢复的演练 |
| D8 | 镜像拉取（2026-11-03） | 每次部署由 GitHub Actions 带当次有效的令牌登录 GHCR，部署结束即退出登录；服务器上不长期保存镜像仓库凭据 |
| D9 | 部署账号（2026-11-03） | 服务器上建专用账号 `deploy`，只允许 SSH 密钥登录；该账号属于 `docker` 组，权限实际接近 root，dev 阶段接受，记为风险 |
| D10 | SSH 端口（2026-11-02） | 11022；公网只开放 80、443、11022 |

## Impact

- **新增**：`services/api/**`、`apps/line-mini/**`、`apps/web-pc/**`、`apps/web-admin/**`、`packages/{api-client,tsconfig,ui}/**`、`.github/workflows/**`、`scripts/**`（含 `scripts/deploy/` 下的 Compose 文件与 Caddy 配置）、`docs/deployment/README.md`。
- **修改**：根 `package.json` 脚本（增加 `web-admin`）；`docs/30-design/adr/ADR-006-ai-native-workflow.md`、`docs/30-design/Architecture.md`、`docs/00-standards/Directory-Structure.md`、`docs/00-standards/React-Frontend-Structure.md`、`docs/00-standards/ID-Conventions.md`；`docs/30-design/openapi.json` 与 `API-Spec.md`（由新后端导出替换）。
- **外部**：VPS 上的 Docker、`deploy` 账号、部署目录与环境变量文件；DNS 中三个子域名指向 VPS；GHCR 中 4 个镜像；GCS 备份桶与只写服务账号；GitHub 仓库 Secrets 与 Variables。
- **风险**：单台服务器承载数据库与全部服务（ADR-008）；`deploy` 账号权限接近 root（D9）；备份是唯一的恢复手段，所以 B-1 验证中必须实际做一次恢复演练，并把结果写入 `verification.md`。
- `legacy/` 不改动、不引用。
