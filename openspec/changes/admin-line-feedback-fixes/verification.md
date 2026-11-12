# admin-line-feedback-fixes — 验证记录

## 授权与边界

负责人 2026-11-11 反馈 LINE 三项（退出遮罩、套餐页、CSV 导出提示）与管理后台用户页一项，另含折线图孤立点修正；指示"按推荐的方式直接全部开发完成并测试完成"。该指示**不含**提交、推送或部署授权；本地交付阶段未提交、未发布；随后的发布授权与结果见文末"正式发布"节。

验证只在本机隔离环境进行：API `127.0.0.1:8010`（`saiflow_dev`）、line-mini `:5173`、web-admin `:5175`；集成测试只连 `127.0.0.1:25432/saiflow_test_full1`。未触碰生产 `38.60.156.234` 或 `81.68.72.120`，未调用付费 OCR。后端改动后重启了本机 API（此前进程运行旧代码，管理端用户页首屏曾返回"输入无效"）。

## 逐项证据（2026-11-12）

| # | 项目 | 追溯 | 自动化测试 | 浏览器检查 |
|---|---|---|---|---|
| 1 | LINE 退出确认框不再被遮罩盖住 | FR-SYS-043、FR-SYS-137 | `components/ui/ui.test.tsx` 断言确认框内容 `z-[51]` 高于遮罩 `z-50`、底部面板内容 `z-[41]` 高于遮罩 `z-40` | 390px：退出后无残留遮罩（0 个打开的 overlay），页面回到 `#/` 且可操作 |
| 2 | LINE 套餐页美化 | FR-SYS-053（样式与说明文案） | `billing.test.tsx` 9/9；053-05 另断言 Kinder 显示"当前空间不可用"且无按钮、Starter 显示"续费" | en 390、zh 390、zh 360、th 320：四张档位卡、每张有色条、当前档位描边、无横向溢出、卡内无截断 |
| 3 | LINE 内 CSV 不离开 LINE（2026-11-12 修订，见文末） | FR-SYS-144、FR-REPORT-016 | 修订后 `reports.test.tsx` 44/44（初版 42/42）；144-01 分享文件字节与 API 返回一致；144-02 不支持文件分享时预览并复制，不换取凭证、不打开外部浏览器；144-03 取消分享不提示，"在浏览器中下载"按需换取凭证；144-04 新发布版本使已准备文件失效；144-05 两种复制方式都失败时提示改用浏览器、面板保持打开 | 修订后用 `window.__inClient` 模拟 LINE 内：5 组宽度/语言 45 PASS（见文末） |
| 4 | 管理后台用户页默认分页展示全部用户 | FR-SYS-080、FR-SYS-070 | 后端 `test_admin_user_search.py` 新增 `test_list_all_without_query`；web-admin `people.test.tsx` 15/15；`auth.test.tsx` 6/6 | 1280、1440：打开即列出用户且首个请求无 `q`、显示"第 1 页"、第 1 页"上一页"禁用、搜索发送 `q`、清空回到全部用户第 1 页、无横向溢出 |
| 5 | 折线图孤立数据点显示 | FR-REPORT-013、FR-REPORT-018 | `packages/ui` ChartRenderer `option` 测试断言折线系列 `showAllSymbol: true`，其他图型不设置 | — |

浏览器检查脚本 `temp/admin-line-feedback/browser.cjs`，结果 `temp/admin-line-feedback/shots/results.json`：**45 PASS / 0 FAIL**；截图同目录（`line-390-en-plans.png`、`line-390-zh-plans.png`、`line-360-zh-plans.png`、`line-320-th-plans.png`、`line-390-after-logout.png`、`admin-1280-users*.png`、`admin-1440-users*.png`）。控制台仅有未登录时 `/me` 的 401 与静态资源 404，均为既有预期，不计为错误。

## 全量检查

| 检查 | 结果 |
|---|---|
| 后端 `ruff check` / `ruff format --check` | 通过 |
| 后端 `pytest tests/unit` + `tests/integration/test_admin_user_search.py`（`saiflow_test_full1`） | 542 passed |
| line-mini vitest（单 worker） | 33 files，319 passed |
| web-admin vitest（单 worker） | 16 files，86 passed |
| packages/ui vitest（单 worker） | 10 files，162 passed |
| eslint（line-mini、web-admin、ui） | 通过 |
| tsc `--noEmit`（line-mini、web-admin、ui、web-pc） | 四个包均 rc=0 |
| vite build（line-mini、web-admin、web-pc，输出到 `temp/admin-line-feedback/build-*`） | 三个应用均构建成功 |

### 过程中修正

- `auth.test.tsx`"会话中途过期"用例：用户页现在打开即查询，原 mock 对所有 `/admin/users` 请求返回 401，使过期提示提前出现。改为无 `q` 的首屏查询返回空列表、带 `q` 的搜索返回 401，仍覆盖原场景。
- `reports.test.tsx` 的 CSV mock 改用字符串响应体：Node 的 `Response` 不识别 jsdom 的 `Blob`，会把它序列化为 `"[object Blob]"`。
- `packages/ui` 的 `ReportDesigner` 测试在 2 个 worker 并行时偶发超时，单独运行 8/8；全量统一以单 worker 运行。

## 限制

- 真实 LINE 客户端（iPhone/Android）中的系统分享面板、复制到剪贴板未验证：本机只能模拟 `isInClient`。上线后需在真机确认。
- 不支持文件分享的 WebView（iOS LINE、部分 Android LINE）原先会走下载凭证并出现"打开外部应用"提示；2026-11-12 修订后改为预览并复制，只有用户点击"在浏览器中下载"才会出现该提示（见文末）。
- Excel 导出未改动。

## 正式发布（2026-11-12，已完成）

负责人随后明确回复 **"提交并部署"**。本变更与 admin-impersonate-user 合并提交并发布：生产版本 **`78e144425f069bc23679359fd3c429903de35067`**，[CI 43124397561](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43124397561) 与 [Deploy 43125365719](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43125365719) 均 success；迁移前备份、迁移与健康检查细节见 `openspec/changes/admin-impersonate-user/verification.md` 的"正式发布"节。只读检查：LINE 入口 `index-CbAB76wT.js` 含确认框层级 `z-[51]`、`canShare` 文件分享与折线图 `showAllSymbol`；三站健康版本一致。真实 LINE 客户端中的退出、套餐页与 CSV 分享仍待真机确认。

## 2026-11-12 修订：iOS LINE 内 CSV 仍提示"打开外部应用"

**反馈。** 发布后负责人在 iPhone LINE 中打开报表 feng-2222，点击卡片 ts-1 的"CSV"，仍出现"此网站正尝试打开外部应用"（附截图）："这个导出还是不行。"指示"不要问我，直接按照你推荐的方式开发……并测试完成"，**不含**提交或部署授权。

**原因。** iOS LINE 的 WKWebView 不支持分享文件（`navigator.canShare({ files })` 为 false）。初版在这种情况下直接换取下载凭证并 `liff.openWindow({ external: true })`，因此每次都会触发 LINE 的提示。

**修订后的行为（FR-SYS-144，delta spec 已改写）。**

- 在 LINE 内一律用当前会话取得 CSV，并显示"CSV 已准备好"面板：
  - 预览最多 50 个非空行，超出时注明"仅显示前 50 行，共 N 行"；
  - 支持文件分享时显示"保存或分享"；
  - 始终提供"复制 CSV"（不支持分享时为主按钮）；
  - "在浏览器中下载"附说明"LINE 会询问是否打开外部应用，请选择'允许'"。
- 只有用户点击"在浏览器中下载"才换取 60 秒下载凭证并打开外部浏览器。
- 复制在点击中同步执行：先在面板内放置只读文本框并执行复制命令（避开面板的焦点约束），失败时再用 Clipboard API；复制内容去掉服务端为 Excel 加的 BOM，文件字节保持原样。
- 涉及 `apps/line-mini/src/features/reports/api.ts`、`ReportDetailPage.tsx`、`reports.module.css`、三语资源与 `reports.test.tsx`；proposal 与 plan 已同步注明本次修订。

**自动化检查。**

| 检查 | 结果 |
|---|---|
| `reports.test.tsx` | 44/44 |
| line-mini vitest 全量（单 worker） | 33 files，321 passed |
| line-mini tsc `--noEmit` | rc=0 |
| line-mini eslint | 通过（修正 `no-useless-assignment` 与测试中未使用参数各一处） |
| `openspec validate admin-line-feedback-fixes --strict` | valid（FR-SYS-144 正文压缩到 500 字以内，细节移入场景，新增 AC-05 复制失败） |
| line-mini vite build（输出 `temp/csv-panel/build-line-mini`） | 成功 |

**浏览器检查。**

- 脚本 `temp/csv-panel/browser.cjs`，配置 `temp/csv-panel/vite.config.mts`。line-mini 在 `:5180` 运行，devLiff 的 `isInClient` 由 `window.__inClient` 切换。
- 登录走本机 API `:8010`（`saiflow_dev`）的开发登录。报表 31 的详情、数据、CSV 与下载凭证由 Playwright 拦截返回，`/me/tenants` 在真实响应上追加一个替身组织席位；未写入任何记录。
- 5 组场景：en 390、zh 390、th 320 为"不支持分享"；zh 390、en 320 为"支持分享"。共 **45 PASS / 0 FAIL**，每组检查：
  - 面板出现，且未换取凭证、未打开新窗口；
  - 预览 50 行；
  - 页面无横向溢出，面板与按钮在视口内；
  - 预览区内部可滚动（高 238px）；
  - 实际点击"复制 CSV"后出现提示，剪贴板内容与 CSV 去掉 BOM 后完全一致，面板保持打开；
  - 无控制台错误。
- 截图 `temp/csv-panel/shots/panel-*.png`。
- 检查结束后已停止本次启动的 vite 与 API 进程。

**仍待真机确认。** iPhone 与 Android LINE 中的复制与系统分享面板，本机无法验证。若两种复制方式在真机都失败，面板会提示改用"在浏览器中下载"。本修订尚未提交、未部署。

### 修订发布（2026-11-12，已完成）

负责人回复 **"提交部署我测试下"**，授权本修订的提交、推送与既有 GitHub Actions 正式发布；未手动 SSH，未做业务写入，未调用付费 OCR。

- 代码提交 **`614884bd212e9d4fbc8babddee94934754daebda`**（11 个文件；`.qoder/` 与 `docs/10-product/user-manuals/` 排除）。
- [CI 43138830581](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43138830581)：backend、frontend、contract、scripts、stack 全部 success。
- [Deploy 43139598856](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43139598856)：workflow_dispatch，headSha `614884b`，全部步骤 success。迁移前备份 `saiflow-20261112T021508Z.dump`（301,477 bytes）已上传 `gs://saiflow-db-backup/`；无新迁移；三站健康、外部 5432 关闭、runner SSH key 清理均 success。日志存 `temp/csv-release/deploy.log`。
- 只读线上检查：三站 `/api/v1/health` 均 status/database ok、version `614884b…`；LINE 入口 `index-Dr6yPEVn.js` 含 `execCommand`、`csv-preview`、`canShare` 与 `showAllSymbol`。
- 待负责人在 iPhone/Android LINE 真机确认复制与分享。

## 2026-11-12 修订：LINE 内 Excel 导出仍提示"打开外部应用"（FR-SYS-107、FR-SYS-116）

**授权。** 负责人截图反馈 LINE 内导出仍弹出"此网站正尝试打开外部应用"，已先行手改 Excel 导出（`features/scan/download.ts`、`FinalResultPage.tsx`、`final.test.tsx`、三语资源），并要求"你检查下，然后部署到服务器上我测一下"。这一指示授权本修订的检查、提交与既有 GitHub Actions 发布。

**复核负责人的改动，保留做法，修正 3 处。** 做法是在 LINE 内带会话取得 XLSX，再从点击中调用 `navigator.share({ files })`。修正如下：

1. 原实现无条件显示"分享 Excel"。不支持分享文件时（iOS LINE 常见），点击会抛出未处理的异常，用户看不到任何反应。现在只在 `navigator.canShare({ files })` 为真时显示该按钮；否则说明此 LINE 版本无法直接保存文件。
2. 原实现删除了下载凭证路径，导致没有任何退路。现在始终提供"在浏览器中下载"：只在点击时换取 60 秒凭证并打开系统浏览器，同时提示需选择"允许"。
3. 分享出错时：`AbortError` 不提示；其他错误显示"无法打开分享面板，请改用'在浏览器中下载'"，并保留已就绪的文件。

另外两处调整：

- 已就绪的文件按租户标记，切换租户后不再提供。
- 文件改由 `arrayBuffer()` 构建，确保字节与服务端返回一致。

规格方面，delta 修改 FR-SYS-107（含 `verify-template-custom-fields` 的 AC-04/05，归档顺序在其后）与 FR-SYS-116，新增 AC-FR-SYS-107-06、07，并改写 AC-01。

| 检查 | 结果 |
|---|---|
| `final.test.tsx` | 11/11；107-01 断言分享文件名为 `invoice.xlsx`、字节与 API 一致、无凭证、无外部窗口；107-06 不支持分享时无"分享 Excel"，点击"在浏览器中下载"才换取凭证并以 `external: true` 打开；107-07 取消不提示，`NotAllowedError` 提示改用浏览器 |
| line-mini vitest（单 worker） | 33 files，323 passed |
| tsc、eslint、vite build | 通过 |
| `openspec validate admin-line-feedback-fixes --strict` | valid |
| 浏览器检查 `temp/xlsx-share/browser.cjs` | zh 390（支持分享）、zh 390、en 360、th 320（不支持分享）共 **29 PASS / 0 FAIL**：按钮出现条件正确，点击前无凭证、无新窗口，无横向溢出，面板在视口内，分享得到的 xlsx 文件名与字节正确，无控制台错误。截图见 `temp/xlsx-share/shots/`。仅拦截了 job j9 与导出 e9 的接口，未写入记录；结束后已停止本次启动的 vite 与 API |

**发布。**

- 代码提交 **`8eacd4ceb579f7d41a387d0f672df59e957cac1e`**，10 个文件，已排除 `.qoder/` 与 `docs/10-product/user-manuals/`。
- [CI 43149775308](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43149775308)：backend、frontend、contract、scripts、stack 全部 success。
- [Deploy 43150621287](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43150621287)：success。迁移前备份 `saiflow-20261112T035153Z.dump`（302,579 bytes）已上传 `gs://saiflow-db-backup/`，本次无新迁移。日志存于 `temp/xlsx-share/deploy.log`。
- 只读线上检查：三站 `/api/v1/health` 均为 status/database ok，version `8eacd4c…`；LINE 入口 `index-BaWrOuwp.js` 含 `final.shareExcel`、`final.downloadInBrowser`、`export-panel`、`csv-preview` 与 `canShare`。
- 部署目标仍为 GitHub Variable `VPS_HOST`（38.60.156.234）。DoH 查询三个域名均解析到该地址，负责人提到的新服务器 IP 尚未提供。
- 待负责人在 iPhone/Android LINE 真机确认。若 iOS LINE 不支持分享文件，面板只提供"在浏览器中下载"，这时仍会出现一次"允许"询问，属于 LINE 的限制。

## 2026-11-12 再修订：CSV 与 Excel 只在点击时分享，彻底移除浏览器退路

**反馈与授权。** 负责人再次提供 iOS LINE 的"此网站正尝试打开外部应用"截图，并要求"请更换导出方式……按照我刚才修改代码的那种方式来"。本次按其手改方式完成本地代码与验证；未获得新的提交、推送或生产部署授权，**尚未提交、未部署**。前文是历史版本的验证及发布证据，其能力探测隐藏按钮、浏览器退路与允许提示不再适用于本次代码。此前将 iOS LINE 的分享能力一概视为不支持也不构成本次真机证据，实际结果只能由运行时调用确定。

**当前行为（FR-SYS-144、FR-SYS-107、FR-SYS-116、FR-ENTRY-015、FR-REPORT-016）。**

- CSV 与 XLSX 均使用当前会话、租户上下文取得原始文件字节，先在当前页面准备文件；第二次点击分享按钮时直接调用 `navigator.share({ files })`，调用之前没有异步等待。
- 不使用 `navigator.canShare` 隐藏按钮。其缺失、返回 false 或抛错时仍保留分享按钮并直接尝试分享。
- 删除两条 LINE 导出路径的下载凭证请求、外部浏览器跳转、浏览器下载按钮和允许提示；同时移除 `features/scan/api.ts` 中无引用的旧 `exportTicket` 封装。全项目 line-mini 非测试代码搜索上述旧符号与两条 ticket 请求均无匹配。
- CSV 保留最多 50 个非空行的预览和完整文本复制，复制文本去 BOM，分享文件保留原始字节。分享缺失或同步/异步失败时提示改用复制；复制失败时提示重试复制或分享，均不离开当前页面。
- XLSX 分享接口缺失或失败时在页面明确提示，文件保留供重试；取消静默，成功后关闭文件就绪面板。错误提示上移到分享按钮上方，并缩短英文、泰文提示，避免被底部操作栏遮挡。
- LINE 外的普通浏览器仍沿用原直接下载方式；文件内容、版式、服务端接口、权限规则均未扩展。proposal、plan 与 delta spec 已同步，无新迁移、无 design/tasks 文件。

### 最终自动化检查

| 检查 | 结果 |
|---|---|
| 修改前新增回归用例（红） | 13 failed / 51 passed，证明旧能力探测和外部退路与本次行为不一致 |
| `reports.test.tsx` 与 `final.test.tsx` | 50 + 14 = 64 passed；覆盖字节、能力探测 false/缺失/抛错、接口缺失、取消、失败、重试及无 ticket/openWindow |
| line-mini vitest 全量（单 worker、vmThreads） | 33 files，332 passed |
| line-mini tsc `--noEmit`、eslint | 均 rc=0 |
| line-mini vite build | 成功，输出 `temp/xlsx-share/share-only-build/` |
| `openspec validate admin-line-feedback-fixes --strict` | valid |
| `git diff --check` | 通过 |

测试及构建日志为 `temp/xlsx-share/share-only-full.log`、`share-only-targeted.log`、`share-only-build.log`；未重跑后端或其他应用，本次没有修改它们。

### 浏览器与截图检查

脚本 `temp/xlsx-share/browser-share-only.cjs`，页面 `127.0.0.1:5181`，配置沿用 `temp/csv-panel/vite.config.mts` 的开发 LIFF 替身。**所有 `/api/**` 请求由 Playwright 完全模拟返回，没有 `route.fetch`，未启动或访问真实 API/数据库，未登录或创建任何实际账号/导出记录，未调用 OCR。** XLSX 是标注为模拟的文件字节，不是实际工作簿；这次只验证传递字节完整性，不验证服务端工作簿生成。

- 18 组场景，共 **147 PASS / 0 FAIL**：两种格式各 zh 390px、en 360px、th 320px 的成功分享；各 en 390px 的接口缺失、同步抛错、异步拒绝和取消；另含 XLSX zh 390px、th 320px 的接口缺失与失败。
- `canShare` 在所有场景均为 false，检查分享按钮仍存在、不调用探测、不自动分享；成功分享时 `navigator.userActivation.isActive` 为 true，收到的文件字节与模拟 API 完全一致。
- CSV 每组实际点击复制，Chrome 剪贴板得到完整 CSV（仅移除 BOM），复制后面板保留，预览为 50 行。
- 所有场景均无 ticket 请求、`window.open` 或新窗口，导出使用租户 8；所有 API 请求均命中预期模拟接口，没有页面未处理异常。
- 页面和面板无横向溢出。XLSX 错误提示的底部高于操作栏顶部；已打开检查 CSV 中/泰文、XLSX 中/泰文及中/英/泰失败截图。截图及逐项 JSON 见 `temp/xlsx-share/shots-share-only/`，结果汇总见 `share-only-browser.log`。
- 完成后已关闭浏览器及本次启动的 `:5181` Vite 服务，没有停止其他开发服务。

### 审查及仍未验证的边界

独立静态审查全文核对四个导出实现及相关测试，未发现本次新增的实质缺陷。其记录了既有的缓存文件边界：XLSX 只绑定租户，同组件换任务或权限撤销后可能仍保留旧文件；CSV 同发布版本的 `can_export` 单独变 false 时未必清理已准备文件。本次没有扩展到这些既有上下文失效问题，不将其描述为已验证或已修复。

真实 iPhone/Android LINE 的系统分享和复制**仍未验证**。本机模拟分享成功不证明 LINE 支持分享文件；若客户端没有提供该能力，XLSX 将停留在页面显示不支持提示，而不会改用外部浏览器。Web Share 的用户激活及支持条件参考 [MDN Navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)。上述为本地交付时状态，后续发布授权与结果见下节。

### 再修订正式发布（2026-11-12）

负责人随后明确回复 **"提交并部署"**，授权本次分享方式修订的提交、推送与既有 GitHub Actions 生产发布。代码提交 **`0dcfa77552d8df2ee30bdac2206fb051894e520e`**，18 个文件，已推送 `chore/ai-workflow-v2`；未纳入 `.qoder/`、`docs/10-product/user-manuals/` 或临时文件。

部署前只读确认：GitHub Variable `VPS_HOST` 为 `38.60.156.234`，APP/ADMIN/LINE 地址与现有三站一致；三站健康正常，版本均为此前的 `8eacd4c…`，LINE 入口仍为 `index-BaWrOuwp.js`。沿用 Deploy workflow_dispatch，仅接受既有分支并检查当前提交 CI 成功；迁移前执行本地与 GCS 备份，未手动 SSH，未触发业务写入或付费 OCR。

**发布结果：已完成。**

- [CI 43164852651](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43164852651)：headSha `0dcfa77…`，backend、frontend、contract、scripts、stack 全部 success。
- [Deploy 43165496859](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43165496859)：workflow_dispatch，headSha `0dcfa77552d8df2ee30bdac2206fb051894e520e`，success；镜像构建与推送、服务更新、三站健康、外部数据库端口关闭及 runner SSH key 清理全部 success。
- 迁移前备份 `saiflow-20261112T060748Z.dump`（302,877 bytes）已完成并上传 `gs://saiflow-db-backup/`。本次没有新迁移，部署按原流程执行 `alembic upgrade head`。部署日志 `temp/xlsx-share/share-only-deploy.log`。
- 2026-11-12 14:09 +08:00 的独立只读检查：APP、ADMIN、LINE 三站的 `/api/v1/health` 均 status/database ok，version 均为上述完整代码提交。
- LINE 实际入口已更新为 `/assets/index-BV5-Dp5b.js`，首页 `Cache-Control: no-cache`。已下载核对真实资源：含 `final.shareExcel`、`final.shareUnavailable`、`rpt.csvShare`、`rpt.csvCopy`、`export-panel`、`csv-preview`；不含旧浏览器按钮/说明键 `final.downloadInBrowser`、`final.browserHint`、`rpt.csvInBrowser`、`rpt.csvBrowserHint`，也不含两种导出的 ticket 请求路径。
- 只读核验脚本 `temp/xlsx-share/check-share-only.ps1`，结果 `share-only-production-check.json`，所有检查 passed；原始公共资源留在 `share-only-production-index.js`。核验只访问首页、公共静态文件与健康接口，没有登录、生成实际导出或写入业务记录。
- 真实 iPhone/Android LINE 的系统文件分享仍待负责人测试。可关闭后重新打开小程序，先准备 CSV/Excel，再点击分享；分享不支持时只在当前页面提示，不再提供浏览器下载退路。

## 参考 20261104 可用版本恢复服务器附件下载（2026-11-12，未发布）

负责人最新要求：对照 `temp/saiflow-monorepo-20261104`，修复当前 CSV 与 Excel 两处导出。本节取代前述分享-only 的当前实现说明，不覆盖其历史测试和发布记录。本次仅本地修复与测试，**没有提交、推送、部署或生产业务写入**。此前 Published 频道配置工作仍暂停，其 workflow/scripts 本地修改没有混入本次导出验证或发布。

### 实际对比与实现

- 完整读取快照 `apps/line-mini/src/views/FinalResultPage.vue`、`api.ts`、`liff.ts` 及旧导出路由：其可用 XLSX 导出不是 Web Share，iOS 等环境用真实 HTTP 附件链接，Android LINE 使用 60 秒票据与外部浏览器。快照没有当前报表 CSV 页面；CSV 是同一机制在现有架构的适配，不能声称复制了旧报表页。
- 当前 FastAPI 的两种 ticket/redeem 接口仍存在。当前认证还要求租户 header，所以 LINE 两平台都申请现成的短时凭证，让原生下载器无需附带 header/cookie也能由服务端恢复会话和租户、验证权限。iOS 用真实服务器附件 anchor；Android 用 LIFF external（SDK 抛错时用 LINE 外部浏览器参数）。不使用 `navigator.share` 或 `canShare`，非 LINE 原 blob 下载不变。
- CSV 保留 authenticated GET 的原字节、BOM 去除后的完整复制文本及前 50 非空行预览；首次下载后可再次下载，重走期间/版本/权限校验并申请新 ticket。XLSX 首次点击直接创建/复用有效文件、取票据并发起下载，不再准备第二次分享面板。共享 helper 拒绝非可信 origin、错误 route、凭据、查询、片段和路径穿越。
- 独立审查发现两项问题，均用红测试复现并修复：同事被复用其他创建者 XLSX 后无法签票；同版本 `can_export=false` 不清理 CSV。后端复用按当前创建者限定，仍禁止交叉签票；前端在权限撤销时立即取消 pending CSV/ticket、关闭预览并禁止复制。复核全文核对四文件及模型/迁移约束，两问题消除，未发现新增实质问题。

### AC → 回归证据

| AC | 检查 | 结果 |
|---|---|---|
| AC-FR-SYS-144-01/03 | iOS 真实附件 URL、Android external、ticket body 固定卡片/期间/版本、无 Web Share、重试新 ticket、拒绝不下载 | reports + helper 专项通过；浏览器通过 |
| AC-FR-SYS-144-02/05 | RFC4180 引号、50 非空行、完整文本去 BOM、面板内 copy command/clipboard、失败保留提示 | 专项通过；浏览器实际剪贴板检查通过 |
| AC-FR-SYS-144-04 | 发布/取消发布/租户/离页的迟到 CSV 和 ticket；同版本权限撤销已准备/待票据两条回归 | 专项通过；新增红测试 2 failed 后转绿 |
| AC-FR-SYS-107-01/06/07、FR-SYS-116 | 首次点击附件、Android 提示、缺失/抛错 Web Share 不影响、失败重试、租户切换取消 | final + helper 专项通过；浏览器通过 |
| AC-FR-SYS-107-02/03/04/05 | 无权限/待复核限制、额外字段只读、页面可见不扩展导出 | 既有回归保持通过 |
| AC-FR-SYS-107-08、AC-FR-ENTRY-015-03/04 | 同事分别创建和复用、无 cookie 取票下载、owner 仍复用原文件、禁止交叉签票、60 秒过期/注销/篡改 | 隔离库 XLSX 集成通过；多人红测试 1 failed 后转绿 |
| FR-REPORT-016 | 服务端 CSV 内容/期间/发布版本/范围、导出权限、ticket 过期及撤销 | 隔离库 CSV 集成通过 |

### 最终检查结果

- 三文件导出专项：**95 passed**（helper 13、final 15、reports 67），日志 `temp/xlsx-share/reference-download-targeted-final.log`。
- line-mini 全量：**34 files / 363 passed**，日志 `reference-download-full-final.log`。
- line-mini `tsc --noEmit`、全应用 eslint 均 rc=0；最终 Vite build 成功（`reference-download-build-final/`，日志 `reference-download-build-final.log`，主 bundle `index-DmeFbbOK.js`）。
- 后端只在新建的 **127.0.0.1:25432 / saiflow_test_reference_exports** 顺序执行：`test_exports.py` **10 passed**、`test_report_csv.py` **7 passed**；日志 `reference-backend-green.log`、`reference-backend-csv.log`。使用隔离测试角色与 fake LINE/邮件/OCR/LLM/对象存储，没有访问实际 API/生产数据库或付费识别。两项修改 Python 文件 Ruff check/format --check 通过。未重跑整个后端或其他应用套件。
- `openspec validate admin-line-feedback-fixes --strict` 与 `git diff --check` 通过。

### 浏览器、附件字节与布局

`temp/xlsx-share/reference-browser.cjs` + `reference-vite.config.mts`：本地 Chrome 移动视口，**16 场景 / 142 PASS / 0 FAIL**，见 `reference-browser-final.log` 和 `reference-browser-shots/checks.json`。涵盖两格式各 iOS/Android × zh390/en360/th320，以及两格式的票据失败重试和非 LINE 下载。

所有业务 `/api/**` 由 Playwright 完全模拟；真实原生附件下载仅通过 Vite 两条指定 route 代理到 **127.0.0.1:5183 的本地合成附件服务器**。该服务器不连接数据库、云存储或任何第三方。首轮发现 Chrome 原生 anchor 下载绕过 Playwright route，收到了 Vite SPA HTML，而非模拟附件；已改为上述真实本地附件响应，最终逐个保存并核对字节成功。没有把首轮失败当作产品修复成功。

- iOS 模拟路径真正触发 Chrome download，保存的 CSV/XLSX 字节与合成源完全一致；XLSX 是明确标注的 transport 合成字节，真实工作簿格式另由后端 openpyxl 集成检查，不把其当生产文件。
- Android 检查真实同源 ticket URL 交给外部窗口替身，不证明真实系统浏览器已保存。CSV 再次下载始终取新 ticket、复制取得全部文本（仅去 BOM）、预览 50 行。
- 分享/能力探测均设为抛错且实际调用次数为 0；选择的租户为 8，业务请求及票据均带正确 tenant，CSV ticket 固定屏幕期间/卡片/版本，没有未处理页面异常或未预期 API 请求。
- 所有视口无横向溢出、CSV sheet 适配移动宽度；已打开检查中/泰文 CSV 及中/泰文 Excel 截图。浏览器和本次 Vite/附件服务器均关闭，5182/5183 已复查不再监听，没有停止其他开发服务。

### 仍未验证

真实 iPhone/Android LINE 的原生附件保存仍需发布后由负责人真机复测；本地 Chrome 下载不证明 LINE 保存能力。Android 按参考版本可能询问允许打开手机浏览器，不能承诺消除此系统询问。没有线上换票/下载检查，生产 DOWNLOAD_TICKET_SECRET 的当前可用性未在本轮验证；本次未新增或修改该凭据。未提交部署，不宣称生产已经修复。

## 服务器附件导出修复发布（2026-11-12）

负责人在上述本地交付后明确授权“提交并发布”。本节记录后续实际发布；上一节的“未发布”是当时的阶段状态，保留历史记录。

- 业务提交：`ae5913b0975676aeba1972eb27da0deb4e3b0e96`，已推送 `chore/ai-workflow-v2`，仅包含两处导出修复、相关测试及本 change 文档（23 文件）。没有纳入暂停的 Published 频道 workflow/scripts 配置、`.qoder/`、用户手册或临时产物。
- [CI 43174872663](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43174872663)：**success**；frontend、backend、contract、scripts、stack 五项全部通过。覆盖前端全工作区 lint/test/build、后端全量 pytest/Ruff、API 客户端一致性、脚本安全测试及隔离部署栈备份恢复演练。
- 启动部署前核对远端分支仍精确指向业务 SHA，`VPS_HOST=38.60.156.234`。使用已提交的原 Deploy workflow，不使用本地暂停配置、不直接 SSH 修改生产。[Deploy 43175807161](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43175807161)：**success**，07:35:37 UTC 完成。
- 实际部署日志：迁移前生成 `saiflow-20261112T073458Z.dump`（303968 bytes），成功上传 `gs://saiflow-db-backup/`；随后 `alembic upgrade head` 与服务重启成功。本次没有新迁移，也没有修改已部署迁移。三个站点 smoke-check 成功，外部 5432 端口关闭检查通过。
- 发布后独立只读核验（07:36:21 UTC）：`saiflow-app.aibaba.asia`、`saiflow-admin.aibaba.asia`、`saiflow-line2.aibaba.asia` 首页和健康接口均 HTTP 200，`status=ok`、`database=ok`，版本均为业务 SHA。
- LINE 当前主资源：`/assets/index-XWEsQkLC.js`，SHA-256 `c93d619db04a55bf5b65913db0b848ea82f633317084690ef1a686e46f73bbb3`；首页 `Cache-Control: no-cache`。实际公共资源包含 CSV/XLSX ticket 请求、两种附件下载 route、`final.exportExternal`、`rpt.csvDownload`、CSV 复制/预览和 Android fallback；不再包含 `final.shareExcel`、`final.shareUnavailable`、`final.shareFailed`、`final.exportPrepared`、`rpt.csvShare`、`rpt.csvShareFailed`。原 LIFF ID `2012285576-KbzpK5mY` 保持不变，未顺带切换 Published 频道。
- 核验脚本 `temp/xlsx-share/check-reference-production.py` 已先用模拟响应验证成功/错版本两条路径；实际结果 `reference-production-check.json` 全部 passed，原资源保留为 `reference-production-index.js`。核验只有 7 个公共 GET，没有登录、签发下载票据、生成业务导出记录或触发 OCR。

真实 iPhone/Android LINE 原生保存及生产 ticket 配置仍需负责人真机复测；本次部署和公共健康检查不能替代这两项验证。关闭并重新打开 LINE 小程序，再分别测试 CSV 与 Excel；Android 如询问打开手机浏览器需允许。此发布证据另以文档提交推送，不再次部署。

## 下载 HEAD 405 兼容性修复（2026-11-12，本地验证，未提交发布）

负责人要求“fix the 405 head request issue”。本轮仅修复 FR-ENTRY-015 / FR-REPORT-016 既有下载路由的 HEAD 兼容性，不修改 UI、文件名、票据签名/期限或 Published 频道配置，不提交、推送或部署。

- 四条路由显式注册 HEAD 并与 GET 共用处理函数：`/api/v1/exports/{export_id}/download`、`/api/v1/export-downloads/{token}`、`/api/v1/reports/{report_id}/csv`、`/api/v1/report-downloads/{token}`。保留原授权、租户/数据范围、会话、订阅、权限及发布版本检查。成功 HEAD 保留 GET 的 Content-Type、Content-Disposition、Content-Length、Cache-Control，实际 ASGI 文件响应体为空；HEAD 不消耗票据，随后 GET 和重复 HEAD 均成功。仍使用现有文件读取/CSV 生成路径，未另做元数据查询优化。
- TDD 红灯：两个新增集成用例在实现前均于首次 HEAD 返回 **405** 时失败，记录 `temp/xlsx-share/head-red.log`；实现后两用例 **2 passed in 17.70s**，记录 `head-green.log`。
- 完整 XLSX/CSV 集成模块：**19 passed in 96.59s**，记录 `temp/xlsx-share/head-integration.log`。使用专用 `127.0.0.1:25432 / saiflow_test_head_downloads`，`REQUIRE_INTEGRATION=1`、`DB_APP_USER=saiflow_v3_app`；未并发运行集成套件，未连接生产或 saiflow_dev，LINE/email/LLM/GCS 使用测试替身，未触发付费 OCR。
- HEAD 拒绝回归覆盖未登录、跨用户、无 export 权限、文件/票据过期、篡改票据、票据类型混用、会话结束、CSV 权限撤销/订阅到期及重新发布后的旧票据；保持对应 401/403/404/409 行为。成功用例捕获原始 ASGI body，避免仅依赖 HTTPX 自动隐藏 HEAD 响应体而误判。
- OpenAPI 单元模块：**3 passed in 2.83s**，包括下载 HEAD/GET 同处理函数、HEAD 不进入 schema、四个 GET operationId 不变、签发票据路由仍仅 POST。另将两个已提交 router 模块从 `git show HEAD:...` 在内存加载，比较完整应用 schema：与当前生成结果**完全相同**，过程未连接数据库；无需修改生成客户端。
- 五个修改的 Python 文件 Ruff check 与 format --check 全部通过；`git diff --check` 通过。独立静态审查未发现可操作问题，主会话核对实际差异；实现仅涉及两个 router，测试涉及两个集成模块及 OpenAPI 单元模块，证据追加于本文件。暂停的频道配置、前端、服务逻辑和迁移均未改动。

本轮只证明本地 HEAD 405 已修复及既有下载行为回归通过，不证明 iPhone LINE 的“允许后无反应”已解决。没有本轮生产验证、提交、推送或部署，真实 LINE 下载仍需发布后真机复测。
