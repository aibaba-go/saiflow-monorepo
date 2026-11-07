# ui-restyle 验证记录

## 1. 自动化测试

- **前端：** `pnpm -r test` 全部通过，共 435 个：
  - line-mini **218 passed**（变更前 195 个，原有测试没有删除或放宽断言）；
  - web-pc **144 passed**；web-admin **62 passed**；
  - packages/ui **6 passed**；api-client **5 passed**。
- **lint 与构建：** `pnpm -r lint`、`pnpm -r build` 通过。
- **后端：** 本变更不改后端，没有单独运行；CI 中后端测试通过。
- **CI：** `3ef864f` 一次通过。
- **规格：** `openspec validate ui-restyle --strict` 通过。
- **构建产物：**
  - 小程序 JS 709 kB、CSS 89 kB；web-pc CSS 23 kB；admin CSS 22 kB；
  - Noto Sans SC 的字体声明（356 kB）单独打包，只在中文界面加载；
  - 三个应用的产物里都没有 `fonts.googleapis` 或 `fonts.gstatic`。

## 2. 验收标准 → 证据

| 需求 | 验收标准 | 证据 |
|---|---|---|
| FR-SYS-132 统一的颜色与字体 | 132-01 | `packages/ui/src/tokens.test.ts`（antd 主题取值）、`apps/web-pc/src/AppConfig.test.tsx`、`apps/web-admin/src/AppConfig.test.tsx`；负责人在三个前端目测 |
| | 132-02 | `packages/ui/src/fonts.test.ts`；构建产物检查；线上 `saiflow-line2` 的泰文字体从本站返回 `font/woff2` |
| | 132-03 | `tokens.test.ts`（`color-scheme: light`）、`apps/line-mini/src/test/guards.test.ts`（没有 `prefers-color-scheme`） |
| FR-SYS-133 单据状态的颜色 | 133-01、02 | `apps/web-pc/src/ocr/StageTag.test.tsx`、`apps/line-mini/src/features/scan/parts.test.tsx`（复核色、"已退回"标签） |
| FR-SYS-134 小程序的尺寸 | 134-01、02 | `components/ui/ui.test.tsx`（`min-h-11`、小按钮 44px 可点区域）；可点区域逐条检查（25 处改为 44px 或加大可点范围）；负责人手机目测 |
| FR-SYS-135 web-pc 与 admin 的尺寸 | 135-01、02 | `tokens.test.ts`、两个 `AppConfig.test.tsx`；负责人目测 |
| FR-SYS-136 三种语言的显示 | 136-01 | `ui.test.tsx`（长泰文按钮换行）；本机预览 320px / 360px 泰语；负责人手机目测 |
| | 136-02 | `apps/web-pc/src/ocr/ocr.test.tsx`（数字列右对齐、等宽数字） |
| FR-SYS-137 可访问性 | 137-01 | `tokens.test.ts`（文字颜色对比度不低于 4.5:1）、`guards.test.ts`（浅蓝底上不用主色文字） |
| | 137-02 | 全局 `:focus-visible` 轮廓（小程序）、antd 自带焦点样式（web-pc） |
| | 137-03 | 原有 BrandLoading 的减少动态效果测试；组件动画加 `motion-reduce` |
| FR-SYS-138 只改样子，不改行为 | 138-01 | 测试条数只增不减；改动的测试只有两处，见 §5 |
| | 138-02 | 负责人在 LINE 小程序完整走了一遍主流程 |
| FR-SYS-118 界面与 main 一致（修改） | 118-01 | 负责人看了组织、角色、识别结果、复核等页面，布局与文字与以前一致 |

## 3. 部署与实测（2026-11-07）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42372306740 | `3ef864f` | 无迁移；三个站点健康检查正常，版本 `3ef864f` |

负责人实测（2026-11-07）：
- LINE 小程序主流程与以前一致，只是界面样式变了；
- 组织、角色、识别结果、复核页面都看过，没有发现界面异常；
- web-pc 与 admin 都能登录，界面有变化但不明显，以后再精细打磨。

## 4. 最终评审

Opus 整体评审：没有严重问题；2 个重要问题已修复，每个都先有失败的测试：
- Tailwind 的基础样式去掉了标题加粗和段落间距，9 个页面的标题变细。已在基础层恢复（`guards.test.ts`）；
- 浅蓝底上的蓝字（模板名、表头、"回首页"等）对比度只有 3.97:1，web-pc 的警告和成功文字也偏浅。已改用更深的文字色，并设置 antd 的 `colorSuccessText`、`colorWarningText`、`colorErrorText`（`guards.test.ts`、`tokens.test.ts`）。

延后的次要问题（负责人以后决定是否修）：
- 历史页筛选按钮不能换行（`white-space: nowrap`），很长的泰文会溢出；
- 成员列表的角色名标签在 320px 下不能换行；
- 输入框下面多一条线（`.field__row` 的下边框）；
- 输入框的清除按钮只要有内容就显示（以前只在输入时显示）；
- 两个确认框排队时，连点可能点到下一个确认框；
- 提示消息在顶部叠放（以前是一条居中的提示）；
- 测试在每个用例后清除 body 样式，可能掩盖 `pointer-events` 残留；组织页"先关面板再弹确认框"的实际顺序没有测试；
- `.page-pill`、`.quota-plans` 的可点区域不到 44px；
- STD-006 说不用 Tailwind 任意值，代码里有 4 处；
- 依赖声明：`packages/ui` 的 `@types/node` 写成 `*`、没有声明 vitest；tailwind 两个包放在小程序的运行依赖里；
- 一处半透明颜色没有用令牌；web-pc 上 antd 绿色标签的文字对比度仍不足 4.5:1。

## 5. 执行中的决定

执行记录中共 21 条 Ruling，主要有：
- **依赖安全：** pnpm 自动在 `pnpm-workspace.yaml` 加了"允许刚发布的版本"的豁免，已撤销并没有提交；Tailwind 改用 4.3.3，lucide 改用 1.61.0，lockfile 重新生成；
- **中文字体按需加载：** Noto Sans SC 只在中文界面加载，主 CSS 由 463 kB 降到约 90 kB；
- **扫描页的旧问题：** 按钮重置规则（`.tokens button`）的优先级过高，自 `ocr-ui-parity` 起盖掉了按钮自己的样式。改为 `:where(.tokens) button`；
- **自动替换样式：**
  - 只替换 8–14px 的圆角，胶囊和圆形保持不变；
  - 小于 12px 的字统一改为 12px（STD-008 最小字号）；
  - 用户数据（文件名、组织名、模板名）仍可省略显示，标签改为换行；
- **与原来保持一致：** 通知角标显示具体数字；底部面板用 aria-label 命名，不和面板里的标题重复；
- **测试只改了两处：**
  - 测试渲染工具挂上新的确认框与提示组件；
  - 套餐申请测试先关闭"已收到"提示，再检查状态。

  两处的断言都没有变；
- **测试超时：** 小程序测试超时改为 15 秒，与 web-pc、admin 一致（CI 中三个应用并行时偏慢）；
- **本机目测方式：** 真实应用要 LINE 登录和后端，改用临时预览页（假数据，320px / 360px，泰语）。预览中发现并修复了两处：最近任务的标签挤掉文件名；扫描页按钮样式被重置。
