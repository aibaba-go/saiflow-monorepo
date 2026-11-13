# pc-report-view-polish — 实施计划

## 1. 输入与范围

输入：[proposal](proposal.md)、[web-pc delta spec](specs/web-pc/spec.md)。本 change 属于已有能力的界面/少量行为完善；实现遵循 STD-006/STD-008，按 TDD 推进。规格与计划已获确认，按用户随后授予的实施至部署权限执行；本文件未勾选项仍表示待完成。

沿用 [FR-SYS-159/160](../../pc-report-view-menu/specs/web-pc/spec.md)、[FR-SYS-141](../../template-report-management/specs/web-pc/spec.md) 和 [FR-REPORT 系列](../../template-report-management/specs/reporting/spec.md)，新增 FR-SYS-161/163/164；不重复定义报表权限或统计引擎。

## 2. 已核实的实现与决策

- `apps/web-pc/src/layout/AppLayout.tsx` 已有 `/report-view` 菜单，图标为 chart；`src/reports/common.tsx` 按组织、有效 Starter/Intermediate/Advance、report_view/report_manage 分别判定。保留判断与路由，不建立第二个菜单，不改变 API 权限。
- `ReportBrowserPage.tsx` 已按 published_version 过滤并显示名称/版本/发布时间；目前加载用 Spin，错误可能同时落入 Empty。优先改善信息层次和互斥状态，不增加查询接口。
- `ReportViewPage.tsx` 已有日期覆盖、手动刷新、范围/时间、诊断、绑定版本和期间的 CSV、迟到响应保护及权限清理。修改只读入口时，要同时检查 Viewer 顶部和 ViewLoader 未发布状态的 `detail.can_manage` 分支：`/report-view` 不显示设计，`/reports` 保留已有管理入口。
- `ReportGrid mode="view"` 保留已发布位置、尺寸、row_height；`ChartRenderer` 提供精确值表格、单位、重试与无数据/错误状态。通过 PC 包装类改善外观，不更改网格数据，不覆盖配置的 palette、精度和显示开关。
- 视觉方向：浅色低噪声仪表盘，标题/版本为一级，实际期间/范围/时间为二级；筛选工具栏可换行；图表卡片统一边界、留白和状态文字。参考 [Tremor templates](https://blocks.tremor.so/templates)、[Metabase dashboards](https://www.metabase.com/dashboards)，仅参考组织方式，不下载或新增模板依赖。品牌、字体、间距、泰文行高遵循 [STD-008](../../../../docs/00-standards/UI-Design-System.md)，颜色使用现有 CSS 变量。
- 不需要数据库迁移、公开 API 或生成客户端修改。保留 e2ce30e 的侧栏图标居中修复。

## 3. 执行步骤与验收映射

### P1 — 先补行为回归

- [x] 扩展 `apps/web-pc/src/pages/reports.test.tsx`：已发布卡片名称/版本/时间、长名称、整卡导航、菜单选中与返回；覆盖三语和独立 manage/view 权限。对应 AC-FR-SYS-161-01～03、既有 AC-FR-SYS-159-01～03/160-01～02。
- [x] 增加列表首次加载/空/失败互斥、详情获取错误后的重试、成功后普通刷新失败、请求中重复刷新、租户切换和迟到响应、401/403/402/404及发布版本冲突清理用例。对应 AC-FR-SYS-164-01～03；断言无权时没有统计请求，旧结果不会恢复。
- [x] 在现有报表测试中断言 owner 的 `/report-view/:id` 已发布/未发布页面均没有设计控件，管理路径保留其原能力；日期应用/重置、不适用图和 CSV 版本/期间固定。对应 AC-FR-SYS-163-02～03。

先观察新增用例在当前实现上的失败，再只修复本 change 覆盖的缺口；不通过降低断言或扩大授权使测试通过。

### P2 — 美化已发布报表列表

- [x] 修改 `ReportBrowserPage.tsx`：标题区说明/已发布数量、清晰卡片结构、发布版本与曼谷时间、键盘 focus、长名称；加载/空/错误独立渲染，错误有 retry，使用真实 published 列表。对应 FR-SYS-161、AC-FR-SYS-164-01。
- [x] 在 `apps/web-pc/src/styles/app.css` 的 PC 报表作用域调整现有 `.pc-report-cards`、`.pc-report-card` 等样式；必要时为页面添加独立包装类，避免影响设计器、其他卡片及 LINE。对应 AC-FR-SYS-161-02、163-04。
- [x] 将新增界面文字加入 `src/i18n/reports.en.ts`、`reports.th.ts`、`reports.zh.ts`，复用现有 nav.reportView；扩展 i18n 完整性测试。对应 FR-SYS-093、AC-FR-SYS-161-02/163-04。

### P3 — 美化只读仪表盘与反馈

- [x] 修改 `ReportViewPage.tsx` 的页面标题/事实信息/日期工具栏及只读路径管理按钮分支。保留 seq/active、下载 AbortController、period/version 固定和 onStale 重新验证。对应 FR-SYS-163、164。
- [x] 使用 PC 作用域 CSS 改善图表框、诊断入口、加载/空/错误/旧数据呈现；旧数据必须有文字提示，不能只降低透明度。不修改发布 cards/layout/style，不启用设计工具，不额外添加摘要 KPI。对应 AC-FR-SYS-163-01、164-02～03。
- [x] 复用 `ReportGrid`/`ChartRenderer`，为网格代码首次加载提供可见 fallback。仅当现有 DOM 不能满足可访问性时做最小扩展，并回归 `packages/ui` 的图表/网格测试和 LINE，禁止顺便重构共享库。对应 AC-FR-SYS-163-01/04。

### P4 — 完整验证与视觉检查

- [x] 运行定向前端测试 `pnpm --filter @saiflow/web-pc test -- src/pages/reports.test.tsx src/i18n/i18n.test.ts`，再运行根目录 `pnpm -r lint`、`pnpm -r test`、`pnpm -r build`。构建包含 TypeScript 检查；任何失败先诊断，不能仅凭单测重跑通过宣称全量通过。
- [x] 在 mock 或隔离 API 上打开列表及六图型详情，逐一检查 1024px/1440px、三语、长泰文、键盘焦点、工具栏换行、实际期间、空/加载/错误/旧数据状态、精确值及 CSV。截图/日志只存 `temp/pc-report-view-polish/`；截图不可用时明确记录 DOM 检查与未完成的视觉核验，不声称截图通过。对应全部新增 AC。
- [x] 回归共享图表和 LINE 展示，核对 PC 发布布局不变、负值/混合单位/无数据提示及历史 CSV 绑定行为；后端全量隔离测试与另一个 change 的最终门槛共同执行。
- [x] 完成只读差异审查、`openspec validate pc-report-view-polish --strict`，在本 change 的 `verification.md` 记录 AC → 测试名 → 实际结果及未覆盖项。不存在结果前不写成功证据。

### P5 — 收尾、提交与发布

- [x] 经验证和审查后，按仓库流程归档/同步 delta，不修改其他未归档 change。按 [AI-WORKFLOW §5–6](../../../../AI-WORKFLOW.md) 不创建 design 或重复任务内容；CLI 在实施入口强制要求 tasks 时，仅保留指向本 plan 的最小链接文件。默认 CLI planningComplete=false 属预期。
- [ ] 两项均完成后分开提交本 change 的规格、计划、代码和验证证据，具体文件 staging；不加入既有脏 `.github/workflows/deploy.yml`、`scripts/deploy/remote-deploy.sh`、`scripts/tests/remote-deploy.test.sh`、`scripts/tests/workflow-config.test.sh`、`scripts/deploy/line-mini-config.py`、`scripts/tests/line-mini-config.test.py`、`.qoder/`、用户手册或 `temp/`。不 amend、不改 git config、不跳 hooks。
- [ ] 仅在当前变更实施/提交/发布授权有效时推送；核验目标 SHA 的标准 CI 全部成功后运行标准 Deploy，禁止直接 SSH 写生产或私自修部署配置。若磁盘等环境问题导致失败，检查既有 run 状态后报告，不自动清理生产资源。
- [ ] 只读核验 PC、admin、LINE 三站健康、数据库状态及精确发布 SHA，PC 索引引用的 CSS/JS 可达且含本次改进；有授权会话时只读查看已有报表，不能为验收创建真实业务记录。静态资源/健康检查与真实报表 UI 验收分别记录，不互相替代。

## 4. 确认点与安全门槛

当前用户已确认视觉方向及保留权限边界，并随后书面授权“开始开发吧，按照你的推荐执行，不要问我，直到完成部署”，据此执行 P1～P5。发现需要扩大权限、改变发布布局、增加依赖/API/迁移或改动别的 change 时暂停并重新确认。测试数据只用合成内容，生产数据与恢复副本不可作测试库；授权不包含生产数据清理或默认 OCR 配置变更。最终结果包含两项全量验证、审查与只读生产核验，不把规划 strict 校验当实现完成。
