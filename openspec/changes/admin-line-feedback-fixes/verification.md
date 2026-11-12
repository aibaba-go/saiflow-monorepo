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
