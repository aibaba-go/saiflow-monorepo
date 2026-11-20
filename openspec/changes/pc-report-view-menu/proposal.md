# Proposal：web-pc 独立的"报表查看"菜单

## Why

负责人于 2026-11-12 要求"用户增加一个报表查看菜单，可以查看报表"，并确认：

- 拆出独立的"报表查看"菜单；
- 仅 web-pc 企业版（LINE 小程序已有"报表"底栏，不变）；
- 在邮箱登录（`customer-email-login`）完成后实施。

目前 web-pc 只有一个"报表"菜单（FR-SYS-141），设计者与查看者共用同一个列表：查看者看到的是带状态、版本、更新时间的管理表格，要在表格里找"打开"按钮。只需看报表的成员缺少直接的入口。

## What Changes

变更分级为 S：只改 web-pc 前端的菜单、路由与一个列表页；不改后端、接口与权限点。

- `web-pc`：**新增 FR-SYS-159 报表查看菜单、FR-SYS-160 报表查看列表与展示页**。
  - 菜单"报表查看"位于"工作区"分组末尾，对有效 Starter 及以上套餐组织中持有 `report_view` 的成员和 owner 显示（与 FR-SYS-141 的展示条件相同）。
  - `/report-view` 以卡片列出当前组织已发布的报表（发布名称、版本、发布时间），点击打开 `/report-view/{id}`，展示与 FR-SYS-141 相同的只读页面；返回时回到"报表查看"列表。
  - 原"报表"菜单改名"报表管理"，只对持有 `report_manage` 的成员和 owner 显示，用于设计、发布与管理；只持有 `report_view` 的成员打开 `/reports` 时转到 `/report-view`。
  - 切换租户、套餐或权限失效时与 FR-SYS-141 相同：不残留旧租户的报表，路由由 `ReportGate` 与后端共同拒绝越权。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-pc`：新增 FR-SYS-159、FR-SYS-160。

## 归档顺序

FR-SYS-159、FR-SYS-160 依赖 `template-report-management` 中的 FR-SYS-141 与 reporting 能力。本变更 SHALL 在 `template-report-management` 之后归档。

## Impact

- web-pc：`layout/AppLayout.tsx`（菜单项、可见性、图标）、`App.tsx`（`/report-view`、`/report-view/:id`）、`pages/ReportBrowserPage.tsx`（新增）、`pages/ReportsPage.tsx`（只读成员转向）、`pages/ReportViewPage.tsx`（返回列表的路径随入口）、样式、三语资源与测试。
- 后端、契约、web-admin、line-mini：无变化。

## Non-goals

- 不新增权限点，不改变谁能看哪张报表、看到的数据范围（reporting 规则不变）。
- 不在报表查看中提供设计、发布或删除。
- 不改 LINE 小程序的报表底栏。
