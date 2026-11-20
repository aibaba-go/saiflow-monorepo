# AIbaba / SaiFlow 客户端品牌重构

## Why
负责人指定 temp/ui-redesign/saiflow-pc-precision.html 与 saiflow-line-mini-aibaba.html 为客户界面重构依据。当前 STD-008 与 ui-style 的旧紫蓝色及禁止调整布局规则与原型不一致，须通过本 change 明确修改，而不是直接覆盖规范。

## What Changes
- PC 与 LINE mini 使用海军蓝、清晰蓝主色和青绿装饰，白色卡片、柔和背景，保留状态语义及本地多语字体。
- PC 深色导航、白色顶栏、首页流程 hero/真实用量、上传/核验/单据库与其余页面一致化；mini 品牌首页、悬叠用量、扫描/待处理/最近任务、四个安全区导航与结果/复核/账号卡片一致化。
- 保留真实数据、权限、路由、确认/取消、上传进度、原件交互、复核及导出；原型的演示手机壳、LINE 头、假数据与模拟操作不进入应用。
- 负责人 2026-11-09 走查后决定：PC 与 mini 逐页按原型高还原（页头、统计条、表格/卡片结构等，只用真实数据）；admin 也改用 PC 的品牌外壳与颜色，页面内业务控件不变。新增操作/字段能力分别由两个独立 change 管理。

## Capabilities
### Modified Capabilities
- `ui-style`：FR-SYS-132/135/138，品牌色作用范围、PC 导航布局和视觉重构边界；其余状态、密度、三语、对比度要求不变。

## Impact
packages/ui 集中令牌及 pcTheme，PC AppLayout/页面/CSS，mini 样式及首页，STD-008。遵循 STD-006、NFR-USAB-003/004、FR-SYS-136/137。继续使用随应用提供的 IBM Plex Sans/Thai 与 Noto Sans SC，不引入原型 Inter 外部字体请求。

## Non-goals
不新增报告业务和后端接口，不改 admin 的业务与表单，不复制原型的假记录/计时器/模拟成功；不更改菜单权限与业务流程，不扩展模板 Excel 额外字段导出范围，不部署或提交。

## 交接
按负责人 2026-11-09 自主实现授权推进。实施方案唯一来源 [plan.md](plan.md)，证据写 verification.md。原型是视觉参考，实际功能以行为 spec 为准。
