---
title: "Design: textin-extract-v3"
status: draft
version: 0.1.0
updated: 2026-10-20
owner: Product Engineering
related: [EPIC-02, FR-OCR-017, FR-OCR-018, ADR-003]
---

# Design: textin-extract-v3

> **本文档定位：** OpenSpec 变更 `textin-extract-v3` 的设计稿（过程产物，按 `AI-WORKFLOW.md` 铁律二存放于 `openspec/changes/<change>/`）。契约确认并归档后，才把稳定结论沉淀到 `docs/30-design/OCR-Pipeline.md`。
>
> **状态：** 代码路径已落地且默认关闭（`EXTRACT_V3_ENABLED` 缺省 `false`）。extract-v3 的 i/o 契约仍为假设，见 §12 TODO-1。

## 0. 摘要

将 TextIn 的 `extract-v3`（智能抽取）端点接入为新增的可选提取源，与现有 TextIn Prompt 模式 + DeepSeek 整理共存。同一文件走单一路径，失败自动回退，能力字段记录实际路径以便审计。`result_versions.structured` 的 IR 与下游 0 改动。

## 1. 目标 & 非目标

**目标：**
- 提供一条新支路：`TextIn parse/sync`（OCR）→ `TextIn extract-v3`（KV 抽取）→ IR。
- 与现有 `extract_with_prompt` + 可选 `deepseek.refine_json` 双轨并存；按任务能力字段与全局配置开关选择。
- 路径失败时自动回退；回退结果同样落地，可审计。
- 单一任务 = 单一路径：不允许两路并跑合并输出（避免一份件出两份 KV）。

**非目标：**
- 不动 `docs/30-design/OCR-Pipeline.md` §1 mermaid（架构现状与文档不符的技术债，本次不解决）。
- 不重构 renderer（前端 0 改动）。
- 不实现批量回填 / Dataflow（V2 范围）。
- 不替换 DeepSeek 整理为其它的语义整理层；DeepSeek 仅在新支路失败/旧路径上继续生效。

## 2. 背景 & 现状

当前 OCR 链路（`services/api/worker.py:175-246` + `services/api/textin/adapter.py:209-238` + `services/api/deepseek.py`）：

```text
file bytes
  → client.extract_with_prompt(...)        # TextIn Prompt 模式（内置 LLM）
  → result.llm_json → structured
  → （if deepseek.is_configured）deepseek.refine_json(structured)
  → result_versions.structured
```

| 关注点 | 当前值 | 本次是否变 |
|--------|--------|-----------|
| `result_versions.structured` 形状 / 大小限制 2 MB | 不变 | 否 |
| `apps/line-mini/src/components/StructuredDataView.vue` 渲染 | 不变 | 否 |
| `apps/line-mini/src/structured.ts` IR 解析 | 不变 | 否 |
| `services/api/routes/results.py` GET/PATCH | 不变 | 否 |
| `services/api/routes/exports.py` XLSX/CSV | 不变 | 否 |
| `services/api/textin/adapter.py:_count_structure` | 不变 | 否 |
| `services/api/worker.py:_process_inner` | 加分支 | **是** |
| `services/api/textin/client.py` | 加 2 个方法 | **是** |
| `services/api/textin/adapter.py` | 加 1 个函数 + 1 个归一器 | **是** |
| `ocr_jobs.capability` 字段 | 加 `extractor` | **是** |
| `audit/{job_id}.json` 摘要 | 加 `parser` / `extractor` / `fallback_reason` | **是** |
| `FR-OCR-017..018` 描述 | 加 extract-v3 替代路径（不改动词义） | **是（文字层）** |

## 3. 决策 / 选择 A 的理由

**采用 Option A：** Worker 内分支，不引入 provider 注册表或 Cloud Functions 重构。理由：
- 与用户已定的"双轨 / OCR JSON 输入 / DeepSeek 兜底 / 配置开关+能力"四要素严丝合缝。
- 下游 0 改动；变更半径仅 3 文件 + 1 个新归一器。
- 单任务单路径在 worker 一处表达；回退矩阵集中。
- YAGNI：注册表/工厂对"未来第三家厂商"是过度抽象；当前双轨已由 capability 表达。
- 不动 OCR-Pipeline.md §1（消除无关变更）。

B（工厂+注册表）与 C（Pipeline 重写）已讨论并排除（见 §0 节段说明）。

## 4. 架构与落位

### 4.1 文件级落位

```text
services/api/textin/
  ├── client.py          (+ parse_sync, + extract_v3_from_ocr_json)  # 新方法
  └── adapter.py         (+ run_extraction_v3, + normalize_v3_to_ir)  # 新函数

services/api/worker.py   # _process_inner 增加能力分支；其它（重试/取消/审计/通知）不变
services/api/deepseek.py # 0 改动
services/api/routes/results.py / exports.py / models.py  # 0 改动
apps/line-mini/src/components/StructuredDataView.vue + structured.ts  # 0 改动
```

### 4.2 任务级调用序列

```text
file bytes
  │
  ├─ cfg = (job.params.get("extract_v3") ?? app.config.get("EXTRACT_V3_ENABLED", false))
  │
  ├─ if cfg == True:
  │     try:
  │       parse_json = client.parse_sync(file)
  │       v3_raw     = client.extract_v3_from_ocr_json(parse_json, params)
  │       structured = normalize_v3_to_ir(v3_raw)           # 见 §5.2
  │       extractor  = "extract_v3"
  │     except Exception as e:                              # 兜底矩阵见 §6
  │       log.warning("extract-v3 失败，回退 Prompt 模式: %s", e)
  │       fallback_reason = _classify_fallback(e)           # 详见 §6 枚举
  │       # 落下方支路 2，并在结尾改写 capability.extractor = "prompt_fallback"
  │
  └─ else:                                  # 旧路径，行为不变
  │
  └─ else:                                  # 旧路径，行为不变
        result = run_extraction(client, filename, content, params)  # ≡ 既有实现
        if deepseek.is_configured(app.config):
            result["structured"] = deepseek.refine_json(result["structured"], app.config)
            result["refiner"] = "deepseek"
        structured = result["structured"]
        extractor  = "prompt"

result_versions.structured = structured
ocr_jobs.capability = {vendor, parser, extractor, refiner, field_source, fallback_reason?}
```

### 4.3 约束

- 任一任务只走一支；**绝不并跑合并**输出。
- 支路 1 任意阶段抛错（vendor / 空 KV / 归一器校验不过）→ 自动转支路 2，capability 改写 `extractor=prompt_fallback`。
- DeepSeek 整理仅在支路 2 生效；支路 1 自己已分组的 `structured` 不再过 refine。
- 单一支路的 `MAX_VENDOR_RETRIES=3`（文本层 429/458/459 + transport）继续共用；回退后支路 2 重新数。

## 5. 数据流 & 形状契约

### 5.1 IR（保持现有 renderer 口径）

| 节点类型 | 渲染为 | 已能渲染的现有示例 |
|----------|--------|--------------------|
| `dict`（标量叶子 + 嵌套） | 字段表 + 递归字段表 | `{ "invoice_number": "INV-001" }` |
| `[ {…}, {…} ]`（对象数组） | 数据表 | line items |
| `[ "a", "b" ]`（标量数组） | 多行字段 | 电话号码、签名列表 |
| 标量 / 其它 | 自适应展示 | 单值或 JSON.stringify |

定义见 `apps/line-mini/src/structured.ts:39-242`；本次维持不变。

### 5.2 normalize_v3_to_ir 职责边界

- **唯一职责：** 把 extract-v3 返回 JSON 折成 IR 树（dict/array/scalar）。
- **不做：** 语义翻译（如金额判定、字段英文 snake_case 化）；这些仍在 `routes/exports.py:_is_amount_key` 与 `structured.ts:isAmountKey` 上层。
- **不做：** 字段重命名或填充默认；renderer 自动用 `displayName` 对 `_` 转空格。
- 内部校验：`json.dumps(structured, ensure_ascii=False, separators=(",", ":"))` 字节数 ≤ `MAX_STRUCTURED_BYTES = 2_000_000`（与 `routes/results.py:34` 一致）。
- 校验失败抛 `TextInAPIError(-1, "shape_invalid")` 触发回退。

### 5.3 字段/表格计数

沿用 `services/api/textin/adapter.py:_count_structure(node) -> (tables, fields)` 对归一后树计数；与 `ocr_jobs.table_count` / `field_count` 口径一致。

### 5.4 审计增量

`audit/{job_id}.json`（由 `worker.py:253-267` 写）保留现有字段：

```json
{
  "job_id": "...",
  "saved_at": "...",
  "summary": {
    "page_count": 1,
    "table_count": 0,
    "field_count": 12,
    "missing_pages": [],
    "duration_ms": 1234,
    "field_source": "extract_v3",
    "vendor": "textin",
    "parser": "parse/sync",
    "extractor": "extract_v3",
    "fallback_reason": null
  }
}
```

`fallback_reason` ∈ {`null`, `"vendor_error"`, `"empty_or_invalid"`, `"normalize_failed"`}。

## 6. 错误处理与回退矩阵

| 触发 | 当前态 | 本次行为 | `extractor` 终值 |
|------|--------|----------|------------------|
| `parse_sync` 报错（任何阶段错误） | n/a（不存在） | `FAILED`，`error_code=TEXTIN_ERROR_*` | 留空 |
| `extract_v3_from_ocr_json` vendor error（4xx/5xx/458/459/timeout） | n/a | 自动回退支路 2 | `prompt_fallback`，`fallback_reason="vendor_error"` |
| `extract-v3` 返回 KV 为空 / 形态无效 | n/a | 回退支路 2 | `prompt_fallback`，`fallback_reason="empty_or_invalid"` |
| `normalize_v3_to_ir` 抛 `shape_invalid` | n/a | 回退支路 2 | `prompt_fallback`，`fallback_reason="normalize_failed"` |
| 支路 2 内 `extract_with_prompt` 报错 | `FAILED`（既有） | 不变 | 留空 |
| 支路 2 内 `deepseek.refine_json` 抛错 | `WARNING` + 沿用 TextIn llm_json | 不变 | `prompt`，`refiner=""` |
| 任务被取消 | `CANCELLED` + `quota.refund_for_job` | 不变 | 留空 |
| 长时间无进展（>10min） | 重排队回 `QUEUED` | 不变 | 留空 |

**重试预算：** 文本层 `MAX_VENDOR_RETRIES=3`（429/458/459 + transport）。extract-v3 与 Prompt 模式共用这一档，不重复计量；回退到支路 2 后新起一轮计数。回退再失败 → `FAILED`。

**配额：** 任务创建时扣 `free_tasks.remaining` 一次；终态 `FAILED/CANCELLED` 由 `quota.refund_for_job(job_id)` 幂等返还。回退路径不双扣。

**告警：** 单日 extract-v3 → `prompt_fallback` 比例 > 30% 时产生告警（写入 ADR-003，初始阈值默认 30%，可配）。

## 7. 配置 & 能力

### 7.1 全局配置

| 项 | 来源 | 默认 | 说明 |
|----|------|------|------|
| `EXTRACT_V3_ENABLED` | 环境变量 / Secret Manager / app.config | `false` | 新支路总开关 |

### 7.2 任务级能力字段

`ocr_jobs.capability`（既有 JSON 字段）增加：

| 键 | 值 | 写入时机 |
|----|----|---------|
| `extractor` | `"extract_v3"` \| `"prompt"` \| `"prompt_fallback"` | worker 落实路径后写入；提交时**不预置**，避免与代码不一致 |
| `fallback_reason` | `"vendor_error"` \| `"empty_or_invalid"` \| `"normalize_failed"` \| 缺失 | 仅在回退后写入 |
| `parser` | `"parse/sync"` \| 缺失 | 仅在支路 1 写入 |

既有字段 `vendor` / `field_source` / `refiner` 保留并扩值。

### 7.3 任务创建端契约

`POST /api/v1/ocr/jobs` 入参新增可选字段 `extract_v3: bool | null`：

| 入参 | 全局 `EXTRACT_V3_ENABLED` | 实际路径 |
|------|---------------------------|---------|
| `null` | `false` | 支路 2 |
| `null` | `true` | 支路 1 |
| `true` | 任意 | 支路 1 |
| `false` | 任意 | 支路 2 |

不预置 `extractor`；worker 决策后由 worker 写入。

## 8. 测试策略

### 8.1 单测（`services/api/tests/`）

| 文件 | 用例 | 断言 |
|------|------|------|
| `textin/test_client_v3.py` | `parse_sync` 200；`extract_v3_from_ocr_json` 200 / vendor error | data 提到顶层；非 200 code 抛 `TextInAPIError` |
| `textin/test_adapter_v3.py` | `run_extraction_v3` 串起 parse→extract | 两次调用顺序正确；返回统一 `{vendor, structured, field_source, …}` 形状 |
| `test_worker_branch.py` | `_select_extractor` 7 组；`_classify_fallback` 3 类；`_run_extraction_pipeline` 成功/回退/normalize 失败/双失败/取消中断 | cfg 优先级；`fallback_reason` 枚举；双失败抛最后异常；退避期取消不再重试 |
| `test_worker_process.py` | SQLite 全状态机跑 `_process` | `capability.extractor` / `parser` / `fallback_reason` 按 §7.2 落库 |
| `test_config_v3.py` | `EXTRACT_V3_ENABLED` 环境变量 | 缺省 false；truthy/falsy 取值正确 |
| `test_route_extract_v3.py` | `POST /ocr/jobs` 接受 `params.extract_v3` | true/false 落库；非 bool → 400；缺省不落库 |

> 文档形态对比（5 类单据、IR 字节上限、字段集命中率）依赖真实 extract-v3 契约，**契约确认后再补**（见 §10 TODO-1）。

### 8.2 集成测试（`services/api/tests/api/`）

- create→process→get_results 全链路；使用 FastAPI TestClient + mock 双 client。
- 断言：必含 ≥1 dict、≥1 对象数组（line items）、标量叶子 > 5 个；与基线 fixture 字段名集合差异 ≤ 5%。

### 8.3 影子测试（灰度期）

- `EXTRACT_V3_ENABLED=true`；每日 ≤ 5% 任务抽样**额外**跑支路 2，结果不写库，入 `audit/dual/{job_id}.json`。
- 字段数命中率、cell 命中率、KV 空率写到周报。

### 8.4 回滚

| 触发 | 操作 |
|------|------|
| 全局回滚 | `EXTRACT_V3_ENABLED=false`（5 分钟内生效，需 worker 重启或 PM 推送） |
| 任务级回滚 | 用户创建时传 `extract_v3=false`（立即生效，不需重启） |

## 9. FR / AC / NFR 映射

| 现有 ID | 关联位置 | 本次动作 |
|---------|----------|---------|
| FR-OCR-017（TextIn 调用） | `EPIC-02 §4.5` | 文字层追加 "可选 extract-v3 路径"，不改语义 |
| FR-OCR-018（原始 JSON 保存） | 同上 | 同上 |
| FR-EXTRACT-V3-001（新建） | 本设计 §0 | 草案："TextIn extract-v3 作为可选提取源；任务能力字段记录路径；归一器不丢字段、不引入新语义。" |
| FR-VERIFY-002/015/016/017 | `EPIC-03` | 0 改动（renderer/confirm 路径不变） |
| NFR-PERF-001 端到端 ≤ 5s p95 | `NFR.md` | 风险字段：extract-v3 延时不达标 → 影子测试看尾延迟；超阈值时仅保留 `EXTRACT_V3_ENABLED=false` 回滚 |
| NFR-SEC-* | 不变 | TextIn 凭据仅服务端 |

代表性 AC（待 proposal 时落地）：

```gherkin
Scenario: AC-FR-EXTRACT-V3-001-01  默认走 Prompt 模式
  Given 全局 EXTRACT_V3_ENABLED=false，且任务入参未指定 extract_v3
  When  worker 处理新任务
  Then  该任务走 extract_with_prompt
  And   capability.extractor == "prompt"

Scenario: AC-FR-EXTRACT-V3-001-02  全局开启 + 任务 opt-in
  Given 全局 EXTRACT_V3_ENABLED=true，任务入参 extract_v3=true
  When  worker 处理新任务
  Then  该任务走 extract-v3 路径
  And   capability.extractor == "extract_v3"
  And   capability.parser == "parse/sync"

Scenario: AC-FR-EXTRACT-V3-001-03  extract-v3 失败回退
  Given 全局开 + 任务入参 extract_v3=true
  And    mock extract_v3_from_ocr_json 抛 TextInAPIError
  When  worker 处理
  Then  capability.extractor == "prompt_fallback"
  And   capability.fallback_reason == "vendor_error"
  And   result_versions.structured 不为空
  And   job.status ∈ {SUCCEEDED, PARTIAL_SUCCESS}

Scenario: AC-FR-EXTRACT-V3-001-04  归一器超 2 MB 拒收
  Given extract-v3 返回 JSON 归一后 2.5 MB
  When  normalize_v3_to_ir
  Then  抛 TextInAPIError("shape_invalid")
  And   任务回退支路 2，fallback_reason="normalize_failed"
```

## 10. 开放问题 / 已知 TBD

| 项 | 状态 | 影响 |
|----|------|------|
| extract-v3 endpoint 准确 i/o 契约 | TBD（沙箱内无法访问 docs.textin.com） | 设计 §4 / §5 中明确以 IR 边界为唯一约束；归一器将以 i/o 契约为输入实现；合同细节仅影响实现，不影响架构 |
| `EXTRACT_V3_ENABLED` 的部署位置（环境变量 / Secret Manager） | 沿用现有 `DEEPSEEK_API_KEY` 的存储方式 | 部署脚本 |
| 影子测试比例 5% 是否合适 | 周报跑两周后回看 | 阈值 |
| 告警阈值 30% 是否合适 | 同上 | 阈值 |

## 11. 已知后续动作（不在本次范围）

- ~~新增 `docs/30-design/adr/ADR-003-extract-v3-rollout.md`~~ —— 已落地（开关、影子策略、告警阈值、回滚手册）。
- `docs/30-design/OCR-Pipeline.md §1 mermaid` 与代码现状（直跑 Python worker）不符，作为既有技术债；本次不解决。
- 评估 `EXTRACT_V3_ENABLED=true` 后 NFR-PERF-001 达标情况；若不达标，记录为回归并考虑默认回退到 Prompt 模式。
- 契约确认并归档后，把本设计的稳定结论（双轨结构、能力字段、回退矩阵）写入 `docs/30-design/OCR-Pipeline.md`。

## 12. 实现现状（2026-10-20，分支 `feature_ocr_v2`）

已落地并有单测覆盖：

| § 设计条目 | 落地位置 |
|-----------|---------|
| §4.2 `parse_sync` / `extract_v3_from_ocr_json` | `textin/client.py` |
| §4.3 `run_extraction_v3` / `normalize_v3_to_ir` | `textin/adapter.py` |
| §5 cfg 决策与回退 | `worker._select_extractor` / `_classify_fallback` / `_run_extraction_pipeline` |
| §6 重试预算 | `_run_extraction_pipeline` 内 `_do`，每条支路各起一轮 |
| §7.1 `EXTRACT_V3_ENABLED` | `config.py`（`EXTRACT_V3_ENABLED` 环境变量，缺省 false） |
| §7.2 `extractor` / `parser` / `fallback_reason` | `worker._process_inner` 落 `ocr_jobs.capability` |
| §7.3 任务级 `params.extract_v3` | `routes/ocr.py` + `openapi.yaml` |

**与设计的偏差（有意为之）：**

1. `_run_extraction_pipeline` 终态失败时**抛出**最后一次异常而非返回 `None`——`_process_inner` 需要它才能按 `_error_code(err)` 落 `TEXTIN_ERROR_*`（§6 第 1 行与第 5 行）。终态行为与设计一致。
2. 新增 `cancelled` 回调：可重试错误的退避 sleep 期间若任务进入 `CANCEL_REQUESTED`，立即抛 `_ExtractionCancelled` 并落 `CANCELLED`。这是重构前 `_process_inner` 内联重试循环已有的行为，抽出 helper 时需显式保留。

**尚未实现（依赖真实契约）：**

| 编号 | 项 | 说明 |
|------|----|------|
| TODO-1 | extract-v3 i/o 契约 | 端点默认复用 `extract/sync` URL；响应按 `{"extracted": {k: v}}` 假设。字段集合、confidence、bbox、是否含表格均未对齐。 |
| TODO-2 | AC-04 归一器 2 MB 上限 | `normalize_v3_to_ir` 尚无体积校验，`shape_invalid` 目前只由解析失败路径产生。 |
| TODO-3 | §8.2 全链路集成测试 / §8.3 影子测试 | 需真实响应样本后补。 |

## 12. 变更触达清单

| 路径 | 动作 |
|------|------|
| `services/api/textin/client.py` | +2 方法 |
| `services/api/textin/adapter.py` | +1 函数、+1 归一器 |
| `services/api/worker.py` | 加分支（不重写） |
| `docs/20-requirements/functional/EPIC-02-ocr-recognition.md` | §4.5 文字层追加 |
| `docs/30-design/Data-Model.md` | 0 改动（IR 不变） |
| `docs/30-design/OCR-Pipeline.md` | 0 改动（已知技术债） |
| `openspec/changes/textin-extract-v3/` | 新建（proposal.md / design.md / tasks.md） |
| `docs/superpowers/specs/2026-10-20-textin-extract-v3-design.md` | 本文档；批准后**迁移到** `openspec/changes/textin-extract-v3/design.md`，本文档删除 |

## 13. 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 0.1.0 | 2026-10-20 | AI (superpowers:brainstorming) | 初稿；覆盖段 1-4 用户确认内容；TBD §10 待用户提供 extract-v3 契约 |
