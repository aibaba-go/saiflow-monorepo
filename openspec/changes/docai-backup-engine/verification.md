# docai-backup-engine — 验证记录

## 当前状态与边界

Google Cloud Vision 已从代码、配置、管理端与文档中替换为 Google Document AI OCR（引擎 id `google_docai`，默认作 TextIn 的备用）。两个引擎都走同一条识别 → 原始载荷 → 匹配/转换 → 结果版本流程；Document AI 与历史 Vision 结果以逐页原文交给大模型（FR-OCR-028），TextIn 原样不变。

尚未完成、不以其他检查替代：

- **隔离库集成测试未运行：** `temp/local-postgres/secrets.env` 已不存在，本机 127.0.0.1:25432 需要 scram 口令，环境中也没有 `TEST_DB_*`。不改 pg_hba、不连 81.68.72.120。恢复凭据后按下文命令补跑。已确认集成测试可收集（788 项）。
- **真实 Document AI 调用未做：** asia-southeast1 处理器须由负责人在控制台创建（API 创建被权限策略拦截）并提供处理器 ID；服务账号须授予 “Document AI API User”。（2026-11-15 已补做，见下节。）
- 未提交、未归档、未部署。部署须负责人在对话中明确批准，生产需先配置 `DOCAI_*` 变量。

## AC → 测试 → 当前结果

| AC | 测试 | 当前结果 |
|---|---|---|
| AC-FR-OCR-027-01/02 | `tests/unit/ocr/test_docai.py`（图片 1 次；15 页 1 次；32 页拆 15/15/2；fieldMask、mimeType、Bearer；段序与页数） | 单元通过 |
| AC-FR-OCR-027-03 | `test_docai.py`（错误码不含厂商消息、令牌、凭据与处理器编号） | 单元通过 |
| AC-FR-OCR-021-01～05 | `test_docai.py` 分类；`tests/integration/test_engine_switching.py`（google_docai 作另一引擎） | 单元通过；集成待跑 |
| AC-FR-OCR-025/026 | `tests/unit/ocr/test_generic_result.py`（Document AI raw → 逐页原文输入，无 documents/textAnchor 泄漏；Vision 历史） | 单元通过 |
| AC-FR-OCR-028-01/02 | `tests/unit/ocr/test_page_text.py`；`test_template_mapping.py::test_docai_large_layout_uses_page_texts_for_templates`、`::test_historical_vision_result_converts_from_page_texts` | 单元通过；集成待跑 |
| AC-FR-OCR-028-03 | `tests/unit/test_template_samples.py::test_page_texts_by_engine` | 单元通过 |
| AC-FR-SYS-005-01～05 | `tests/integration/test_ocr_settings.py` | 集成待跑 |
| AC-FR-SYS-005-06 | `test_ocr_schema.py::test_0020_moves_vision_to_document_ai_and_keeps_history`（设置改写、健康行、历史保留、有结果时拒绝回退、干净往返） | 集成待跑 |
| AC-FR-SYS-072-01、162-01～05 | `apps/web-admin/src/pages/catalog.test.tsx` | 单独运行 16/16 通过 |

## 已运行的检查（2026-11-15）

- `ruff check .`、`ruff format --check .`（services/api）：通过。
- 单元测试 `pytest tests/unit`：**651 passed**。
- `openapi.json` 与 api-client `schema.ts` 由 `app.export_openapi` 与 openapi-typescript 重新生成（`KeyStatusOut.google_docai`），未手改。
- web-admin `tsc --noEmit -p tsconfig.json`：通过。
- `pnpm -r lint`：三端与共享包全部通过。
- `scripts/tests/compose-config.test.sh`：**88 passed, 0 failed**；`bash -n scripts/dev/local-env.sh` 通过。
- `openspec validate docai-backup-engine --strict`：通过。
- 首次 `pnpm -r test` 与 lint 并发时 web-admin 49 项 15s/30s 超时（catalog 用时 268s，单独运行 46s），属负载超时；递归运行在 web-admin 处中止。随后逐包单独重跑（`--pool=threads`）：
  - api-client **5 passed**、ui **162 passed**（首次运行）；
  - web-admin **16 files / 97 passed**；
  - web-pc **23 files / 292 passed**；
  - line-mini **37 files / 442 passed**。
- `pnpm -r build`（三端 TypeScript + Vite）：通过。

## 真实调用（2026-11-15，处理器 49ceda251a3bb831）

一次性脚本 `temp/docai-test/product_engine_check.py` 直接使用产品的 `DocAIClient`、`DocAIEngine` 与 `page_text`，以负责人的 gcloud 用户凭据调用（本机没有服务账号密钥），样本为一张真实泰文发票（不入库）：

- 处理器 GET：`OCR_PROCESSOR`、`ENABLED`，位于 asia-southeast1；默认版本仍是 `pretrained-ocr-v1.0-2020-09-23`。
- 默认版本 v1.0：图片 1 次调用成功，但第 1 页文字中没有泰文（1230 字符，英文也有乱码）。**因此必须设置 `DOCAI_PROCESSOR_VERSION=pretrained-ocr-v2.1.1-2025-01-31`**，已写入 `env.example` 与部署 README。
- v2.1.1 图片：1 次调用，1 页，泰文与英文正确，1948 字符；raw 77,938 字节 JSON，大模型输入 2,071。
- v2.1.1 16 页 PDF：拆成 2 次调用（15 + 1），page_count 16、16 页原文、无空页；raw 1,295,272 字节，大模型输入 33,137（低于 60k 上限，AC-FR-OCR-028-01 的真实对应）。

未验证：生产服务账号 `saiflow-v3-docs-dev@…` 的调用。只读查询项目 IAM 显示它尚无 `roles/documentai.apiUser`，须负责人授予；授予并配置 `DOCAI_*` 前生产只用 TextIn（备用不可用，后台显示未配置）。

## 补跑集成测试（恢复凭据后）

在 `services/api/` 内，`source ../../scripts/dev/local-env.sh` 后以 `DB_APP_USER=saiflow_v3_app DEV_LOGIN_ENABLED=false APP_ENV=test REQUIRE_INTEGRATION=1` 指向新建的 `saiflow_test_<x>`（`temp/local-postgres/new_test_db.sh`）运行 `.venv/Scripts/python.exe -B -m pytest tests/integration -q`。
