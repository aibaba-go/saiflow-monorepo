---
doc_id: DES-003
title: "SaiFlow — API 规范"
type: api
status: active
version: 1.3.5
updated: 2026-11-01
owner: Product Engineering
source: "services/api/openapi.yaml info.version=1.3.0；document-template-mapping v2"
related: [DM-DocumentTemplate, DM-OcrRawResult, DM-TemplateMapping, DM-ResultVersion, DM-ExportJob]
doc_source: openapi-derived-index
---

# SaiFlow — API 规范

> 接口唯一定义来源为 [后端 OpenAPI YAML](../../services/api/openapi.yaml)，发布镜像为 [openapi.json](openapi.json)，当前 info.version=1.3.0。本文件是源契约的导航、说明及批准方案核对表，不是第二份手工契约；`doc_source` 表示来源关系，不表示本文件由自动生成流程产出。

## 1. 通用契约

- OpenAPI paths 省略前缀，servers 包含 `/api/v1`，下表列完整路径。
- 沿用 HttpOnly `saiflow_session` Cookie（path=/api）、现有会话/注册/租户校验；写请求需要 `X-CSRF-Token`。系统模板可被有效会话（含游客）读取；租户模板仅该租户成员。停用/软删除不使历史版本不可读。
- 成功信封为 `{code:"OK",data:...}`；错误使用 code、message_key、request_id、retryable 及可选 field_errors。不得另造数据/错误结构。
- 任务归属先于开关错误判定，不可访问任务返回 404；开关关闭不应泄漏任务是否存在。新映射不新增订阅/页额度扣减，原认证/注册/租户/确认边界不变。

## 2. 模板与映射接口索引

| 方法/完整路径 | 源契约摘要 | FR / AC |
|---|---|---|
| GET `/api/v1/templates/versions/{version_id}` | 历史固定版本预览/渲染；对前端裁剪各层 description，内部不可变快照保留完整描述；无 REST 写接口 | TEMPLATE-007 / AC-FR-TEMPLATE-007-02/03；VERIFY-018 / AC-FR-VERIFY-018-01 |
| GET `/api/v1/ocr/jobs/{job_id}/template-options` | raw_result_id、可见启用当前模板、推荐/分数、历史 READY/FAILED 映射 | OCR-018 / AC-FR-OCR-018-01/02；VERIFY-018 / AC-FR-VERIFY-018-01 |
| POST `/api/v1/ocr/jobs/{job_id}/apply-template` | `{raw_result_id,template_id,expected_version,force?}` 或 `{mapping_id,expected_version}`；传 mapping_id 忽略其他选择字段；重试映射传 force=true | VERIFY-018 / AC-FR-VERIFY-018-02/04/05/06；OCR-020 / AC-FR-OCR-020-04/09 |
| POST `/api/v1/ocr/jobs/{job_id}/use-generic` | `{expected_version}` 同步恢复通用分支最近保存版本；不要求开关开启；每次显式选择均记录 template.generic_selected，已通用也不新增结果版本 | VERIFY-018 / AC-FR-VERIFY-018-02/05 |
| GET `/api/v1/ocr/jobs/{job_id}/results` | 扩展 ResultVersion 元数据与 schema/validation，无映射时字段可空 | VERIFY-019 / AC-FR-VERIFY-019-01/03；OCR-021 / AC-FR-OCR-021-03 |
| PATCH `/api/v1/ocr/jobs/{job_id}/results` | 保留请求形状/expected_version，补齐模板字段/列但保留人工 extras；模板 confirm:true 必填门禁 | VERIFY-019/020 / AC-FR-VERIFY-019-02、AC-FR-VERIFY-020-01/02/03 |
| POST `/api/v1/ocr/jobs/{job_id}/exports` | ExportCreateRequest 格式 XLSX/CSV/TXT/JSON，绑定创建导出时的当前结果版本，不提供任意版本选择参数；模板 XLSX/CSV 按顺序/显示名/类型导出；JSON 原样 structured、application/json、.json 下载，TXT 旧行为不变 | ENTRY-002 / AC-FR-ENTRY-002-01/02/03 |

apply：READY 且非 force 同步切换 200；同版本处理中复用 202；否则建 MANUAL 并设 pending 返回 202。mapping_id 须 READY。重试使用原始结果与模板选择并显式传 `force=true`，避免复用旧 READY；仍遵守处理中复用及次数上限。错误包括 404、409 TEMPLATE_MAPPING_DISABLED / RAW_RESULT_MISSING / TEMPLATE_UNAVAILABLE / MAPPING_NOT_READY / MAPPING_LIMIT_REACHED / VERSION_CONFLICT，以及 results.not_ready / results.already_confirmed。max_mappings 默认 5 含 AUTO/FAILED，READY 复用不计。

源 template-options 对单候选成功 AUTO 展示 score=1.0；MappingSummary.match_score 仍 null。前者仅 UI 排序/推荐表示，不能作为模型置信度或字段准确率。≥2 候选最高合法分仍可推荐，低分只警告；0.7 是未经真实质量评测校准的初始阈值。

## 3. 结果、并发与确认

ResultVersion 扩展 raw_result_id、current_mapping、template_schema、pending_mapping、latest_failed_mapping、template_available、validation；当前通用时 current_mapping/template_schema=null。description 仅用于模型匹配/转换，内部快照保留，不作为公开字段要求。validation.required_missing 为内容路径，type_warnings 为路径+code。列表 JobSummary.template_name 通用时为空。开关关闭也保存并返回 raw_result_id；仅无快照历史任务为空，无修改 API 或历史回填。

整个任务的所有新结果版本均取 `max(version)+1`，锁任务串行 create/switch/READY/PATCH，PATCH 继承 mapping。切换只移动 is_current/指针，不复制数据/调用模型或新增结果版本，因此可返回旧版本号；下一次新建仍取全任务 max+1。READY 总生成分支版本，但仅 pending 相同、base 仍当前且未确认才自动生效；不覆盖编辑或新 pending。

`confirm:true` 模板 required 缺失返回 **422 INVALID_ARGUMENT / results.required_missing**，`field_errors=[{field:"structured.<path>",reason:"required"}]`；无版本、确认或完成状态写入。草稿/通用不受这项门禁；检查已有表格行，空表不虚造行；类型警告不拦。注册门禁仍先于写入；PATCH 不额外检查套餐订阅，不新增后端订阅门禁。编辑 compact UTF-8 上限 2,000,000 字节不是快照存储上限或模型 60,000 字符限制。

删除结果保留 ocr_jobs 行，在同一任务锁事务内删除 results/raw/mappings 并清指针。Worker 每阶段前后重读任务及原始快照、映射、基础结果关联；关联已清理则中止，不作迟到写入，不以任务行不存在为唯一判据。该删除/中止路径已静态复核并有隔离测试。

## 4. 尚未对齐的契约差异

为保持既有链接，本节保留原锚点标题；内容现为最终契约核对表，不再是未修复清单。

| 项目 | 对齐契约 | 验收/核对依据 |
|---|---|---|
| 字段与列 type | 仅 string/integer/decimal/amount；API YAML 与 JSON 镜像一致 | AC-FR-TEMPLATE-003-02、AC-FR-OCR-019-02 |
| GET 模板版本 description | 对前端裁剪，仅模型使用；内部不可变快照保留完整 description，无公开描述需求 | AC-FR-TEMPLATE-007-03 |
| ResultVersion.raw_result_id | 开关关闭仍保存；仅无历史快照时为空 | AC-FR-OCR-021-01/02/04 |
| 版本增量与切回 | 所有新版本为任务 max(version)+1；切回已有分支可返回旧号，不升版 | AC-FR-VERIFY-018-02/04 |
| JSON 导出 | 正式 format=JSON；application/json、.json 下载，原样 structured；不改变 TXT 行为 | AC-FR-ENTRY-002-03；补测结果以实际收尾记录为准 |
| 删除与 Worker | 保留 job，同任务锁清理 raw/mappings/results；阶段重读关联检测中止 | AC-FR-OCR-020-08；已静态复核及隔离测试 |
| 显式通用选择审计 | 即使已通用也记录 template.generic_selected，不新增结果版本 | AC-FR-VERIFY-018-02；补测结果以实际收尾记录为准 |
| 映射重试 | force=true 避免复用旧 READY，不绕过次数上限 | AC-FR-OCR-020-04/09 |

单候选 UI score 与 mapping null 得分按上述边界区分，不伪造模型得分；其余未受影响接口以源 YAML 为准。NFR/Architecture 已范围化历史事件链路、5 秒性能、佛历/金额精度目标，合法 Firestore 完整原文归档保留；这些旧目标不是新模板的实测性能证据。核对表不是全量接口测试通过或真实质量实测证据，已确认验证及限制见 [Acceptance-Criteria](../40-acceptance/Acceptance-Criteria.md)。

## 5. 追溯与发布边界

- [EPIC-02](../20-requirements/functional/EPIC-02-ocr-recognition.md)、[EPIC-03](../20-requirements/functional/EPIC-03-data-verification.md)、[EPIC-04](../20-requirements/functional/EPIC-04-entry-archiving.md)、[EPIC-08](../20-requirements/functional/EPIC-08-document-template-configuration.md)
- [Data-Model](Data-Model.md)、[OCR-Pipeline](OCR-Pipeline.md)、[汇总 AC](../40-acceptance/Acceptance-Criteria.md)
- [ADR-006](adr/ADR-006-relational-template-storage.md)、[ADR-007](adr/ADR-007-llm-only-template-mapping.md)

本地与线上共用数据库，TEMPLATE_MAPPING_ENABLED 默认关闭，本地保持关闭。CLI 不是 REST 接口；validate 不连接数据库，dry-run 只保证不写入。两种子已获业务批准，正式 CLI validate 均通过；共享库 seed、schema 变更、开关开启及部署未授权。2026-10-31 共享库仅执行 transaction_read_only=on 下的 SELECT，重复当前版本任务数为 0，无 DDL/写入；这不表示索引已补建或部署已验收。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.3.5 | 2026-11-01 | Product Engineering | OpenAPI 1.3.0：套餐改为 `plans` 表配置（FR-SYS-019）。`Plan` 新增 `theme`、`is_default`、`i18n`（en/th 的 `PlanText`：name/price_display/features）；各处 `plan_code` 取消硬编码枚举，合法值以套餐配置为准；`QuotaTenant.plan` 新增 `name_i18n`；`GET /plans` 只返回启用套餐，停用套餐不可申请但已有订阅仍可解析；配置只经 CLI `manage_plans.py` 维护，无管理 REST 接口 |
| 1.3.4 | 2026-10-31 | Product Engineering | OpenAPI 1.2.2：`GET /me/notifications` 与已读接口只作用于账户变动类通知（`Notification.type` 8 值枚举，新增 ACCOUNT_ACTIVATED / COMPANY_ACTIVATED）；OCR 完成不再产生通知，历史 OCR_DONE / INFO 不返回、不计未读（FR-SYS-018） |
| 1.3.3 | 2026-10-31 | Product Engineering | OpenAPI 1.2.1：任务 `stage` 枚举与 `GET /ocr/jobs?stage=` 新增 `TEMPLATE_MATCHING`（成功未确认且 pending_mapping_id 非空），VERIFYING 收窄为无进行中映射（FR-VERIFY-017） |
| 1.3.2 | 2026-10-31 | Product Engineering | 修正导出绑定创建时当前版本、无任意版本选择参数；最新隔离验证链接至汇总AC/任务记录 |
| 1.3.1 | 2026-10-31 | Product Engineering | 收尾对齐四类型、快照/公开描述、max+1与旧号切回、删除中止、正式JSON导出、显式通用审计及force重试；保留§4锚点，补充已确认验证和共享库只读边界 |
| 1.3.0 | 2026-10-31 | Product Engineering | 以源 OpenAPI 1.2.0 替换未启动占位，添加模板/结果/导出导航与门禁 |
| 1.2.2 | 2026-10-12 | Product Engineering | 清空设计内容，待项目启动后由后端 OpenAPI 自动生成 |
| 1.2.1 | 2026-10-12 | Product Engineering | 声明 doc_source: generated，在正文顶部增加自动生成警告框，明确后端 OpenAPI 为唯一来源 |
| 1.2.0 | 2026-10-07 | Product Engineering | 更新上传/批次处理链路并新增 API-10 文档格式模板配置接口 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增 API-4c 固定层级复核策略与复核决定接口；明确不支持任意工作流编排 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | V1.0 初始本地 API 契约（含 V2.0/V3.0 适配器存根） |
