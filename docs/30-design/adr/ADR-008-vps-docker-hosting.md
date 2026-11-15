---
doc_id: ADR-008
title: "ADR-008 — 运行环境改为 VPS + Docker，表单数据存 PostgreSQL jsonb"
type: adr
status: accepted
version: 1.1.0
updated: 2026-11-15
owner: Product Engineering
related: [ADR-001, ADR-005, ADR-006, ADR-007, NFR-SEC-001, NFR-SEC-002, NFR-SEC-009, NFR-DATA-005, OQ-7, OQ-8]
doc_source: manual
---

# ADR-008 — 运行环境改为 VPS + Docker，表单数据存 PostgreSQL jsonb

> 定义 v3 的运行环境与存储边界。`Architecture.md`、`Data-Model.md` 与 `AGENTS.md` 第 7 条的运行环境与存储描述以本 ADR 为准，不另行定义。取代 ADR-001 与 ADR-007。

## 状态

accepted（2026-11-02，负责人确认；变更 `adopt-vps-docker`）

## 上下文

- 项目初期 Google Cloud 托管服务（Cloud Run、Cloud SQL、Firestore、Secret Manager）的费用过高，难以承受。
- 负责人已在 LightNode 曼谷机房采购一台 VPS，并手动完成防火墙配置（SSH 端口 11022，开放 80/443）。
- 原方案中 Firestore 只用到“保存不固定结构的 JSON”这一特性，没有用到通知、实时监听等其他特性。
- OCR 引擎 TextIn 与 Google Cloud Vision API 不变；原件等对象继续使用私有 GCS。（`docai-backup-engine`，2026-11-15 修订：Google Cloud Vision API 由 asia-southeast1 的 Google Document AI OCR 取代）
- 约束：PDPA；凭据只在服务端；1–2 人维护。

## 决策

### 运行环境

| 项目 | 决定 |
|------|------|
| 服务器 | 一台 LightNode VPS（曼谷机房），作为唯一的 dev 环境 |
| 运行方式 | Docker Compose：PostgreSQL、后端 API、三个前端（LINE 小程序、web-pc 企业版、web-pc admin 后台）与 Caddy 反向代理 |
| 入口 | Caddy 监听 80/443，自动申请 HTTPS 证书，按域名或路径转发到各容器；其他容器端口不对公网开放 |
| 数据库 | PostgreSQL（Docker 官方镜像，主版本 18），数据放 Docker 数据卷；只在 Docker 内部网络可达，管理员经 SSH 隧道访问 |
| 凭据 | 运行时凭据放在服务器上一个只有管理员可读的环境变量文件中（权限 600），不进仓库、不进镜像；由 Docker Compose 注入容器 |
| 部署 | GitHub Actions 手动触发：构建镜像并推送到 GHCR → 经 SSH（端口 11022）登录 VPS → 执行数据库迁移 → `docker compose` 更新服务 → 健康检查；部署所需的 SSH 私钥等值只放在 GitHub 仓库 Secrets 中，服务器上的部署账号只拥有部署所需的权限 |
| 备份 | 每天导出一次数据库；VPS 本地保留 7 天；每次导出完成后立即复制一份到 GCS 上单独的数据库备份桶，备份桶保留 30 天后自动删除 |
| 日志 | Docker 日志（后端为单行 JSON），按大小轮转；集中日志与告警留到投产前决定（OQ-29） |
| GCP 凭据 | 一个专用服务账号，只授予：业务桶对象读写、备份桶写入、Document AI API User（2026-11-15 前为 Vision API 调用）；其密钥按“凭据”一行保存 |

### 存储边界

按数据性质划分：**对象存私有 GCS，其余全部存 PostgreSQL**。

| 数据 | 存储 | 说明 |
|------|------|------|
| 原始单据、导入文件、导出文件、头像等对象 | 私有 GCS | 只存对象；元数据在 PostgreSQL。下载由后端校验权限后签发有时效的 V4 签名 URL，浏览器不持有凭据 |
| 识别结果：OCR 原始 JSON | PostgreSQL，jsonb | 按载荷版本不可变 |
| 识别结果：大模型按文档模板结构化转换后的 JSON | PostgreSQL，jsonb | 每个结果版本一份 |
| 单据的结果版本、状态（待核验 / 待复核 / 正式业务数据）、核验修改记录、复核记录 | PostgreSQL，普通字段与表 | 不放进 jsonb |
| 用户与关联身份、租户、企业认证（可选）、成员关系、角色与权限点分配、邀请 | PostgreSQL | 系统数据 |
| 套餐目录、订阅、免费额度、续费/升级与企业认证申请、用量与到期提醒记录、站内通知 | PostgreSQL | 月扫描配额计量依赖识别任务记录 |
| 文件元数据、识别任务（状态、页数、所用引擎） | PostgreSQL | |
| 文档格式模板及其版本、系统参数（OCR 引擎与切换参数、大模型配置引用、阈值） | PostgreSQL | 密钥本体在服务器环境变量文件中 |
| 操作日志（审计） | PostgreSQL | 仅追加 |
| 平台 admin 账号 | PostgreSQL | 与客户账号分表隔离 |
| 数据库备份文件 | VPS 本地（7 天）+ GCS 备份桶（30 天） | 备份桶与业务桶分开 |

- **报表：** 方式 A 直接查询 PostgreSQL（含 jsonb）；方式 B 不再使用 Dataflow ETL，需要时在 PostgreSQL 内建立报表汇总表，时机仍按 OQ-8。
- **一致性：** 表单数据与系统数据在同一数据库中，写单据结果与更新识别任务放在同一事务中；重试仍按幂等键避免重复结果（NFR-REL-004）。
- **Cloud Functions：** 不再引入；PRD V2.0 中“Cloud Functions 作为大模型结构化 JSON 的可选处理能力”改为后端异步任务。

## 考虑过的替代方案

| 选项 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. 本决策：VPS + Docker，PostgreSQL 存全部非对象数据，对象仍存 GCS | 费用低；单一数据库，事务一致，后端逻辑简单；对象存储与签名下载能力不变 | 单台服务器是单点；数据库运维（备份、升级、加密）由团队负责；访问 GCS 与 Vision 需保存服务账号密钥 | 已选用 |
| B. 保持 Google Cloud 托管服务（ADR-001、ADR-007） | 运维最少 | 费用超出项目初期承受能力 | 已拒绝 |
| C. 对象也存 VPS 本地磁盘 | 不依赖外部服务，无需 GCP 凭据 | 磁盘容量与备份压力集中在单台服务器；需自行实现签名下载 | 已拒绝（负责人决定保持 GCS） |
| D. 在 VPS 上自建对象存储（如 MinIO） | 兼容 S3 签名 URL；不依赖外部服务 | 多一个需要运维与备份的组件；数据仍在同一台服务器上 | 已拒绝 |

## 后果

- **正面影响：** 托管服务费用基本取消；表单数据与系统数据同库，取消跨库一致性的设计负担；模板字段变化仍无需改表结构（结构化结果在 jsonb 中）。
- **负面影响 / 权衡：** 单台服务器同时承载数据库与全部服务，宕机即全部不可用，磁盘损坏依赖 GCS 上的备份恢复（投产前重新评估）；VPS 上的静态加密方式待定（OQ-30）；服务账号密钥是长期凭据，需按最小权限授予并定期轮换。
- **数据驻留：** 服务器与数据库在泰国境内；GCS 业务桶与备份桶当前位于泰国境外（`asia-southeast1` 新加坡），记入 OQ-7。
- **取代：** ADR-001（Google Cloud 云原生部署）与 ADR-007（表单数据存 Firestore，系统数据存 Cloud SQL）。ADR-005 的自建 PostgreSQL 由本 ADR 定为正式方案（主机与配置与 ADR-005 记录的不同）。
- **新增待决问题：** OQ-29（集中日志与告警）、OQ-30（VPS 上数据库与备份文件的静态加密方式），均在投产前关闭。
- **后续修订：** `AGENTS.md` 第 7 条、`Architecture.md`、`Data-Model.md`、`OCR-Pipeline.md`、PRD 与 NFR 据此修订；B-1 `rebuild-skeleton` 的配置来源与部署需求、B-3 的存储实现按本 ADR 修订。字段级结构以代码（ORM 模型 + Alembic 迁移）为唯一来源。

## 合规与约束检查

- **PDPA：** 浏览器不直接访问 GCS 或数据库，所有访问经服务端授权；对象下载只用有时效的签名 URL（NFR-SEC-002/010）。保留期限与删除策略仍待 OQ-4（投产前关闭）。
- **凭据：** 数据库口令、OCR、大模型与 GCP 服务账号密钥只在服务器环境变量文件与 GitHub Secrets 中，不进仓库与镜像（NFR-SEC-009）。
- **暴露面：** 公网只开放 80/443（Caddy）与 SSH 11022；数据库与各应用容器端口不对公网开放。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-11-15 | Product Engineering | `docai-backup-engine`：Google Cloud Vision API 由 asia-southeast1 的 Google Document AI OCR 取代；服务账号角色同步（决策其余部分不变） |
| 1.0.0 | 2026-11-02 | Product Engineering | 初版：VPS + Docker 运行环境；表单数据存 PostgreSQL jsonb；对象保持私有 GCS；取代 ADR-001、ADR-007 |
