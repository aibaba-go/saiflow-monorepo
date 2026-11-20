# Plan：pc-report-view-menu

负责人 2026-11-12 要求为 web-pc 用户增加独立的"报表查看"菜单。规则见 proposal，规格见 delta（FR-SYS-159、FR-SYS-160）。

## 方案选择

- **只改前端**：沿用 `useReports`（`GET /api/v1/reports`，查看者只得到已发布的报表）与 `ReportGate`；列表页再按 `published_version` 过滤，保证草稿不出现。
- **菜单**：`MENU` 增加 `reportView`（`/report-view`，图标 `chart`），归入"工作区"分组；`reports` 改为仅 `reports.manage` 时显示，文案改为"报表管理"。
- **展示页复用**：`/report-view/:id` 渲染 `ReportViewPage`，"返回列表"按当前路径前缀决定回 `/report-view` 或 `/reports`；`selected()` 按前缀匹配，菜单自然选中"报表查看"。
- **只读成员转向**：`ReportsPage` 内 `access.view && !access.manage` 时 `<Navigate to="/report-view" replace />`。

## 任务

| # | 任务 | 需求 | 文件 |
|---|------|------|------|
| 1 | 菜单项、可见性与"报表管理"文案 | FR-SYS-159 | `layout/AppLayout.tsx`、`i18n/reports.*.ts` |
| 2 | 列表页（卡片、空状态）与路由 | FR-SYS-160 | `pages/ReportBrowserPage.tsx`（新增）、`App.tsx`、`styles/app.css` |
| 3 | 展示页返回路径随入口；只读成员转向 | FR-SYS-159、FR-SYS-160 | `pages/ReportViewPage.tsx`、`pages/ReportsPage.tsx` |
| 4 | 测试：AC-159-01..03、AC-160-01..02 与原 FR-SYS-141 用例更新 | FR-SYS-159、FR-SYS-141 | `pages/reportView.test.tsx`（新增）、`pages/reports.test.tsx` |
| 5 | 全量 vitest、eslint、tsc、build 与浏览器截图 | NFR | — |
