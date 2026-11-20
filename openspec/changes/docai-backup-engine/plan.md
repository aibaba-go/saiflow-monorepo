# docai-backup-engine — 实施计划

## 1. 输入与范围

输入是 [proposal](proposal.md) 和三份 delta：[ocr-settings](specs/ocr-settings/spec.md)、[recognition](specs/recognition/spec.md)、[web-admin](specs/web-admin/spec.md)。

- 修改的需求：FR-SYS-005、FR-OCR-021/025/026、FR-SYS-072/162。
- 新增的需求：FR-OCR-027（Document AI 识别）、FR-OCR-028（逐页原文视图）。
- 延续的契约：FR-OCR-018/019（原始结果不可变，模板以原始结果为唯一输入），以及结果和导出契约。

遵循 STD-005/006：先写测试，再做最小实现。

负责人已确认三项决定：

- Vision 由 Document AI 取代，处理器放在 `asia-southeast1`。
- 复用 GCS 服务账号。
- 大模型只接收逐页原文。

规划阶段没有调用厂商、没有写生产，也没有创建云资源。处理器通过 API 创建被权限拦截，改由负责人在控制台创建。

## 2. 已核实的实现与关键取舍

- **调度不改。** `engines.recognise/_plan` 与引擎名称无关，只认 `engines` 字典的 key 和 `OcrSettings`。新增 `DocAIEngine(name="google_docai")`，`structured=None`，沿用 worker 中 `_generic` 的分支。`classify/error_code` 增加 `DocAIError` 分支：
  - 401/403/404/408/429/≥500 记为 service；
  - 凭据读取失败、令牌刷新失败记为 service（错误码 `DOCAI_ERROR_CREDENTIALS`），可以改用备用；
  - 其他 4xx 记为 content；
  - 错误码统一为 `DOCAI_ERROR_{status}`。

  httpx 的超时和连接错误沿用原有分支。
- **客户端 `app/ocr/docai.py`：**
  - 端点为 `https://{loc}-documentai.googleapis.com/v1/projects/{p}/locations/{loc}/processors/{id}[/processorVersions/{v}]:process`。
  - 请求体是 `rawDocument{content(base64), mimeType}` 加 `fieldMask`。fieldMask 取 `text,pages.pageNumber,pages.dimension,pages.layout,pages.blocks,pages.paragraphs,pages.lines,pages.detectedLanguages`，排除 `pages.image` 和 token、symbol 级数据。
  - PDF 超过 15 页时，用 `pymupdf` 的 `insert_pdf` 按 15 页切段；不超过 15 页直接提交原字节。
  - 原始结果为 `{"documents": [<每段响应的 document>]}`。
  - 令牌通过可注入的 `token_provider` 获取，默认用 `google.oauth2.service_account` 以 `cloud-platform` scope 刷新并缓存。测试注入假令牌与 `httpx.MockTransport`。
  - 令牌和凭据内容不进入异常信息。
- **逐页原文视图 `app/ocr/page_text.py`：**
  - `page_texts(engine, raw) -> list[str] | None`：Document AI 按 `page.layout.textAnchor.textSegments` 从各段的 `document.text` 截取，startIndex 缺省为 0，int64 以字符串形式出现；历史 Vision 读取 `pages[].fullTextAnnotation.text`；TextIn 返回 None。
  - `model_input(engine, raw)`：有页文字时返回 `{"pages": [...]}`，否则返回 raw 本身。
  - 使用位置：
    - `worker._generic`，传入 `result.engine`；
    - `mapping_worker`，用 `raw.engine` 计算 payload，同时供 match 和 convert 使用；
    - `sample_worker.ocr_text`，用样例 OCR 文件中保存的 engine。
  - `matcher.compact_raw` 不改，60,000 字符上限照旧。
- **配置：**
  - `Settings` 删除 `google_vision_api_key`，新增 `docai_project_id`、`docai_location`（默认 asia-southeast1）、`docai_processor_id`、`docai_processor_version`。
  - 凭据用 `gcs_credentials_file`。`build_engines` 和 `key_status` 判断凭据、项目、处理器三者都非空，且凭据文件存在。
  - `KeyStatusOut.google_vision` 改为 `google_docai`，只有 web-admin 消费。
- **引擎值：**
  - `states.ENGINES = ("textin","google_docai")`，用于配置校验和健康表。
  - `states.RECORDED_ENGINES = ("textin","google_vision","google_docai")`，用于 `ocr_jobs` 和 `ocr_raw_results` 的 CHECK，保留历史行。
  - 迁移 `0020`：替换三条 CHECK，删除 `ocr_engine_health` 中的 google_vision 行，`system_settings` 里 `ocr_primary_engine`/`ocr_backup_engine` 值为 `"google_vision"` 的改为 `"google_docai"`。downgrade 按反方向执行，有 google_docai 记录时拒绝。
  - 初始备用默认值改为 `google_docai`。
- **保留与删除：** 删除 `vision.py`、`test_vision.py` 和 Vision 相关配置。历史 Vision 原始结果只读，可以按逐页文字转换。
- **不做的事：** 不新增依赖。`google-auth 2.62` 和 `requests 2.34` 已随 `google-cloud-storage` 安装，已在 venv 中核实可以导入。不改提示词，也不改模板结构。

## 3. 验证矩阵

| 输入/配置 | 必须断言 | 追溯 |
|---|---|---|
| 图片 / 15 页 / 32 页 PDF | 调用 1/1/3 次，每段页数 ≤15，请求含 fieldMask、mimeType 和 Bearer 令牌；raw 段序和页数正确 | AC-FR-OCR-027-01/02 |
| HTTP 400/403/404/429/503、超时、凭据错误 | 分类和错误码正确；service 类重试后改用备用，content 类直接失败；第二段失败不保存部分结果 | AC-FR-OCR-021-05、027-02 |
| 两个方向的首选、全局切换与试探、备用 none、缺配置 | 原有调度测试以 google_docai 为另一个引擎，全部通过 | AC-FR-OCR-021-01～04 |
| Document AI raw + 大模型成功 / 失败 | LLM 输入为逐页文字；通用结果或原文保底正确；raw 深度相等，不额外调用 OCR | AC-FR-OCR-025-01/02、026-01/02 |
| Document AI raw 超过 60k、页文字未超 | 匹配和转换不报 RAW_TOO_LARGE；TextIn raw 输入不变；历史 Vision raw 可转换 | AC-FR-OCR-028-01/02/03 |
| 配置初始值、key_status、校验、旧值迁移 | 初始备用为 google_docai；google_vision 返回 400；迁移改写设置、保留历史引擎记录 | AC-FR-SYS-005-01～06 |
| 后台配置页 | 名称、默认值、联动、双语和密钥状态均为 Document AI，不出现 Vision | AC-FR-SYS-072-01、162-01～05 |
| 日志与错误信息 | 不含令牌、凭据内容和处理器编号 | AC-FR-OCR-027-03 |

所有测试使用合成数据、fake engine 和 MockTransport，不使用真实单据和付费调用。真实调用只在负责人创建处理器并授权后做一次，确认响应形状和 fieldMask 生效，结果记入 verification.md；样本和输出只放在 `temp/`。

## 4. 执行步骤

### D1 — Document AI 客户端与引擎（TDD）

- [x] 新建 `tests/unit/ocr/test_docai.py`，覆盖上表前两行，然后实现 `app/ocr/docai.py`、`engines.DocAIEngine`、`classify`、`error_code` 和 `build_engines`。删除 `vision.py` 与 `test_vision.py`。

### D2 — 逐页原文视图

- [x] 新建 `tests/unit/ocr/test_page_text.py`，覆盖 Document AI 多段与空页、textSegments 缺省 startIndex、Vision 历史和 TextIn 原样。实现 `page_text.py`，接入 worker、mapping_worker 和 sample_worker。更新 `test_generic_result.py`、`test_template_samples.py` 中的 Vision 形状。

### D3 — 配置、状态与迁移

- [x] 更新 `config.py`、`states.py`、models、`ocr_settings_service.py` 和 `schemas/ocr.py`，新增 `alembic/versions/0020_docai_engine.py`。更新集成测试 `test_ocr_settings`、`test_engine_switching`、`test_ocr_worker`、`test_template_mapping`、`test_results`、`test_exports` 中的 Vision 用例，并补充迁移场景 AC-FR-SYS-005-06。

### D4 — 管理端与契约

- [x] 更新 `OcrSettingsPage.tsx`、i18n 和 `catalog.test.tsx`，重新生成 `openapi.json` 和 api-client schema。

### D5 — 部署与文档

- [x] 更新 `compose.yaml`（api 与 ocr 服务）、`env.example`、`scripts/dev/local-env.sh`、`compose-config.test.sh` 和部署 README。同步 Architecture、Data-Model、PRD §4.6/OQ-7、Glossary、NFR、ADR-008 中的引擎描述。

### D6 — 全量验证

- [ ] （除集成测试与真实调用外已完成，见 verification.md）依次运行：ruff、单元测试、隔离库集成测试（127.0.0.1:25432）、`pnpm -r lint test build`、`openspec validate docai-backup-engine --strict`。处理器就绪后做一次真实调用，结果写入 verification.md。

### D7 — 收尾与发布

- [ ] 提交、归档和同步主 spec。部署须负责人在对话中明确批准；生产需要先配置 `DOCAI_*` 环境变量并授予角色。

## 5. 确认点

- 负责人在控制台创建 `asia-southeast1` 的 Enterprise Document OCR 处理器，给 GCS 服务账号授予 Document AI API User 角色，并提供处理器编号。处理器默认版本建议设为 `pretrained-ocr-v2.1.1-2025-01-31`，即前期实测用的版本；也可以通过 `DOCAI_PROCESSOR_VERSION` 指定。
- 部署和生产环境变量的修改须另行批准。
