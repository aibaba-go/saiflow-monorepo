# Design: textin-docflow-migration

> Reference: `proposal.md` for motivation, `specs/ocr-vendor/textin-docflow/spec.md` for behavior contract.

## Context

- 当前 OCR 唯一路径走 TextIn 中文站 (`api.textin.com`)，通过 `ai/service/v2/entity_extraction`（Prompt 模式 + base64 + 自由 prompt）实现；结果用 `llm_json` 直接作为 `ResultVersion.structured`。
- 调用链是 Flask worker 单线程轮询（`services/api/worker.py`）拉取 `QUEUED` 任务，调 `run_extraction`（`services/api/textin/adapter.py`）→ `client.extract_with_prompt`，一次调用同步拿到 JSON，序列化进 `ResultVersion`。
- 凭据从 `build_textin_settings` 解析 Flask config，回退到环境变量，再回退到 **硬编码默认值**（`textin/config.py:65-83`），凭据管理违反最小特权。
- 服务端无单元测试（`client.py` 已留好 `httpx.MockTransport` 注入位，但实际没有 `test_*.py`）。
- 架构上 `OCR-Pipeline.md` §8 提出 `ExtractionProvider` 接口契约（ADR-002）但未在代码中落实为正式抽象；本次替换以单实现重写的方式对齐该意图。

## Goals / Non-Goals

**Goals**

- 替换外部 OCR 厂商到 TextIn DocFlow，同步上传接口，最小改动 worker 模型。
- 在持久化载荷中保留 vendor 原始形状（含字段级 `position` 与 `pages[]` 几何），不丢失位置信息。
- `items[][]` 规范化保持下游可观察，且不丢单元格级 `position`。
- 把 vendor 凭据管理收敛到 Secret Manager / env，去掉源码中的硬编码默认值。
- 同时补全后端 unit test 体系（本次新增 DocFlow 客户端与 adapter 规范化的测试）。
- 落 ADR-003 记录本次厂商替换决策。

**Non-Goals**

- 不引入 `ExtractionProvider` 多实现注册表（保持单厂商单实现；下一变更再抽象）。
- 不引入 DocFlow 异步上传轮询。
- 不实现 File Category 配置 API 封装。
- 不在前端层面启用坐标高亮（数据已就位）。
- 不迁移旧 `ResultVersion.structured` 历史数据。

## Decisions

### D1. 同步上传（`/upload/sync`） vs 异步轮询

**Decision:** 采用同步上传 `POST /api/app-api/sip/platform/v2/file/upload/sync`。

**Rationale:**

- 现有 worker 模型是"任务出队 → 单次同步调用 → 落库"，同步上传直接对接，无需重写状态机、DB schema、轮询端点。
- 单文件 p95 ≤ 5s（NFR-PERF-002）；文档建议同步超时 ≥ 300s，足以覆盖大文件。
- 同步路径下，`recognition_status` 只会出现终态（1 / 2），不需要 worker 新增中间态（0/3/4/5/6/7/20）分支。

**Alternatives considered:**

- **异步 `POST /file/upload` + `GET /file/fetch` 轮询**：要新建 `recognition_status` 中间态映射、`task_id`/`batch_number` 持久化、`OcrJob` 增加字段，worker 改成"upload → poll → finalize"两段式。功能等价，改动显著更大；放弃。

### D2. `ResultVersion.structured` 存 DocFlow 原样

**Decision:** 把 DocFlow 响应的 `result.files[0]` 子树（含 `data`、`pages`、文件级元数据）原样存入 `ResultVersion.structured`。

**Rationale:**

- 字段级 / 单元格级 `position` 坐标是 DocFlow 的稳定外延能力，复核 UI 后续要做"框选高亮"是刚需，不能丢。
- 保留 `pages[].width/height/dpi/angle` 元数据，未来前端做 PDF/image 渲染与坐标变换无需再次 vendor 调用。
- 现有下游（前端、导出）需做适配但**契约调整是单向、版本化的**（新数据走新形状，历史数据按版本判定）；符合 PRD §12.2 "原始识别载荷" 的"原样保存"原则。

**Alternatives considered:**

- **在 adapter 层规范化成扁平 `{fields, tables}`**：下游契约最稳，但丢失 `identifier` / `stamps` / `handwritings` 等信息、单元格坐标要重做映射。放弃。
- **双写（DocFlow 原样 + 规范化副本）**：DB 增列、审计完整但引入"哪个是真相"的歧义；本次变更不引入，等真有必要时再切。延后。

### D3. `items[][]` 在 adapter 层转 dict 行（`row.cells` + `row.kv` + `row.cell_positions`）

**Decision:** adapter 在写库前把每个 row 转成 `{row_index, cells: [{key, value, position}], kv: {...}, cell_positions: [...]}`。

**Rationale:**

- DocFlow `items[][]` 是 cell 数组，每个 cell 自带 key，缺列定义层；不规范化存储会逼迫每条下游路径自行转换。
- 同时保留 `cells[]`（带 `position`）和 `kv`（按 key 取值），让"按字段查值"的简单场景不用遍历坐标，也保证坐标信息不丢。
- 同 key 后值覆盖前值（dict 语义）符合下游期望；前值位置仍可在 `cell_positions` 找回。

**Alternatives considered:**

- **原样存 `items[][]`**：0 转换工作但下游每处渲染逻辑都要重写；契约风险太大。放弃。
- **只存 `kv`，丢弃 cell 坐标**：丢失复核 UI 必需的坐标；放弃。

### D4. `timeout_seconds` 默认 300s

**Decision:** `TextInSettings.timeout_seconds` 默认从 60.0 改为 300.0。

**Rationale:**

- DocFlow 官方文档明示同步上传"建议设置较长超时"，复杂文件会显著拉长处理时间。
- 与 NFR-PERF-002 不冲突（p95 5s 是单个样本的厂商侧处理，但上传 + 同步返回含网络往返与多文件排队）。

### D5. 凭据治理：移除硬编码默认值

**Decision:** `build_textin_settings` 不再含 `TEXTIN_APP_ID` / `TEXTIN_SECRET_CODE` 的硬编码默认 vendor 值；新增 `textin_docflow_workspace_id` 同样仅来自 env 或 app.config。

**Rationale:**

- `textin/config.py:65-83` 当前给 `textin_app_id` 默认值 `4a8a32165b164e4fef6f2e54336de2d7`、给 `textin_secret_code` 默认值 `eac1b93270d3c7b9b7641c89309bb444` —— 这是 vendor 真实凭据被硬编码到源码，违反 NFR-SEC（仅服务端持有凭据，且来源应是 Secret Manager）。
- 本次变更强制走 Secret Manager / env，部署配置缺失时明显失败（`init_textin` 已有的"未配置凭据则跳过 client 创建"行为保留）。

**Alternatives considered:**

- **保留默认值，改默认值指向 placeholder**：仍违反"按 secret 管理凭据"的纪律；放弃。

### D6. 删除旧 vendor 调用路径

**Decision:** 删除 `TextInClient.extract_with_prompt` / `extract_with_schema` / `extract_file` / `extract_url`、`adapter.run_extraction` 中的旧入口、`textin/field_extractor.py` 与 `adapter.normalize_response`。

**Rationale:**

- 旧路径对应的 vendor 能力（中文 xparse `parse/sync`、Prompt 模式 llm_json）已不存在；保留代码会引入死路径。
- 没有外部调用者（`worker.py` 是唯一调用方，本次顺路改），删除无 break risk。

**Alternatives considered:**

- **保留为 deprecated**：不存在 deprecated 路径的兼容价值（P0 新厂商）；维护成本高；放弃。

### D7. ADR-003 —— 「DocFlow 取代 xparse 作为 V1.0 唯一 OCR 厂商」

**Decision:** 新建 `docs/30-design/adr/ADR-003-textin-docflow-replaces-xparse.md`。

**Rationale:** 这是一次有取舍的厂商决策（选 sync、保原样、删旧路径），符合 `docs/30-design/Architecture.md` §"ADR" 中"涉及权衡的架构决策需记录"。

## Risks / Trade-offs

- **风险：** 把 DocFlow 原样结构写入 `ResultVersion.structured` 后，下游（特别是 `apps/line-mini/src/structured.ts` 与 `apps/web-pc` 复核 UI）短期内读不出 `data.fields[]`。
  - **Mitigation：** apply 阶段在 frontend 增加最小适配层（增加"读不到新结构时回退旧 shape"的兼容读取），并把"前端结构性适配"列为独立 tasks 任务，禁止蔓延到 UI 业务改动。

- **风险：** 同步接口长尾延迟（> 60s）可能堵住 worker 单线程。
  - **Mitigation：** worker 状态机保留 cancel 入口 (`CANCEL_REQUESTED`，`worker.py:108`)，用户在前端 cancel 时立即返回；同步超时 300s 上限保护。如未来延迟常态化，把 worker 改成"软并发（最多 N 个）即可"，属 P1 延后项。

- **风险：** `workspace_id` 配置漏配时所有任务 FAILED，影响交付。
  - **Mitigation：** `init_textin` 在缺失凭据时打 WARN 并设 `OCR_VENDOR_UNAVAILABLE` 错误码；任务创建路由也校验（前置截流，避免入队后失败浪费配额）。

- **风险：** `items[][]` 规范化的"同 key 后值覆盖"语义可能让"同 key 不同位置"信息最终无 UI 入口查看。
  - **Mitigation：** 把 `cells` / `cell_positions` 完整存进 DB，前端需要查看历史值时从那里读。

- **风险：** `recognition_status` 枚举值集合是 vendor 文档自家陈述，缺枚举值（3/4/5/6/7/10/20）是否在同步接口下出现未经证实。
  - **Mitigation：** 在 `_map_recognition_status` 中将任何不在已知集合内的值映射为 `DOCFLOW_UNEXPECTED_STATUS` 并记录原始值到 `error_message`，便于线上观测。

- **Trade-off：** 移除硬编码 vendor 凭据默认值意味着本地开发首次启动必须显式配置三个 env 变量。
  - **Acceptance：** `services/api/README.md` 提供示例 `.env.example` 与启动说明。

## Migration Plan

1. **Pre-cutover：** 部署 DocFlow 工作区 + 创建 6 类 P0 单据对应 File Category（产品/SRE 侧，不在本次变更范围）；为 Secret Manager 注入 `TEXTIN_APP_ID` / `TEXTIN_SECRET_CODE` / `TEXTIN_DOCFLOW_WORKSPACE_ID`。
2. **Cutover：** apply 阶段任务一次性合并：删除旧代码、新代码上线、worker 自动用新 vendor 调用；同时新增 `OcrJob.task_id` / `batch_number` / `category` 三列（Alembic migration 同步）。
3. **Rollback：** 旧 vendor 凭据不再有意义，回滚只能恢复代码 + DB schema；配置侧无回滚路径。这是接受的风险 —— 旧 vendor 能力本身在新账号不可用。
4. **Post-cutover：** 监控 `OCR_FAILED` 占比与 `recognition_status` 分布；首 7 天保留旧字段解析兼容读取以防回看历史结果。

## Open Questions

- Workspace ID 与 `workspace_id` 应在 Secret Manager 中作为单一 secret 还是拆成独立三项 secret？—— 不影响本次实现，部署侧决策，延后。
- 是否需要为本次变更提供 mock DocFlow vendor server（用于本地集成测试）？—— apply 阶段再评估。
