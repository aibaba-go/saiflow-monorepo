# Proposal

## Why

用户确认保留报表的组织、有效 Starter 及以上套餐与 `report_view` 权限限制，并要求 PC 报表查看入口及展示更清晰、美观。现有独立菜单与页面已经实现，本次在 [PRD §4.7](../../../../docs/10-product/PRD-SaiFlow.md)、[界面设计规范 STD-008](../../../../docs/00-standards/UI-Design-System.md) 及 `pc-report-view-menu` 的 FR-SYS-159/160 基础上改善已有能力，不再建立重复菜单。

## What Changes

- 美化工作区已有“报表查看”入口和已发布报表列表：品牌图标、清晰的名称、发布版本、曼谷时间及打开提示；整卡可通过鼠标或键盘进入。
- 改善只读仪表盘的标题、实际统计范围、日期工具栏、卡片层次及加载/无数据/错误/旧数据状态。保留六种图型、发布网格、统计精度、诊断和授权 CSV，不制造额外指标。
- 查看路径即使由 owner 打开也不提供设计或发布入口；管理能力继续在“报表管理”路径提供。无权限、订阅失效及租户切换继续清理不可见数据。
- 参考 [Tremor 模板](https://blocks.tremor.so/templates) 的留白与信息层次、[Metabase 仪表盘](https://www.metabase.com/dashboards) 的过滤及图表组织，沿用 SaiFlow 浅色品牌令牌和现有字体；不是复制模板或引入其依赖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-pc`：补充报表查看的信息层次、可访问性与请求状态展示要求。菜单与权限延续 FR-SYS-159/160，统计与导出延续 `template-report-management` 的 FR-REPORT-001/002/003/010/015/016/018。

## Impact

涉及 `apps/web-pc/src/pages/ReportBrowserPage.tsx`、`ReportViewPage.tsx`、报表测试、PC 样式与三语资源；按需要调整 `AppLayout.tsx` 的现有入口呈现。复用 `packages/ui` 的 `ChartRenderer`、`ReportGrid`、`ReportCardInfo` 和 `ReportCardDetails`，优先用 PC 作用域样式，不改变共享组件的跨端行为。

不新增接口、实体、数据库迁移或前端依赖。具体实施、测试和发布门槛见本 change 的 `plan.md`；本次提案阶段不修改代码或生产配置。

## 非目标（Non-goals）

- 不开放个人、游客、Kinder 或套餐过期组织的报表；不扩大 `report_view`、`report_manage`、`data_browse` 或 `export` 权限。
- 不新增默认业务 KPI、模拟趋势、公开分享、钻取、自动刷新、设计器功能或深色主题。
- 不重排或修改已发布配置、数据口径、客户标题、模板版本、金额精度或 CSV 内容。
- 不修改 LINE 报表样式、后台报表管理、既有部署脚本或其他变更。术语遵循 [Glossary](../../../../docs/10-product/Glossary.md)。
