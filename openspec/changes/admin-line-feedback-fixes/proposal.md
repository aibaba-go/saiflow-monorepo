# Proposal：admin 用户列表与 LINE 反馈修正

## Why

负责人于 2026-11-11 提出以下问题（附截图）：

1. LINE 小程序点击"退出"后出现遮罩，之后任何操作都无法进行；
2. LINE 小程序"套餐"页太单调，需要美化；
3. LINE 小程序导出报表 CSV 时弹出"此网站正尝试打开外部应用"的提示，无法顺利导出；
4. 管理后台"用户"页应默认展示所有用户，分页显示。

另外，负责人在同一会话中发现折线图在一年的日期轴上不显示孤立的数据点（柱状图正确）。

经核对：

- 第 1 项是层叠缺陷：确认框的遮罩与内容分别挂到页面末尾，遮罩后挂、层级相同，于是盖住了确认框。所有 LINE 确认框与底部面板都有同样隐患。
- 第 3 项来自 FR-REPORT-016 的设计：LINE 内导出通过 60 秒下载凭证在外部浏览器中打开，LINE 因此询问是否允许打开外部应用。
- 折线图问题来自 ECharts 在类目轴较长时自动隐藏数据点（`showAllSymbol: 'auto'`），数据本身正确。

## What Changes

- 变更分级：M。修改既有 P0 行为，并新增一条 LINE 内保存 CSV 的需求；无新实体、无迁移。`GET /api/v1/admin/users` 的 `q` 参数改为可为空，响应结构不变。
- `identity`：FR-SYS-080 查询词为空时返回全部客户用户（同样的排序、分页与字段，不含游客）；非空、非数字且少于 2 个字符仍返回 HTTP 400。新增 AC-04。
- `web-admin`：FR-SYS-070 打开"用户"页即分页列出全部用户；查询后只显示匹配结果；清空后回到全部用户。新增 AC-03、AC-04。
- `line-mini`：新增 FR-SYS-144。LINE 内点击"CSV"一律用当前会话取得 CSV，显示带预览的"CSV 已准备好"面板，始终提供"保存或分享"与"复制 CSV"；第二次点击时直接调用 `navigator.share({ files })`，不根据 `canShare` 隐藏分享按钮。分享不支持或失败时保留文件并提示改用复制，取消不报错。彻底移除 LINE CSV 导出的下载凭证请求、外部浏览器跳转及"在浏览器中下载"操作。
  - 2026-11-12 再修订：负责人再次实测遇到"打开外部应用"，明确要求 CSV 与 Excel 都沿用其手改的"先准备文件、再点击分享"方式；不保留浏览器下载退路。本机不能证明真实 iOS/Android LINE 是否支持系统文件分享，失败时只在当前页面提示。
- `line-mini`：修改 FR-SYS-107 与 FR-SYS-116（2026-11-12 负责人提出并先行手改）。LINE 内"导出 Excel"同样用当前会话取得 XLSX，在页面显示"Excel 已就绪"并始终提供"分享 Excel"；第二次点击时直接调用 `navigator.share({ files })`，不根据 `canShare` 隐藏分享按钮。分享 API 缺失或失败时明确提示并保留文件供重试，取消不报错。彻底移除 LINE Excel 导出的下载凭证请求、外部浏览器跳转及浏览器下载操作。XLSX 内容、权限及服务端接口不变，LINE 外原下载方式不变。新增 AC-06、AC-07。
- 不改变行为的修正，不另写 delta：
  - 第 1 项：确认框与底部面板的内容层级高于各自的遮罩，对应 FR-SYS-043 与 FR-SYS-137；
  - 第 2 项：套餐页改为等高卡片、突出当前档位、操作区对齐，按 FR-SYS-053 与 FR-SYS-138"只改样子"处理；
  - 折线图：始终显示数据点，对应 FR-REPORT-013、FR-REPORT-018。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `identity`：FR-SYS-080。
- `web-admin`：FR-SYS-070。
- `line-mini`：新增 FR-SYS-144；修改 FR-SYS-107、FR-SYS-116。

## 归档顺序

- FR-SYS-144 引用 `reporting` 的 FR-REPORT-016，它由未归档的 `template-report-management` 引入。本变更 SHALL 在 `template-report-management` 之后归档。
- FR-SYS-107 也由未归档的 `verify-template-custom-fields` 修改（AC-04、AC-05）；本变更的 FR-SYS-107 已包含其内容，SHALL 在其之后归档。
- FR-SYS-080、FR-SYS-070 与 FR-SYS-116 目前没有其他未归档变更修改。

## Impact

- 后端：`services/api/app/routers/admin_query.py`、`services/api/app/services/admin_query_service.py`；集成测试。
- web-admin：`pages/UsersPage.tsx`、`people.test.tsx`、三语资源。
- line-mini：`features/scan/download.ts`、`features/scan/api.ts`（移除未使用的旧下载凭证封装）、`features/scan/FinalResultPage.tsx` 与样式、`final.test.tsx`；`components/ui/dialogs.tsx`、`components/ui/sheet.tsx`、`features/reports/api.ts`、`features/reports/ReportDetailPage.tsx`、`features/billing/PlansPage.tsx` 与样式、三语资源及测试。
- packages/ui：`components/ChartRenderer/option.ts` 及测试。

## Non-goals

- 不改变用户查询的字段、排序与每页条数，不增加总数统计或跳页。
- 不改变 CSV 内容、权限、下载凭证与服务端接口。
- 不改变 Excel 的内容、版式、权限与服务端接口（原"不改变 Excel 导出"一条已由 2026-11-12 的 FR-SYS-107 修订取代）。
- 不改变套餐规则、价格与申请流程。
