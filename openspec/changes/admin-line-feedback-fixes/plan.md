# Plan：admin-line-feedback-fixes

负责人 2026-11-11 反馈 4 项问题；沿用"按推荐的方式做"。每项对应 delta 中的 requirement，或对应既有 requirement 的纯样式、缺陷修正。

| # | 问题 | 方案 | 追溯 | 文件 |
|---|---|---|---|---|
| 1 | LINE 退出确认框被遮罩盖住 | Radix 将遮罩与内容分别挂到页面末尾，遮罩后挂、层级相同时盖住内容。确认框内容 `z-[51]`（遮罩 `z-50`），底部面板内容 `z-[41]`（遮罩 `z-40`）；测试断言内容层级高于遮罩 | FR-SYS-043、FR-SYS-137 | `components/ui/dialogs.tsx`、`sheet.tsx`、`ui.test.tsx` |
| 2 | 套餐页单调 | 按 web-pc 套餐卡（FR-SYS-102）的结构：按档位着色的顶部色条与徽标、空间类型、当前档位描边与"当前套餐"标签、价格区（主价格 + 次价格；无价时"联系我们"）与特性列表分区、操作在卡片底部；无可用操作时显示原因（"正在使用此套餐"/"当前空间不可用"，与 web-pc 同文案），游客与无 plan_apply 成员不显示原因；按钮出现条件与申请规则不变 | FR-SYS-053（仅样式与说明文案，FR-SYS-138） | `features/billing/PlansPage.tsx`、`styles/app.css`、`billing.test.tsx`、三语资源 |
| 3 | 导出 CSV 触发"打开外部应用" | LINE 内一律带会话取得 CSV blob，显示 BottomSheet"CSV 已准备好"（含前 50 行预览）；支持 `navigator.canShare({ files })` 时显示"保存或分享"，在点击处理中同步调用 `navigator.share({ files })`，`AbortError` 不提示；"复制 CSV"在点击处理中同步写剪贴板（先 `execCommand('copy')`，文本框挂在面板内以避开焦点陷阱，再 `navigator.clipboard.writeText`），文本经 `TextDecoder` 去 BOM；"在浏览器中下载"走原下载凭证，并提示需选"允许"。版本变化、`cancelDownloads`、离开页面时清空已准备文件。（2026-11-12 修订：去掉"不支持分享即走下载凭证"的分支，iOS LINE 实测会弹"打开外部应用"） | FR-SYS-144、FR-REPORT-016 | `features/reports/api.ts`、`ReportDetailPage.tsx`、`reports.module.css`、`reports.test.tsx`、三语资源 |
| 4 | 用户页默认展示全部用户 | 后端 `q` 可为空，空白时不加条件；非空、非数字且少于 2 个字符仍 400。前端打开即查询第 1 页，显示页码，上一页/下一页；空输入查询回到全部 | FR-SYS-080、FR-SYS-070 | `admin_query.py`、`admin_query_service.py`、集成测试；`UsersPage.tsx`、`people.test.tsx`、三语资源 |
| 5 | 折线图孤立点不显示 | 折线系列 `showAllSymbol: true` | FR-REPORT-013、FR-REPORT-018 | `packages/ui/src/components/ChartRenderer/option.ts` 与测试 |
| 6 | Excel 导出触发"打开外部应用"（2026-11-12 负责人先行手改） | 保留负责人的做法：LINE 内带会话取得 XLSX（`arrayBuffer` 后建 `File`），页面显示"Excel 已就绪"，"分享 Excel"在点击时调用 `navigator.share({ files })`。补充：仅当 `navigator.canShare({ files })` 为真才显示分享；始终有"在浏览器中下载"（原 60 秒下载凭证，仅点击时使用）与"需选择允许"的说明；`AbortError` 不提示，其他分享错误提示改用浏览器且保留文件（原实现会抛出未处理的异常）；切换租户后不再提供旧文件 | FR-SYS-107、FR-SYS-116、FR-ENTRY-015 | `features/scan/download.ts`、`FinalResultPage.tsx` 与样式、`final.test.tsx`、三语资源 |

验证：后端用户查询集成测试（测试库）；line-mini、web-admin、ui 的 vitest；`pnpm -r lint`、tsc 与 build；浏览器检查 LINE 退出、套餐页、CSV 面板与 admin 用户页。结果写入 `verification.md`。真实 LINE（iPhone/Android）中的系统分享面板无法在本机验证，如实记录。
