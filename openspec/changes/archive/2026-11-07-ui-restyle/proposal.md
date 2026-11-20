## Why

负责人认为现在的界面不好看。SaiFlow 面向小 B 与 C 端用户，PRD §1 把"简单 UX"列为差异化之一，NFR-USAB-001～005 要求低门槛、状态清楚、三种语言完整显示。负责人 2026-11-07 已确定界面设计规范 STD-008（`docs/00-standards/UI-Design-System.md`）：
- 方向 A 亮蓝；
- IBM Plex Sans + IBM Plex Sans Thai + Noto Sans SC；
- 两端同一品牌色，只区分圆角与密度；
- 先只做浅色。

本变更让三个前端按 STD-008 显示，并为前端框架的调整写 ADR-010。

## What Changes

**负责人决定（2026-11-07，采纳建议）：**
- **D1 LINE 小程序：** 去掉 Ant Design Mobile，改用 Tailwind CSS + shadcn/ui，全部页面按 STD-008 显示。
- **D2 web-pc：** 保留 Ant Design，用主题令牌按 STD-008 设置颜色、字体、圆角与控件高度。上线后由负责人评估效果，再决定是否也换成 shadcn/ui（另开变更）。
- **D3 admin 后台：** 保留 Ant Design，只按 STD-008 §11.3 设置主色、状态色、圆角与字体。

**负责人已确认的建议（2026-11-07）：**
- **D4 FR-SYS-118 的范围：** "界面与 main 一致"保留区块顺序、布局、文字、图标与按钮的位置；颜色、字体、圆角与间距改为以 STD-008 为准（见 `line-mini` 增量）。
- **D5 品牌等待动画（NFR-USAB-004）：** 保留 F＋圆点标志、字标、扫描光线与光点，只把颜色换成 STD-008 的令牌。
- **D6 字体文件：** 随应用一起打包，由本站提供，不从外部字体服务加载。这样用户的访问不会被第三方记录，网络慢时也不依赖另一个站点。

**规格变化：**
- 新增 `ui-style`：三个前端的颜色与字体、单据状态的颜色、两种密度、三种语言的显示、可访问性、"只改样子不改行为"（FR-SYS-132～138）。
- 修改 `line-mini` 的 FR-SYS-118（D4）。

**非目标（Non-goals）：**
- 深色模式（STD-008 §12，负责人决定先只做浅色）；
- 改页面结构、流程、文字或新增功能。界面文字与三种语言的翻译不变；
- web-pc 与 admin 后台换成 shadcn/ui（D2、D3）；
- 后端与接口的任何变化；
- 只在 P1/P2 才有的页面（报表、模板配置、Excel 导入、界面录入）。

## Capabilities

### New Capabilities
- `ui-style`：三个前端的视觉规则，以 STD-008 为依据：颜色与字体、单据状态的颜色、小程序与 web-pc 的密度、admin 的主题、三种语言的显示、可访问性，以及改样子时不改行为。

### Modified Capabilities
- `line-mini`：FR-SYS-118 不再要求颜色、圆角与间距与 main 一致，改为按 STD-008（D4）。

## Impact

- **前端：**
  - `apps/line-mini`：
    - 去掉 `antd-mobile` 依赖，改用 Tailwind CSS 与 shadcn/ui 组件。现在用到 13 种组件：Button、Popup、Tag、Dialog、Toast、ErrorBlock、Space、Result、NoticeBar、List、Input、Card、Badge；
    - 页面样式改用 STD-008 的令牌。扫描各页现有的 CSS 模块已经用了 main 的同一组颜色，主要改字体、次要文字颜色（`#99A1B0` 对比度不足，改为 `#5D6673`）与圆角；
    - 依赖 antd-mobile 的测试辅助代码要换掉。
  - `apps/web-pc`：在 `ConfigProvider` 中设置主题令牌，单据状态标签改用 STD-008 的颜色。
  - `apps/web-admin`：在 `ConfigProvider` 中设置主题令牌。
  - `packages/ui`：放共享的设计令牌、Tailwind 预设与字体文件。
- **文档：**
  - 新增 ADR-010（前端界面框架）；
  - 实现时同步修改：
    - `React-Frontend-Structure.md`（STD-006：小程序技术栈、`packages/ui` 的内容、主题写法）；
    - `Directory-Structure.md`；
    - `Architecture.md` 的前端表；
    - STD-008 §11（补上 web-pc 的 Ant Design 令牌）；
    - ADR-006 第 125 行与 `Document-Source-Guide.md` 第 104 行加注"见 ADR-010"；
    - `openspec/config.yaml` 的技术栈说明。
- **后端、接口、数据库：** 不变。
- **部署：** 与平常一样（CI 通过后手动部署）。包体积会变化，构建时检查。
