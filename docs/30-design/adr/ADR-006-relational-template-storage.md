---
doc_id: ADR-006
title: "模板映射的关系型存储"
type: adr
status: accepted
version: 1.0.1
updated: 2026-10-31
owner: Product Engineering
source: "document-template-mapping v2，2026-10-30 R1–R6；PRD §3.2/4.8"
---

# ADR-006 — 模板映射的关系型存储

## 背景

当前后端是 Flask + Flask-SQLAlchemy，OcrWorker 为进程内单线程轮询；result_versions、任务、租户已使用 Cloud SQL PostgreSQL 18.6（saiflow-dev / postgres / schema saiflow）。PRD 3.0.0 C-10 曾提出全部表单数据存 Firestore，与当前实现/结果事务不同。此次批准变更要求不可变输入、固定模板版本、可切回编辑分支、统一版本序列及无覆盖的自动生效，不引入跨库事务或事件函数。

## 决策

- 新 document_templates、document_template_versions、ocr_raw_results、template_mappings 和 result_versions.structured 全部使用 PostgreSQL **json**（沿用 db.JSON），不使用 jsonb，保留对象键顺序；groups/items/columns数组顺序为展示和导出契约。
- 模板族为ENABLED/DISABLED+软删除，版本append-only，以规范化name+description+groups SHA-256幂等导入。系统tenant_id=NULL，租户模板仅本租户；部分唯一code索引 `(COALESCE(tenant_id,0),code) WHERE deleted_at IS NULL`。不使用draft/publish。
- llm_json在整理、映射或人工编辑前深拷贝，与v1同一最终事务写一份raw快照；默认关闭的TEMPLATE_MAPPING_ENABLED不影响保存。历史无快照任务不回填，只能通用结果。
- mapping固定引用历史template_version_id。所有新结果版本在任务行锁下取**max(version)+1**，PATCH继承mapping；切换只移动is_current/指针，恢复分支最近编辑，不复制数据、不新增版本，可返回旧号。READY仅pending仍相同、base仍当前、任务未确认时自动生效。
- 当前/待处理mapping及结果循环引用采用可空逻辑指针，应用负责归属和事务清理。删除保留job，在同任务锁内清理raw/mappings/results及指针；Worker阶段前后重读关联，清理后中止不得迟到写回，该路径已静态复核并有隔离测试。每job最多一个is_current的部分唯一索引须在旧库重复检查后补建；2026-10-31共享库transaction_read_only=on下仅SELECT，重复当前版本任务数0，无DDL/写入，不表示已补建索引。
- 内部不可变模板版本保留完整description供模型使用；GET版本对前端裁剪各层description，没有公开描述需求，公开视图不反向修改内部快照。
- 原件仍在私有GCS。既有 **Firestore完整TextIn原始响应归档合法保留**，与新llm_json快照不同；不迁移、不全局删除Firestore，不作为新映射触发源，不引入Cloud Functions/Dataflow执行链。

以上为本期对旧C-10全表单Firestore目标的明确偏差与替代，不修改历史决议。未来报表/Excel导入等非本期目标不因本ADR成为已实现能力。

## 备选方案与权衡

| 方案 | 取舍 |
|---|---|
| Firestore保存新结果+SQL元数据 | 不采纳：跨库版本/切换/确认事务复杂，与当前ORM不一致 |
| PostgreSQL jsonb | 不采纳：不保留对象键顺序，现有渲染/导出依赖顺序 |
| PostgreSQL json | 采纳：复用现有存储和任务锁；代价是不能宣称jsonb索引/查询优势 |

不可变版本和FAILED映射会增加存储；模型输入大小限制不是快照存储限制。decimal/amount在JSON中为不舍入字符串，不受旧decimal(14,2)投影约束；历史NFR相关适用边界需另行同步。

## 未来迁移触发条件（OQ-27）

若真实容量/延迟测量、获批报表跨文档查询需求、法律/区域合规或成本评估表明需要迁移/投影，则另立需求和ADR，定义顺序保持、版本关联、幂等、删除/保留及回滚策略，再授权执行。没有批准新的数值阈值；不会据此自动开启Firestore/Dataflow迁移。OQ-27本期存储选择已解决，未来迁移条件与Architecture/NFR全面同步仍开放。

## 操作与安全边界

本地与生产共用数据库，**本地保持TEMPLATE_MAPPING_ENABLED=false**；禁止以本地Worker处理线上数据。仅两份首批系统种子system.billing_note、system.tax_invoice，已获业务批准并经正式CLI validate通过；共享库seed、schema补建、开关开启与部署未授权。2026-10-31隔离SQLite/mock后端816项通过，共享库仅有上述只读SELECT核查，无DDL/写入；不表示真实PostgreSQL多实例并发、迁移或部署已验收。真实LLM质量/耗时/token基线未运行，验证范围见[汇总验收](../../40-acceptance/Acceptance-Criteria.md)。回滚设计为关开关，保留表/历史映射读取、编辑与导出，不做破坏性回迁。

## 追溯

- [PRD §3.2/4.8](../../10-product/PRD-SaiFlow.md)
- [EPIC-08：FR-TEMPLATE-001..005/007](../../20-requirements/functional/EPIC-08-document-template-configuration.md)
- [EPIC-02：FR-OCR-021](../../20-requirements/functional/EPIC-02-ocr-recognition.md)
- [EPIC-03：FR-VERIFY-018..020](../../20-requirements/functional/EPIC-03-data-verification.md)
- [Data-Model](../Data-Model.md)、[OCR-Pipeline](../OCR-Pipeline.md)、[API-Spec §4](../API-Spec.md#4-尚未对齐的契约差异)
- [AC：模板/快照/切换/并发/门禁](../../40-acceptance/Acceptance-Criteria.md)
- [ADR-007](ADR-007-llm-only-template-mapping.md)

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|---|---|---|---|
| 1.0.1 | 2026-10-31 | Product Engineering | 对齐新版本max+1/旧号切回、完整内部描述与公开裁剪、同锁删除及Worker关联中止；记录816隔离后端、两种子批准/validate和共享库只读重复数0，无DDL/写入 |
| 1.0.0 | 2026-10-31 | Product Engineering | 记录已批准关系型json存储、历史Firestore边界、事务/版本与未来迁移条件 |
