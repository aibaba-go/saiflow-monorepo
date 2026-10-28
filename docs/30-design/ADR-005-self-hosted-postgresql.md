---
doc_id: ADR-005
title: "ADR-005 — 关系数据库迁移至自建 PostgreSQL 17"
type: adr
status: accepted
version: 1.0.0
updated: 2026-10-26
owner: Product Engineering
related: [ADR-001, NFR-SEC-001, NFR-SEC-002, NFR-DATA-005]
supersedes: "ADR-001 中“关系数据存 Cloud SQL for PostgreSQL 18.6”部分"
---

# ADR-005 — 关系数据库迁移至自建 PostgreSQL 17

## 背景

2026-10-26 前后，Cloud SQL 实例 `saiflow-dev`（PostgreSQL 18.6）出现两类问题：GCP 项目计费一度停用（Cloud Run 返回 “billing is disabled”），且 Cloud Run 通过 Unix 套接字连接时 `postgres` 用户的口令认证失败，导致 API 依赖数据库的请求不可用。产品方决定把关系数据迁移到自建的 PostgreSQL 服务。

## 决策

- 关系数据改存自建 PostgreSQL **17.6**：主机 `122.51.11.112:5432`，库 `odoo`，用户 `odoo_app`，schema `saiflow`（与 Odoo 业务表在不同 schema，互不干扰）。
- 后端连接参数全部来自环境变量 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSCHEMA/PGSSLMODE`（`services/api/config.py`）。Cloud Run 上的 `PGPASSWORD` 从 Secret Manager 的 `saiflow-pg-password` 注入，不再以明文环境变量保存。
- 会话统一 `TimeZone=UTC`，因为模型时间均为 naive UTC，而新服务端默认时区为 `Asia/Shanghai`。
- 表结构以 `models.py` 为准（应用启动时 `_ensure_tables` 同源）；Cloud SQL 中的 `odoo` schema 不在本次迁移范围。
- GCS 原件、Firestore 与 Cloud Run 部署方式不变。

## 迁移记录（2026-10-26）

1. 用 `gcloud sql export sql` 导出 `saiflow-dev/postgres` 的一致性快照（不需要数据库口令）。
2. 在目标库按 `models.py` 建表，并与导出结构比对：17 张表、15 个索引、51 个约束全部一致。
3. 先移除外键，再用 `COPY` 原样装载各表数据，恢复 24 个外键（重新校验），并按导出值对齐 12 个序列。
4. 逐表比对行文本：迁移后数据与快照完全一致（含 users 31、ocr_jobs 36、result_versions 43、files 43 等）。
5. 后端与 Cloud Run 切换到新库，并用一次性 dev 账号走通全流程：登录、上传、OCR、核验修改、Excel 导出。

## 后果与风险

- **传输未加密（待整改）：** 新服务端目前未启用 SSL，`PGSSLMODE=prefer` 下连接会以明文传输，与 NFR-SEC-002 的“传输加密”要求不符。服务端启用 SSL 后，应把 `PGSSLMODE` 改为 `require`。
- **公网暴露：** 数据库端口对公网开放（Cloud Run 出口 IP 不固定），需依赖强口令；后续应通过 VPC 出口固定 IP 加白名单，或改走隧道/VPN 来收敛。
- **PDPA / 数据驻留：** 数据库所在地区与原 Cloud SQL（asia-southeast1）不同，需要确认个人数据跨境存储符合 PDPA 要求。
- **静态加密与备份：** 由自建服务器负责（NFR-SEC-001、NFR-DATA-005），需要另行配置备份。
- **回滚：** Cloud SQL 实例 `saiflow-dev` 暂时保留且未删除。回滚时把 Cloud Run 的 PG* 环境变量改回 `/cloudsql/saiflow-509205:asia-southeast1:saiflow-dev`，并恢复 Cloud SQL 连接与 `postgres` 口令；切换后新库产生的增量数据需要回灌。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-10-26 | Product Engineering | 关系数据从 Cloud SQL 迁移至自建 PostgreSQL 17（122.51.11.112 / odoo.saiflow），记录迁移校验、风险与回滚 |
