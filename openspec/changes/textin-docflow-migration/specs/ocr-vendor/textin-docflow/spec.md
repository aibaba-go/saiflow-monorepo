# Spec Delta: ocr-vendor/textin-docflow

## Purpose

Provides the only OCR vendor integration in V1.0: synchronous uploads to TextIn DocFlow (`docflow.textin.ai`), persisting vendor extraction payloads with field-level coordinates for downstream review and export, and isolating vendor semantics behind stable job-status and structured-payload contracts.

## ADDED Requirements

### Requirement: 同步调用 DocFlow 上传接口

The system SHALL submit accepted OCR jobs to TextIn DocFlow's synchronous upload endpoint `https://docflow.textin.ai/api/app-api/sip/platform/v2/file/upload/sync` via HTTPS POST, sending `workspace_id` as a required query parameter and the configured `x-ti-app-id` and `x-ti-secret-code` headers, with a 300-second overall timeout. Local source files SHALL be sent as `multipart/form-data` with field name `file`.

#### Scenario: 凭据齐全且 vendor 接受

- **WHEN** `textin_app_id`、`textin_secret_code`、`textin_docflow_workspace_id` 已配置且 DocFlow 返回 HTTP 200 with `result.files[0].recognition_status = 1`
- **THEN** 系统将抽取结果持久化为 SUCCESS 或 PARTIAL_SUCCESS 的 OcrJob

#### Scenario: 未配置 workspace_id

- **WHEN** 任一必需凭据缺失
- **THEN** 系统不为该任务发起 DocFlow 调用，任务以 FAILED + `OCR_VENDOR_UNAVAILABLE` 收尾

### Requirement: 持久化 vendor 标识

The system SHALL persist `task_id`、`batch_number`、`category` 三个 vendor 标识，作为 OcrJob 的可读字段，供诊断与人工查询使用。

#### Scenario: 任务详情页可读

- **WHEN** 任务 SUCCEEDED 后用户从任务详情页拉取
- **THEN** 响应中包含上述三个字段原文（非空时）

### Requirement: recognition_status 映射为任务状态

The system SHALL map DocFlow `recognition_status` to internal job statuses as: `1` 且 `data.fields` 与 `data.items` 同时非空 → SUCCEEDED；`1` 但任一为空 → PARTIAL_SUCCESS；`2` → FAILED，且 `failure_causes` 文本（前 512 字符）写入 `error_message`；其他枚举值 → FAILED 且 `error_code = DOCFLOW_UNEXPECTED_STATUS`。

#### Scenario: 成功但无字段

- **WHEN** `recognition_status = 1`，`data.fields` 为空，`data.items` 非空
- **THEN** 任务状态为 PARTIAL_SUCCESS

#### Scenario: 成功且字段与行项目双非空

- **WHEN** `recognition_status = 1`，且 `data.fields` 与 `data.items` 均非空
- **THEN** 任务状态为 SUCCEEDED

#### Scenario: 失败并带原因

- **WHEN** `recognition_status = 2`，`failure_causes = "Unsupported file format"`
- **THEN** 任务状态为 FAILED，`error_code` 为 `DOCFLOW_RECOGNITION_FAILED`，`error_message` 含 "Unsupported file format"

### Requirement: 可重试错误分类

The system SHALL retry a failed vendor call up to `MAX_VENDOR_RETRIES = 3` times with exponential backoff (2、4、8 秒) when the failure is HTTP 429、HTTP 5xx、httpx.TimeoutException 或 httpx.TransportError。HTTP 4xx（除 429 外）与解析失败 SHALL NOT 重试。

#### Scenario: 限流后恢复

- **WHEN** DocFlow 首次返回 HTTP 429，第二次返回 HTTP 200
- **THEN** 系统使用第二次响应作为任务结果，无需人工干预

#### Scenario: 5xx 后重试成功

- **WHEN** DocFlow 首次返回 HTTP 503，第二次返回 HTTP 200
- **THEN** 系统使用第二次响应作为任务结果

#### Scenario: 网络超时后重试成功

- **WHEN** DocFlow 首次调用触发 `httpx.TimeoutException`，第二次返回 HTTP 200
- **THEN** 系统使用第二次响应作为任务结果（不因单次超时立刻 FAILED）

#### Scenario: 硬错误不重试

- **WHEN** DocFlow 返回 HTTP 400 with `msg = "invalid workspace_id"`
- **THEN** 任务立即落 FAILED，不进行重试

### Requirement: 持久化原样 structured 载荷

The system SHALL persist the vendor response body for each SUCCEEDED / PARTIAL_SUCCESS job as the canonical structured payload (`ResultVersion.structured`), preserving `data.fields[]`、`data.items[][]`、`data.tables[]`、`data.stamps[]`、`data.handwritings[]`、`pages[]` 各级原始字段，以及文件级 vendor 元数据（`task_id`、`batch_number`、`category`、`recognition_status`、`duration_ms`、`failure_causes`）。字段级与单元格级 `position` 坐标 SHALL be preserved as-is in the persisted payload。

#### Scenario: 复核页可读字段与坐标

- **WHEN** 复核人打开一个 SUCCEEDED 任务的结果版本
- **THEN** UI 能列出 `data.fields[]` 中每条记录的 `key`、`value` 与 position，UI 能读取 `pages[]` 的 `width/height/dpi/angle` 用于坐标绘制

### Requirement: items[][] 转 dict 行

The system SHALL transform each row of `data.items[][]` into one record containing `row_index`、扁平化 `cells[]`（每条 `{key, value, position}`，原样保留）、`kv`（由 `cell.key → cell.value` 构造，同 key 后出现者覆盖前者）、`cell_positions[]`（每条对应一个 `cells[]` 元素，按行内顺序）。系统 MUST NOT 丢弃 `key` 缺失或重复的单元格：无 key 的单元格记入 `kv` 时使用 `${row_index}-${col_index}` 占位。

#### Scenario: 单行多列

- **WHEN** 某行 `data.items` 包含两个 cell：`{key: "Quantity", value: "2"}` 与 `{key: "Amount", value: "1000.00"}`
- **THEN** 持久化记录 `kv = {"Quantity": "2", "Amount": "1000.00"}`，`cells` 与 `cell_positions` 各两条，分别携带各自的 `position`

#### Scenario: 行内同 key 重复

- **WHEN** 一行有两个 cell 同为 `key: "Tax"`，值分别为 `"7%"` 与 `"5%"`
- **THEN** `kv["Tax"] = "5%"`，`cells`/`cell_positions` 仍保留两条

### Requirement: 拒绝遗留 vendor 模式

The system SHALL NOT accept OCR job parameters corresponding to legacy TextIn xparse modes (`layout`、`article`) or legacy extraction paths. ACCEPTED `parser_parse_mode` 值 MUST be `auto` / `scan` / `vlm` 之一；其他值 SHALL 返回 `invalid_argument` 且不下发到 vendor。

#### Scenario: 收到遗留 layout 模式

- **WHEN** 客户端提交 OCR 任务带 `parser_parse_mode = layout`
- **THEN** 任务创建请求返回 `invalid_argument`，不产生 OcrJob

### Requirement: 凭据仅来自 Secret Manager / 环境变量

The system SHALL resolve `textin_app_id`、`textin_secret_code`、`textin_docflow_workspace_id` exclusively from runtime environment variables (or boot-time secret resolution). The source tree SHALL NOT embed any default vendor credentials.

#### Scenario: 任一凭据缺失

- **WHEN** 进程启动时上述三项中有任一项取不到值
- **THEN** 系统记录 WARN 日志，且创建 OCR 任务时返回 `OCR_VENDOR_UNAVAILABLE`

#### Scenario: 配置完整

- **WHEN** 三项凭据均能从环境解析
- **THEN** 任务可正常进入 DocFlow 调用路径且不输出任何凭据值到日志
