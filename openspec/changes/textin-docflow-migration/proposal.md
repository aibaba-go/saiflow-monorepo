# Proposal: textin-docflow-migration

## Why

SaiFlow V1.0 当前 OCR 唯一路径走的是 TextIn 中文站 (`api.textin.com`) 的 `ai/service/v2/entity_extraction`（Prompt 模式）。该模式依赖"自由 prompt + base64 编码文件"返回 `llm_json`，并非 TextIn 主线产品形态，且该能力在新账号/新工作区不可用。为使用长期可用、按工作区分账、可观测（task_id / batch_number / recognition_status / position 坐标）的 OCR 能力，需将外部 OCR 厂商切换到 TextIn DocFlow 英文版 (`docflow.textin.ai`)。同步上传接口与现有 worker 模型（同步单文件调用 → 持久化结果）兼容，是改动面最小的迁移路径。

来源：
- 产品诉求：`docs/10-product/PRD-SaiFlow.md` §12（单厂商路径）、§13（票据类型列表）。
- 现有需求：`docs/20-requirements/functional/EPIC-02-ocr-recognition.md`（FR-OCR-017/018）。
- 现有设计：`docs/30-design/OCR-Pipeline.md` §3、§8（ADR-002：可插拔 OCR/提取引擎抽象）。
- 术语：`docs/10-product/Glossary.md`（`TextIn`、`原始识别载荷` 条目将在同步更新）。

## What Changes

- **`BREAKING`** 将 OCR 厂商从 TextIn 中文 xparse/Prompt 模式切换到 TextIn DocFlow 英文同步上传 `POST /api/app-api/sip/platform/v2/file/upload/sync`。
- **`BREAKING`** 鉴权模型扩展：保留 `x-ti-app-id` / `x-ti-secret-code`，新增**必填**查询参数 `workspace_id`（按工作区隔离凭据，由 Secret Manager 注入）。
- **`BREAKING`** 解析参数从 multipart `config` JSON 字符串迁移到 query string：`parser_parse_mode`（`auto`/`scan`/`vlm`，替代旧 `scan`/`layout`/`article`）、`parser_formula_level`、`parser_crop_dewarp`、`parser_apply_merge`、`parser_dpi`、`category`、`batch_number`、`target_process`。`textin/fields` 自定义字段路径（`extract_with_schema`）下线。
- **`BREAKING`** `ResultVersion.structured` 形状改为 DocFlow 原样结构（`{fields[], items[][], tables[], stamps[], handwritings[], pages[], recognition_status, task_id, batch_number, category, duration_ms, failure_causes}`），保留字段级 `position` 坐标与页面几何，供复核 UI 后续实现"框选高亮"使用。下游（LINE Mini App、复核工作台、Excel 导出）按需映射；不删除现有数据，先做向后映射策略。
- 删除旧实现：`textin/client.TextInClient.extract_with_prompt` / `extract_with_schema` / `extract_file` / `extract_url`、`textin/adapter.run_extraction` 中的旧 Prompt 路径、`textin/field_extractor.py`（parse/sync 启发式字段提取，vendor 切换后不再需要）、`textin/adapter.normalize_response`。
- 新增后端单元测试：基于 `httpx.MockTransport` 注入，覆盖 `upload_file_sync`（成功/失败/超时）以及`items[][] → DM-LineItem` 规范化映射。
- 默认 `timeout_seconds` 从 60s 调整为 300s（DocFlow 同步接口官方建议）。
- 错误响应字段 `message` → `msg`，更新 `textin/errors.TextInAPIError` 与重试判定。

待用户确认的默认决策（见下方 §Open Questions）：
1. 同步上传（与非同步轮询二选一 → 选同步）。
2. `ResultVersion.structured` 存 DocFlow 原样（含 position / pages）。
3. `items[][]` 在 adapter 层转 dict 行，并把单元格 `position` 保留在 `cell_positions[]`。
4. `timeout_seconds` 默认 300s。
5. `workspace_id` 由 Secret Manager / env 注入，`build_textin_settings` 不再硬编码默认 vendor credentials。
6. 旧厂商路径全部直接删除（不留兼容分支）。

## Capabilities

### New Capabilities

- `ocr-vendor/textin-docflow`：TextIn DocFlow OCR 厂商集成。覆盖鉴权（`x-ti-app-id` + `x-ti-secret-code` + `workspace_id`）、同步上传契约、错误与重试语义、`recognition_status` 与 `OcrJob.status` 的映射契约，以及 `items[][] → dict 行` 的规范化规则。该 capability 在后续替换厂商时可被同名/新路径取代以扩展抽象，符合 ADR-002 的"可插拔 OCR/提取引擎"意图。

### Modified Capabilities

无（项目 `openspec/specs/` 当前为空）。

## Impact

- **代码**：`services/api/textin/{client,adapter,config,errors}.py` 重写；`services/api/textin/field_extractor.py` 删除；`services/api/extensions.py` 增 `workspace_id` 装配；`services/api/worker.py` 保留单线程轮询模型，调整 vendor 调用 + `recognition_status` 映射；`services/api/routes/ocr.py` 的 `/ocr/capabilities` 调整 `parse_modes` 枚举（`scan`/`layout`/`article` → `auto`/`scan`/`vlm`）与可接受 params 子集；`services/api/models.py` 持久化 `task_id` / `batch_number` / `category` 列；`services/api/storage.py` 审计 JSON 形状微调；`services/api/openapi.yaml` 同步更新；`services/api/README.md` 调整环境变量表。
- **迁移**：如新增 `task_id` / `batch_number` / `category` 列，配套 Alembic 迁移。
- **前端**：`apps/line-mini/src/{structured.ts, api.ts, i18n.ts, views/ResultPage.vue}` 检查 vendor 词与字段映射适配；本次变更允许**只做最小类型适配**（不改业务行为）。
- **文档**：`docs/30-design/{OCR-Pipeline.md, Architecture.md, Data-Model.md}` 更新厂商与载荷形状；`docs/10-product/{PRD-SaiFlow.md, Glossary.md}` 更新 TextIn/DocFlow 术语；`docs/40-acceptance/Acceptance-Criteria.md` 中 TextIn 相关 Given/When/Then 改写为 DocFlow；`docs/20-requirements/functional/EPIC-02-ocr-recognition.md` 中涉及 vendor 的措辞需统一。
- **测试**：新增 `services/api/tests/test_textin_docflow_client.py`、`test_textin_adapter_normalize.py` 等；后端 Vitest/python test 套件从零起步建立。
- **配置**：运行时新增 `TEXTIN_DOCFLOW_WORKSPACE_ID` 环境变量；`TEXTIN_APP_ID` / `TEXTIN_SECRET_CODE` 沿用同名变量但语义切到 DocFlow；`build_textin_settings` 移除硬编码 vendor 凭据默认值。
- **凭据/合规**：与现有 NFR-SEC 约束一致（仅服务端持有凭据，浏览器不接触）；DocFlow 工作区合规评估暂未完成，视为上线前置条件（与原 TextIn `OQ-7` 同级风险），不在本次变更范围内。

## Non-goals（非目标）

- **不实现** 异步上传 + 轮询状态机：本次只走 `/upload/sync`，OcrJob 状态机不变。
- **不实现** 批次上传（DocFlow 单次支持多文件 → 我们仍坚持一次 OcrJob = 一份上传文件）。
- **不实现** DocFlow File Category 的配置/管理 UI 或 API 封装：File Category 由产品/SRE 在 DocFlow 控制台预先建好；本次变更假设 6 类 P0 单据（PO/Delivery Note/Invoice/Receipt/Credit Note/Tax Receipt）已有对应 Category（命名为 `purchase_order` / `delivery_note` / `invoice` / `receipt` / `credit_note` / `tax_receipt`）。
- **不实现** Frontend 复核 UI 的"框选高亮"功能：保留 position 数据，仅备料。
- **不调整** DeepSeek refine 流程：保留作为可选二次整理模块，输入输出形状按新 structured 调整。
- **不调整** OcrJob 业务字段（`page_count` / `table_count` / `field_count` / `missing_pages`）的语义：从 DocFlow `data.fields` + `data.items` + 统计计算。
- **不迁移** 已有 `ResultVersion.structured` 历史数据：旧值停留在历史版本，新版本走新形状。

## Open Questions（用户需在 review 时定案）

- 若推荐决策 1（同步）被否决切到异步，需要重写 worker、设计、tasks 三份产物。
- 若推荐决策 3 改为"直接存 `items[][]` 原样"，下游契约（`DM-LineItem`、行渲染）需要补变更。
- 若 File Category 命名约定与上述不一致，需打开数据字典对齐。
