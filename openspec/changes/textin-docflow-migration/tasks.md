# Tasks

> 实现顺序按依赖排列；每组内任务自带测试（不需要末位集中处理）。本次 apply 范围按 `openspec/config.yaml` 的 `operations.apply.guidance` 收敛到 `apps/`、`packages/`、`services/`；docs/ 与 openspec 自身的更新归到 `## Workflow follow-up` 段（archive 阶段执行）。

## 1. Config & errors 基础

- [x] 1.1 在 `services/api/textin/config.py` 增加 `textin_docflow_workspace_id: str` 与 `timeout_seconds` 默认 300.0；移除 `textin_app_id` / `textin_secret_code` 的硬编码 default vendor 凭据（替换为 `""`）；并把 `TEXTIN_DOCFLOW_WORKSPACE_ID` 加入 `build_textin_settings` 的 env 解析顺序。验证：运行 `pytest services/api/tests/test_textin_config.py -q` 通过，且测试断言"无 env 时不含默认值字符串"
- [x] 1.2 重写 `services/api/textin/errors.py`：错误响应解析用 `msg` 字段（不再是 `message`）；新增错误码分类常量（`DOCFLOW_RECOGNITION_FAILED` / `DOCFLOW_UNEXPECTED_STATUS` / `OCR_VENDOR_UNAVAILABLE`），并保留 GBK 解码 fallback。验证：`pytest services/api/tests/test_textin_errors.py -q` 通过，覆盖 `code=200` / `code=429` / `code=400` / `code=-1` + gb2312 文本四种响应

## 2. Vendor 客户端与规范化

- [x] 2.1 重写 `services/api/textin/client.py`：删除 `extract_with_prompt` / `extract_with_schema` / `extract_file` / `extract_url` 四个方法，新增单一 `upload_file_sync(filename, content, content_type, *, parser_params)` 方法；请求走 `POST https://docflow.textin.ai/api/app-api/sip/platform/v2/file/upload/sync`，`workspace_id` 等解析参数全部置入 query string；鉴权头保持 `x-ti-app-id` / `x-ti-secret-code`；解析响应读 `msg` 字段；保留 `transport=httpx.BaseTransport` 注入位。验证：`pytest services/api/tests/test_textin_client.py -q` 全绿，至少覆盖 (a) 成功 200 with `result.files[0].data.fields[0]`，(b) `code != 200` 抛 `TextInAPIError`，(c) workspace_id 缺失从 query string 缺失即报错
- [x] 2.2 重写 `services/api/textin/adapter.py`：新增 `run_extraction(client, *, filename, content, params)` 单一入口；把响应 `result.files[0]` 整段原样存进 `ResultVersion.structured`（含 `data.{fields,items,tables,stamps,handwritings}`、`pages`、文件级元数据）；按 `recognition_status` 映射 `OcrJob.status`（1 → SUCCEEDED 且 fields/items 双非空 / 否则 PARTIAL_SUCCESS；2 → FAILED；其他 → FAILED with DOCFLOW_UNEXPECTED_STATUS，`failure_causes` 进 `error_message`）；返回 `task_id` / `batch_number` / `category` 给 worker。验证：`pytest services/api/tests/test_textin_adapter.py -q` 全绿，覆盖三档 status、失败原因截断、空 items[][]
- [x] 2.3 新增 `services/api/textin/adapter.py` 内的 `normalize_items_to_rows(items)` 把 `items[][]` 转 `{row_index, cells:[{key,value,position}], kv:{...}, cell_positions:[{key,position}]}` 纯函数（用于 tests 覆盖）；同 key 后值覆盖前值，缺 key 用 `${row}-${col}` 占位；返回行列表供 worker 写入结构化结果。验证：`pytest services/api/tests/test_textin_adapter_items.py -q` 全绿，覆盖 (a) 单行多列、(b) 行内重复 key、(c) 缺 key 的 cell
- [x] 2.4 删除 `services/api/textin/field_extractor.py` 与 `services/api/textin/adapter.py` 中旧 `normalize_response` / `_page_numbers` / `_page_texts` / `_normalize_tables` / `_find` / `_fields_for_page` 等 parse/sync 启发式代码；grep 后确认 worker.py / routes 仅引用 `run_extraction`。验证：`grep -rn 'extract_with_prompt\|extract_with_schema\|field_extractor\|normalize_response' services/api` 输出空

## 3. 持久化 schema 迁移

- [x] 3.1 在 `services/api/models.py` 给 `OcrJob` 增加 `vendor_task_id` / `vendor_batch_number` / `vendor_category` 三列（`String`，可空）以及 `recognition_status`（`Integer`，可空）；保留已有字段不变。验证：`pytest services/api/tests/test_models_columns.py -q` 通过
- [x] 3.2 / 3.3 项目无 Alembic（schema 同步入口是 `python setup_db.py`，源码 `setup_db.py` 用 `db.drop_all()` + `db.create_all()`）；3.1 的四列建模后由 setup_db.py 在首次部署时建表。在 `services/api/README.md` 增加一节，写明新部署必须先跑 `python setup_db.py`，并把 `TEXTIN_APP_ID` / `TEXTIN_SECRET_CODE` / `TEXTIN_DOCFLOW_WORKSPACE_ID` 三个 env 列为"必填 vendor 凭据"（不做 README 之外的运维脚本新增；任务 5.2 已覆盖 env 详尽描述）。验证：`grep -n 'setup_db.py\|TEXTIN_DOCFLOW_WORKSPACE_ID' services/api/README.md` 输出非空

## 4. Worker / extensions / routes 集成

- [ ] 4.1 改写 `services/api/extensions.py` 中 `init_textin`：当 `textin_docflow_workspace_id` 为空时与 app_id/secret 同样记 WARN 且不创建 client；保留 `atexit` 关闭行为。验证：单元测试覆盖"三凭据齐全 / 三凭据全缺 / 仅缺 workspace_id"三场景
- [x] 4.2 改写 `services/api/worker.py` 调用路径：`_process_inner` 调 `run_extraction`，捕获 `TextInAPIError` 时复用现有重试逻辑但 error_code 改新体系；`OcrJob` 写入 `vendor_task_id` / `vendor_batch_number` / `vendor_category` / `recognition_status` / `vendor = "textin-docflow"`；审计 JSON 写入完整 structured 摘要。验证：`pytest services/api/tests/test_worker_docflow.py -q` 全绿，覆盖 (a) 成功落 structured 形状、(b) `recognition_status=2` 落 FAILED with failure_causes、(c) 429+200 重试两轮后成功
- [x] 4.3 调整 `services/api/routes/ocr.py` 的 `/ocr/capabilities`：把 `parse_modes` 从 `["scan","layout","article"]` 改为 `["auto","scan","vlm"]`；`create_job` 在 `params` 校验里拒绝 `parser_parse_mode ∉ {auto,scan,vlm}` 与 `layout/article` 等旧 vendor 键。验证：`pytest services/api/tests/test_ocr_routes.py -q` 全绿，覆盖合法 / 拒绝两路
- [x] 4.4 在 `routes/ocr.py` 任务摘要/详情返回中暴露 `task_id` / `batch_number` / `category`，使 `OcrJob.to_summary` 与 detail 端点都看得到 vendor 标识。验证：单测断言 detail 响应含三个字段

## 5. OpenAPI / 服务 README 同步

- [x] 5.1 更新 `services/api/openapi.yaml`：让 `/ocr/capabilities` 响应 schema 中的 `parse_modes` 与新枚举一致；任何 mention `x-ti-*` 鉴权 header 的描述保留。验证：`python -c "import yaml; yaml.safe_load(open('services/api/openapi.yaml'))"` 无报错且 `parse_modes == [auto, scan, vlm]`
- [x] 5.2 在 `services/api/README.md` 列出 `TEXTIN_APP_ID` / `TEXTIN_SECRET_CODE` / `TEXTIN_DOCFLOW_WORKSPACE_ID` 三个 env；删除旧 vendor URL 描述；给出 `.env.example` 节选（不放真凭据）。验证：人工对照 README 与 config.env 解析对照表一致

## 6. 前端结构性适配

- [x] 6.1 在 `apps/line-mini/src/structured.ts` 新增 `DocFlowStructured` 类型（含 `data.fields[].position` 与 `data.items[][]`），并把 `ResultVersion.structured` 类型改为"`DocFlowStructured | LegacyStructured`"，加运行时嗅探（`'data' in obj` 判别）；同步让 `apps/line-mini/src/views/ResultPage.vue` 渲染前先做兼容读取（先看 `data.fields`，不存在回退旧 llm_json 平铺），适配期间**不修改**业务字段名 / 渲染行为，仅当旧字段缺失时使用新字段。验证：`pnpm -C apps/line-mini exec tsc --noEmit` 与 `pnpm -C apps/line-mini run test`（vitest）全绿

## 7. 端到端验证

- [x] 7.1 在 `services/api` 内运行 `ruff check .` 与 `pytest -q`（含本变更新增 test_*.py），全部通过。验证：CI 入口命令无报错（README 已记录）
- [ ] 7.2 提交本次 apply 变更（按 `operations.apply.guidance`"每个提交引用 `<change>`"），commit message 末尾含 `textin-docflow-migration`。验证：`git log -1 --format=%s` 含 `textin-docflow-migration`

## Workflow follow-up

- 文档同步（archive 阶段执行）：更新 `docs/30-design/{OCR-Pipeline.md, Architecture.md, Data-Model.md}`、`docs/10-product/{PRD-SaiFlow.md, Glossary.md}`、`docs/40-acceptance/Acceptance-Criteria.md`、`docs/20-requirements/functional/EPIC-02-ocr-recognition.md`，以及把 TextIn/DocFlow 在 OCR-Pipeline.md / Data-Model.md 中的措辞统一。
- 新增 `docs/30-design/adr/ADR-003-textin-docflow-replaces-xparse.md`（accepted 状态）并在 `docs/30-design/Architecture.md` 的 ADR 表登记。
- 上述 6 个验证 grep 同步在 archive 前重跑一次确认无残留 vendor 词。
- `apps/line-mini/src/views/ResultPage.vue` 的"UI 截屏"人工验收（mock 一次 DocFlow response 在 dev 跑 pnpm dev 截屏确认）。
- 归档前在仓库根运行 `openspec validate textin-docflow-migration --strict --type change` 期望通过（apply 完成的硬性签字条件）。
- 归档时按 `operations.archive.guidance` 把成果同步回 docs/ 并更新版本历史。
