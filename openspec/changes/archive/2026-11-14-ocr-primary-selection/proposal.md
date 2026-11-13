# Proposal

## Why

用户要求默认 OCR 可选择 TextIn 或 Google Cloud Vision，同时保持现有最终解析结果格式。依据 [PRD §4.6 与 OQ-12](../../../../docs/10-product/PRD-SaiFlow.md)、`ocr-settings` 的 FR-SYS-005 和 `recognition` 的 FR-OCR-021，后端已支持双向首选/备用；当前后台切换首选到当前备用容易产生冲突，而 Vision 经大模型生成通用结果可能保存空值或非法 JSON 标量，需完善交互及格式保障。

## What Changes

- 后台明确“默认 OCR（首选引擎）”与“失败时备用引擎”的含义；首选切至当前备用时同步交换备用，备用为“不使用”时保持不使用。提交仍须确认，复用现有配置字段及整体校验。
- 保留 TextIn 初始默认、系统共用配置、按新任务读取配置、服务失败重试与备用/全局切换、内容失败不回退以及实际引擎记录；补足 Vision 首选和 TextIn 备用的对称回归。
- 对 Vision 的大模型通用输出验证对象、分组/字段与对象数组表格的可用形状，拒绝空或标量输出；大模型未配置、失败或输出不可用时，以现有通用结果结构保留可读逐页原文，不伪造业务字段，不再次调用 OCR 引擎。
- 最终模板结果继续按同一模板版本转换和标准化；通用结果沿用分组键值及明细对象数组，而不是增加统一外层包装。新通用结果中超出 JavaScript 安全范围的整数以精确十进制字符串保存，安全整数和布尔不变，防止两端读取及 XLSX 导出舍入。核验、保存、确认及 XLSX 导出保持现有接口兼容。
- 厂商原始识别载荷继续原样不可变；TextIn 与 Vision 的 raw 格式允许不同。格式一致不代表不同引擎逐字识别值必然相同。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-admin`：补充默认 OCR 选择的语义和首选/备用联动交互，延续 FR-SYS-072/073。
- `recognition`：补充无厂商结构时通用结果的形状验证和原文保底，延续 FR-OCR-018/019/020/021/023/016。

## Impact

涉及 `apps/web-admin/src/pages/OcrSettingsPage.tsx`、后台双语资源及 `catalog.test.tsx`；后端 `services/api/app/ocr/worker.py` 的通用输出边界，以及按需调整 `deepseek.py` 的输出校验。PC/LINE 的通用结果组件仅补原文保底的多语说明与长文本读取/编辑，普通结果不变。引擎切换、配置 API、模板转换、结果 API 与导出以补测试为主，未发现需要改其公开契约。

预计无需数据库迁移、新 API 字段、生成客户端变动或依赖更新。实施与测试边界见 `plan.md`；本次规划不调用生产 OCR/LLM，也不修改生产默认配置。

## 非目标（Non-goals）

- 不把默认引擎自动改为 Vision，不按租户或单据增加选择项，不保存或返回密钥。
- 不改厂商 raw、历史结果或模板定义，不新建 `header_groups/tables` 外层包装，不通过浮点转换金额。
- 不因大模型整理失败触发额外 OCR、自动扣费重试或改变既有引擎错误分类。
- 不保证保底原文等同完整字段抽取；不引入新 OCR 厂商、大模型协议、提示语言变更或 `response_format` 参数。
- 不改报表、登录、计量规则、部署脚本或其他未确认能力。术语遵循 [Glossary](../../../../docs/10-product/Glossary.md)。
