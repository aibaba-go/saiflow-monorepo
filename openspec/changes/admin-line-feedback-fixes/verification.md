# admin-line-feedback-fixes — 验证记录

## 授权与边界

负责人 2026-11-11 反馈 LINE 三项（退出遮罩、套餐页、CSV 导出提示）与管理后台用户页一项，另含折线图孤立点修正；指示"按推荐的方式直接全部开发完成并测试完成"。该指示**不含**提交、推送或部署授权；本地交付阶段未提交、未发布；随后的发布授权与结果见文末"正式发布"节。

验证只在本机隔离环境进行：API `127.0.0.1:8010`（`saiflow_dev`）、line-mini `:5173`、web-admin `:5175`；集成测试只连 `127.0.0.1:25432/saiflow_test_full1`。未触碰生产 `38.60.156.234` 或 `81.68.72.120`，未调用付费 OCR。后端改动后重启了本机 API（此前进程运行旧代码，管理端用户页首屏曾返回"输入无效"）。

## 逐项证据（2026-11-12）

| # | 项目 | 追溯 | 自动化测试 | 浏览器检查 |
|---|---|---|---|---|
| 1 | LINE 退出确认框不再被遮罩盖住 | FR-SYS-043、FR-SYS-137 | `components/ui/ui.test.tsx` 断言确认框内容 `z-[51]` 高于遮罩 `z-50`、底部面板内容 `z-[41]` 高于遮罩 `z-40` | 390px：退出后无残留遮罩（0 个打开的 overlay），页面回到 `#/` 且可操作 |
| 2 | LINE 套餐页美化 | FR-SYS-053（样式与说明文案） | `billing.test.tsx` 9/9；053-05 另断言 Kinder 显示"当前空间不可用"且无按钮、Starter 显示"续费" | en 390、zh 390、zh 360、th 320：四张档位卡、每张有色条、当前档位描边、无横向溢出、卡内无截断 |
| 3 | LINE 内 CSV 走系统分享而非外部浏览器 | FR-SYS-144、FR-REPORT-016 | `reports.test.tsx` 42/42；144-01 断言分享的文件字节与 API 返回完全一致；144-02 不支持文件分享时走下载凭证；144-03 取消分享不提示、面板保留且"在浏览器中下载"可用；144-04 新发布版本使已准备文件失效 | 本机 devLiff 恒为非 LINE 客户端，无法打开真实分享面板（见"限制"） |
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

- 真实 LINE 客户端（iPhone/Android）中的系统分享面板未验证：本机 devLiff 的 `isInClient` 恒为 false。上线后需在真机确认。
- 部分 Android LINE WebView 不支持文件分享（`navigator.canShare({ files })` 为 false），此时仍走下载凭证，可能继续出现"打开外部应用"提示。
- Excel 导出未改动。

## 正式发布（2026-11-12，已完成）

负责人随后明确回复 **"提交并部署"**。本变更与 admin-impersonate-user 合并提交并发布：生产版本 **`78e144425f069bc23679359fd3c429903de35067`**，[CI 43124397561](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43124397561) 与 [Deploy 43125365719](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43125365719) 均 success；迁移前备份、迁移与健康检查细节见 `openspec/changes/admin-impersonate-user/verification.md` 的"正式发布"节。只读检查：LINE 入口 `index-CbAB76wT.js` 含确认框层级 `z-[51]`、`canShare` 文件分享与折线图 `showAllSymbol`；三站健康版本一致。真实 LINE 客户端中的退出、套餐页与 CSV 分享仍待真机确认。
