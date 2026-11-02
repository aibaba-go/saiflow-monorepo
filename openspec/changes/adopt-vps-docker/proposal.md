## Why

项目初期 Google Cloud 托管服务（Cloud Run、Cloud SQL、Firestore、Secret Manager）的费用过高。负责人于 2026-11-02 决定：运行环境改为租用的 LightNode VPS（曼谷机房），在服务器上用 Docker 运行全部服务与 PostgreSQL；表单数据不再使用 Firestore，改为 PostgreSQL。现有架构、PRD 与需求文档都以 Google Cloud 托管服务为前提，必须先改文档，B-1（`rebuild-skeleton`）的部署部分与 B-2 起的实现才有依据。

## What Changes

只改文档，不改代码。按下面的决定新增 ADR-008，并同步受影响的文档。

### 负责人决定（2026-11-02）

| # | 主题 | 决定 |
|---|------|------|
| H1 | 运行平台 | LightNode VPS，曼谷机房；服务器已采购，防火墙已手动配置，SSH 端口 11022 |
| H2 | 环境 | 先只有一台 VPS 作为 dev 环境：PostgreSQL、后端、三个前端与反向代理都在这台服务器上，用 Docker Compose 运行 |
| H3 | 数据库 | PostgreSQL 运行在 VPS 的 Docker 中，取代 Cloud SQL |
| H4 | 表单数据 | 取代 Firestore，全部存 PostgreSQL。**jsonb 只用于识别结果**：OCR 原始 JSON，以及大模型按文档模板把原始 JSON 结构化转换后的 JSON。结果版本、单据状态、核验记录、复核记录用普通字段（整数、字符串等）保存 |
| H5 | 对象存储 | **保持私有 GCS**（原件、导入与导出文件、头像等）；下载使用后端签发的有时效的签名地址（GCS V4 签名 URL，相当于 AWS 的 presigned URL），浏览器不持有凭据 |
| H6 | 密码与密钥 | 取代 Secret Manager：运行时凭据放在服务器上一个只有管理员可读的环境变量文件中，不进仓库、不进镜像；部署所需的值放在 GitHub 仓库 Secrets 中 |
| H7 | 部署 | GitHub Actions 手动触发：构建镜像并推送到 GHCR → 经 SSH（端口 11022）登录 VPS → 执行数据库迁移 → `docker compose` 更新服务 → 健康检查。入口使用 Caddy 反向代理并自动申请 HTTPS 证书 |
| H8 | 数据库备份 | 每天导出一次；VPS 本地保留 7 天；每次导出完成后立即复制一份到 GCS 上单独的数据库备份桶 |
| H9 | 不变 | OCR 引擎 TextIn 与 Google Cloud Vision API 不变 |

### 由上述决定带来的连带调整（负责人 2026-11-02 确认：S1–S9 按建议；VPS 已开放 80/443）

| # | 主题 | 建议 |
|---|------|------|
| S1 | GCP 凭据 | VPS 不在 Google Cloud 内，访问 GCS、签发签名地址与调用 Vision 需要一个服务账号密钥。建一个专用服务账号，只授予：业务桶的对象读写、备份桶的写入、Vision 调用；密钥按 H6 放在服务器环境变量文件中 |
| S2 | 数据驻留 | GCS 桶位于泰国境外（现为 `asia-southeast1` 新加坡），原件与备份因此在境外；记入 OQ-7，不影响开发 |
| S3 | 报表 | 报表方式 A 改为直接查询 PostgreSQL（含 jsonb）；方式 B 的 Dataflow ETL 不再需要，改为“必要时在 PostgreSQL 内建立报表汇总表”，仍按 OQ-8 决定时机 |
| S4 | Cloud Functions | PRD 中 V2.0 “Cloud Functions 作为大模型结构化 JSON 的可选处理能力”改为“后端异步任务”，不再引入 Cloud Functions |
| S5 | 跨库一致性 | 表单数据与系统数据同在一个数据库，写单据与更新识别任务可以放在同一事务中；ADR-007 中“跨库无事务、需幂等”的约束随之取消（重试幂等仍保留，NFR-REL-004） |
| S6 | 数据库暴露 | PostgreSQL 端口不对公网开放，只在 Docker 内部网络中可达；管理员经 SSH 隧道访问 |
| S7 | 日志与监控 | Cloud Logging / Cloud Monitoring 改为 Docker 日志（单行 JSON，按大小轮转）；告警与集中日志留到投产前再定（新增 OQ） |
| S8 | 静态加密 | NFR-SEC-001“云平台静态加密”改为：GCS 保持静态加密；VPS 上数据库与备份文件的加密方式待定（新增 OQ，投产前关闭） |
| S9 | 备份桶保留期 | GCS 备份桶设生命周期规则，保留 30 天后自动删除 |

### 受影响的文档（`legacy/` 与已归档的 change 不改）

- **新增：** `docs/30-design/adr/ADR-008-vps-docker-hosting.md`。
- **ADR：** ADR-001 标记 superseded（被 ADR-008 取代）；ADR-005 补充说明“自建 PostgreSQL 由 ADR-008 定为正式方案”；ADR-007 标记 superseded（存储边界改由 ADR-008 定义）；ADR-006 §6（部署、凭据）与 §7（B-1、B-3 范围中的 Firestore、Cloud Run）。
- **设计：** `Architecture.md`、`Data-Model.md`、`OCR-Pipeline.md`、`docs/00-standards/Python-Backend-Structure.md`、`docs/01-templates/TPL-04-data-model.md`。
- **产品与需求：** `PRD-SaiFlow.md`（C-10、§3、§4.7 报表、§5 架构图、§7.3 决议等）、`Vision-Scope.md`、`Personas.md`、`Glossary.md`、`NFR.md`（SEC-001/002/003/009/010、REL-001/003、DATA-005）、`Requirements-Index.md`、`Acceptance-Criteria.md`、EPIC-02、EPIC-04、EPIC-06、EPIC-08。
- **仓库入口：** `AGENTS.md` 第 7 条、根 `README.md`、`openspec/config.yaml`。
- **记忆：** 本地 AI 记忆中“ADR-005 自托管 PG 是临时的”一条作废。

## Capabilities

### New Capabilities

（无。本 change 只改文档，`.openspec.yaml` 设 `skip_specs: true`。）

### Modified Capabilities

（无。`openspec/specs/` 目前为空。）

## Non-goals

- 不改代码；不迁移旧环境的数据；不下线旧 Google Cloud 资源（另行处理）。
- 不在本 change 中修改 B-1 `rebuild-skeleton` 的 proposal、spec 与 plan：本 change 归档后，B-1 按 ADR-008 单独修订并再请负责人确认。
- 不选定监控告警方案与数据库加密方式（S7、S8 记为 OQ）。

## Impact

- **后续 change：** B-1 `rebuild-skeleton` 需修订（FR-PLAT-003 凭据来源、FR-PLAT-005 部署与密钥要求、plan 第 3、6–10 步）；B-3 的存储实现改为 PostgreSQL jsonb + GCS。
- **外部：** VPS 上需开放 80/443 端口给 Caddy；GCS 新建数据库备份桶；GCP 新建专用服务账号（S1）。
- **风险：** 单台服务器同时承载数据库与全部服务，宕机即全部不可用、磁盘损坏依赖异地备份恢复；投产前需要重新评估。

## 实施说明（2026-11-02）

- 按上面的清单修改；以下两处与清单不同，理由如下：
  - `EPIC-*`、`Acceptance-Criteria.md`、`Requirements-Index.md` **未改**：`AGENTS.md` 规则 6 规定需求与 AC 只经 change 的 delta spec 落地，不再直接改写；这三类文件已标注“与 PRD 冲突时以 PRD 为准”，其中的存储表述在 B-2～B-4 迁入 `openspec/specs/` 时按 ADR-008 改写。
  - `OCR-Pipeline.md` 只在开头加“已过时”说明：全文是 v2 设计，按 ADR-006 §7 在 B-3 重写。
- 历史记录（各文档的版本历史、PRD §0 的 v2.2.2 对比列、已决议问题的原结论、已归档的 change）保留原文，只在需要处注明“按 ADR-008 修订”。
- `docs/30-design/openapi.json` 中的旧环境描述在 B-1 Task 4 由新后端导出的契约整体替换，本 change 不改。
