---
doc_id: ADR-001
title: "ADR-001 — Google Cloud 云原生部署"
type: adr
status: accepted
version: 1.0.1
updated: 2026-10-02
owner: Product Engineering
related: [NFR-SEC-001, NFR-SEC-002, NFR-DATA-001]
---

# ADR-001 — Google Cloud 云原生部署

## 状态

已接受。

## 背景

SaiFlow 项目已明确选择 Google Cloud 作为生产云平台。
- 前端与 FastAPI 后端均须部署至 Cloud Run；
- 结构化的业务数据须持久化到 Cloud SQL for PostgreSQL 18.6；
- 原始文档和派生文件须保存在私有 Google Cloud Storage Bucket。

## 决策

- React + Ant Design 前端以独立容器部署至 Cloud Run。
- Python + FastAPI API 以独立容器部署至 Cloud Run。
- 业务结构化数据存储在 Cloud SQL for PostgreSQL 18.6。
- 非固定结构的业务数据（例如OCR识别结果的原始JSON数据）持久化到 FireStore ；
- 原始上传文件、预处理派生文件、导出归档文件存储在私有 GCS Bucket；数据库中仅保存 GCS URI 和元数据。
- Cloud Run 服务使用专用服务账号访问 Cloud SQL 和 GCS；不向浏览器暴露 GCS 服务账号凭据。
- 所有资源区域、项目 ID、实例连接名、Bucket 名称通过部署环境变量或 Secret Manager 提供，不硬编码。

## 考虑过的方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 本地桌面应用 + 本地存储 | 离线能力强 | 交付、升级、集中运维困难；不符合云平台决定 | 拒绝 |
| Cloud Run + Cloud SQL + 私有 GCS | 无服务器运维、按需扩缩、托管数据库与对象存储 | 依赖网络；需严格配置 IAM 与 PDPA 控制 | 采用 |
| Cloud Run + 仅 GCS | 组件较少 | 无法可靠支持事务、审计、关系查询与权限数据 | 拒绝 |

## 后果

- **正面：** 可弹性扩缩；前后端独立发布；文档对象与关系数据分别使用合适的托管服务；便于备份、审计与集中运维。
- **权衡：** 取消 V1.0 离线运行承诺；网络可用性和云成本成为运行约束。
- **安全要求：** GCS Bucket 必须私有、启用统一桶级访问控制；Cloud SQL 不公开暴露；最小权限 IAM；传输使用 HTTPS；静态数据采用 Google Cloud 托管加密，并可按合规需求配置 CMEK。
- **待实施：** Cloud Run 服务账号、Cloud SQL 连接器、Secret Manager、CI/CD 与监控告警。

## 合规与约束检查

PDPA 适用：需定义数据区域、保留/删除策略、授权访问和审计记录。区域选择尚未确定，必须在部署前由项目负责人确认。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-10-01 | Product Engineering | 记录 Google Cloud Cloud Run、Cloud SQL PostgreSQL 18.6 与私有 GCS 的正式部署决策 |
