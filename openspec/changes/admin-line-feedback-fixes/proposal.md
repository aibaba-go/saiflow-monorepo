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
- `line-mini`：新增 FR-SYS-144。按负责人 2026-11-12 最新要求，对照 `temp/saiflow-monorepo-20261104` 的可用实现恢复真实服务器附件下载，而非文件分享。LINE 内点击 CSV 后带会话取得原数据，申请与卡片、期间、范围、发布版本一致的短时凭证；iOS LINE 使用附件链接，Android LINE 交给手机浏览器。保留前 50 行预览、完整复制和重新下载操作；重试申请新凭证，上下文失效后丢弃文件及迟到请求。LINE 外下载不变。
  - 参考快照只有最终结果 Excel 导出，没有当前报表 CSV 页面；CSV 是对同一机制的适配，不是复制不存在的旧 CSV 页面。此前分享-only 修订与发布保留在 verification 历史中，由本次最新修订取代。
- `line-mini`：修改 FR-SYS-107 与 FR-SYS-116。LINE 内首次点击导出 Excel 即创建或复用有效 XLSX、申请短时凭证并发起服务器附件下载；iOS 使用链接、Android 打开手机浏览器并显示允许打开的说明，不再依赖 `navigator.share` / `canShare`。失败可重试，任务、租户、语言、导出资格或页面变化时取消迟到下载。XLSX 内容、权限及服务端接口不变，LINE 外原下载方式不变。保留额外字段只读行为及 AC-04、AC-05。
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

- 后端：`services/api/app/routers/admin_query.py`、`services/api/app/services/admin_query_service.py`；`export_service.py` 有效 XLSX 复用按当前创建者限定，保留票据权限边界并避免同事导出失败；集成测试。
- web-admin：`pages/UsersPage.tsx`、`people.test.tsx`、三语资源。
- line-mini：共享 `services/download.ts`、LIFF OS 适配及测试；`features/scan/download.ts`、`features/scan/FinalResultPage.tsx`、`final.test.tsx`；`components/ui/dialogs.tsx`、`components/ui/sheet.tsx`、`features/reports/api.ts`、`features/reports/ReportDetailPage.tsx`、`features/billing/PlansPage.tsx` 与样式、三语资源及测试。
- packages/ui：`components/ChartRenderer/option.ts` 及测试。

## Non-goals

- 不改变用户查询的字段、排序与每页条数，不增加总数统计或跳页。
- 不改变 CSV 内容、权限、下载凭证与服务端接口。
- 不改变 Excel 的内容、版式、权限与服务端接口（原"不改变 Excel 导出"一条已由 2026-11-12 的 FR-SYS-107 修订取代）。
- 不改变套餐规则、价格与申请流程。
