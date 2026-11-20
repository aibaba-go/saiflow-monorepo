# review-flow 验证记录

## 1. 自动化测试

- **后端：** `pytest -q` **865 passed**，ruff 无告警（本机 Docker PostgreSQL，`REQUIRE_INTEGRATION=1`）。旧测试 `test_password_check_does_not_block_event_loop` 只看耗时，整套跑时偶尔超时，单独跑通过，整套运行时排除了它，与本变更无关。
- **前端：** line-mini **185 passed**，web-pc **80 passed**，web-admin 55，api-client 5；三个应用的 lint 与 build 通过。小程序首页"取消上传"的旧测试在整套运行时失败过一次，单独跑与重跑整套都通过（与本变更无关）。
- **契约：** `openapi.json` 与 `packages/api-client` 已重新生成；`openspec validate review-flow` 通过。
- **CI：** 提交 `2278292` 的 CI（contract、backend、frontend、stack、scripts）全部通过。

## 2. 验收标准 → 测试

| 需求 | 验收标准 | 测试 |
|---|---|---|
| FR-VERIFY-010 复核层级设置 | 010-01～03 | `test_review_settings.py`（owner 设置与读取、非 owner 403、超出范围 422、个人租户 403、未知模板 404、操作日志只写一次）、`test_reviews.py::test_settings_change_does_not_affect_pending`、`test_review_confirm.py::test_level0_confirm_is_official` |
| FR-VERIFY-011 确认后进入复核 | 011-01～02 | `test_review_confirm.py`（一级复核开轮次、个人租户直接已确认） |
| FR-VERIFY-019 复核队列与查看 | 019-01～02 | `test_reviews.py`（按级别列出、详情与数量）、`test_review_confirm.py::test_reviewer_reads_pending_job_and_file`（没有数据浏览的复核人能看任务、结果、修改记录与原件，但历史里没有） |
| FR-VERIFY-012 复核通过 | 012-01～05 | `test_reviews.py`（二级门控与正式业务数据、确认人不能复核、一级复核人不能做二级、两人同时处理只有一个成功、权限收回后被拒） |
| FR-VERIFY-013 退回与复核记录 | 013-01～03 | `test_reviews.py`（记录字段、退回回到待核验并开始新一轮、空白意见 422、超长 422、重新确认时重读层级） |
| FR-VERIFY-009 确认门控（修改） | 009-04、009-06 | `test_review_confirm.py`、`test_results.py` |
| FR-VERIFY-006 锁定（修改） | 006-01～02 | `test_review_confirm.py`（待复核时保存、确认、换模板都 409；复核中途完成的模板转换不覆盖结果；待复核时删除结果） |
| FR-VERIFY-017 任务阶段（修改） | 017-03 | `test_review_confirm.py::test_history_filter_pending` |
| FR-VERIFY-007 修改记录 | 007-01～03 | `tests/unit/test_change_log.py`、`test_change_log_api.py`（保存一行 JSON、无改动不记、换模板一条、自动匹配不记、看不到的任务 404） |
| FR-ENTRY-015 导出（修改） | 015-05 | `test_review_confirm.py::test_pending_export_409`、`test_reviews.py::test_level2_gate_then_official` |
| FR-SYS-126 待复核通知 | 126-01～04 | `test_review_notices.py`（收件人与排除、二级通知、邮件默认关闭、失败不重发、只发一次、未配置发信、没有收件人照常进入复核、退回后重新确认再通知、中断的发送记为失败） |
| FR-SYS-119 首页待复核入口 | 119-01～02 | `features/reviews/reviews.test.tsx` |
| FR-SYS-120 复核队列与详情 | 120-01～03 | `reviews.test.tsx`（通过、退回须填意见、本人确认只读、已被他人处理） |
| FR-SYS-121 复核设置（小程序） | 121-01～02 | `reviews.test.tsx`（设置层级、保存失败恢复原值） |
| FR-SYS-122 修改记录（小程序） | 122-01 | `features/scan/review-state.test.tsx` |
| FR-SYS-105～108、054（修改） | 105-04、106-03、107-03、108-03、054-05 | `review-state.test.tsx`（退回意见、已提交复核、待复核不显示导出、历史筛选与级别标签、点开通知切换租户进入详情） |
| FR-SYS-094、103（web-pc，修改） | 094-02、094-04、103-03 | `apps/web-pc/src/pages/reviews.test.tsx` |
| FR-SYS-123～125（web-pc） | 123-01、124-01～02、125-01 | `apps/web-pc/src/pages/reviews.test.tsx` |

## 3. 部署与实测（2026-11-07）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42285150575 | `2278292` | 失败：CI 尚未跑完，部署前检查拦下（未改动服务器） |
| Deploy 42285872405 | `2278292` | 迁移 0013（复核层级、轮次、记录、修改记录、复核通知、`ocr_jobs.official_at`）；三个站点健康检查正常 |

负责人实测：小程序"组织"页的"复核设置"可以把模板设为一级或二级复核。负责人目前没有第二个账号，需要两个账号的流程（确认 → 复核人收到 → 退回 / 通过 → 导出）延后再测（2026-11-07）。

## 4. 最终评审

Opus 整体评审：没有严重问题，计划的五项 Review Focus 都成立；2 个重要问题已修复，每个都先有失败的测试：
- 历史与首页的状态标签显示复核级别（待一级复核 / 待二级复核）；
- 邮件改为一封一封取出发送，被中断的发送记为"失败（interrupted）"，不重发也不丢失记录。

延后的次要问题：
- 复核详情已打开但结果加载失败时一直转圈；
- 修改记录：自动补出的空表格也记一条，行号按文字排序，删除中间一行显示为后续行被修改，换模板后旧字段显示原始键名；
- 复核检查先查状态（409）再查本人限制（403），与规格列出的顺序相反；
- 点开已退出组织的通知会把它存成当前租户；
- "权限收回"测试允许 403 或 404；
- 小程序队列滚动时别人处理了单据可能漏掉或重复；
- 单据已处理、已删除或收件人已无权限时，待发的邮件仍会发出；
- 迁移 0013 回退后，原待复核单据残留确认时间；
- 复核设置连续快速修改时，前一次失败的恢复会冲掉后一次成功的显示。

## 5. 执行中的决定

见执行记录中的 Ruling，主要有：
- 两人同时复核时先锁单据再检查，后到者得到 409；
- 关闭到期提醒时待复核邮件照常发送；
- 复核人保存单据得到 404；
- 通过 / 退回的对话框即"先确认"步骤；
- 复核详情 404 按"已被他人处理"处理；
- 没有可复核的人时单据一直等待（owner 可调低层级，确认人可删除结果）。
