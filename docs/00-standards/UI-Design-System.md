---
doc_id: STD-008
title: "SaiFlow 界面设计规范"
type: standard
status: active
version: 1.1.0
updated: 2026-11-07
owner: Product Engineering
doc_source: manual
---

# SaiFlow 界面设计规范

本标准定义 SaiFlow 各前端的视觉与交互基础：颜色、字体、字号、间距、圆角、阴影、常用组件的样子与用法、状态的表达方式与可访问性要求。

**适用范围**
- LINE 小程序（`apps/line-mini`）与 web-pc 企业版（`apps/web-pc`）：用同一套品牌色与字体，只在圆角与密度上区分（§5、§6）。
- admin 后台（`apps/web-admin`）：内部运营使用，保留 Ant Design，只把主色、字体与状态色按本规范设置（§11）。

**负责人决定（2026-11-07）**
- 颜色：方向 A，延续现有的亮蓝主色。
- 字体：IBM Plex Sans + IBM Plex Sans Thai，中文用 Noto Sans SC。
- 两端同一套品牌色，小程序偏亲和、web-pc 偏紧凑，差别只在圆角与密度。
- 先只做浅色；深色模式的令牌位置保留（§12），暂不实现。

方向对比稿：<https://claude.ai/artifact/T5rnmuw3PPWP2ZaDAsXrEk>（只读参考，以本文为准）。

---

## 1. 原则

1. **先看清，再好看。** 单据数据是主角：金额、日期、编号要一眼可读，状态要一眼可辨。装饰让位于信息。
2. **一个主色，克制使用。** 主色只用于主要操作、选中与进度。同一屏最多一个主按钮。
3. **状态用颜色加文字表达。** 永远不要只靠颜色区分状态，标签里必须有文字。
4. **三种文字一起好看。** 泰文、英文、中文混排是常态，行高、字号要照顾泰文的上下标音符号。
5. **同一件事同一个样子。** 同一种状态、同一种操作，在小程序和 web-pc 里颜色与文字一致。

---

## 2. 颜色

所有颜色都以令牌（CSS 变量）使用，组件代码中不得写死色值。

### 2.1 品牌色

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--primary` | `#4A66F7` | 主按钮、链接、选中、进度条 |
| `--primary-hover` | `#3D59EE` | 主按钮悬停 |
| `--primary-pressed` | `#3149D4` | 主按钮按下；浅底上的主色文字 |
| `--primary-soft` | `#E8EDFF` | 次要按钮底色、选中行底色、"待核验"标签底色 |
| `--on-primary` | `#FFFFFF` | 主色上的文字与图标 |

白字在 `--primary` 上的对比度约 4.6:1，满足正文 AA。

### 2.2 中性色

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--bg` | `#F5F7FA` | 页面底色 |
| `--surface` | `#FFFFFF` | 卡片、表格、弹窗 |
| `--surface-muted` | `#F0F3F7` | 表头、分组背景、只读输入框 |
| `--border` | `#E3E8F0` | 分隔线、卡片与输入框边框 |
| `--border-strong` | `#CDD5E0` | 悬停与聚焦前的输入框边框 |
| `--text` | `#171A1C` | 正文、标题、数据 |
| `--text-secondary` | `#5D6673` | 说明、标签、元信息（对白底约 5.9:1） |
| `--text-tertiary` | `#99A1B0` | 只用于占位符与禁用文字（对比不足，不能用于需要阅读的内容） |
| `--icon` | `#596170` | 默认图标 |
| `--track` | `#EDF2F7` | 进度条底轨、骨架屏 |

### 2.3 语义色

每种语义有三档：图形用色（图标、圆点、进度）、底色（标签与提示的背景）、文字色（底色上的文字，对比 ≥ 4.5:1）。

| 语义 | 图形 `--x` | 底色 `--x-bg` | 文字 `--x-text` | 用途 |
|---|---|---|---|---|
| success | `#1F9E6B` | `#E3F5ED` | `#18774F` | 已确认、保存成功 |
| warning | `#D98F1F` | `#FCF2E3` | `#935D0E` | 识别中、即将到期、需注意 |
| review | `#E07B1A` | `#FFF0E0` | `#A35400` | 待复核 |
| danger | `#D6383E` | `#FDEAEA` | `#C4343A` | 识别失败、必填缺失、金额不一致、删除 |
| info | `#4A66F7` | `#E8EDFF` | `#3149D4` | 待核验、一般提示（与主色相同） |

白字只用于 `--primary` 与 `--danger` 的实心底（对比约 4.6:1、4.7:1）。success、warning、review 的图形色对白字不足 4.5:1，不作为带文字的实心底，标签一律用"底色 + 文字色"。

### 2.4 单据状态的配色（两端必须一致）

| 状态 | 语义 | 标签文字（中文示例） |
|---|---|---|
| 识别中、模板匹配中 | warning | 识别中 / 模板匹配中 |
| 识别失败 | danger | 识别失败 |
| 待核验 | info | 待核验；被退回时另加 danger 标签"已退回" |
| 待复核 | review | 待一级复核 / 待二级复核 |
| 已确认（正式业务数据） | success | 已确认 |

字段级标记：
- 必填缺失：输入框边框与说明文字用 `--danger`。
- 类型不符、金额不一致：用 warning。

---

## 3. 字体

### 3.1 字体栈

```css
--font-sans: "IBM Plex Sans", "IBM Plex Sans Thai", "Noto Sans SC", -apple-system,
  BlinkMacSystemFont, "Segoe UI", sans-serif;
```

- 字体文件随应用一起打包，由本站提供，不从 Google Fonts 等外部服务加载（FR-SYS-132，ADR-010 D6）；字重 400、500、600。
- IBM Plex Sans 与 IBM Plex Sans Thai 随页面加载；Noto Sans SC 的字体声明很大，只在界面语言为中文时加载（`loadChineseFont()`），其他语言下的中文字符用系统字体。
- 用 `font-display: swap`，加载完成前显示系统字体。
- 金额、数量、日期、编号一律用等宽数字（`font-variant-numeric: tabular-nums`）。
- 不使用斜体；强调用字重或颜色。

### 3.2 字号层级

| 令牌 | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `text-caption` | 12px / 18px | 400 | 时间、辅助说明、表格次要信息 |
| `text-sm` | 13px / 20px | 400 | web-pc 表格正文、标签文字 |
| `text-base` | 14px / 22px | 400 | web-pc 正文、表单 |
| `text-body` | 15px / 24px | 400 | 小程序正文、表单（手机上不小于 15px） |
| `text-title-sm` | 16px / 24px | 600 | 卡片标题、弹窗标题 |
| `text-title` | 20px / 28px | 600 | 页面标题 |
| `text-display` | 24px / 32px | 600 | 首页关键数字（剩余次数等） |

泰文行高不得低于字号的 1.5 倍，避免上下标音符号被裁切；上表已满足。

---

## 4. 间距

以 4px 为单位：`4, 8, 12, 16, 20, 24, 32, 40, 48`。

| 场景 | 小程序 | web-pc |
|---|---|---|
| 页面左右边距 | 16px | 24px |
| 卡片内边距 | 16px | 20px |
| 卡片之间 | 12px | 16px |
| 表单字段之间 | 16px | 16px |
| 标签与输入框之间 | 6px | 6px |

同组元素用 flex 或 grid 的 `gap` 排列，不用单个元素的外边距。

---

## 5. 圆角与阴影

| 令牌 | 小程序 | web-pc | 用途 |
|---|---|---|---|
| `--radius-card` | 14px | 10px | 卡片、弹窗 |
| `--radius-control` | 10px | 8px | 按钮、输入框、下拉 |
| `--radius-pill` | 999px | 999px | 状态标签、计数徽标 |

阴影只用两档，按角色使用，不是每个块都加：
- `--shadow-sm`：`0 1px 2px rgba(16, 24, 40, .06)`，卡片；
- `--shadow-md`：`0 8px 24px rgba(16, 24, 40, .12)`，弹窗、下拉菜单、底部弹层。

---

## 6. 密度与尺寸

| 控件 | 小程序 | web-pc |
|---|---|---|
| 按钮、输入框高度 | 44px（触控最小目标） | 36px |
| 表格行高 | — | 44px（紧凑表格 36px） |
| 底部操作栏 | 64px + 安全区 | — |
| 图标 | 20px（导航 24px） | 16px（工具栏 20px） |

---

## 7. 组件规范

组件实现见 STD-006 与迁移变更。本节只规定样子与用法。

### 7.1 按钮

| 变体 | 样子 | 用途 |
|---|---|---|
| primary | `--primary` 底、白字 | 每屏最多一个：确认、开始识别、保存 |
| secondary | `--primary-soft` 底、`--primary-pressed` 字 | 次要操作：选择文件、保存草稿 |
| outline | 白底、`--border` 边、`--text` 字 | 并列的普通操作：更换模板、修改记录 |
| ghost | 无底、`--primary-pressed` 字 | 行内、工具栏操作 |
| danger | `--danger` 底、白字 | 删除、退回、取消识别（总是先确认） |

- 文字用动词，说明会发生什么（"开始识别（3 个文件）"，而不是"确定"）。
- 加载中：保留按钮宽度，显示旋转图标，不再响应点击（一次只发一个请求）。
- 禁用：降低不透明度，并在附近说明原因（例如"没有上传权限"）。

### 7.2 输入框与字段

- 标签在上，必填项在标签后加 `*`（`--danger`）。
- 说明文字在输入框下方（`text-caption`，`--text-secondary`）；出错时改为错误文字（`--danger`），输入框边框变为 `--danger`。
- 聚焦时边框为 `--primary`，外加 3px `--primary-soft` 光晕。
- 金额、数量输入框右对齐、等宽数字；千位分隔只在显示时加，保存时去掉（与现有规则一致）。

### 7.3 状态标签

圆角 `--radius-pill`，内边距 2px × 10px，`text-sm`，字重 500。底色与文字色按 §2.3、§2.4。

### 7.4 卡片与列表

- 卡片：`--surface` 底、`--radius-card`、`--shadow-sm`，不加边框。表格放在卡片里时，卡片不再加阴影。
- 列表项：左侧为主要信息（文件名），右侧为状态标签；第二行放元信息（模板、时间），用 `text-caption`。

### 7.5 表格（web-pc）

- 表头：`--surface-muted` 底、`text-sm`、字重 500、`--text-secondary` 字。
- 行：行高 44px、行间 1px `--border` 分隔、悬停 `--bg`、选中 `--primary-soft`。
- 数字列右对齐，等宽数字。
- 分页在表格右下，每页 20 条。

### 7.6 弹窗与确认

- 标题说明要做什么（"退回这张单据？"），正文说明后果，按钮写具体动作（"退回"），危险操作用 danger。
- 小程序优先用底部弹层（宽度占满，顶部圆角 `--radius-card`）；web-pc 用居中弹窗，宽 480px。

### 7.7 提示消息（toast）

- 位置：小程序顶部居中，web-pc 右上角；3 秒后消失，错误提示 5 秒。
- 成功提示用过去式写完成的事（"已保存"）；错误提示说明原因与解决方法，不道歉。

### 7.8 空状态、加载、出错

| 状态 | 规范 |
|---|---|
| 空 | 一句话说明这里会出现什么，加一个下一步操作（如"还没有任务"＋"上传"） |
| 加载 | 列表与卡片用骨架屏（`--track`）；按钮内用旋转图标；整页加载不超过一个旋转图标 |
| 出错 | 说明哪里出了问题，并提供"重试"；不显示技术细节 |

---

## 8. 图标

- 使用 lucide 图标（shadcn/ui 默认），线宽 1.75。
- 尺寸按 §6。
- 图标与文字间距 6px。
- 单独使用图标的按钮必须有无障碍名称（`aria-label`）。

---

## 9. 可访问性

- 文字对比：正文 ≥ 4.5:1，大字（≥ 18px 或 16px 加粗）≥ 3:1。`--text-tertiary` 不用于需要阅读的内容。
- 键盘：所有可操作元素可用 Tab 到达，聚焦时显示 2px `--primary` 轮廓、2px 偏移。
- 触控：小程序可点区域不小于 44 × 44px。
- 动效：时长 150–200ms，缓动 `ease-out`；尊重系统的"减少动态效果"设置。

---

## 10. 文案

- 按用户熟悉的说法命名（"通知"，不说"推送配置"）。
- 主动语态，按钮说清会发生什么，结果提示与按钮对应（"发布"→"已发布"）。
- 三种语言的文案长度差别大（泰文、英文通常比中文长 30–60%），按钮与标签要能换行或留出空间，不能截断。

---

## 11. 实现映射

### 11.1 CSS 变量（shadcn/ui 约定）

shadcn/ui 组件读取以下变量。值取自 §2，写在各应用的全局样式中：

```css
:root {
  --background: #F5F7FA;      /* --bg */
  --foreground: #171A1C;      /* --text */
  --card: #FFFFFF;            /* --surface */
  --card-foreground: #171A1C;
  --popover: #FFFFFF;
  --popover-foreground: #171A1C;
  --primary: #4A66F7;
  --primary-foreground: #FFFFFF;
  --secondary: #E8EDFF;       /* --primary-soft */
  --secondary-foreground: #3149D4;
  --muted: #F0F3F7;           /* --surface-muted */
  --muted-foreground: #5D6673;
  --accent: #E8EDFF;
  --accent-foreground: #3149D4;
  --destructive: #D6383E;
  --destructive-foreground: #FFFFFF;
  --border: #E3E8F0;
  --input: #E3E8F0;
  --ring: #4A66F7;
  --radius: 10px;             /* 小程序 --radius-control；web-pc 用 8px */
  /* 扩展：语义色 */
  --success: #1F9E6B; --success-bg: #E3F5ED; --success-text: #18774F;
  --warning: #D98F1F; --warning-bg: #FCF2E3; --warning-text: #935D0E;
  --review: #E07B1A;  --review-bg: #FFF0E0;  --review-text: #A35400;
  --danger-bg: #FDEAEA; --danger-text: #C4343A;
}
```

### 11.2 Tailwind

- 共享的 Tailwind 主题放在 `packages/ui/src/styles/theme.css`（Tailwind v4 `@theme`），把以上变量映射为颜色、圆角（`rounded-card`、`rounded-control`、`rounded-pill`）、字体与字号（`text-caption` … `text-display`），小程序引用这份主题。
- 密度由应用设置：`--card-radius`、`--control-radius`、`--control-h`（小程序 14px / 10px / 44px）。
- 业务代码中只使用预设里的颜色与字号类名，不使用任意值（如 `text-[#4a66f7]`）。

### 11.3 web-pc（Ant Design）

`ConfigProvider theme` 使用 `@saiflow/ui` 的 `pcTheme`（ADR-010 §2）：
- 颜色：`colorPrimary #4A66F7`、`colorSuccess #1F9E6B`、`colorWarning #D98F1F`、`colorError #D6383E`、`colorInfo #4A66F7`；文字色 `colorSuccessText #18774F`、`colorWarningText #935D0E`、`colorErrorText #C4343A`（Typography 的成功、警告、错误文字用这三个，图形色对白底不足 4.5:1）；`colorBgLayout`、`colorBgContainer`、`colorBorder`、`colorText`、`colorTextSecondary`、`colorTextPlaceholder` 取 §2.2；
- 尺寸：`borderRadius 8`、`borderRadiusLG 10`、`controlHeight 36`、`fontSize 14`、`lineHeight 22/14`、`fontFamily`（§3.1）；
- 表格：`cellPaddingBlock 12`（行高约 44px）、表头底色 `--surface-muted`。

单据阶段标签不用 antd `Tag` 的预设颜色，用 §2.4 的"底色 + 文字色"。

### 11.4 admin 后台（Ant Design）

`ConfigProvider theme` 使用 `adminTheme`：
- `colorPrimary: #4A66F7`、`colorSuccess: #1F9E6B`、`colorWarning: #D98F1F`、`colorError: #D6383E`，以及与 §11.3 相同的三个文字色；
- `borderRadius: 8`、`fontFamily`（§3.1）。

其余沿用 Ant Design 默认。

---

## 12. 深色模式（暂不实现）

负责人 2026-11-07 决定先只做浅色。实现时要求：
- 所有颜色都通过令牌使用（§2）；
- 深色值只在令牌层重新定义，组件中不出现只适用于一种主题的颜色。

这样以后加深色模式时，不需要改组件代码。

---

## Version History

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-11-07 | Product Engineering | 变更 `ui-restyle` 实现后对齐：字体随应用打包（不用 Google Fonts），中文字体按需加载；§11.2 改为 Tailwind v4 主题与应用密度变量；新增 §11.3 web-pc 的 Ant Design 令牌（含成功、警告、错误的文字色），admin 改为 §11.4 |
| 1.0.1 | 2026-11-07 | Product Engineering | 对比度修正：success/warning/review 文字色加深为 `#18774F`/`#935D0E`/`#A35400`，danger 改为 `#D6383E`，使标签文字与白字删除按钮达到 4.5:1（变更 `ui-restyle` FR-SYS-137）；说明白字只用于主色与 danger 实心底 |
| 1.0.0 | 2026-11-07 | Product Engineering | 初始版：方向 A（亮蓝）、IBM Plex Sans + IBM Plex Sans Thai + Noto Sans SC、两端同一品牌色只区分圆角与密度、先只做浅色（负责人 2026-11-07） |
