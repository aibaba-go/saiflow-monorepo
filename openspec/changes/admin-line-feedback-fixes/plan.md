# Plan：admin-line-feedback-fixes

负责人 2026-11-11 反馈 4 项问题；沿用"按推荐的方式做"。每项对应 delta 中的 requirement，或对应既有 requirement 的纯样式、缺陷修正。

| # | 问题 | 方案 | 追溯 | 文件 |
|---|---|---|---|---|
| 1 | LINE 退出确认框被遮罩盖住 | Radix 将遮罩与内容分别挂到页面末尾，遮罩后挂、层级相同时盖住内容。确认框内容 `z-[51]`（遮罩 `z-50`），底部面板内容 `z-[41]`（遮罩 `z-40`）；测试断言内容层级高于遮罩 | FR-SYS-043、FR-SYS-137 | `components/ui/dialogs.tsx`、`sheet.tsx`、`ui.test.tsx` |
| 2 | 套餐页单调 | 按 web-pc 套餐卡（FR-SYS-102）的结构：按档位着色的顶部色条与徽标、空间类型、当前档位描边与"当前套餐"标签、价格区（主价格 + 次价格；无价时"联系我们"）与特性列表分区、操作在卡片底部；无可用操作时显示原因（"正在使用此套餐"/"当前空间不可用"，与 web-pc 同文案），游客与无 plan_apply 成员不显示原因；按钮出现条件与申请规则不变 | FR-SYS-053（仅样式与说明文案，FR-SYS-138） | `features/billing/PlansPage.tsx`、`styles/app.css`、`billing.test.tsx`、三语资源 |
| 3 | CSV 仍无法导出，参考可用快照（2026-11-12 最新修订） | 带会话 GET CSV、保留原字节和预览/复制文本，再 POST 当前现成的 `/reports/{id}/csv/ticket`（同 card_id、period、report_version），取消检查后交给共享真实 URL 下载器；iOS anchor、Android LIFF external。面板保留 50 行预览及复制，主操作改为重新下载（重走校验、申请 fresh ticket）。不调用 share/canShare。复制仍先面板内 execCommand 再 clipboard，TextDecoder 去 BOM。期间/版本/权限/租户/页面变化取消请求并清理面板 | FR-SYS-144、FR-REPORT-016 | `features/reports/api.ts`、`ReportDetailPage.tsx`、`reports.test.tsx`、三语资源 |
| 4 | 用户页默认展示全部用户 | 后端 `q` 可为空，空白时不加条件；非空、非数字且少于 2 个字符仍 400。前端打开即查询第 1 页，显示页码，上一页/下一页；空输入查询回到全部 | FR-SYS-080、FR-SYS-070 | `admin_query.py`、`admin_query_service.py`、集成测试；`UsersPage.tsx`、`people.test.tsx`、三语资源 |
| 5 | 折线图孤立点不显示 | 折线系列 `showAllSymbol: true` | FR-REPORT-013、FR-REPORT-018 | `packages/ui/src/components/ChartRenderer/option.ts` 与测试 |
| 6 | Excel 仍无法导出，参考可用快照（2026-11-12 最新修订） | 首次点击 POST 创建/复用 XLSX，再 POST `/exports/{id}/ticket`，取消检查后交给共享真实 URL 下载器；LINE 不取 blob、不创建 File、不使用分享。非 LINE 原 GET blob 下载不变。任务/租户/语言/导出资格/页面变化通过 AbortController 取消迟到请求；状态只描述已发起下载，Android 显示允许 LINE 打开手机浏览器的说明 | FR-SYS-107、FR-SYS-116、FR-ENTRY-015 | `features/scan/download.ts`、`FinalResultPage.tsx`、`final.test.tsx`、三语资源 |

共享下载器：只接受可信 API origin 下对应 `/api/v1/export-downloads/` 或 `/api/v1/report-downloads/` 的 token URL，拒绝非预期协议/来源、凭据、查询、片段及路径穿越。SDK `getOS` 优先，缺失/异常时用 Android+LINE UA；iOS 用真实 HTTP 附件 anchor，Android 用 `liff.openWindow({external:true})`，SDK 抛错时附加 LINE `openExternalBrowser=1` 参数。当前后端需要租户 header，所以 iOS 同样使用能恢复会话/租户的现成凭证，而非复制旧 Flask 的 cookie-only 链接。不新增接口、迁移或凭据。审查补齐既有复用缺陷：Excel 有效文件只按当前创建者复用，保持票据仅能由创建者申请的权限约束，避免另一位有导出权限的同事被返回不可签票的文件；对应后端集成测试覆盖双方分别创建、复用、无 cookie 下载及禁止交叉签票。同版本详情 `can_export=false` 时立即取消 CSV、关闭预览并清理复制数据，对应前端已准备和待票据两种回归测试。

验证：保留此前用户查询/退出/套餐/图表的记录。本次专项及 line-mini 全量 vitest、tsc、eslint、build、OpenSpec strict validate；本地浏览器全 API 模拟验证服务器附件下载字节、Android 外部链接、重新下载、复制与移动布局，不访问真实 API/数据库/OCR。结果追加到 `verification.md`，不覆盖此前发布证据。真实 iPhone/Android LINE 的原生下载保存仍需设备复测，不以模拟成功宣称已保存；没有本次新提交或发布授权时不提交部署。
