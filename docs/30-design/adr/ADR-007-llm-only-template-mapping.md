---
doc_id: ADR-007
title: "LLM-only 模板匹配与转换"
type: adr
status: accepted
version: 1.0.1
updated: 2026-10-31
owner: Product Engineering
source: "document-template-mapping v2，2026-10-30 R1–R6；FR-OCR-018..021"
---

# ADR-007 — LLM-only 模板匹配与转换

## 背景与决策

TextIn Prompt v2的llm_json形状随文档变化。批准方案以有序分组字段/表格及名称/描述/四类型定义目标，不建立JSONPath、规则快速路径、文档分类、计算或可配置标准化引擎。

复用现有 **DeepSeek** 配置做匹配与转换，独立Flask MappingWorker线程不阻塞OcrWorker或Web请求；无新供应商/工具调用。LLM-only指多候选语义匹配与字段提取；零候选不映射、单候选直选及后端校验/类型标准化是明确批准的非模型步骤，不是额外规则匹配引擎。

- 0候选：不建AUTO，使用通用结果；1候选：直选，match_score=null/single_candidate，不调用匹配模型；多候选：目录最多50个，描述截至120字符，ID白名单，score钳制0–1，保留top-3，选最高合法分，低于默认0.7警告仍套用。全部非法修复一次后MATCH_FAILED。
- 原始compact JSON超过60,000字符则RAW_TOO_LARGE，**不截断**。模型只提取源信息，缺失null、不推算/计算合计，每表行对应源行；文档数据非指令，不调用工具。模板外键丢弃计数，缺字段/列补null；对象数组表格≤500行，非法结构修复一次后LLM_INVALID_OUTPUT。
- parse_float=str避免浮点漂移；string trim/空→null，integer安全JSON整数≤2^53−1，decimal规范字符串不舍入，amount至少2位且>2位保留/amount_precision；失败保留原文/type_mismatch，null不算错误，日期仍字符串。
- 原始llm_json不可变；人工草稿补齐模板但保留用户extras/组/列/行，模型extras丢弃规则不能用于删除人工扩展。required仅确认门禁，缺失不是OCR失败；422无写入、草稿/通用不受该门禁，类型警告不拦。

## 开关、调用预算与失败降级

TEMPLATE_MAPPING_ENABLED默认false且本地保持false（共享数据库）。关闭仍存raw快照、保留既有可选DeepSeek整理，不建AUTO/启动MappingWorker，apply返回409；开启只跳过**整理**，匹配/转换仍调用同一DeepSeek。关闭后历史映射仍可读/编辑/导出；无历史快照不回填。

temperature=0、无response_format；连接10秒，读取默认120秒，匹配/转换各首次+最多1次重试（网络/超时/429/5xx/非法输出），等待2秒。约524秒是预算估算，非测试或硬端到端上限。2秒轮询/条件认领；启动及每5分钟恢复超过10分钟停滞的MATCHING/CONVERTING为FAILED/MAPPING_INTERRUPTED。默认每job最多5个新映射含AUTO/FAILED，READY复用不计，不消耗月OCR页额度。

失败/低分可选其他模板或通用；dirty切换先保存。用户重试映射显式传force=true，避免复用旧READY，仍受次数上限约束。READY不会覆盖用户编辑/新pending/确认，切回恢复最近保存版本，可返回旧号、不新增结果版本；每次显式use-generic即使已通用也记录template.generic_selected。详见ADR-006。日志仅用量、模型、提示版本、耗时，不写单据内容。确认记录自动推荐与最终选择反馈。

## 备选方案与代价

| 方案 | 取舍 |
|---|---|
| JSONPath确定性映射 | 不采纳：需维护各源形状路径，与R5批准方向不符 |
| 规则快速路径+模型兜底 | 不采纳：双路径维护且本期无获批规则目录 |
| 新模型/供应商平台 | 不采纳：不扩展本期配置或供应商范围 |
| 现有DeepSeek语义匹配/提取 | 采纳：降低配置复杂度；代价是延迟、token成本、质量/提示注入风险与非确定性 |

温度0和修复重试不保证确定性；force重做可能不同，READY复用才是不新调用。人工核验为最终防线，禁止编造数值。单据仍发送给既有DeepSeek，沿用人工PDPA合规确认，并不表示真实处理范围/跨境合规已通过法律审查。

## 验证与后续条件

2026-10-31隔离SQLite/mock后端816项通过；该记录不是模型质量实测，也不覆盖后续JSON导出及显式通用选择审计补测，实际结果以[汇总验收](../../40-acceptance/Acceptance-Criteria.md)及变更收尾记录为准。真实LLM匹配/转换质量、低分比例、耗时p50/p95、token及切换/必填缺失率基线未运行，0.7保持未经实测校准的初始阈值，不宣称质量已达标。旧5秒端到端NFR、字段confidence/重算/佛历目标不等于本链路验收，其适用范围仍需同步。最终API契约核对见[API-Spec §4](../API-Spec.md#4-尚未对齐的契约差异)：四类型、raw快照、公开描述裁剪、正式JSON导出及审计规则均按本期最终契约验收。两种子已获业务批准、正式CLI validate均通过；共享库仅只读SELECT，重复当前版本任务数0，无DDL/写入，seed、开关开启与部署未授权。

## 追溯

- [EPIC-02：FR-OCR-018..021](../../20-requirements/functional/EPIC-02-ocr-recognition.md)
- [EPIC-08：FR-TEMPLATE-003..005/007](../../20-requirements/functional/EPIC-08-document-template-configuration.md)
- [EPIC-03：FR-VERIFY-018..020](../../20-requirements/functional/EPIC-03-data-verification.md)
- [EPIC-04：FR-ENTRY-002](../../20-requirements/functional/EPIC-04-entry-archiving.md)
- [AC（匹配/转换/降级/核验/导出）](../../40-acceptance/Acceptance-Criteria.md)
- [OCR-Pipeline](../OCR-Pipeline.md)、[API-Spec §4](../API-Spec.md#4-尚未对齐的契约差异)、[ADR-006](ADR-006-relational-template-storage.md)

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|---|---|---|---|
| 1.0.1 | 2026-10-31 | Product Engineering | 对齐force重试、旧号切回不升版/显式通用选择审计与最终API契约；记录816隔离后端及两种子批准/validate，0.7保持初始阈值、真实LLM基线未运行，seed/部署未授权 |
| 1.0.0 | 2026-10-31 | Product Engineering | 记录R5 LLM-only、现有供应商/独立Worker与质量、预算、安全权衡 |
