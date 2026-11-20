# verify-template-custom-fields 验证记录

验证日期：2026-11-09。环境：本机隔离环境（本地 PostgreSQL `127.0.0.1:25432`，集成测试库 `saiflow_test_regression`）。未连接线上库或恢复库 `81.68.72.120:15432/saiflow`，未提交，未部署。

## 1. 自动化测试

| 范围 | 命令（在对应目录执行） | 结果 |
|---|---|---|
| 后端集成（全量） | `services/api`：载入 `temp/local-postgres/secrets.env`，`REQUIRE_INTEGRATION=1`，`pytest tests/integration -q -p no:cacheprovider` | **584 passed, 1 failed**；失败的 `test_job_filters.py::test_mapping_state_has_target` 依赖 `now() + 1 second` 的先后顺序，25 分钟全量负载下偶发，单独重跑通过（与本变更无关，本变更未改该路径） |
| 后端本变更用例 | `tests/integration/test_results_extra_fields.py` | 5 passed（包含在上面的全量中） |
| 后端单元 / ruff | `pytest tests/unit`；`ruff check .`；`ruff format --check .` | 415 passed；无问题 |
| web-pc | `apps/web-pc`：`npx vitest run --no-file-parallelism`；`eslint .`；`tsc --noEmit`；`vite build` | **169 passed**（前一轮全量中 `ocr-verify.test.tsx` 129-04 偶发失败 1 次，单独运行与再次全量均通过）；lint、tsc 0 错误；构建通过 |
| line-mini | 同上（`apps/line-mini`） | **270 passed**；lint、tsc 0 错误；构建通过 |

## 2. 验收标准 → 证据

| 需求 | 验收标准 | 证据 |
|---|---|---|
| FR-VERIFY-015（结果级额外字段） | AC-FR-VERIFY-015-01～04（原有） | 既有 results 集成测试，全量通过 |
| | AC-FR-VERIFY-015-05 保存新版本、重读可见、模板不变 | `test_results_extra_fields.py::test_extra_field_saved_reread_template_unchanged` |
| | AC-FR-VERIFY-015-06 删除、无变化保存 | `::test_extra_field_delete_and_noop_save` |
| | AC-FR-VERIFY-015-07 不新增必填、确认后锁定、复核锁定与权限 | `::test_extra_field_adds_no_required_rule`、`::test_extra_field_locked_when_confirmed`、`::test_extra_field_locked_in_review_and_permission` |
| FR-SYS-129（web-pc 核验） | AC-FR-SYS-129-01～05（原有） | 既有 `ocr.test.tsx`、`ocr-verify.test.tsx`，全部通过 |
| | AC-FR-SYS-129-06 新增额外字段排在模板字段后、明细表前；再次打开可见可编辑 | `apps/web-pc/src/ocr/ocr.test.tsx` “template extra header fields” 的 129-06 两例；`ocr-verify.test.tsx` “verify: template extra fields” |
| | AC-FR-SYS-129-07 空白名、与本组已有字段（模板定义/已保存/未保存）重名被拒 | `ocr.test.tsx` 129-07 |
| | AC-FR-SYS-129-08 取消保留草稿，只能删除额外字段 | `ocr.test.tsx` 129-08；`ocr-verify.test.tsx` 确认后的结果只读、无增删 |
| | AC-FR-SYS-129-09 切换模板前询问，取消保留新字段及值 | `ocr-verify.test.tsx` 第 284 行起 |
| | AC-FR-SYS-129-10 三语操作文案，字段名按输入保存 | `ocr.test.tsx` 129-10（en/th/zh）；另有数值按原文本保存（精度）用例 |
| FR-SYS-105（mini 结果页） | AC-FR-SYS-105-01～04（原有） | 既有 `result.test.tsx` 用例，全部通过 |
| | AC-FR-SYS-105-05、105-10 只显示已保存的额外字段，排在模板字段后 | `apps/line-mini/src/features/scan/result.test.tsx` 第 358 行 |
| | AC-FR-SYS-105-06 编辑额外字段值并保存新版本（含退回后） | `result.test.tsx` 第 387 行（returned=false/true） |
| | AC-FR-SYS-105-07 模板结果不提供额外字段增删；通用结果保留原能力 | `result.test.tsx` 第 413 行 |
| | AC-FR-SYS-105-08 三语下名称与值按保存显示，不新增必填 | `result.test.tsx` 第 435 行 |
| | AC-FR-SYS-105-09 无编辑权限或已锁定时只读 | `result.test.tsx` 第 464 行 |
| FR-SYS-107（mini 最终结果） | AC-FR-SYS-107-01～03（原有） | 既有 `final.test.tsx` 用例 |
| | AC-FR-SYS-107-04 显示确认版本的额外字段，只读 | `final.test.tsx` 第 196 行（各阶段/复核状态） |
| | AC-FR-SYS-107-05 导出请求不变，不扩展输出范围 | `final.test.tsx` 第 214 行 |
| FR-SYS-120（mini 复核） | AC-FR-SYS-120-01～03（原有） | 既有 `reviews.test.tsx` 用例 |
| | AC-FR-SYS-120-04 一、二级复核详情只读显示额外字段，决策不变 | `apps/line-mini/src/features/reviews/reviews.test.tsx` 第 211 行 |
| | AC-FR-SYS-120-05 被阻止复核（本人确认/已做一级）时显示字段但仍不能决策 | `reviews.test.tsx` 第 227 行 |

## 3. 浏览器检查（mock API）

脚本 `temp/ui-redesign/pc-extra-field-check.cjs`：headless Chrome 打开 web-pc 开发服务器，`/api/v1/*` 由 CDP Fetch 拦截返回模拟数据（不连真实后端）。核验页模板分组中新增字段、输入值、保存、重新加载后可见、删除并保存：**11/11 通过**，产生 2 次 PATCH，无外部请求、无页面错误。结果 `temp/ui-redesign/impl/verify-extra-field-check.json`，截图 `temp/ui-redesign/impl/verify-extra-field-added-en-1440.png`。

检查中发现并修复：额外字段输入框原先比模板字段窄（`Space align="end"` 不撑满）。`apps/web-pc/src/ocr/EditableResult.tsx` 改为 `FIELD_ROW` flex 行（输入框 `flex: 1; minWidth: 0`），通用结果的字段行同样处理；修复后复跑相关测试与浏览器检查通过。

## 4. 未覆盖与限制

- 未接入真实 OCR/LLM：识别与模板转换由测试替身提供，额外字段只在“识别后的结构化结果”上验证；真实识别后再人工增字段的链路未在实服跑过。
- 浏览器检查使用模拟接口；保存的 PATCH 契约由后端集成测试单独证明（§2）。
- XLSX 导出按设计不包含额外字段（AC-107-05 只证明请求不变），未另外打开导出文件核对。
