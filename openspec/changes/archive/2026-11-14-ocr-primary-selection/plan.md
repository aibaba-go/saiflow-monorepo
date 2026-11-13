# ocr-primary-selection — 实施计划

## 1. 输入与范围

输入：[proposal](proposal.md)、[web-admin delta](specs/web-admin/spec.md)、[recognition delta](specs/recognition/spec.md)。新增 FR-SYS-162、FR-OCR-025/026；延续 [FR-SYS-005](../../../specs/ocr-settings/spec.md)、[FR-OCR-018/019/020/021/023/016](../../../specs/recognition/spec.md) 及结果/导出契约。遵循 STD-005/STD-006，先补测试，再做最小实现。

用户确认的默认可选是平台 admin 的全系统共用配置，不是客户单据选择。部署本变更不自动改变任何已保存默认值；初始默认仍 TextIn，备用仍 Google Cloud Vision。规划阶段未修改代码、运行回归、调用厂商或写生产。

## 2. 已核实的实现与关键取舍

- `apps/web-admin/src/pages/OcrSettingsPage.tsx` 已有 primary_engine/backup_engine，Select 目前独立更新 state；后端 `ocr_settings_service.update` 对合并后首选/备用同值整体返回 400。联动应在 UI 实现，不让服务静默修正非法 PATCH。
- `services/api/app/ocr/engines.py` 已按配置读取首选/备用及该首选的全局健康状态，支持反向调用。复用现有调度；在引擎健康且有密钥时首选成功只调用一次，不调用备用。服务失败、熔断/试探及无密钥仍按 FR-OCR-021，不把“大模型失败”误作“OCR 服务失败”。
- `VisionEngine` 给 `EngineResult.raw`，structured=None；`worker._generic` 提取 pages/fullTextAnnotation.text 后调用 `deepseek.refine_json`。当前未配置/失败返回 None，`_save` 因而可能写空 structured；解析器仅 json.loads，标量会被接受但 ResultOut 只接受对象/数组/空值。
- 最小实现位置为 worker 的通用结果边界：验证新生成的自由格式后返回 dict，失败时返回原文分组。保留 `deepseek.py` 的中文提示、parse_float=str、现有请求格式及超时；不添加未经接口验证的 response_format。仅对新通用结果递归将超出 ±9007199254740991 的整数转为精确十进制字符串，安全整数及布尔值不变；在后端 Python 整数阶段完成，不经 float。不重新校验/重包 TextIn 厂商直接结构和历史数据。
- 模板结果仍由 `templates/converter.py`、`normalize.py` 按模板版本生成 `{group: {field: value, table: [{column: value}]}}`；已有整数类型、精确 decimal/amount 字符串和 ISO 日期不改变。新通用结果的大整数精确字符串属于 FR-OCR-025 的消费边界保护，不改模板或厂商结构规则。raw 原样写入 OcrRawResult，模板匹配/转换继续使用 raw。
- 原文保底采用与现有编辑器兼容的对象，例如 `{ "ocr_text": { "page_1": "原页全文", "page_2": "原页全文" } }`，页序不压缩，文字不 strip、不翻译、不伪造字段。无文字页保留空字符串；完全无页/无可读文字明确显示没有可读 OCR 原文，而非声称完成业务字段抽取。
- PC `src/ocr/EditableResult.tsx` 和 `src/reviews/ReadonlyResult.tsx`、LINE `src/features/scan/components/StructuredDataView.tsx` 已支持分组键值。仅对无模板、根对象为上述原文分组的结果补可翻译的“OCR 原文/结构化整理不可用”说明及长文本读取/编辑；原文使用多行控件或保留换行的只读区域。不改普通通用字段、模板字段、保存接口或业务标题。
- 预计不需要数据库迁移、ResultOut 字段变更、新依赖或客户端生成。若必须新增公开状态字段或迁移，应暂停重新确认，不能通过猜接口结构实施。

## 3. 验证矩阵

| 输入/配置 | 必须断言 | 追溯 |
|---|---|---|
| TextIn 首选、Vision 备用，及完全反向 | 健康首选成功时备用调用数 0；实际引擎记录正确 | FR-OCR-021；AC-FR-OCR-025-04 |
| 双向服务失败、内容失败、备用 none、无密钥、全局切换/试探恢复 | 调用次数、退避、全局状态、终态及预占符合原规则 | AC-FR-OCR-021-01～04 |
| 后台双向首选交换、none、取消、错误、双语 | 原子提交两个变动字段、确认前零写、错误保留、密钥不泄露 | AC-FR-SYS-162-01～05 |
| Vision pages + 大模型有效对象 | 分组/表格、零值、false、空字段、精确金额，结果 GET/PATCH 不报 schema 错误 | AC-FR-OCR-025-01/03 |
| 安全整数边界与越界正负整数，位于根字段/组字段/表格单元格 | 安全整数不变、越界整数为精确字符串；两端读取/显示/编辑保存/XLSX 全部数字不舍入，false 不当整数 | AC-FR-OCR-025-05 |
| null/标量/根数组/空对象/全空分组/非法表行、非 JSON、HTTP 错误、超时、无密钥 | 进入原文保底，不再调用 OCR、不写非法正常结果 | AC-FR-OCR-025-02、026-01 |
| 多页多语、空页、完全无文字 | 页序/换行/数值原文保持，空页不填造，UI 明确原文或无原文 | AC-FR-OCR-026-02 |
| 两引擎 → 同模板；Vision 通用/保底 → 核验 → 确认 → XLSX | 相同模板路径/日期金额规范、导出权限、版本、原始载荷不可变 | AC-FR-OCR-025-04、026-03 |
| LLM 期间取消/任务已结束 | 不覆盖终态，取消仍按原规则退还一次，不保存取消任务结果 | FR-OCR-017/022 |

上述均使用合成原件、fake engines 与 httpx.MockTransport，不用生产单据或付费厂商调用；Mock 验证接口格式兼容，不证明厂商对真实图片的识别质量。

## 4. 执行步骤

### O1 — 后台联动的 TDD

- [x] 扩展 `apps/web-admin/src/pages/catalog.test.tsx` 的 OCR settings 组：选择 Vision 自动把备用改 TextIn、反向交换、none 不变、取消无 PATCH、确认发送精确 changed fields、重新打开持久化、错误保留及双语。对应 AC-FR-SYS-162-01～05。
- [x] 在 `OcrSettingsPage.tsx` 增加首选变更处理：记住原首选，仅当新值等于当前备用时交换，其他输入不重置；保留 changes()、ConfirmButton、key status、整体错误展示。
- [x] 在 `apps/web-admin/src/i18n/zh.ts`、`en.ts` 添加默认/备用解释，复用原有 engine id，不重命名 API 字段。运行 catalog 与 i18n 定向测试。

### O2 — 双向调度与配置兼容

- [x] 将 `services/api/tests/integration/test_engine_switching.py` 的调度断言扩展为 TextIn/Vision 两种首选，涵盖首选直接成功、服务重试后备用、内容失败零备用、none、缺密钥、双向熔断及试探恢复。使用计数 fake 与无真实 sleep，保留旧测试语义。
- [x] 扩展 `test_ocr_settings.py`：两个字段交换与读取、其他参数保持、初始默认不变、单字段造成冲突依旧 400、拒绝不部分写入及审计。不要删除现有单改 primary 到当前 backup 的 validation 用例。
- [x] 用集成 worker 测试证明保存新配置后下一次处理按新设置调用；进行中的调用不会被中途替换，记录实际成功的 engine。若仅补测试即可通过，不为本次改调度实现。对应 FR-SYS-005、FR-OCR-021、AC-FR-OCR-025-04。

### O3 — 通用结构验证与原文保底

- [x] 在现有 `tests/unit/ocr/test_ocr_rules.py` 增加通用验证/原文提取用例，或在确需独立边界时新建正式 `test_generic_result.py`。允许根层标量字段、一个语义分组层的标量字段及根层/组内对象数组表格；字段和表格单元格可为字符串、整数、布尔或 null，空表合法。正例覆盖 `{ "invoice_no": "IV1", "seller": { "name": "A" }, "items": [{ "amount": "10.00" }], "summary": { "net_total": "10.00", "lines": [] } }`。非法根、全空内容、非对象表行、组内再嵌套对象或表格单元格再嵌套对象/数组不可直接当可用输出；不得拒绝上述合法分组和表格。另覆盖安全整数上下边界、越界正负整数及 false，确保原文中的大整数数字不丢失。对应 AC-FR-OCR-025-01～03/05。
- [x] 在 worker 中对无厂商结构分支生成结果做形状校验；保留有效 JSON 的 key/value/精度，不自动纠正或重命名业务内容。分组只容纳上述可编辑的字段和对象数组表格；解析浮点仍保存为字符串，安全整数保持整数，越界整数在 Python 整数阶段递归转为精确十进制字符串，显式区分 bool，绝不经 float。不因此丢弃整个有效对象。对应 AC-FR-OCR-025-05。
- [x] 加固 `_page_texts` 对缺失/无效 pages、页对象和 fullTextAnnotation 的读取，保留页序与原字符串；大模型未配置/失败/无效时返回 ocr_text 分组，确保 `_save` 不会因 None 哨兵再次写空。保底不经过“正常抽取有内容”的校验而被丢弃；无文字时使用明确空原文状态，不编造文本或丢弃已取得 raw。
- [x] 扩展 `test_ocr_worker.py`/`test_template_mapping.py`：fake Vision 必须返回真实接口形状的 pages/fullTextAnnotation.text、structured=None，而不是复用 TextIn 的 llm_json raw。断言 LLM 请求输入含实际逐页文字、结果 GET 200、raw 深度相等、0 次额外 OCR、取消后终态/预占不变。对应 AC-FR-OCR-025-01/02、026-01/02及 FR-OCR-018/022。
- [x] 保留自动模板匹配/转换执行顺序；原文保底不替代 raw 作为模板输入、不禁止将来手动转换，不回填历史结果。对应 AC-FR-OCR-026-03。

### O4 — 两端消费与导出兼容

- [x] 对上述原文分组在 PC/LINE 提供三语说明和可完整读取/编辑的多行文字；PC 只读单据/复核同样识别原文形态。界面变动仅限 fallback，不改普通字段控件。扩展 `apps/web-pc/src/ocr/ocr.test.tsx`、`src/pages/ocr-verify.test.tsx`、相关 reviews 测试及 LINE `features/scan/result.test.tsx`，核对空原文、换行、长金额字符、三语及保存 body；使用实际 JSON 解码后的通用结果核对大整数的完整显示与编辑请求数字不舍入，对应 AC-FR-OCR-025-05。
- [x] 扩展后端 `test_template_mapping.py`、`test_results.py`、`test_exports.py` 和 `tests/unit/ocr/test_xlsx.py` 的组合：双向 OCR → 同模板；Vision → 正常通用/保底 → 保存新版本 → 确认/复核规则 → XLSX。断言日期公历/佛历、千分位、两位 amount、小数精度、空表、无 export 权限拒绝，以及导出的实际单元格内容；越界整数必须作为精确文本写入 XLSX，不能经 Excel 数值单元格舍入，对应 AC-FR-OCR-025-05。
- [x] 按应用角色再次验证 raw 禁止改写，模板输入仍为同一 raw，保底编辑不会污染原件；通用结果继续不纳入模板运营报表。对应 AC-FR-OCR-025-04、026-03、FR-OCR-018/016、FR-REPORT-007。

### O5 — 全量验证与审查

- [x] 执行前只读确认隔离 PostgreSQL 目标：本机 127.0.0.1:25432、专用 `saiflow_test_*` 数据库及正确测试账号；DB_APP_USER=saiflow_v3_app，提供全部 TEST_DB_* 且 REQUIRE_INTEGRATION=1。不把 saiflow_dev 本身、共享/远程数据或 81.68.72.120 副本作为集成测试库。现有 fixtures 会迁移、重置角色及 TRUNCATE，必须先通过 tests/db_target_guard。
- [x] Python 命令仅在 `services/api/` 执行：定向 pytest（ocr_settings、engine_switching、ocr_worker、template_mapping、results、exports 与上述单元测试），再 `uv run ruff check .`、`uv run ruff format --check .`、带隔离配置的全量 `uv run pytest -v`；可用现有 `.venv/Scripts/python.exe -m pytest` 避免 uv 重建的额外等待，但不省略工具检查。
- [x] 根目录执行 `pnpm -r lint`、`pnpm -r test`、`pnpm -r build`，覆盖 PC、admin、LINE、共享 UI 和客户端。未配置集成库导致 skip 不能称全量通过；偶发失败要记录原因及全量重跑结果，不只汇报孤立重跑。
- [x] 隔离浏览器核验后台双向选择/取消/重开及 PC/LINE 正常结果/原文保底的读、编辑、保存、确认、导出。临时样本、XLSX、截图和日志仅存 `temp/ocr-primary-selection/`，不保存密钥。原生 LINE 的下载验收与浏览器 mock 分开记录，未完成不声称完成。
- [x] 完成代码差异审查、`openspec validate ocr-primary-selection --strict`；把 AC → 测试 → 实际结果、全量命令及未覆盖项写本 change 的 `verification.md`，不写成功占位或 docs 验证记录。

### O6 — 收尾与发布

- [x] 两个 change 都完成上述门槛后，按项目规则归档/同步 delta、分别形成范围清晰的新提交；不混入既有脏部署文件、.qoder、用户手册、temp 或其他 change，不跳 hooks、不 amend。不创建 design 或重复任务内容；CLI 在实施入口强制要求 tasks 时，仅保留指向本 plan 的最小链接文件。CLI planningComplete=false 按 AI-WORKFLOW 属预期。
- [x] 有当前变更的明确书面实施/提交/发布授权后推送，等最终目标 SHA 的标准 CI 全部通过再运行标准 Deploy；不直接 SSH 修改生产、不修改生产默认引擎、不付费调用 OCR 来“冒烟”。具体排除脏文件与三站核验步骤沿用 [PC plan P5](../2026-11-14-pc-report-view-polish/plan.md)。
- [x] 只读核验三站健康、数据库状态、精确发布 SHA 和新静态资源。已有授权后台会话可只读确认新控件/当前配置，不能为了验收切换真实配置或建立真实识别任务。真实厂商识别质量及原生 LINE 行为若未验收，明确列为未验证项，不用健康检查代替。

## 5. 确认点

当前方向和权限/默认值边界已确认；用户随后书面授权“开始开发吧，按照你的推荐执行，不要问我，直到完成部署”，据此执行本计划及标准 CI→Deploy。若发现必须改引擎错误分类、原始载荷、公开 JSON 契约、计量、生产默认值或新增迁移/依赖，先说明范围与影响并重新确认。授权仅覆盖当前两个变更，不从历史变更继承其他生产操作权限。
