## Why

旧代码已移入 `legacy/`，`services/`、`apps/`、`packages/*` 都是空的，仓库里没有 CI，部署只能在一位同事的电脑上手工操作（ADR-006 §6）。B-2 起的每个功能都需要一个可测试、可构建、可部署的基础，所以先重建骨架：后端、三个前端空壳、自动生成的接口客户端、CI，以及手动触发的部署（ADR-006 §7 B-1）。

## What Changes

- **新后端 `services/api`**：FastAPI 骨架，按 `docs/00-standards/Python-Backend-Structure.md` 分层；配置读取；Alembic 在 Cloud SQL 的新 schema 中从空白基线开始（不碰旧 `saiflow` schema）；pytest 单元与集成测试；健康检查；统一错误响应。
- **三个前端空壳**（React + TypeScript + Vite，按 `docs/00-standards/React-Frontend-Structure.md`）：
  - `apps/line-mini`：LINE 小程序（Ant Design Mobile）；
  - `apps/web-pc`：用户 PC 版（web-pc 企业版，Ant Design）；
  - `apps/web-admin`：admin 后台（Ant Design）。**新增**：负责人于 2026-10-30 决定 admin 后台独立成应用、独立部署。
  每个空壳只有一个页面，通过接口客户端调用健康检查并显示结果。
- **共享包**：`packages/api-client` 从后端接口描述自动生成；`packages/tsconfig` 共享 TypeScript 配置；`packages/ui` 只建空包结构。
- **CI（GitHub Actions）**：每次推送到 `chore/ai-workflow-v2` 和每个 PR 都运行后端 lint 与测试（使用临时 PostgreSQL）、前端 lint、测试与构建，并检查接口客户端是否与后端一致。
- **部署**：`scripts/` 下的部署脚本负责构建镜像、推送到 Artifact Registry 并部署到 Cloud Run，由 GitHub Actions 手动触发调用；GitHub 通过 Workload Identity Federation 访问 GCP，不保存长期密钥。部署 4 个新的 Cloud Run 服务（命名见 D1），与旧服务并存。旧服务不再维护，可随时丢弃（线上无真实用户）。
- **一次性 GCP 配置说明**：写在 `scripts/` 下，由有项目管理权限的人在 Cloud Shell 中执行一次。内容包括建 Artifact Registry 仓库、建部署服务账号并授权、建 Workload Identity 绑定（只允许本仓库）、在 Secret Manager 中放数据库密码。
- **文档同步**：
  - ADR-006 §7：B-1 改为三个前端空壳，部署改为 GitHub Actions 手动触发；
  - Architecture §0、§5：admin 后台为独立应用与独立 Cloud Run 服务；部署方式改为 GitHub Actions 手动触发；
  - `Directory-Structure.md`：新增 `apps/web-admin`、`.github/`；
  - `ID-Conventions.md`：新增领域代码 `PLAT`（平台基线）。

## Capabilities

### New Capabilities

- `platform-baseline`：所有后续功能共用的平台基线行为，包括健康检查、统一错误响应、配置与凭据加载、前端只经生成的接口客户端调用后端、只能手动触发且只部署通过 CI 的提交。需求编号 `FR-PLAT-001` 起。

### Modified Capabilities

（无。`openspec/specs/` 目前为空。）

## Non-goals

- 登录、游客、租户、套餐、计量（B-2）；上传、OCR、大模型、Firestore、GCS（B-3）；核验、复核、导出（B-4）；任何业务页面（B-5）。
- 自动部署（推送后自动发布）；多套环境（只有当前 GCP 项目一套 dev 环境）；自定义域名。
- 旧服务的下线操作与旧 `saiflow` schema 的删除。
- `packages/ui` 的组件内容；国际化文案（只预留机制，不翻译）。

## Product sources

- `docs/30-design/adr/ADR-006-ai-native-workflow.md` §6（技术栈、API 契约、部署、凭据）、§7（B-1 范围、新 schema）。
- `docs/30-design/Architecture.md` §0（技术基线）、§5（部署模型）、§6（密钥只在服务端）。
- `docs/20-requirements/non-functional/NFR.md`：NFR-SEC-003（最小权限服务账号）、NFR-SEC-009（凭据只在 Secret Manager）、NFR-USAB-004（错误本地化且可操作）、NFR-REL-001（云服务不可用时给出明确失败状态）。
- `docs/00-standards/Python-Backend-Structure.md`、`React-Frontend-Structure.md`、`Directory-Structure.md`。
- 负责人决定（2026-10-30）：部署走 GitHub Actions 手动触发；web-pc 拆为用户 PC 版与 admin 后台；新服务用新名字与旧服务并存。

## Decisions（负责人确认，2026-10-30）

| # | 问题 | 结论 |
|---|------|------|
| D1 | Cloud Run 服务命名 | `saiflow-<be 或 fe>-<目录名>`：`be` 对应 `services/`，`fe` 对应 `apps/`，最后一段与目录名相同。B-1 的 4 个服务为 `saiflow-be-api`、`saiflow-fe-web-pc`、`saiflow-fe-web-admin`、`saiflow-fe-line-mini`；镜像同名。后端按角色命名（将来如有 `worker`、`jobs` 由对应 change 决定），不按业务拆分微服务 |
| D2 | 新 schema 名 | `saiflow_v3` |
| D3 | 区域 | `asia-southeast1`；数据驻留结论仍以 OQ-7 为准 |
| D4 | 一次性 GCP 配置 | 由有项目管理权限的负责人或同事在 Cloud Shell 中执行；部署前在 Cloud Run 列表确认新服务名不与旧服务重名 |
| D5 | 外部服务重试（已定，留给后续） | 所有外部服务（OCR、大模型、LINE 消息、邮件）的临时性错误（超时、对方服务报错、限流）重试 3 次，间隔逐次加长；内容层面的错误不重试。OCR 重试后按 PRD §4.6 切换备用引擎，其余服务重试后标记失败并记录日志。B-1 不调用外部服务，不写入本 change 的需求；在 B-2（LINE、邮件）与 B-3（OCR、大模型）的需求中写成验收标准。OCR 单据重试次数默认 3 次已写入 PRD §4.6（v3.2.1） |

## Impact

- **新增**：`services/api/**`、`apps/line-mini/**`、`apps/web-pc/**`、`apps/web-admin/**`、`packages/{api-client,tsconfig,ui}/**`、`.github/workflows/**`、`scripts/**`。
- **修改**：根 `package.json` 脚本（增加 `web-admin`）；`docs/30-design/adr/ADR-006-ai-native-workflow.md`、`docs/30-design/Architecture.md`、`docs/00-standards/Directory-Structure.md`、`docs/00-standards/ID-Conventions.md`。
- **外部**：GCP 新增 Artifact Registry 仓库、部署服务账号、Workload Identity 池、Secret Manager 密钥、4 个 Cloud Run 服务；Cloud SQL 实例 `saiflow-dev` 中新增 schema `saiflow_v3`。
- **风险**：旧服务曾出现 Cloud Run 连接 Cloud SQL 时口令认证失败（ADR-005），所以新服务部署后必须实际验证数据库连接，并把结果写入 `verification.md`。
- `legacy/` 不改动、不引用。
