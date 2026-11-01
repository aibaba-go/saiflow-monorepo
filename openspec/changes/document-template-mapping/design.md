# Design（v2）

## Context

设计以当前代码为准，不以 `docs/30-design` 中的历史目标架构为准：

- 运行时是 Flask + Flask-SQLAlchemy + PostgreSQL 18（Cloud SQL `saiflow-dev`，`postgres.saiflow`）+ 私有对象存储。没有 Firestore、Cloud Functions 或 FastAPI 的生产代码。
- `OcrWorker`（`worker.py`）是单线程进程内轮询。链路：TextIn Prompt v2 `llm_json` →（可选）DeepSeek 整理 → `result_versions.structured` v1。TextIn 调用已有单层自动重试（FR-OCR-017），最坏耗时约 734 秒。
- 结果版本在任务内单一序列（`uq_result_version_job_version`），整个任务只有一个 `is_current`。读取、保存（`expected_version` 乐观并发）、确认、导出都基于这个当前版本（`routes/results.py`、`routes/exports.py`）。
- 前端渲染与导出都按 JSON 形状推断分区：标量归入字段分区，对象数组视为表格（`structured.ts`、`exports.py` 中的 `_field_sections` / `_table_sections`）。
- 租户由 `tenants / memberships` 实现。没有系统管理员角色；运维操作通过后台脚本完成（参照 `admin_plans.py`）。
- 本地开发与线上共用同一数据库，任何 Worker 都可能处理线上数据。

评审决议 R1–R6 见 `proposal.md`。

## Goals / Non-Goals

**Goals**：

- 用最少的数据结构变化接入「模板 → 匹配 → 映射 → 核验 → 导出」。
- 保证原始结果不可变，切换模板可追溯、可切回。
- 不占用 Web 线程。
- 保持现有乐观并发、确认、导出语义不变。

**Non-Goals**：见 `proposal.md`。

## Decisions

### D1. 存储：全部使用 PostgreSQL，JSON 列保持键顺序

- 模板、版本、原始结果、映射结果全部存 PostgreSQL，沿用 `db.JSON`（PostgreSQL `json` 类型保留键顺序，渲染和导出依赖该顺序）。不用 JSONB。
- PRD、Data-Model 与 ADR-006 已同步本期关系型存储决策；历史 Firestore 完整 TextIn 原文归档仍保留，但不是 llm_json 输入快照或模板执行状态来源。日后获批投影/迁移触发条件见 ADR-006（OQ-27）。

### D2. 模板结构与校验

模板文件与版本快照使用同一 JSON 结构：

```json
{
  "code": "system.invoice",
  "name": "Invoice / ใบแจ้งหนี้",
  "description": "泰国增值税发票：含卖方与买方税号、发票号、开票日期、货品明细与含税合计。用于匹配，越具体越好。",
  "groups": [
    {
      "key": "document", "name": "单据信息", "description": "发票头部信息",
      "items": [
        {"kind": "field", "key": "invoice_no", "name": "发票号", "description": "发票编号，通常位于右上角，标注 เลขที่ / No.", "type": "string", "required": true},
        {"kind": "field", "key": "invoice_date", "name": "开票日期", "description": "原样保留，可能为佛历", "type": "string"}
      ]
    },
    {
      "key": "goods", "name": "货品清单", "description": "",
      "items": [
        {"kind": "table", "key": "line_items", "name": "明细", "description": "每行一个货品",
         "columns": [
           {"key": "product_name", "name": "品名", "description": "...", "type": "string", "required": true},
           {"key": "quantity", "name": "数量", "description": "...", "type": "decimal"},
           {"key": "unit_price", "name": "单价", "description": "...", "type": "amount"},
           {"key": "line_total", "name": "金额", "description": "...", "type": "amount"}
         ]}
      ]
    }
  ]
}
```

| 规则 | 值 |
|------|----|
| `type` | `string` / `integer` / `decimal` / `amount`（R2）；缺省为 `string` |
| `required` | 布尔值，缺省 `false`。字段：值非空；表格列：已有的每一行该列都非空 |
| key 格式 | `^[a-z][a-z0-9_]{0,63}$` |
| key 唯一性 | 分组 key 在模板内唯一；字段 key 与表格 key 在分组内唯一；列 key 在表格内唯一 |
| 结构下限 | 至少 1 个分组；每个分组至少 1 项；每张表格至少 1 列 |
| 上限 | 分组 ≤ 20；字段与列合计 ≤ 200；表格 ≤ 10；`name` ≤ 100 字符；`description` ≤ 500 字符（模板级 ≤ 1000） |
| `code` | `^[a-z0-9][a-z0-9._-]{0,63}$`，在同一作用域内唯一，供脚本幂等导入 |

- 校验用 Pydantic 实现，一次返回全部错误（带路径，例如 `groups[1].items[0].columns[2].type`）。
- 每个分组对应结果中的一个对象，因此不允许字段 key 与表格 key 重名。

### D3. 版本快照与模板状态（简化 v1 的草稿 / 发布流程）

- `document_templates`：模板本身，状态为 `ENABLED` / `DISABLED`，`deleted_at` 表示软删除，`current_version_id` 指向当前版本。
- `document_template_versions`：每次导入或更新时，计算规范化 JSON（name + description + groups）的 SHA-256。哈希有变化就新增一个版本号，否则不做任何事。版本行**只增不改**。
- 映射固定引用 `template_version_id`。模板停用、删除或升版后，已有映射照常读取与编辑；新的自动匹配和选择框只使用启用状态、未删除模板的当前版本。
- 内部不可变快照保留各层 description 供模型匹配/转换；公开 GET 版本与结果 schema 裁剪描述，不修改内部快照，不要求前端显示描述。
- 作用域：`tenant_id IS NULL` 为系统模板，`tenant_id = N` 为租户模板。对某个任务可见的模板是 `tenant_id IS NULL OR tenant_id = job.tenant_id`。
- 唯一约束：`(COALESCE(tenant_id, 0), code) WHERE deleted_at IS NULL`，部分唯一索引，避免 NULL 不参与唯一判断的问题。

### D4. 后台维护（R1）

新增 `services/api/manage_templates.py`，风格与 `admin_plans.py` 一致：连接参数与 Flask 相同，不打印密码；写操作需要二次确认，`--yes` 跳过；校验失败时在写库之前退出。

| 命令 | 说明 |
|------|------|
| `list [--tenant-id N \| --system] [--include-deleted]` | 列表：id、code、名称、作用域、状态、当前版本、更新时间 |
| `show --id N [--version V]` | 输出模板 JSON |
| `validate --file F` | 只校验，不连接数据库 |
| `import --file F [--tenant-id N] [--dry-run] [--yes]` | 按 `(作用域, code)` 创建或升版；内容未变则不操作 |
| `export --id N` | 把当前版本 JSON 输出到 stdout |
| `enable` / `disable` / `delete --id N` | 启用 / 停用 / 软删除 |
| `seed [--dry-run]` | 以系统作用域导入 `templates_seed/*.json`，幂等 |

实际有变化的写操作才写入审计日志（`template.created / versioned / enabled / disabled / deleted`，操作人为空，来源 `cli`）；无变化/dry-run 不写审计。validate 不连接数据库；dry-run 只保证不写入，仍可能连接共享库，不能作离线校验。

### D5. OCR 解析结果（原始结果）

- 新表 `ocr_raw_results`，每个任务一行，保存 TextIn `llm_json`。它的 `id` 就是需求里的「OCR 解析结果 ID」（`raw_result_id`）。
- `run_extraction` 不需要修改。Worker 在 DeepSeek 整理之前深拷贝 `result["structured"]`，在最终持久化事务中与 v1 一起写入。
- 只写一次，任何接口都不能修改。不设单独的大小上限，与现有 v1 一致；送入大模型时的大小上限见 D9。
- 无原始快照的历史任务不能套用模板，只能使用通用结果；不回填历史。开关关闭的新任务仍保存并返回 raw_result_id。

### D6. 开关与 DeepSeek

| `TEMPLATE_MAPPING_ENABLED` | 关闭（默认） | 开启 |
|---|---|---|
| 原始结果 | 保存（用户无感知） | 保存 |
| v1 通用结果 | DeepSeek 整理后的 JSON（与现状相同） | 直接使用 TextIn `llm_json`，**不调用 DeepSeek** |
| 自动映射 | 不创建 | 有可用模板时创建 |
| 映射 Worker 与写接口 | 不启动；`apply-template` 返回 409 `TEMPLATE_MAPPING_DISABLED` | 启用 |

代价：开启后，「不套用模板」看到的是 TextIn 原始结构，而不再是 DeepSeek 整理后的结构。这是为了缩短调用链、降低成本，已被评审采纳。

### D7. 映射结果实体与状态机

新表 `template_mappings`，每一次「任务 + 模板版本」的映射尝试对应一行：

```
PENDING ──claim──► MATCHING ──► CONVERTING ──► READY
   │                  │              │
   │ (已指定模板版本时直接 claim 到 CONVERTING)
   └──────────────────┴──────────────┴────► FAILED
```

- `source`：`AUTO`（OCR 成功后系统创建，`template_version_id` 为空，先匹配）或 `MANUAL`（用户选择，直接进入转换）。
- `base_version_id`：创建时任务的当前结果版本。`result_version_id`：转换成功后生成的结果版本。
- 其他字段：匹配得分、理由、候选 top-3、警告、丢弃键数、错误码与消息、大模型调用次数、模型、提示词版本、耗时、时间戳。
- READY 的映射是可复用的成功结果；FAILED 的映射保留，用于展示和审计。

### D8. 结果版本归属与当前指针（解决 v1 方案的核心冲突）

- `result_versions.mapping_id`：版本属于哪个映射，为空表示通用结果。任务内版本号仍为单一序列，**新版本号 = 该任务 `max(version) + 1`**；实现已改为任务 max+1。切回已有分支可返回旧版本号，不复制数据或升版。
- `ocr_jobs.current_mapping_id`：当前版本所属的映射，为空表示通用结果。`ocr_jobs.pending_mapping_id`：用户最近一次请求、尚未完成的映射。
- **切换**（同步、无大模型调用，在任务行 `FOR UPDATE` 下执行）：
  1. 校验：任务成功、未确认，且 `expected_version` 等于当前版本号。
  2. 找到目标（某个 READY 映射或通用结果）的最新版本。
  3. 旧版本 `is_current = false` 并 flush 后再设置目标 `is_current = true`，避免部分唯一索引的瞬时冲突。
  4. 更新 `current_mapping_id`，清空 `pending_mapping_id`，重算表格数与字段数。
  - 不复制数据；目标上次保存的编辑原样恢复。
- **自动生效**：映射 READY 时，Worker 总会生成一个新版本，但只在以下条件**全部**满足时才切换为当前：
  - `pending_mapping_id` 仍等于该映射；
  - 任务的当前版本仍是 `base_version_id`，即期间用户没有保存过编辑或切换过；
  - 任务未确认。
  - 不满足时只保留为「已生成，可切换」；仅 pending 仍指向本映射才清空，不覆盖新请求，不抢走人工编辑。
- **编辑**：PATCH 生成的新版本 `mapping_id = current_mapping_id`。若当前是模板结果，后端先做**结构补齐**：缺失的模板字段补为 `null`，表格行补齐列。模板外新增的字段和行原样保留。确认、乐观并发和审计逻辑不变。
- **确认后**：禁止切换、套用和改为通用结果，返回 409 `state_conflict("results.already_confirmed")`。
- 在一个任务上同时创建 / 切换 / 生效，都在任务行锁下执行。若上线前确认 `result_versions` 中没有重复的当前版本，就加部分唯一索引 `(job_id) WHERE is_current`。

### D9. 匹配（R5，只用大模型）

- 候选 = 对该任务可见、启用、未删除的模板的当前版本。
  - **0 个**：不创建自动映射，结果页显示「暂无可用模板」。
  - **1 个**：直接选中，`match_score = null`，理由为 `single_candidate`，不调用大模型。
  - **≥ 2 个**：调用大模型。
- 模板目录：每个模板只放 `template_version_id`、名称、描述，以及各分组 / 字段 / 列的 key、名称和截断到 120 字符的描述。最多 50 个模板，超出时按更新时间截取并记日志。
- 输出 `{"ranking":[{"template_version_id","score":0..1,"reason"}]}`，最多 3 项。ID 必须属于候选白名单；`score` 被钳制到 0–1，非法项丢弃。**至少有一项合法就选得分最高的一项**；全部非法时修复重试 1 次，仍失败则 `FAILED / MATCH_FAILED`。
- `score < TEMPLATE_LOW_SCORE_THRESHOLD`（默认 0.7）时，结果页提示「匹配度较低，请确认模板」，但仍然套用。
- 原始结果的紧凑 JSON 超过 60,000 字符时，`FAILED / RAW_TOO_LARGE`。**不截断**，以免模型基于不完整数据产生错误映射。用户仍可使用通用结果。

### D10. 转换与类型标准化

- 提示词包含：模板骨架 JSON（分组 → 字段为 `null`、表格为含一行全 `null` 列的数组）+ 每个字段 / 列的名称、描述、类型 + 规则。规则为：
  - 只能使用文档中出现的信息；
  - 找不到的填 `null`，不推算，不计算合计；
  - 数值写原文数字；
  - 每个表格行对应原文中的一行；
  - 只输出 JSON。
- 解析：`json.loads(..., parse_float=str)`，**避免浮点漂移**。
- 结构校验：顶层必须是对象。按模板逐项取值，缺失的补 `null`。表格必须是对象数组，单表最多 500 行。模板外的键丢弃并计数。结构非法时修复重试 1 次，仍失败则 `FAILED / LLM_INVALID_OUTPUT`。
- 结果形状与现有渲染器、导出兼容：`{group_key: {field_key: 标量, table_key: [{col_key: 标量}]}}`。

**类型标准化**：

| 类型 | 规则 | 失败处理 |
|------|------|----------|
| `string` | 转为字符串，去掉首尾空白；空串转为 `null` | — |
| `integer` | 去掉千分位 `,`、空格与币种符号（`฿`、`THB`、`บาท`）后匹配 `^-?\d+(\.0+)?$`，且绝对值 ≤ 2^53−1 → JSON 整数 | 保留原文字符串，记警告 `type_mismatch` |
| `decimal` | 同样清洗后匹配 `^-?\d+(\.\d+)?$` → **规范化字符串**（如 `"1234.5"`），不舍入 | 同上 |
| `amount` | 同 `decimal`；小数不足 2 位补齐到 2 位（`"1234"` → `"1234.00"`）；超过 2 位**不舍入**，记警告 `amount_precision` | 同上 |

- 金额按类型显示千分位且至少 2 位小数，超过 2 位保留全部精度、不舍入或截断；类型/精度警告不拦确认。模板 decimal/amount 编辑使用精确十进制字符串，integer 只提交安全整数；通用分支沿用旧格式。
- `null` 和空值不算类型错误。

### D11. 调用、超时与上限

| 项 | 值 |
|----|----|
| 大模型 | 复用 `DEEPSEEK_BASE_URL / API_KEY / MODEL`；温度 0；不使用 `response_format` |
| 超时 | 连接 10 秒；读取 `DEEPSEEK_TIMEOUT_SECONDS`（默认 120 秒） |
| 每个阶段的调用次数 | 最多 2 次：首次 + 1 次重试（网络 / 超时 / 429 / 5xx 或输出非法），重试前等待 2 秒 |
| 每个映射的最坏耗时 | 约 2 × 2 × 130 + 4 ≈ 524 秒 |
| 卡住恢复 | MATCHING / CONVERTING 状态超过 10 分钟未更新 → `FAILED / MAPPING_INTERRUPTED`，并清空对应的 pending |
| 错误码 | `MATCH_FAILED`、`LLM_TIMEOUT`、`LLM_UNAVAILABLE`（网络 / 429 / 5xx）、`LLM_INVALID_OUTPUT`、`RAW_TOO_LARGE`、`MAPPING_INTERRUPTED` |
| 每个任务的映射次数上限 | `TEMPLATE_MAX_MAPPINGS_PER_JOB = 5`（含自动映射；复用 READY 映射不计）；超出返回 409 `MAPPING_LIMIT_REACHED` |
| 页额度 | 映射不消耗 SaiFlow 月页额度 |
| 日志 | 只记录调用次数、token 用量、耗时、模型和提示词版本（`match-v1` / `convert-v1`），**不记录单据内容** |

### D12. 映射 Worker

- 新增 `mapping_worker.py`（线程名 `template-mapping-worker`），与 `OcrWorker` 在同一处启动。各自独立线程，避免大模型调用阻塞 OCR 队列。开关关闭时不启动。
- 每 2 秒轮询一次，取最早的 PENDING 映射。用条件更新 `WHERE id = ? AND status = 'PENDING'` 认领；影响 1 行才处理，多实例下安全。
- 每个阶段前后重读任务、raw、mapping 与基础结果关联（`populate_existing`）：
  - 任务存在但结果/原始快照/映射关联已清理也必须中止，不以 job 不存在为唯一判据；
  - 任务已确认 → 仍然完成，但不自动生效。
- 启动时执行一次卡住恢复，之后每 5 分钟一次。
- **本地开发注意**：本地与线上共用数据库，本地必须保持开关关闭，否则本地 Worker 会处理线上映射。已写入现有后端 README 与 tasks。

### D13. API

所有写接口走现有 Cookie + CSRF、任务归属（`_get_job_for_user`）与租户校验。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/ocr/jobs/{job_id}/template-options` | `raw_result_id`；该任务可见的启用模板（按自动匹配得分排序，第一项标为推荐）；该任务已有的映射（READY / FAILED 的摘要，供切回或查看失败原因） |
| GET | `/api/v1/templates/versions/{version_id}` | 版本快照，用于预览和渲染。系统模板对所有持有有效会话的用户（含游客会话）可读；租户模板只对该租户成员可读；已停用或删除的模板的版本仍可读，保证历史可追溯 |
| POST | `/api/v1/ocr/jobs/{job_id}/apply-template` | 见下文 |
| POST | `/api/v1/ocr/jobs/{job_id}/use-generic` | `{expected_version}` → 同步切换到通用结果的最新版本，清空 pending，返回结果 |
| GET | `/api/v1/ocr/jobs/{job_id}/results` | 新增字段见下文 |
| PATCH | `/api/v1/ocr/jobs/{job_id}/results` | 请求体不变；新增 D8 的版本号规则、结构补齐，以及**必填门禁** |

**`apply-template` 的处理规则**：

- 请求体为 `{raw_result_id, template_id, expected_version, force?}`，或 `{mapping_id, expected_version}`（切回旧映射）。
- 结果分支：
  - 已有同一模板当前版本的 READY 映射，且 `force` 不为真 → 同步切换，返回 200 + 结果。
  - 同一模板版本正在处理中 → 把 pending 指向它，返回 202。
  - 其他情况 → 新建 MANUAL 映射并设为 pending，返回 202 + 映射。
  - 失败重试传原始结果/模板选择与 `force=true`，避免复用同模板的旧 READY；不绕过处理中复用或次数上限。
- 错误：
  - `raw_result_id` 不属于该任务 → 404；
  - 无原始结果 → 409 `RAW_RESULT_MISSING`；
  - 模板不可见、已停用或已删除 → 409 `TEMPLATE_UNAVAILABLE`；
  - 已确认 → 409；
  - 超过上限 → 409 `MAPPING_LIMIT_REACHED`。

**GET results 的新增字段**：

```json
{
  "raw_result_id": "…",
  "current_mapping": {"id": "…", "template_id": 3, "template_name": "Invoice / ใบแจ้งหนี้",
                       "template_version_id": 12, "template_version": 2, "source": "AUTO",
                       "match_score": 0.62, "low_score": true},
  "template_schema": {"groups": []},
  "pending_mapping": {"id": "…", "status": "CONVERTING", "template_name": "…"},
  "latest_failed_mapping": {"id": "…", "template_name": "…", "error_code": "LLM_TIMEOUT", "error_message": "…"},
  "template_available": true,
  "validation": {"required_missing": ["document.invoice_no", "goods.line_items[2].product_name"],
                 "type_warnings": [{"path": "goods.line_items[0].unit_price", "code": "type_mismatch"}]}
}
```

- 当前为通用结果时，`current_mapping` 与 `template_schema` 均为 `null`。
- `latest_failed_mapping` 只在最近一次映射失败、且之后没有成功映射时返回。

**必填门禁**：`confirm = true` 且当前为模板结果时，按保存后的内容校验 `required`。有缺失则返回 422（`invalid_argument`，`field_errors` 中每项为 `{field: "structured.<path>", reason: "required"}`），不写入版本，也不确认。草稿保存不受门禁限制。

**任务摘要**（列表）新增 `template_name`（当前映射的模板名，通用结果为空）。

### D14. 前端（line-mini）

- `api.ts`：
  - 类型：`TemplateSchema`、`TemplateOption`、`MappingSummary`、`JobResults` 的扩展字段；
  - 函数：`getTemplateOptions`、`getTemplateVersion`、`applyTemplate`、`useGenericResult`。
- `ProcessingPage`：OCR 成功后，若 `pending_mapping` 存在，显示「正在匹配模板…」并每 2 秒轮询结果。最多等 90 秒，之后照常进入结果页（结果页继续轮询）。
- `ResultPage`：
  - 顶部模板选择框。默认显示当前模板，通用结果时显示「不套用模板（通用结果）」。选项依次为：推荐模板（带得分）、其他可用模板（已生成过的标「已生成」）、「不套用模板（通用结果）」。每项可展开预览分组和字段名。
  - 切换前若有未保存的修改，提示「保存并切换 / 取消」，先保存草稿再切换。
  - pending 期间显示「正在套用模板…」遮罩并禁止编辑，每 2 秒轮询，最多 10 分钟。
  - 失败时 toast 加提示条，提供「重试 / 选择其他模板 / 不套用模板」；当前结果保持不变。
  - 提示条：匹配度较低、必填缺失 N 项、转换失败、暂无可用模板。
  - Continue：先在前端检查必填，高亮并滚动到第一个缺失项；同时处理后端返回的 422。
- `StructuredDataView` 新增可选的 `schema` 属性。有 schema 时：
  - 按分组和顺序渲染，显示模板名称和必填星标，必填为空时标红；
  - 模板字段**不显示删除按钮**，只能清空；
  - 数值类型使用数字键盘，金额按 FR-VERIFY-015 格式显示；
  - 表格列按模板顺序；
  - 模板外字段排在模板字段之后，保留现有的增删能力。
  - 无 schema 时完全走现有路径。
- `FinalResultPage`：只读，复用 schema 渲染，并显示模板名。`HistoryPage`：显示模板名标签。
- `i18n.ts`：新增 en / th 文案。

### D15. 导出（FR-ENTRY-002）

- 当前版本带 `mapping_id` 时，XLSX / CSV 按模板分组顺序输出：
  - 字段行为「显示名称 | 值」；
  - 表格表头为列显示名称；
  - 金额按类型（而不是按键名）格式化；
  - 模板外字段追加在对应分组末尾。
- 创建导出时绑定当前结果版本，不提供任意历史版本选择参数。正式格式为 XLSX/CSV/TXT/JSON；JSON 原样输出 structured，application/json、.json，不套用模板显示名/类型格式化。TXT 和通用 XLSX/CSV 旧行为不变。

### D16. 删除、审计与 PDPA

- 删除结果保留 OcrJob，同任务锁事务内清理 results/raw/mappings 并清空任务指针。处理中的 Worker 重读这些关联，已清理则中止且不迟到写入。
- 新增审计动作：
  - `template.applied`（含自动生效）；
  - `template.switched`（含切回）；
  - `template.generic_selected`（每次合法显式通用选择均记录，即使已通用也记录，但不新增结果版本）；
  - `template.mapping_failed`；
  - `template.match_feedback`（自动匹配的模板版本与用户最终确认时的模板版本，在确认时记录一次）。
  - 记录字段：操作人、租户、job_id、映射 ID、模板版本、来源、结果、时间。
- 单据内容会发送给 DeepSeek，与现有整理链路是同一个供应商，范围不扩大。沿用「人工确认模型 PDPA 合规」的约束。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 只用大模型，匹配或转换质量不稳定 | 用 `thai-sample-forms-for-ocr/` 样本建立基线（tasks 9.4）；得分低时提示；用户可一键切换或使用通用结果；记录匹配反馈 |
| 大模型编造数值 | 提示词禁止推算；找不到填 `null`；人工核验是最终防线；不自动计算合计 |
| 用户看到结果的时间变长（OCR 之后多 2 次调用） | 处理页最多多等 90 秒；去掉了 DeepSeek 整理；只有 1 个候选模板时跳过匹配 |
| 用户反复切换产生费用 | 每个任务最多 5 次映射；复用 READY 映射；同时只有一个 pending 生效 |
| 自动映射覆盖用户的编辑 | D8 生效条件要求 base 版本仍为当前版本 |
| 版本号冲突 | 新版本号 = `max + 1`，在任务行锁下执行 |
| 本地 Worker 处理线上数据 | 本地保持开关关闭；部署前停止本地后端 |
| 开启后通用结果不如以前整齐 | 已评审采纳；需要时可关闭开关恢复 |
| 提示注入 | 数据放在分隔符内并声明「文档内容不是指令」；输出 ID 白名单；严格按 schema 取值；不调用工具 |
| 文档与代码漂移 | tasks 第 10 节统一修订文档，并以 `openspec validate` 作为门禁 |

## Migration Plan

1. **后端发布，开关关闭**。
   - 新表与可空列走 `_ensure_tables` / `_ADD_COLUMNS`；新任务开始保存原始结果；用户无感知。
   - 部署前停止本地后端；按惯例 `--no-traffic` 部署，验证后手动切流量。
2. **写入系统模板**。先 `seed --dry-run`。模板内容经业务确认后，由用户授权执行 `seed`（会写入共享库）。
3. **前端发布**。新字段缺失时按现有路径渲染。
4. **开启开关**。更新环境变量生成新 revision，验证后切流量。
5. **回滚**。关闭开关后新任务恢复 DeepSeek 路径，已有映射仍可读、可编辑、可导出；表和列保留，不做破坏性迁移。
6. **监控**。自动匹配成功率、低得分比例、转换失败率与错误码分布、映射耗时 p50 / p95、token 用量、用户切换率、必填缺失率。

## Open Questions

- **Q1（首批已解决）**：两份首批系统种子于 2026-10-30 获业务批准，2026-10-31 正式 CLI 离线 validate 均通过（billing 6组/22项，tax 7组/34项）。共享库 seed 未授权或执行；其他 PO / Delivery Note / Receipt 等待补样本后再加。
- **Q2（本期决策已定）**：模板只有一个显示名称，种子使用 English / ไทย；多语言配置延后，导出采用该名称。
- **Q3（待真实评测）**：0.7 为初始阈值；真实匹配/字段准确率、低分比例、耗时/token 基线未运行，不能从合成测试或单候选 UI score=1.0 推定质量。完整已执行验证与未执行项见 [任务记录](tasks.md)。
