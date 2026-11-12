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
- `line-mini`：新增 FR-SYS-144。LINE 内点击"CSV"一律用当前会话取得 CSV，显示带预览的"CSV 已准备好"面板，不打开外部浏览器；支持分享文件时可"保存或分享"，始终可"复制 CSV"；只有用户点击"在浏览器中下载"才使用 FR-REPORT-016 的下载凭证。
  - 2026-11-12 修订：首版在不支持分享文件时直接走下载凭证。负责人在 iOS LINE 实测仍弹出"打开外部应用"（iOS LINE 不支持分享文件），故改为上述行为。
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
- `line-mini`：新增 FR-SYS-144。

## 归档顺序

- FR-SYS-144 引用 `reporting` 的 FR-REPORT-016，它由未归档的 `template-report-management` 引入。本变更 SHALL 在 `template-report-management` 之后归档。
- FR-SYS-080 与 FR-SYS-070 目前没有其他未归档变更修改。

## Impact

- 后端：`services/api/app/routers/admin_query.py`、`services/api/app/services/admin_query_service.py`；集成测试。
- web-admin：`pages/UsersPage.tsx`、`people.test.tsx`、三语资源。
- line-mini：`components/ui/dialogs.tsx`、`components/ui/sheet.tsx`、`features/reports/api.ts`、`features/reports/ReportDetailPage.tsx`、`features/billing/PlansPage.tsx` 与样式、三语资源及测试。
- packages/ui：`components/ChartRenderer/option.ts` 及测试。

## Non-goals

- 不改变用户查询的字段、排序与每页条数，不增加总数统计或跳页。
- 不改变 CSV 内容、权限、下载凭证与服务端接口。
- 不改变 Excel 导出（FR-SYS-107）。它在 LINE 内同样通过外部浏览器下载，需要时另立变更。
- 不改变套餐规则、价格与申请流程。
