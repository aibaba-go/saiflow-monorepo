# ocr-primary-selection — 验证记录

## 当前状态与边界

后端完整第二轮 **1421 passed、无跳过，3861.16s**，首轮管理员 CLI 连接超时用例及全量均已重跑通过，未修改时限或配置。根前端 lint/test/build 与 994 项测试通过；最后 PC 窄屏 CSS 后根 lint、报表/三语 78 项和三端 TypeScript/build 再次通过。最终隔离浏览器 40/40 场景通过，含 6 个后台与 14 个 OCR 场景，关键截图已实际打开核对。PC `440fdd2` 与 OCR `a69a0e3` 已分别提交并推送；代码 SHA `a69a0e35aa0c25357080cd115850ffd97f8aed62` 的标准 CI 全部 5 jobs 成功，唯一标准 Deploy 成功，三站独立只读 GET 核对精确 SHA、数据库 ok、新资产及 OCR 文案。生产默认引擎未自动切换；真实厂商质量、授权后台控件会话与原生 LINE 未验，不写为成功。

起点：`e2ce30e048de14e56b6055a68dc2001f0cfd0c1e`。用户已针对本变更和 pc-report-view-polish 书面授权开发、测试、提交及标准 CI→Deploy。未修改生产默认设置、部署脚本、数据库结构、公开 API 或生成客户端；没有调用付费 OCR/LLM 或使用真实业务记录。

测试目标是专用本机 PostgreSQL `127.0.0.1:25432/saiflow_test_ocr_primary_20261114`，通过目标 guard；`DB_APP_USER=saiflow_v3_app`、`APP_ENV=test`、`DEV_LOGIN_ENABLED=false`、`REQUIRE_INTEGRATION=1`。只加载隔离本机测试配置，不加载第三方服务配置。凭据不写入本记录。

## 后端 AC → 测试 → 实际结果

测试文件：[通用边界](../../../../services/api/tests/unit/ocr/test_generic_result.py)、[双向调度](../../../../services/api/tests/integration/test_engine_switching.py)、[设置](../../../../services/api/tests/integration/test_ocr_settings.py)、[模板](../../../../services/api/tests/integration/test_template_mapping.py)、[结果](../../../../services/api/tests/integration/test_results.py)、[导出](../../../../services/api/tests/integration/test_exports.py)、[XLSX](../../../../services/api/tests/unit/ocr/test_xlsx.py)、[取消与终态](../../../../services/api/tests/integration/test_ocr_worker.py)。

| AC | 测试与断言 | 后端结果 |
|---|---|---|
| AC-FR-OCR-025-01 | `test_vision_generic_built_by_llm`、`test_vision_result_exact_roundtrip_versions_and_confirm`：真实 Vision pages 形状进入 MockTransport，结果 GET/PATCH/确认正常、版本和分组保留 | 通过 |
| AC-FR-OCR-025-02 | `test_invalid_generic_is_readable_original_not_successful_extraction`、`test_vision_invalid_llm_uses_original_pages_no_extra_ocr`：null/标量/根数组/全空/非法表格/嵌套/非 JSON/HTTP/超时保底 | 通过 |
| AC-FR-OCR-025-03 | `test_valid_groups_tables_and_exact_integer_boundary`、`test_zero_or_false_alone_is_useful`、`test_empty_table_rows_alone_are_not_extraction`：平铺、单层组、根/组表格及唯一有效 0/false；保留空表/null/精确小数 | 通过 |
| AC-FR-OCR-025-04 | 双首选参数化的健康/重试/内容失败/none/缺密钥/熔断/试探测试；`test_worker_reads_swap_next_job_not_during_active_call`、`test_both_primary_engines_convert_same_template_using_unchanged_raw`、双首选确认导出 | 通过 |
| AC-FR-OCR-025-05 | 正负安全边界与 20 位整数在根/组/表格中的 API 往返、`test_generic_big_integer_digits_are_text_in_every_location`、确认后的实际 XLSX 文本单元格；0/false 不误转换 | 通过；两端浏览器精确读取/编辑/确认场景通过 |
| AC-FR-OCR-026-01 | `test_unconfigured_llm_preserves_pages_without_call`、`test_llm_failures_use_original`、Vision 无密钥/无效 LLM 集成：不额外 OCR、结果非空值哨兵、不丢 raw | 通过 |
| AC-FR-OCR-026-02 | 防御页读取、完全无页/空页、多语多页换行及精确数字、`test_ocr_text_fallback_keeps_languages_newlines_and_empty_page` | 通过；两端三语说明/多行/空页浏览器及关键截图核对通过 |
| AC-FR-OCR-026-03 | `test_fallback_edit_then_manual_template_uses_raw_not_edited_text`、通用/原文版本/确认/复核/导出权限与实际 XLSX、应用角色拒绝 raw 改删、通用数据不进入模板报表 | 通过 |
| AC-FR-SYS-162-01～05 的 API 部分 | 原子双字段交换、none 保持、重新读取、正在运行任务不改变/下个任务读取新值、整体 400 不部分写入、审计与无操作不重复审计 | 通过；后台双语/确认/取消/原子 400/no-op 六个浏览器场景通过 |
| FR-OCR-022 兼容 | `test_generic_llm_cannot_overwrite_cancelled_or_finished_job[CANCEL_REQUESTED/FAILED]`：迟到 LLM 不保存 raw/result，不覆盖终态，预占只退还一次 | 通过 |

## 已执行命令与记录

Python 命令全部在 `services/api/` 执行，输出临时文件位于根 `temp/ocr-primary-selection/`。

- TDD：新增通用边界用例先观察到 **20 failed、5 passed**；最小 worker 修正后相关通用/规则用例 **42 passed**。没有降低非法输入断言。
- `pytest tests/unit -q -p no:cacheprovider`：最终 **636 passed in 47.15s**；日志 `unit-full-final.log`。
- 通用边界与 XLSX 定向最终 **50 passed in 9.62s**；包含独立审查建议补充的组内表格唯一有效值/全空行正反例，日志 `unit-exact-final.log`。
- `pytest tests/integration/test_engine_switching.py tests/integration/test_ocr_settings.py tests/integration/test_ocr_worker.py tests/integration/test_template_mapping.py tests/integration/test_results.py tests/integration/test_exports.py tests/unit/ocr/test_xlsx.py tests/unit/ocr/test_generic_result.py -q -p no:cacheprovider`：**196 passed in 954.54s**，日志 `backend-focused.log`。此运行在补充 5 个单元边界用例前完成收集，补充项已由上述最终单元运行覆盖。
- Worker 取消/终态定向 **18 passed in 127.68s**，日志 `worker-focused-final.log`。
- `.venv/Scripts/ruff.exe check .`、`format --check .`：通过，**316 files already formatted**。
- 完整隔离 `pytest tests -v -p no:cacheprovider` 首轮实际 **1 failed/1420 passed in 3627.39s**（`backend-full.log`）。唯一失败为既有 `test_admin_cli.py::test_password_length_and_hash`：短密码 CLI 断言通过，随后第一次 `db.execute` 建立本机 asyncpg 连接超过测试 fixture 的 3 秒连接时限，尚未执行该数据库业务断言；不是本轮 OCR 断言失败。该轮与前端回归并发，环境竞争是可能原因，不能仅凭此推断通过。
- 随后复查同一完整管理员 CLI 文件，**3 passed in 52.96s**（`backend-admin-cli-rerun.log`）；没有改测试/配置/时限或跳过失败项，当时不能以该定向复查或 1420 项通过替代全量门槛。
- 相同隔离配置下第二轮完整 `pytest tests -v --tb=short -p no:cacheprovider`：**1421 passed in 3861.16s（1:04:21），无 skip，exit 0**（`backend-full-rerun.log`）。日志实际收集 1421 项，管理员 CLI 的 `test_password_length_and_hash` 与完整集合均通过；没有改连接时限、配置、测试集合或断言。全部 Python 命令保持 services/api 工作目录，未使用共享/生产库。

## 已核对的前端定向记录

17 个前端文件的实际 diff 已检查：后台仅新增首选/备用联动及解释；PC/LINE 仅对无模板、单 ocr_text/page_N 字符串组增加三语说明、多行编辑/只读与空页提示，普通通用和模板路径保持。完整独立前端审查未发现阻断项，建议的无操作/根表/null 补充已实现并定向通过；其后的最终根工作区全量结果见下文。

日志位于根 `temp/ocr-primary-selection/`：

- 后台红灯 `frontend-admin-red.log`：5 failed/9 passed，其中 4 个为新联动/解释断言，另 1 个为既有套餐首屏等待问题。修正后中间回归仍有失败；完整定向 `frontend-admin-final.log` 为 1 failed/15 passed，失败仍是既有套餐首屏。随后同一完整文件集合重跑 `frontend-admin-rerun.log`：**16 passed、2 files、143.01s**，不称此前失败为通过。
- PC 红灯 `frontend-pc-red.log`：8 failed/42 passed；最终 `frontend-pc-final.log`：**55 passed、3 files、178.01s**。中间普通字段反误识别断言及测试数据类型问题修正后通过，最终 TypeScript 门槛仍以全量构建为准。
- LINE 红灯 `frontend-line-red.log`：5 failed/28 passed；最终 `frontend-line-final.log`：**37 passed、2 files、44.94s**。
- 上述覆盖后台双向交换/none/确认取消/整体 400、PC/LINE 三语多页换行/空原文/保存重开/只读及实际 JSON 解码的大整数根/组/表格值。浏览器视觉、确认/导出后端持久化和原生 LINE 验收分别记录，不以 DOM 单测替代。
- 首轮 admin/LINE 全量命令参数包含多余的 `--`，日志显示 `vitest run -- --pool=threads --maxWorkers=1`，没有正确施加预期的 worker 限制，且两个应用并行。LINE 实际 **6 failed/432 passed（37 files）**，存在多处 15s 超时和首屏元素未就绪；后台同时出现多处超时，该递归命令失败，不能宣称任一全量通过。记录 `full-admin-line-tests.log`。使用正确透传参数、`--workspace-concurrency=1`、`--pool=threads --maxWorkers=1` 重跑两个完整应用集合，`full-admin-line-tests-serial.log` 实际 **admin 95 passed/16 files，518.13s；LINE 438 passed/37 files，470.54s**；未修改配置、超时或断言。该运行早于下述两项新增后台用例与 LINE 用例强化，最终根全量会再次覆盖全部修改。

## 审查与未覆盖项

通用 worker、单元测试、取消/终态测试及关联保存调用链已独立完整只读审查：无阻断项。补充了仅组内表格、表格唯一有效值为 0/false、全空对象行的单元正反例。新增迟到返回用例明确覆盖 CANCEL_REQUESTED/FAILED，不单独声称其覆盖已经 CANCELLED/SUCCEEDED 的场景。

17 个 OCR 前端文件及调用链已独立完整只读审查：未发现阻断性代码缺陷。审查建议补显式无操作/交换还原零 PATCH，以及根层表格/null 的 UI 往返。已先扩展 PC 实际 JSON 用例覆盖根表正负大整数字符串、safe/false/null 的显示/编辑/保存，并保留根/组/组表 null；选中该用例运行 **1 passed、17 skipped、59.81s**（`frontend-pc-root-table.log`），这是定向补充，不能代替最终完整文件集合。后台补充原始不变与交换还原两项确认后零 PATCH 用例：**2 passed/14 skipped，31.60s**（`frontend-admin-noop.log`）。LINE 同样强化根表/null、只读和保存 body：**1 passed/32 skipped，13.30s**（`frontend-line-root-table.log`）。上述定向不代替完整集合；随后根全量 lint/test/build 的 994 项结果见下文。

合成 fake engines 与 MockTransport 证明调用顺序、格式、精度和持久化兼容，不证明真实厂商对图片的识别质量。原生 LINE 身份与真实设备下载没有在此轮验收，后续浏览器 mock 也不能替代它们。

## 最终根工作区回归

```sh
npx --offline --yes pnpm@12.11.2 -r --workspace-concurrency=1 lint
npx --offline --yes pnpm@12.11.2 -r --workspace-concurrency=1 test --pool=threads --maxWorkers=1 --fsModuleCache=false --cache=false --configLoader=runner
npx --offline --yes pnpm@12.11.2 -r --workspace-concurrency=1 build
```

完整链 exit 0，源代码最终状态无删减测试；日志 `frontend-full-lint.log`、`frontend-full-test.log`、`frontend-full-build.log`。客户端 **5/1 file**、共享 UI **162/10 files**、LINE **438/37 files**、admin **97/16 files**、PC **292/23 files**，合计 **994 passed/87 files**；覆盖新增 no-op 与根表/null 回归。lint、TypeScript 和三端 Vite 最终构建通过；构建有 bundle 体积/插件耗时提示，不改配置消除提示。

根全量结束后启动完整后端第二轮 `pytest tests -v --tb=short -p no:cacheprovider`，日志 `backend-full-rerun.log`；最终 1421 项全部通过，结果见上文。浏览器使用三端最终 dist、固定 127.0.0.1 静态端口、合成 API/身份与仅内存 LIFF-init shim，新增四个真实 UI 触发的确认/导出场景（下载字节是明确标识的合成 JSON，不是 XLSX 工作簿）。该轮结束时 CI/Deploy 尚未执行；最终发布结果见下文。

## 浏览器实际执行记录

证据统一位于根 `temp/pc-report-view-polish/`，不提交临时截图、合成身份或下载文件。

首轮 40 场景实际 19 通过/21 失败（71 截图）；完整失败证据保存 `browser-first-summary.json`、`browser-first-run.log`。脚本误点 Ant readonly 搜索 input、loading 图标改变按钮可访问名称、LIFF 同一资产重载被误认为多个目标、确认只读空页零高度 div 不可 visible；经实际保存/确认 PATCH、终态 DOM 与源码核对后修正脚本，没有修改 OCR 业务代码或削弱保存完成断言。

第二轮完整 40 场景实际 31 通过/9 失败（86 截图），保存 `browser-second-summary.json`、`browser-second-run.log`。**14 个 PC/LINE OCR 场景全部通过**：三语原文多行读/编辑/保存/重开/只读、无原文、大整数根/组/表格精确读取和保存，四个实际 UI 保存→重开→确认→只读详情→导出→本地 blob 下载。后台 none 取消、整体 400、unchanged/swap-back 零 PATCH 四场景通过；两双向交换仍在 pending 保存按钮 loading-name 脚本定位处失败，原子 changed-fields PATCH 已发送。其余七失败属于报表检查。保持失败事实，尚不能称完整浏览器通过。

四个 UI 确认场景精确校验 PC `structured:null` 与 LINE 完整已存结构的第二次 PATCH、确认不造新版本、确认后任务离开待核验队列/进入 final、重新 GET 已确认版本 2、无编辑按钮；随后真实点击导出一次，校验 blob 下载事件、文件名和合成 JSON 字节。合成字节明确标为 **SYNTHETIC DOWNLOAD FIXTURE, NOT XLSX**，HEAD 为脚本单独探测而非 UI 发送；实际工作簿精度/权限/版本由前述后端 openpyxl 测试证实，不由假 XLSX MIME 推断。

主代理已实际打开 PC 三语原文、LINE 泰文原文、PC 大整数确认只读等截图；文字与多行提示可读取，无原文空页有说明。最后 PC 窄屏 CSS 后根 lint、报表/三语完整 78 项及三端 TypeScript/build 通过，完整浏览器最终结果如下。

第四轮完整矩阵 exit 0：**40/40 场景通过（20 报表、6 后台、14 OCR）、102 截图、fatal=null、无安全边界违规**。第三轮 39/1 的失败停在第二个下拉，未 PATCH；旧 portal 退出动画有被全局 visible 定位命中的风险，临时脚本改用 input `aria-controls` 唯一 popup，不 force、不提高超时。最终原子 400 场景实际只发送一个 changed-fields PATCH、响应 400、服务配置深度相等不变、输入草稿保留并可切换中/英文错误提示；两个交换场景验证 pending loading 和重复点击零新增 PATCH，unchanged/swap-back 确认后均零 PATCH。没有更改业务按钮机制或服务校验。

实际打开最终中文 400 图，备用与地址错误分别有红色提示，未保存输入保留；另核对中文联动、英文 pending loading、PC 多页原文、LINE 泰语只读及 PC 确认后大整数/root-table/null 显示。四个确认/导出场景仍仅合成 JSON blob，真实工作簿由后端 openpyxl 验证；静态 LINE shim 不证明原生设备行为。所有浏览器 API/身份为合成，未知 API 和外网请求拒绝。

两 change 严格校验均通过，全部 32 条本地文件链接可达；完整后端第二轮 1421 项全部通过。最后完整只读范围审查核对 33 个 tracked 差异及新通用测试，无新 P0/P1；只读审查未运行测试或调用外部服务。本节记录结束时尚未执行提交、CI 与 Deploy；最终结果见下文。

## 规格同步与归档

2026-11-14 复用已取得的 specs 规则 snapshot，向 recognition/web-admin 既有 main spec 追加本 change 的 **3 FR/13 AC**，PC change 同步另外 **3 FR/10 AC**。三份原文件的全部字节、标题/Purpose/48 旧需求保持不变，新增内容与三个 pure ADDED delta 逐字一致，共 54 需求且无 delta 操作标题；只读 snapshot 验证通过。`openspec validate --specs` **15 passed/0 failed**，两个 change strict 通过，未修改无关旧规范提示。

两个最小 tasks 链接均 **1/1、state=all_done**；不创建 design，按项目流程仅移动这两个 change 到 `archive/2026-11-14-*`，`.openspec.yaml` 保留，其他 active change 不动。归档相关 23 链接修正后，全部 **32 本地文件链接可达**。发布前三站 unauthenticated health GET 均为旧代码 `e2ce30e048de14e56b6055a68dc2001f0cfd0c1e`、数据库 ok，不把旧代码健康当本次上线。

## 标准 CI 与发布进度

两个独立新提交 `440fdd2` / `a69a0e3` 已正常推送，目标代码 SHA `a69a0e35aa0c25357080cd115850ffd97f8aed62`。目标 [CI 43503353540](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43503353540) 最后完成于 `2026-11-13T20:46:12Z`（曼谷 2026-11-14），backend/frontend/contract/scripts/stack 全部 **5 jobs success**。实际后端 job 日志为 **1421 passed in 451.66s，无 skip**；前端各工作区 **5+162+438+97+292=994 passed/87 files**，lint 与三端 TypeScript/build 成功，覆盖最终 PC CSS。首次监看遇到 `unexpected EOF` 仅是读取连接中断，恢复同 run 监看后成功，没有重跑 CI、修改配置或省略测试。

核对远端 SHA 未变且没有同 SHA 既有 Deploy 后，仅触发一次 [Deploy 43504725409](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43504725409)，最终 **success**，完成于 `2026-11-13T20:51:48Z`（曼谷 2026-11-14 03:51:48）。构建推送镜像、标准上传/迁移/重启、三站健康、数据库端口关闭均成功。Deploy 监看曾遇到 GitHub API HTTP 500，真实 run 仍在运行，恢复同 run 监看后成功；没有重复部署或直接 SSH 修改，没有清理生产资源或修改既有脏部署配置。

## 独立只读生产核验

`2026-11-13T20:52:17Z` 开始独立 unauthenticated GET，实际输出 `temp/ocr-primary-selection/production-check.json` 为 **pass=true**：PC/admin/LINE 三站 health 都严格为 `status=ok/database=ok/version=a69a0e35aa0c25357080cd115850ffd97f8aed62`；HTML 引用的全部 **9 个 JS/CSS 资产 HTTP 200**，字节数和 SHA-256 已记录。PC 的只读报表与原文保底说明、后台默认 OCR 共用/下一任务生效说明、LINE 原文保底/无可读原文说明均在实际线上资产中存在。站点及主资源清单见 [共同发布核验](../2026-11-14-pc-report-view-polish/verification.md#独立只读生产核验)，线上 build hash 不强求等于本机。

未切换生产默认、未写业务记录、未付费调用 OCR/LLM，未登录生产后台进行控件验收。真实厂商识别质量、授权生产 UI 与原生 LINE 身份/设备下载仍未验证。收尾保存计划与部署证据的新提交只改两 change 的 plan/verification，生产代码继续为上述 SHA，不为证据提交重复部署。
