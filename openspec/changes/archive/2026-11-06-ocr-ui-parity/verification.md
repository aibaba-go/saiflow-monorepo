# ocr-ui-parity 验证记录

## 1. 自动化测试

- **后端：** `pytest -q` **810 passed**，ruff 无告警（本机 Docker PostgreSQL，`REQUIRE_INTEGRATION=1`）。
- **前端：** line-mini **166 passed**，web-pc 73、web-admin 55、api-client 5；`pnpm -r lint`、`pnpm -r build` 通过。
- **脚本与契约：** `scripts/tests/*.test.sh` 全部通过；接口契约重新生成后与提交一致；`openspec validate ocr-ui-parity` 通过。
- **CI：** 提交 `dbdb57c` 的 CI 通过。
- 前端页面的测试是在页面移植之后补写的；每个页面都用“故意改坏关键逻辑、确认测试失败、再恢复”的方式证明测试有效（记录在执行记录中）。

## 2. 验收标准 → 测试

| 需求 | 验收标准 | 测试 |
|---|---|---|
| FR-UPLOAD-014 按链接导入 | 014-01～04 | `tests/unit/test_fetch.py`（内网、十进制与 IPv6 映射地址、解析到内网的域名、重定向逐跳检查、连接到检查过的地址、大小与次数上限）、`tests/integration/test_imports.py` |
| FR-OCR-019 大模型匹配模板（修改） | 019-01～04 | `test_template_mapping.py`（低于 70% 用自由格式、自动转换缺主要字段不报错、没有模板不调用大模型、只有一个模板也打分、手动失败的显示与清除） |
| FR-OCR-023 通用结果（修改） | 023-01 | `test_template_mapping.py`、`result.test.tsx`（自由格式无错误提示） |
| FR-OCR-013 金额校验 | 013-01～03 | `tests/unit/ocr/test_amounts.py`（含负数折扣、非数字折扣与税额）、`test_results.py`、`test_ocr_schema.py`（迁移 0011） |
| FR-OCR-016 标准化 | 016-01～02 | `tests/unit/ocr/test_ocr_rules.py`、`test_results.py`（类型不符提示改正后消失） |
| FR-OCR-024 模板匹配的展示信息 | 024-01～03 | `test_template_mapping.py`、`result.test.tsx`（推荐与匹配度、低匹配度提示、预览字段） |
| FR-SYS-109 首页配额与最近任务 | 109-01～02 | `home.test.tsx` |
| FR-SYS-110 上传队列与按链接导入 | 110-01～03 | `home.test.tsx`（上传中取消会中止请求并删除半成品上传） |
| FR-SYS-111 待处理多选 | 111-01 | `home.test.tsx` |
| FR-SYS-112 确认页逐个浏览 | 112-01～02 | `confirm.test.tsx` |
| FR-SYS-113 原件查看器 | 113-01 | `confirm.test.tsx` |
| FR-SYS-114 结果页的视图与重置 | 114-01～03 | `result.test.tsx` |
| FR-SYS-115 更换模板面板 | 115-01～02 | `result.test.tsx` |
| FR-SYS-116 进度与最终结果的补充 | 116-01 | `processing.test.tsx`、`final.test.tsx` |
| FR-SYS-117 历史搜索 | 117-01 | `history.test.tsx` |
| FR-SYS-118 界面与 main 一致 | 118-01 | 样式代码直接复制自 main；负责人粗看主流程（§3），逐页对照未做 |

## 3. 部署与实测（2026-11-06）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42245651421 | `dbdb57c` | 迁移 0011（模板字段角色）、0012（`ocr_jobs.mapping_switched_at`）；三个站点健康检查正常 |

负责人在手机 LINE 中粗看主流程，确认与之前一致；负责人决定细节（包括与 main 逐页并排对照，AC-FR-SYS-118-01）不逐项测试（2026-11-06）。

## 4. 最终评审

Opus 整体评审：没有严重问题；3 个重要问题已修复，每个都先有失败的测试：
- 按链接导入连接到检查过的地址，防止 DNS 重绑定；
- 负数或非数字的折扣、税额不再误报金额不一致；
- 改用通用结果或切换到已就绪的模板后，之前的手动失败提示消失。

延后的次要问题：
- 少见的 IPv6 写法（IPv4 兼容、NAT64）能通过地址检查；
- 慢速下载期间占用一个数据库连接，导入没有按用户限制频率；
- "1.000,50" 会被读错而不是被拒绝；行折扣为 "-" 时跳过该行的数量 × 单价检查；
- 上传刚完成时点"取消"，文件仍留在待处理中；
- 未就绪的导出查询返回 404；
- 模板预览的缓存未区分租户。

## 5. 与 main 不同之处（已记录的决定）

- 结果页数据区上方多了"表格 / JSON"切换（规格要求 JSON 视图；main 的结果页没有）。
- 按钮栏多了"保存草稿"（规格要求；main 只在换模板或"继续"时保存）。
- 待处理行在 main 的图标位置显示缩略图；铃铛打开我们的通知页，而不是 main 的弹框。
- 上传进度按步骤显示；匹配度低于 70% 时直接用自由格式（main 总是按最接近的模板转换）。
