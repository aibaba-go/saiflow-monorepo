---
doc_id: ADR-010
title: "ADR-010 — 前端界面框架：小程序改用 Tailwind CSS + shadcn/ui，web-pc 与 admin 保留 Ant Design"
type: adr
status: accepted
version: 1.0.0
updated: 2026-11-07
owner: Product Engineering
related: [ADR-006, STD-006, STD-008, NFR-USAB-001, NFR-USAB-003, NFR-USAB-004, FR-SYS-118]
doc_source: manual
---

# ADR-010 — 前端界面框架

> 本 ADR 规定三个前端用什么界面框架来实现界面设计规范 STD-008。它修订 ADR-006 第 125 行关于前端技术栈的说法，由变更 `ui-restyle` 实现。

## 状态

accepted（2026-11-07，负责人确认 `ui-restyle` 提案，含 D4～D6）

## 上下文

- 负责人认为现在的界面不好看。SaiFlow 面向小 B 与 C 端用户，PRD §1 把"简单 UX"列为差异化之一。
- 现状（2026-11-07）：
  - LINE 小程序：React + Ant Design Mobile。用到 13 种组件，22 个文件引用 antd-mobile；扫描与复核各页用 CSS 模块，已经沿用 main 的颜色令牌。
  - web-pc：React + Ant Design 5。41 个文件引用 antd，6 个测试依赖 antd 的 class 名。
  - admin 后台：React + Ant Design。24 个文件引用 antd，只给内部运营使用。
- 负责人 2026-11-07 确定了 STD-008：方向 A 亮蓝；IBM Plex Sans + IBM Plex Sans Thai + Noto Sans SC；两端同一品牌色，只区分圆角与密度；先只做浅色。
- 看起来"不好看"，主要原因是 antd 默认的视觉风格偏重、默认字体对泰文不友好、各页颜色不统一，与组件本身的功能无关。

## 决策

### 1. LINE 小程序：Tailwind CSS + shadcn/ui

- 去掉 Ant Design Mobile。
- 样式用 Tailwind CSS，颜色、字号、圆角都从 STD-008 的令牌生成，业务代码不写任意色值。
- 组件用 shadcn/ui：代码复制进仓库，由我们自己维护，底层用 Radix 处理焦点、键盘与无障碍属性。图标用 lucide。
- 理由：
  - 小程序是 C 端的主要入口，最需要好看、轻；
  - 现在用到的组件少，替换范围可控；
  - 扫描页的 CSS 模块已经用了同一组颜色令牌，可以逐页迁移；
  - shadcn/ui 的组件在仓库里，可以按 STD-008 直接改，不需要覆盖第三方样式。

### 2. web-pc：保留 Ant Design，用主题令牌

- 在 `ConfigProvider` 中按 STD-008 设置颜色、字体、圆角（卡片 10、控件 8）与控件高度（36px）。
- 理由：
  - web-pc 的表格、表单、日期选择、上传与分页功能多，antd 现成且已经测好；
  - 换框架要改 41 个文件和相关测试，风险大；
  - 设好主题令牌后，大部分"不好看"的问题就能解决。
- `ui-restyle` 上线后，由负责人评估 web-pc 的效果。如果仍不满意，另开变更把 web-pc 换成 shadcn/ui，并修订本 ADR。

### 3. admin 后台：保留 Ant Design，只设主题

只按 STD-008 §11.3 设置主色、状态色、圆角与字体。admin 后台只给内部运营使用，不值得换框架。

### 4. 共享设计令牌放在 `packages/ui`

- `packages/ui` 提供以下内容，三个应用都从这里引用，同一个值只定义一处：
  - CSS 变量（STD-008 §11.1）；
  - Tailwind 预设（小程序用）；
  - Ant Design 主题令牌（web-pc 与 admin 用）；
  - 字体文件。
- 字体随应用一起打包，由本站提供，不从外部字体服务加载（FR-SYS-132）。

## 后果

**好处：**
- 小程序的视觉完全按 STD-008，组件在仓库里，可以按需求修改；
- 三个前端的颜色与字体来自同一处，单据状态在两端一致；
- web-pc 与 admin 改动小，风险低。

**代价与风险：**
- 两套组件体系并存（小程序用 shadcn/ui，web-pc 与 admin 用 Ant Design），前端开发要熟悉两套写法。共享令牌保证两边看起来一致。
- shadcn/ui 的组件由我们维护：升级不是装一个新版本就行，需要手动合并上游的修改。
- 小程序的测试要改写查找元素的方式（不再依赖 antd-mobile 的结构），但断言不能删减（FR-SYS-138）。
- 字体文件会增加首次加载的体积：泰文、拉丁与中文字体都要分子集按需加载，构建时检查包体积。

## 需要同步修改的文档

由 `ui-restyle` 在实现时修改：
- STD-006 `React-Frontend-Structure.md`：小程序技术栈、`packages/ui` 的内容、主题写法；
- `Directory-Structure.md`；
- `Architecture.md` 的前端表；
- STD-008 §11：补充 web-pc 的 Ant Design 令牌；
- ADR-006 第 125 行与 `Document-Source-Guide.md`：加注"见 ADR-010"；
- `openspec/config.yaml` 的技术栈说明。

## Version History

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-11-07 | Product Engineering | 负责人确认，状态改为 accepted |
| 0.1.0 | 2026-11-07 | Product Engineering | 初稿（proposed），随变更 `ui-restyle` 提交负责人确认 |
