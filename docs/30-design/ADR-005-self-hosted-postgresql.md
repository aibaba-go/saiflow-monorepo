---
doc_id: ADR-005
title: "ADR-005 — 关系数据库迁移至自建 PostgreSQL 17"
type: adr
status: reverted
version: 1.1.0
updated: 2026-10-27
owner: Product Engineering
related: [ADR-001, NFR-SEC-001, NFR-SEC-002, NFR-DATA-005]
---

# ADR-005 — 关系数据库迁移至自建 PostgreSQL 17

## 状态

**reverted（已回切）。** 用户因新库响应慢要求恢复原 Cloud SQL，2026-10-27 已完成回切，当前关系数据存储恢复 [ADR-001](ADR-001-cloud-native-deployment.md)：Cloud SQL PostgreSQL 18.6，实例 `saiflow-dev`，库 `postgres`、schema `saiflow`。本 ADR 不再取代 ADR-001 的数据库条目。

以下“背景”“决策”“迁移记录（2026-10-26）”及“后果与风险”保留为当时的历史记录，不代表当前部署配置、待办或回切操作；当前状态以“回切记录（2026-10-27）”为准。

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

## 回切记录（2026-10-27）

1. **方向与保护：** 按用户因新库响应慢要求恢复原 Cloud SQL 的决定，将源自建 PostgreSQL `odoo.saiflow` 的增量回灌至目标原 Cloud SQL PostgreSQL 18.6（实例 `saiflow-dev` / `postgres.saiflow`）。切换窗口启用维护模式与只读保护，防止晚到请求写入源库。
2. **增量与原记录：** 仅对 `users`、`sessions`、`quota_ledger` 各执行 `INSERT` 2 条，共 6 条；原有记录均未改变，没有更新、删除或覆盖原记录。
3. **只读一致性校验：** 回灌后源与目标 17 张表的逐字节 `COPY` 数据 hash 一致；12 个序列已同步并校验一致；24 个外键均为 `validated`。数据行数为 `users` 33、`sessions` 50、`ocr_jobs`（jobs）36、`files` 43、`result_versions` 43、`quota_ledger` 66。
4. **额外备份：** 原 Cloud SQL 实例的回切前按需备份 `1793029799102` 已确认 `SUCCESSFUL`，自动备份与时间点恢复配置保留。
5. **连接与最小权限：** 未修改 `postgres` 旧密码，而是创建最小权限专用数据库用户 `saiflow_api`。Cloud Run 使用 Cloud SQL Unix 套接字 `/cloudsql/saiflow-509205:asia-southeast1:saiflow-dev`，库 `postgres`、schema `saiflow`；口令由 Secret Manager `saiflow-cloudsql-password` 版本 **1** 注入。本地使用 TLS TCP，`PGSSLMODE=require`（已验证 TLS 1.3）。
6. **流量：** Cloud Run revision `saiflow-api-rb-cloudsql-1793030931` 已承接 **100%** 流量，关系数据读写恢复原 Cloud SQL。
7. **新库只读归档：** 自建库 `odoo.saiflow` 保留为只读归档；只撤销 `odoo_app` 对 `saiflow` 表的 `INSERT`、`UPDATE`、`DELETE`、`TRUNCATE` 及该 schema 序列的 `USAGE`、`UPDATE` 权限，保留 `SELECT`。Odoo 的 `public` schema 未触碰；结合切换窗口的维护与只读保护，防止晚到写入。
8. **验证边界：** 本轮校验为只读操作，未创建测试账号、真实账号或测试数据，未新增真实业务数据（仅回灌既有 6 条增量）。2026-10-26 的全流程验证仅作为历史记录保留；本轮未重新执行 24 项全流程测试，24 个外键的 `validated` 状态不等同于全流程测试通过。
9. **运行与性能校验：** `/api/health` 返回 200；用不存在的会话凭证调用 `/api/v1/auth/session`，数据库查询后返回预期 401。Cloud Run 日志中的服务端耗时约 **12–22 ms**，同类请求回切前为 **2.2–5.7 s**；新 revision 未出现 ERROR 日志。此结果仅代表该只读探测，不代表 OCR 全链路或用户端网络耗时。另有 4 项隔离的配置检查通过（默认 TLS、Unix 套接字、凭据编码、参数覆盖），不连接生产业务数据。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-10-27 | Product Engineering | 标记 reverted，保留历史迁移正文；记录恢复原 Cloud SQL、6 条增量回灌与只读一致性校验、连接及流量状态、新库只读归档和验证边界 |
| 1.0.0 | 2026-10-26 | Product Engineering | 关系数据从 Cloud SQL 迁移至自建 PostgreSQL 17（122.51.11.112 / odoo.saiflow），记录迁移校验、风险与回滚 |
