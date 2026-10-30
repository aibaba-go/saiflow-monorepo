---
doc_id: ADR-007
title: "ADR-007 — v3 存储边界：表单数据存 Firestore，系统数据存 Cloud SQL"
type: adr
status: accepted
version: 1.0.0
updated: 2026-10-30
owner: Product Engineering
related: [PRD-001, OQ-21, OQ-27, ADR-001, ADR-006]
doc_source: manual
---

# ADR-007 — v3 存储边界：表单数据存 Firestore，系统数据存 Cloud SQL

> 记录 PRD v3 的数据存储边界，关闭 PRD OQ-27。`Architecture.md`、`Data-Model.md` 与 `AGENTS.md` 第 7 条的存储描述以本 ADR 为准，不另行定义。

## 状态

accepted（2026-10-30，负责人确认）

## 上下文

- PRD v3.0.0 决定：**所有表单数据保存在 Firestore**；PostgreSQL 只保存登录、权限、模板配置等非表单的系统数据（PRD §7.3）。JSONPath 映射与 Cloud Functions 关系投影由大模型结构化转换取代（OQ-19）。
- 这与 `Architecture.md` v2、`Data-Model.md` v1 及 `AGENTS.md` 第 7 条中“Cloud SQL 保存模板化关系投影、Cloud Functions 转换”的约定冲突（OQ-27）。
- PRD v3.1.0 新增账户、租户与计费（§4.9），带来用户、租户、套餐、订阅等系统数据，需要明确它们的存放位置。
- 报表方式 A 直接在 Firestore 查询正式业务数据；方式 B 经 Dataflow ETL 抽取到 Cloud SQL，为后续能力（OQ-8）。
- 约束：PDPA；凭据只在服务端；1–2 人维护，尽量少的数据同步链路。

## 决策

按数据性质划分存储：**对象存私有 GCS，表单数据存 Firestore，系统数据存 Cloud SQL PostgreSQL**。归属如下：

| 数据 | 存储 | 说明 |
|------|------|------|
| 原始单据、导入文件、导出文件、头像等对象 | 私有 GCS | 只存对象；元数据在 Cloud SQL |
| 表单数据：每份单据一个文档，含结构化结果、结果版本、状态（待核验 / 待复核 / 正式业务数据）、核验修改记录、复核记录 | Firestore | 状态为同一文档的字段，不分集合（OQ-21）；报表方式 A 直接查询“正式业务数据”状态 |
| 原始识别载荷（OCR 引擎原始 JSON） | Firestore | 按载荷版本不可变 |
| 用户与关联身份、租户、企业及认证、成员关系、角色与权限点分配、邀请 | Cloud SQL | 系统数据 |
| 套餐目录、订阅、续费/升级与企业认证申请、到期提醒记录、站内通知 | Cloud SQL | 月页计量依赖识别任务记录 |
| 文件元数据、识别任务（状态、页数、所用引擎） | Cloud SQL | 识别任务是处理与计量数据，不是表单数据 |
| 文档格式模板及其版本、系统参数（OCR 引擎与切换参数、大模型配置引用、阈值） | Cloud SQL | 密钥本体在 Secret Manager |
| 操作日志（审计） | Cloud SQL | 仅追加 |
| 平台 admin 账号 | Cloud SQL | 与客户账号分表隔离 |
| 报表数据（方式 B，后续） | Cloud SQL（经 Dataflow ETL） | OQ-8，非 V1.0 |

跨存储的关联以内部 ID 引用：Firestore 中的单据文档引用其租户、识别任务、模板版本与 GCS 对象；不在两边重复保存同一份业务内容。

## 考虑过的替代方案

| 选项 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| A. 本决策：表单数据 Firestore，系统数据 Cloud SQL | 与 PRD v3 一致；模板字段变化无需改表结构；系统数据保留事务与约束 | 跨库没有外键与事务，需应用层保证一致；报表方式 A 受 Firestore 查询能力限制 | 已选用 |
| B. 沿用 v2：Firestore 存原始 JSON，Cloud Functions 投影到 Cloud SQL 关系表 | 关系查询与报表方便 | 每个模板都要维护映射与表结构；与 PRD v3 的大模型转换及“表单数据存 Firestore”冲突；多一条事件链路 | 已拒绝 |
| C. 全部存 Cloud SQL（表单数据用 JSONB） | 单一数据库，事务一致 | 与 PRD v3 决议不符；原始载荷体积大 | 已拒绝 |
| D. 识别任务与核验/复核记录也放 Cloud SQL | 计量统计与审计查询在 SQL 中更简单 | 核验/复核记录脱离单据文档，读取单据需跨库拼装 | 部分采用：识别任务放 Cloud SQL（计量依据）；核验与复核记录随单据文档放 Firestore |

## 后果

- **正面影响：** 存储边界与 PRD v3 一致；模板演进不触发数据库迁移；取消 Cloud Functions 关系投影链路，运维更简单。
- **负面影响 / 权衡：** Cloud SQL 与 Firestore 之间没有跨库事务；写单据文档与更新识别任务状态需按幂等方式设计（B-3 的 `plan.md` 细化）。复杂报表待方式 B。
- **取代：** `Architecture.md` v2 中“Cloud SQL 保存模板化关系投影、Cloud Functions（Firestore 触发）转换”的设计，以及 Architecture §7 所列 ADR-004（proposed）。
- **关闭：** PRD OQ-27。
- **后续修订：** `AGENTS.md` 第 7 条、`Architecture.md` v3、`Data-Model.md` v2 据此修订；字段级结构以代码（ORM 模型 + Alembic 迁移，以及 Firestore 文档的服务端模型）为唯一来源。

## 合规与约束检查

- **PDPA：** 原件、表单数据与系统数据均位于 Google Cloud，启用静态加密；浏览器不直接访问 GCS、Firestore 或 Cloud SQL，所有访问经服务端授权（NFR-SEC-001/002/010）。保留期限与删除策略仍待 OQ-4（投产前关闭）。
- **数据驻留：** 区域在部署配置中确定，须满足 OQ-7 的评估结论。
- **性能：** 报表方式 A 的查询性能受 Firestore 索引约束；超出时按 OQ-8 引入方式 B。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-10-30 | Product Engineering | 初版：v3 存储归属表；关闭 OQ-27 |
