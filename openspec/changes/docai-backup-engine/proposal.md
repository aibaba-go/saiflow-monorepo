# Proposal

## Why

负责人 2026-11-15 决定用 Google Document AI 的 Enterprise Document OCR 取代 Google Cloud Vision，作为 TextIn 的备份引擎。处理器放在 `asia-southeast1`（新加坡），这是离曼谷最近的可用地区，与 GCS 业务桶同属一个地区（PDPA 跨境说明见 PRD OQ-7）。两项实现选择已由负责人确认：

- 复用现有的 GCS 服务账号凭据文件，并给该账号授予 Document AI API User 角色。
- 交给大模型整理的只有逐页 OCR 原文，与原 Vision 的流程一致。

要求是：首选 TextIn 和首选 Document AI 都能完整走完识别、通用结果、模板匹配/转换、核验、确认和导出的全流程。另外，PC 管理端的 OCR 配置页要同步改成新引擎。

现有 Vision 路径还有一个流程缺口。模板匹配和转换会把整份原始结果序列化后交给大模型，长度超过 60,000 字符就报 RAW_TOO_LARGE。Vision 或 Document AI 的完整版面响应几乎总会超过这个上限，所以备用引擎识别出的单据实际上无法自动套用模板。

## What Changes

- 新增 `google_docai` 引擎，用 Document AI 的同步在线处理接口和服务账号令牌鉴权。
  - 图片直接提交；PDF 按每段不超过 15 页、依页序分段调用。
  - 只请求文字与版面字段，不返回页面图片。
  - 各段的厂商响应依页序合并成一份原始结果，原样保存，不可修改。
- 移除 `google_vision` 引擎、其客户端与 `GOOGLE_VISION_API_KEY` 配置，改为新增 `DOCAI_PROJECT_ID`、`DOCAI_LOCATION`（默认 `asia-southeast1`）、`DOCAI_PROCESSOR_ID` 和可选的 `DOCAI_PROCESSOR_VERSION`，凭据使用 `GCS_CREDENTIALS_FILE`。
  - 后台的“密钥状态”按凭据文件、项目和处理器是否齐备，报告 Document AI 已配置或未配置。
- 错误分类沿用 FR-OCR-021，以下情况算服务层面失败，可以重试或改用备用：
  - 超时、连接失败、限流、服务端错误；
  - 凭据或权限无效、处理器不存在。

  文件内容不能处理（如参数或页数等 400 类错误）算内容层面失败。
- 新增“逐页原文视图”，按引擎读取原始结果：TextIn 的原始结果原样使用；Document AI（以及历史 Vision）的原始结果取逐页文字。这个视图用在以下几处：
  - 无厂商结构时的通用结果（FR-OCR-025/026）；
  - 模板匹配与转换；
  - 后台样例生成。

  这样备用引擎的单据也能套用模板，原始结果本身不变。
- 数据库迁移：
  - 任务与原始结果允许记录 `google_docai`，保留历史的 `google_vision`；
  - 引擎健康状态只允许 `textin`、`google_docai`，同时删除 Vision 的健康行；
  - 已保存的首选或备用配置值 `google_vision` 改为 `google_docai`，初始备用默认改为 Document AI。
- PC 管理端的 OCR 配置页和双语资源改为 “Google Document AI OCR”，重新生成 OpenAPI 与 api-client。部署样例、本地环境脚本和设计文档同步更新。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ocr-settings`：FR-SYS-005 的引擎可选值、初始备用、Document AI 配置状态，以及升级后旧值的迁移。
- `recognition`：FR-OCR-021 的引擎名称与 Document AI 错误分类；新增 FR-OCR-027（Document AI 识别）与 FR-OCR-028（按引擎的逐页原文视图）；FR-OCR-025/026 的场景从 Vision 改为 Document AI。
- `web-admin`：FR-SYS-072、FR-SYS-162 的引擎名称与默认值。

## Impact

- 后端：
  - 新增 `services/api/app/ocr/docai.py` 与 `page_text.py`，删除 `vision.py`；
  - 修改 `engines.py`、`worker.py`、`mapping_worker.py`、`sample_worker.py`、`templates/matcher.py`、`states.py`、`config.py`、`ocr_settings_service.py`、`schemas/ocr.py`；
  - 新增 alembic 迁移 `0020`。
- 前端与契约：`apps/web-admin` 的 OCR 配置页、i18n 与测试；重新生成 `docs/30-design/openapi.json` 和 `packages/api-client` 的 schema。`KeyStatusOut` 字段 `google_vision` 改为 `google_docai`，只有 web-admin 使用。
- 部署：`scripts/deploy/compose.yaml`、`env.example`、`scripts/dev/local-env.sh`、相关脚本测试，以及部署 README。不新增依赖：`google-auth` 与 `requests` 已随 `google-cloud-storage` 安装，PDF 分段使用已有的 `pymupdf`。
- 云资源：需要负责人在控制台完成两件事：在 `asia-southeast1` 创建 Enterprise Document OCR 处理器，并给服务账号授予 Document AI API User 角色。本变更不创建或修改云资源，也不改生产配置；部署须另行明确批准。

## 非目标（Non-goals）

- 不使用 Layout Parser、Form Parser 或自定义抽取器，不用 Document AI 输出业务字段或表格结构，不做按单据类型定制的解析器。
- 不改 TextIn 路径、引擎调度/重试/切换算法、大模型提示词、模板定义或结果契约，也不回填或改写历史结果。
- 不支持批量（异步）处理、按租户选择引擎，也不在后台录入或展示凭据与处理器编号。
- 不承诺 Document AI 与 TextIn 逐字识别结果相同。识别质量以真实样本验收为准，不由 Mock 测试证明。
