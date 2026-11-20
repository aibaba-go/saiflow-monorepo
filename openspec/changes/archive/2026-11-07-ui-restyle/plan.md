# ui-restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三个前端按 STD-008 显示：小程序去掉 antd-mobile，改用 Tailwind CSS + shadcn/ui；web-pc 与 admin 保留 antd，改用 STD-008 的主题令牌。行为不变。

**Architecture:**
- `packages/ui` 是设计令牌的唯一来源，包括：
  - `tokens.ts`（数值）；
  - `styles/tokens.css`（CSS 变量）；
  - `styles/theme.css`（Tailwind v4 `@theme`）；
  - `styles/fonts.css`（@fontsource 字体）；
  - `antdTheme.ts`（web-pc 与 admin 的 antd 主题）。
- 小程序的 shadcn/ui 组件复制到 `apps/line-mini/src/components/ui/`，由我们维护。
- 小程序现有的 CSS 模块保留，只把写死的颜色、字体、圆角换成令牌。
- 由静态检查测试保证：不再引用 antd-mobile、不写死色值。

**Tech Stack:**
- tailwindcss 4.3.5 + @tailwindcss/vite 4.3.5；
- @radix-ui/react-dialog 1.3.1、@radix-ui/react-alert-dialog 1.2.1、@radix-ui/react-slot 1.5.0；
- sonner 2.0.8、lucide-react 1.70.0、class-variance-authority 0.7.1、clsx 2.1.1、tailwind-merge 3.7.0；
- @fontsource/ibm-plex-sans 5.3.0、@fontsource/ibm-plex-sans-thai 5.3.0、@fontsource/noto-sans-sc 5.3.1；
- antd 5（web-pc、admin），Vitest + RTL。

**Spec:**
- `openspec/changes/ui-restyle/specs/ui-style/spec.md`（FR-SYS-132～138）；
- `openspec/changes/ui-restyle/specs/line-mini/spec.md`（FR-SYS-118）；
- `docs/00-standards/UI-Design-System.md`（STD-008 1.0.1）；
- `docs/30-design/adr/ADR-010-frontend-ui-framework.md`。

## Global Constraints

- 颜色值只取自 STD-008 §2。业务代码（CSS、TSX）中不写十六进制色值，只用令牌（STD-008 §2 开头、§11.2）。
- 主色 `#4A66F7`；success `#1F9E6B / #E3F5ED / #18774F`；warning `#D98F1F / #FCF2E3 / #935D0E`；review `#E07B1A / #FFF0E0 / #A35400`；danger `#D6383E / #FDEAEA / #C4343A`；info `#4A66F7 / #E8EDFF / #3149D4`。
- 中性色：bg `#F5F7FA`、surface `#FFFFFF`、surface-muted `#F0F3F7`、border `#E3E8F0`、border-strong `#CDD5E0`、text `#171A1C`、text-secondary `#5D6673`、text-tertiary `#99A1B0`（只用于占位符与禁用）、icon `#596170`、track `#EDF2F7`。
- 字体栈：`"IBM Plex Sans", "IBM Plex Sans Thai", "Noto Sans SC", -apple-system, "Segoe UI", sans-serif`。字体由本站提供，不请求外部字体服务（FR-SYS-132）。
- 小程序：卡片圆角 14px、控件圆角 10px、控件高 44px、正文 15/24、左右留白 16px（FR-SYS-134）。
- web-pc：卡片圆角 10px、控件圆角 8px、控件高 36px、表格行高 44px、正文 14/22、内容区留白 24px（FR-SYS-135）。
- admin：主色、状态色、圆角 8、字体（STD-008 §11.3），其余用 antd 默认。
- 只做浅色：`:root { color-scheme: light; }`，不写 `prefers-color-scheme` 规则（FR-SYS-132-03）。
- 界面文字与三种语言的翻译不变。只允许新增无障碍名称用的键，例如 `common.clear`（FR-SYS-138）。
- 已有测试不得删除或放宽断言，只允许改查找元素的方式（AC-FR-SYS-138-01）。
- 按钮、标签、菜单的文字不截断。`text-overflow: ellipsis` 只允许用在显示文件名的元素上（FR-SYS-136）。
- 动效 150–200ms、`ease-out`；尊重 `prefers-reduced-motion`（FR-SYS-137）。
- 提交信息以 `[ui-restyle]` 开头。

## Review Focus

1. **泰文长文字的按钮：** shadcn 的 Button 默认带 `whitespace-nowrap` 和固定高度 `h-9`。在 320px 宽的屏幕上，泰文按钮会被截断或溢出。应改为可换行、最小高度 44px（Task 3 的 `button wraps long labels` 测试）。
2. **底部面板中再弹确认框：** 组织页在"选择新 owner"的底部面板里点选后弹出转让确认框。两层 Radix 弹层的焦点与点击都要正常，确认后面板关闭（Task 3 的 `confirm over an open sheet` 测试）。
3. **确认框连点：** 连点"确认"时 `confirmDialog` 只返回一次 `true`，后端只收到一次请求（Task 3 的 `confirm resolves once` 测试；页面层由已有的 `useSubmit` 测试保证）。
4. **系统为深色时：** 不能出现一半深色一半浅色（Task 5 的静态检查：没有 `prefers-color-scheme`，并设置 `color-scheme: light`）。
5. **弹层关闭后页面点不动：** Radix 弹层打开时会给 body 加 `pointer-events: none`，组件在关闭动画中被卸载时可能留下这个样式。底部面板关闭并跳转页面后，页面仍要能点击（Task 3 的 `sheet close restores pointer events` 测试）。

---

## File Structure

**packages/ui（令牌唯一来源）：**
- `src/tokens.ts`：`COLORS`、`FONT_STACK`、`DENSITY`，以及 `contrast(a: string, b: string): number`。
- `src/styles/tokens.css`：`:root` 的 CSS 变量，值与 `tokens.ts` 相同（有测试比对）。
- `src/styles/theme.css`：Tailwind v4 的 `@theme inline`，把变量映射成 `bg-primary`、`text-text-secondary`、`rounded-card` 等。
- `src/styles/fonts.css`：@fontsource 的 400/500/600 三种字重。
- `src/antdTheme.ts`：`pcTheme`、`adminTheme`。
- `src/index.ts`：导出以上。
- `src/*.test.ts`、`package.json`（加 test/lint 脚本与依赖）。

**apps/line-mini：**
- `vite.config.ts`：加 `@tailwindcss/vite`。
- `src/styles/index.css`（新）：引入 tailwind、令牌、主题、字体，以及小程序的密度变量。
- `src/lib/cn.ts`：`cn(...inputs: ClassValue[]): string`。
- `src/components/ui/`：
  - `button.tsx`、`input.tsx`、`sheet.tsx`（`BottomSheet`）、`dialogs.tsx`（`DialogHost`、`confirmDialog`、`alertDialog`、`closeAllDialogs`）；
  - `toast.tsx`（`AppToaster`、`showToast`、`clearToasts`）；
  - `tag.tsx`、`card.tsx`、`alert.tsx`、`list.tsx`、`empty-state.tsx`、`count-badge.tsx`；
  - `ui.test.tsx`。
- 22 个引用 antd-mobile 的文件改用上面的组件。
- CSS 模块与 `app.css` 改用令牌。
- `src/test/setup.ts` 改为清理新的弹层。
- `src/test/guards.test.ts`：静态检查。

**apps/web-pc、apps/web-admin：**
- `App.tsx`：`ConfigProvider theme`。
- `main.tsx`：引入字体与令牌 CSS。
- `apps/web-pc/src/ocr/StageTag.tsx`、`stageTag.css`。
- `pages/VerifyPage.tsx` 的"已退回"标签。

**docs：** STD-006、Directory-Structure、Architecture、STD-008 §11、ADR-006、Document-Source-Guide、`openspec/config.yaml`。

---

### Task 1: packages/ui 设计令牌

**Files:**
- Create: `packages/ui/src/tokens.ts`, `packages/ui/src/styles/tokens.css`, `packages/ui/src/styles/theme.css`, `packages/ui/src/styles/fonts.css`, `packages/ui/src/antdTheme.ts`, `packages/ui/src/tokens.test.ts`, `packages/ui/vitest.config.ts`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json`, `packages/ui/README.md`

**Interfaces:**
- Produces:
  - `COLORS: Record<ColorToken, string>`。键用 CSS 变量名去掉 `--`，例如 `primary`、`primary-hover`、`primary-pressed`、`primary-soft`、`on-primary`、`bg`、`surface`、`surface-muted`、`border`、`border-strong`、`text`、`text-secondary`、`text-tertiary`、`icon`、`track`，以及 `success`、`success-bg`、`success-text` 等（warning、review、danger、info 同样三档）。
  - `FONT_STACK: string`。
  - `DENSITY: { mini: { radiusCard: 14; radiusControl: 10; controlHeight: 44 }; pc: { radiusCard: 10; radiusControl: 8; controlHeight: 36; tableRow: 44 } }`。
  - `contrast(fg: string, bg: string): number`：WCAG 2.x 对比度，保留两位小数。
  - `pcTheme`、`adminTheme`：`{ token: {...}; components?: {...} }` 普通对象，供 antd `ConfigProvider theme` 使用。
  - 包的 exports：`"."`、`"./styles/tokens.css"`、`"./styles/theme.css"`、`"./styles/fonts.css"`。

- [ ] **Step 1: 写失败的测试 `packages/ui/src/tokens.test.ts`**

```ts
import { readFileSync } from "node:fs";
import { COLORS, contrast, DENSITY, FONT_STACK } from "./tokens";
import { adminTheme, pcTheme } from "./antdTheme";

const css = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");

it("tokens.css matches tokens.ts", () => {
  for (const [name, value] of Object.entries(COLORS)) {
    expect(css).toMatch(new RegExp(`--${name}:\\s*${value};`, "i"));
  }
  expect(css).toMatch(/color-scheme:\s*light/);
});
it("reading text meets 4.5:1 (FR-SYS-137)", () => {
  const pairs: [string, string][] = [
    ["text", "surface"], ["text-secondary", "surface"], ["text-secondary", "bg"],
    ["on-primary", "primary"], ["on-primary", "danger"], ["primary", "surface"],
    ["success-text", "success-bg"], ["warning-text", "warning-bg"],
    ["review-text", "review-bg"], ["danger-text", "danger-bg"], ["info-text", "info-bg"],
  ];
  for (const [fg, bg] of pairs) expect(contrast(COLORS[fg], COLORS[bg])).toBeGreaterThanOrEqual(4.5);
});
it("contrast is WCAG", () => {
  expect(contrast("#FFFFFF", "#000000")).toBe(21);
  expect(contrast("#99A1B0", "#FFFFFF")).toBe(2.6);
});
it("antd themes follow STD-008", () => {
  expect(pcTheme.token).toMatchObject({
    colorPrimary: "#4A66F7", colorSuccess: "#1F9E6B", colorWarning: "#D98F1F",
    colorError: "#D6383E", borderRadius: 8, borderRadiusLG: 10, controlHeight: 36,
    fontSize: 14, fontFamily: FONT_STACK, colorBgLayout: "#F5F7FA", colorText: "#171A1C",
  });
  expect(pcTheme.components?.Table).toMatchObject({ cellPaddingBlock: 12 });
  expect(adminTheme.token).toMatchObject({ colorPrimary: "#4A66F7", colorError: "#D6383E", borderRadius: 8, fontFamily: FONT_STACK });
  expect(adminTheme.token).not.toHaveProperty("controlHeight");
  expect(DENSITY.mini.controlHeight).toBe(44);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @saiflow/ui test`
Expected: FAIL。缺少 test 脚本，或无法解析 `./tokens`。

- [ ] **Step 3: 实现**
  - `package.json`：加 `"test": "vitest run"`、`"lint": "eslint ."`、exports 与 `@fontsource/*` 依赖，devDependencies 加 vitest（版本与根目录一致）。
  - `tokens.ts`：值照 Global Constraints。`info-bg` 为 `#E8EDFF`，`info-text` 为 `#3149D4`。
  - `tokens.css`：`:root{ color-scheme: light; --x: ...; }`，同时写 STD-008 §11.1 的 shadcn 别名（`--background`、`--foreground`、`--card`、`--primary-foreground`、`--destructive`、`--ring`、`--input` 等），别名用 `var(--...)` 指向基础变量。
  - `theme.css`：`@theme inline` 映射以下内容：
    - `--color-*`：每个颜色令牌；
    - `--radius-card: var(--radius-card)`、`--radius-control: var(--radius-control)`；
    - `--font-sans: var(--font-stack)`。

    `--radius-card`、`--radius-control`、`--control-h` 的具体数值由各应用的 CSS 设置（Task 3、Task 2）。
  - `fonts.css`：
    - 引入 `@fontsource/ibm-plex-sans/{400,500,600}.css`、`@fontsource/ibm-plex-sans-thai/{400,500,600}.css`、`@fontsource/noto-sans-sc/{400,500,600}.css`；
    - 用 `font-display: swap`（fontsource 默认）。
  - `antdTheme.ts`：
    - `pcTheme`：
      - token：`colorPrimary`、`colorSuccess`、`colorWarning`、`colorError`、`colorInfo`、`colorBgLayout`、`colorBgContainer`、`colorBorder`、`colorBorderSecondary`、`colorText`、`colorTextSecondary`、`colorTextPlaceholder`；
      - `borderRadius: 8`、`borderRadiusLG: 10`、`controlHeight: 36`、`fontSize: 14`、`lineHeight: 22/14`、`fontFamily: FONT_STACK`；
      - `components.Table`：`{ cellPaddingBlock: 12, headerBg: COLORS["surface-muted"] }`（12+20 行高 ≈ 44）。
    - `adminTheme`：只设颜色四项、`borderRadius: 8`、`fontFamily`。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @saiflow/ui test && pnpm --filter @saiflow/ui lint`
Expected: PASS，4 个测试通过。

- [ ] **Step 5: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "[ui-restyle] packages/ui: STD-008 tokens, Tailwind theme, fonts, antd themes"
```

---

### Task 2: web-pc 与 admin 使用主题

**Files:**
- Modify:
  - `apps/web-pc/src/App.tsx`（`ConfigProvider`）、`apps/web-pc/src/main.tsx`；
  - `apps/web-pc/src/ocr/StageTag.tsx`、`apps/web-pc/src/pages/VerifyPage.tsx:326`；
  - `apps/web-pc/package.json`；
  - `apps/web-admin/src/App.tsx`、`apps/web-admin/src/main.tsx`、`apps/web-admin/package.json`。
- Create:
  - `apps/web-pc/src/ocr/stageTag.css`；
  - `apps/web-pc/src/styles/app.css`（引入令牌与字体，设置内容区留白 24px、数字等宽）；
  - `apps/web-pc/src/ocr/StageTag.test.tsx`、`apps/web-pc/src/theme.test.tsx`、`apps/web-admin/src/theme.test.tsx`。

**Interfaces:**
- Consumes: `pcTheme`、`adminTheme`、`@saiflow/ui/styles/tokens.css`、`@saiflow/ui/styles/fonts.css`（Task 1）。
- Produces:
  - `StageTag({ stage, level })` 输出 `<span class="stage-tag stage-tag--{tone}">`，tone ∈ `warning | danger | info | review | success`；
  - `ReturnedTag()` 输出 `stage-tag stage-tag--danger`，文字为 `t("ocr.returned")`。

- [ ] **Step 1: 写失败的测试**
  - `apps/web-pc/src/ocr/StageTag.test.tsx`：
    - `it.each([["OCR_PROCESSING","warning"],["TEMPLATE_MATCHING","warning"],["OCR_FAILED","danger"],["VERIFYING","info"],["PENDING_REVIEW","review"],["CONFIRMED","success"]])`：渲染后断言 `toHaveClass("stage-tag--"+tone)`，且文字为对应的 i18n 文字（FR-SYS-133）；
    - `ReturnedTag`：断言有 `stage-tag--danger` 类，文字为 `Returned`（英文）。
  - `apps/web-pc/src/theme.test.tsx`：
    - 用 `test/render.tsx` 渲染一个路由内的探针组件，调用 `theme.useToken()`；
    - 断言 `token.colorPrimary === "#4A66F7"`、`token.controlHeight === 36`、`token.fontFamily` 包含 `"IBM Plex Sans"`。
  - `apps/web-admin/src/theme.test.tsx`：同样的探针，断言 `colorPrimary === "#4A66F7"`、`borderRadius === 8`。

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @saiflow/web-pc test -- StageTag theme && pnpm --filter @saiflow/web-admin test -- theme`
Expected: FAIL。class 不对，`colorPrimary` 为 antd 默认的 `#1677ff`。

- [ ] **Step 3: 实现**
  - `ConfigProvider` 加 `theme={pcTheme}` 或 `theme={adminTheme}`，保留 `locale` 与 `button` 属性。
  - `main.tsx` 引入 `@saiflow/ui/styles/fonts.css`、`@saiflow/ui/styles/tokens.css` 与 `./styles/app.css`。
  - `StageTag`：
    - 改成自己的 `<span>`，不再用 antd `Tag` 的 color；
    - `stageTag.css` 中 `.stage-tag--x { background: var(--x-bg); color: var(--x-text); }`；
    - 胶囊样式：圆角 999px、13px/20px、字重 500、`white-space: nowrap`。
  - `VerifyPage`：第 326 行的 antd `Tag color="red"` 改为 `ReturnedTag`。
  - `app.css`：
    - `body { background: var(--bg); color: var(--text); font-family: var(--font-stack); }`；
    - `.num { font-variant-numeric: tabular-nums; }`；
    - 金额与数量列加 `align: "right"` 和 `className: "num"`：核验页与单据详情的明细表、单据库的页数列（FR-SYS-136-02）。

- [ ] **Step 4: 运行全部测试**

Run: `pnpm --filter @saiflow/web-pc test && pnpm --filter @saiflow/web-admin test && pnpm --filter @saiflow/web-pc build && pnpm --filter @saiflow/web-admin build`
Expected: 全部 PASS，构建成功。依赖 antd class 名的 6 个测试不受影响。

- [ ] **Step 5: Commit**

```bash
git add apps/web-pc apps/web-admin pnpm-lock.yaml
git commit -m "[ui-restyle] web-pc and admin: STD-008 antd theme, stage tag colours"
```

---

### Task 3: 小程序的基础组件

**Files:**
- Modify: `apps/line-mini/package.json`, `apps/line-mini/vite.config.ts`, `apps/line-mini/src/main.tsx`, `apps/line-mini/src/i18n/{en,th,zh}.ts`（只加 `common.clear`）
- Create: `apps/line-mini/src/styles/index.css`, `apps/line-mini/src/lib/cn.ts`, `apps/line-mini/src/components/ui/{button,input,sheet,dialogs,toast,tag,card,alert,list,empty-state,count-badge}.tsx`, `apps/line-mini/src/components/ui/ui.test.tsx`

**Interfaces:**
- Consumes: `@saiflow/ui/styles/{tokens,theme,fonts}.css`（Task 1）。
- Produces（Task 4 用这些替换 antd-mobile）：
  - `Button`：
    - 签名：`Button(props: ButtonHTMLAttributes & { variant?: "primary"|"secondary"|"outline"|"ghost"|"danger"; size?: "md"|"sm"; block?: boolean; loading?: boolean; asChild?: boolean })`；
    - 默认 variant 为 `"outline"`，对应 antd-mobile 的默认按钮；
    - `loading` 时 `disabled` 加 `aria-busy="true"`，同时显示转圈和原文字；
    - `sm` 对应 antd-mobile 的 `size="small"/"mini"`，高 36px，可点区域仍补到 44px（用 `before:` 伪元素扩大，FR-SYS-134）。
  - `Input`：
    - 签名：`Input(props: { id?: string; type?: string; value: string; onChange(value: string): void; clearable?: boolean; clearLabel?: string; placeholder?: string; ... })`；
    - 有值且 `clearable` 时显示清除按钮，`aria-label` 为 `clearLabel`。
  - `BottomSheet({ open, onClose, label, children, className? })`：
    - 基于 Radix Dialog，从底部弹出；
    - 点遮罩或按 Esc 调用 `onClose`；
    - 用 `label` 作为隐藏的 Dialog 标题。
  - `DialogHost()`，挂在 App 根部，配合以下函数：
    - `confirmDialog({ title, content?, confirmText, cancelText, danger? }): Promise<boolean>`；
    - `alertDialog({ content, confirmText }): Promise<void>`；
    - `closeAllDialogs(): void`。

    同一个确认框只 resolve 一次。
  - `AppToaster()`、`showToast(content: string): void`、`clearToasts(): void`：基于 sonner，位置 top-center，时长 2000ms。
  - `Tag({ tone: "primary"|"success"|"warning"|"review"|"danger"|"default", children })`。
  - `Card({ title?, extra?, children, className? })`。
  - `Alert({ tone: "info"|"warning"|"danger", children })`：替换 NoticeBar。
  - `ListGroup({ header?, children })`、`ListItem({ onClick?, description?, extra?, children })`：有 `onClick` 时渲染为 `<button>` 并显示右箭头。
  - `EmptyState({ status?: "empty"|"error"|"notFound"|"success"|"waiting", title, description?, children? })`：替换 ErrorBlock 与 Result。
  - `CountBadge({ count, children })`：`count>0` 时显示数字，大于 99 显示 `99+`，与 BellBadge 现有规则一致。

- [ ] **Step 1: 写失败的测试 `ui.test.tsx`**

```tsx
it("button loading keeps the label and blocks clicks", async () => {
  const onClick = vi.fn();
  render(<Button loading onClick={onClick}>Save</Button>);
  const b = screen.getByRole("button", { name: /Save/ });
  expect(b).toBeDisabled(); expect(b).toHaveAttribute("aria-busy", "true");
  await userEvent.click(b); expect(onClick).not.toHaveBeenCalled();
});
it("button wraps long labels (Review Focus 1)", () => {
  render(<Button>ยืนยันการส่งเอกสารทั้งหมดเพื่อตรวจสอบ</Button>);
  const b = screen.getByRole("button");
  expect(b.className).not.toMatch(/whitespace-nowrap|truncate|\bh-\d/);
  expect(b.className).toMatch(/min-h-11/);
});
it("confirm resolves true / false", async () => {
  render(<DialogHost />);
  const p = confirmDialog({ title: "Remove?", confirmText: "Confirm", cancelText: "Cancel" });
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  await expect(p).resolves.toBe(true);
  const q = confirmDialog({ title: "Remove?", confirmText: "Confirm", cancelText: "Cancel" });
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  await expect(q).resolves.toBe(false);
});
it("confirm resolves once (Review Focus 3)", async () => {
  render(<DialogHost />);
  const seen: boolean[] = [];
  void confirmDialog({ title: "T", confirmText: "Confirm", cancelText: "Cancel" }).then((v) => seen.push(v));
  const btn = await screen.findByRole("button", { name: "Confirm" });
  await userEvent.dblClick(btn);
  await waitFor(() => expect(seen).toEqual([true]));
});
it("confirm over an open sheet (Review Focus 2)", async () => {
  function Page() {
    const [open, setOpen] = useState(true); const [done, setDone] = useState(false);
    return (<>
      <BottomSheet open={open} onClose={() => setOpen(false)} label="Choose">
        <button onClick={async () => { if (await confirmDialog({ title: "Transfer?", confirmText: "Confirm", cancelText: "Cancel" })) { setOpen(false); setDone(true); } }}>Alice</button>
      </BottomSheet>{done && <p>transferred</p>}<DialogHost /></>);
  }
  render(<Page />);
  await userEvent.click(screen.getByRole("button", { name: "Alice" }));
  await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("transferred")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("sheet close restores pointer events (Review Focus 5)", async () => {
  function Page() { const [open, setOpen] = useState(true);
    return <BottomSheet open={open} onClose={() => setOpen(false)} label="L"><p>body</p></BottomSheet>; }
  render(<Page />);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
});
it("alert resolves on OK", async () => { /* alertDialog → click "OK" → resolves */ });
it("toast shows text", async () => { render(<AppToaster />); act(() => showToast("Copied")); expect(await screen.findByText("Copied")).toBeInTheDocument(); });
it("input clear button empties the value", async () => { /* clearable + clearLabel "Clear" → click → onChange("") */ });
it("count badge caps at 99+", () => { render(<CountBadge count={120}><span>bell</span></CountBadge>); expect(screen.getByText("99+")).toBeInTheDocument(); });
it("tag tone class", () => { render(<Tag tone="review">x</Tag>); expect(screen.getByText("x").className).toMatch(/bg-review-bg/); });
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @saiflow/line-mini test -- ui.test`
Expected: FAIL，无法解析 `./button` 等模块。

- [ ] **Step 3: 实现**
  - **依赖：** 安装 Tech Stack 里列出的包，并加上 `@saiflow/ui: workspace:*`；`vite.config.ts` 的 plugins 加 `tailwindcss()`。
  - **`src/styles/index.css`：**
    - `@import "tailwindcss"; @import "@saiflow/ui/styles/fonts.css"; @import "@saiflow/ui/styles/tokens.css"; @import "@saiflow/ui/styles/theme.css";`；
    - `:root { --radius-card: 14px; --radius-control: 10px; --control-h: 44px; }`；
    - `body { font-size: 15px; line-height: 24px; background: var(--bg); color: var(--text); font-family: var(--font-stack); }`；
    - `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }`。
  - **`main.tsx`：** 引入 `./styles/index.css`，放在 `app.css` 之前，让旧规则暂时优先。
  - **组件：** 按 shadcn/ui 的写法实现（cva + `cn`）。
    - Button：用 `min-h-11 px-4 whitespace-normal rounded-control`，不用固定的 `h-*`。
    - 确认框：用 Radix AlertDialog。`DialogHost` 订阅一个模块级队列；每次只显示队首，确认或取消时先把这一项移出队列再 resolve，保证只 resolve 一次。
    - 动效：`duration-150 ease-out`，加上 `motion-reduce:transition-none`、`motion-reduce:animate-none`。
  - **i18n：** 三种语言加 `common.clear`：en "Clear"、th "ล้าง"、zh "清除"。

- [ ] **Step 4: 运行，确认通过**

Run: `pnpm --filter @saiflow/line-mini test && pnpm --filter @saiflow/line-mini build`
Expected: 新测试全部通过，已有测试仍全部通过（页面还没有换组件），构建成功。

- [ ] **Step 5: Commit**

```bash
git add apps/line-mini pnpm-lock.yaml
git commit -m "[ui-restyle] line-mini: Tailwind + shadcn/ui base components"
```

---

### Task 4: 小程序页面去掉 antd-mobile

**Files:**
- Modify：引用 antd-mobile 的 22 个文件（`grep -rl antd-mobile apps/line-mini/src`），以及 `apps/line-mini/src/App.tsx`（挂 `DialogHost`、`AppToaster`）、`apps/line-mini/src/test/setup.ts`、`apps/line-mini/package.json`（删除 `antd-mobile`）。
- Create: `apps/line-mini/src/test/guards.test.ts`

**Interfaces:**
- Consumes: Task 3 的全部组件。
- 替换对照：

| antd-mobile | 替换为 |
|---|---|
| `Button color="primary"` | `Button variant="primary"` |
| `Button color="danger"` | `Button variant="danger"` |
| `Button fill="none"` | `Button variant="ghost"` |
| `Button size="small"` / `size="mini"` | `Button size="sm"` |
| `Button block` | `Button block` |
| `Popup` | `BottomSheet`，label 用面板的标题文字；没有标题的面板用打开它的按钮文字 |
| `Dialog.confirm` | `confirmDialog`（`utils/confirm.ts` 的签名不变；`MyPage` 改用 `confirmAction`） |
| `Dialog.alert` | `alertDialog` |
| `Toast.show({content})` | `showToast(content)` |
| `Tag color=x` | `Tag tone=x`（primary→primary，danger→danger，warning→warning，success→success，其他→default） |
| `Card title` | `Card title` |
| `NoticeBar` | `Alert` |
| `List` / `List.Item` | `ListGroup` / `ListItem` |
| `ErrorBlock` / `Result` | `EmptyState` |
| `Badge` | `CountBadge` |
| `Input clearable` | `Input clearable clearLabel={t("common.clear")}` |
| `Space wrap` | `<div className="flex flex-wrap gap-2">` |

- [ ] **Step 1: 写失败的测试 `apps/line-mini/src/test/guards.test.ts`**

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(n) ? [p] : []; });
}
it("no antd-mobile anywhere (ADR-010)", () => {
  const hits = files(SRC, /\.(ts|tsx)$/).filter((f) => !f.endsWith("guards.test.ts") && /antd-mobile/.test(readFileSync(f, "utf8")));
  expect(hits).toEqual([]);
  expect(readFileSync(join(SRC, "../package.json"), "utf8")).not.toMatch(/antd-mobile/);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @saiflow/line-mini test -- guards`
Expected: FAIL，列出 22 个文件。

- [ ] **Step 3: 按对照表逐个文件替换**
  - `test/setup.ts`：
    - 去掉 antd-mobile 的 import；
    - `afterEach` 改为 `closeAllDialogs(); clearToasts(); cleanup(); document.body.innerHTML = "";`；
    - 保留 matchMedia 与 pointer capture 的补丁，并补上 `ResizeObserver` 的空实现（sonner 需要）。
  - 测试只改查找方式，例如 antd-mobile 特有的结构或类名；断言不删、不放宽。每改一处测试，在 ledger 中记一条 Ruling。
  - `App.tsx`：在路由外挂 `<DialogHost />` 与 `<AppToaster />`。
  - `RegisterDialog`、`OrgPage` 的 Chooser、`RolesPage`、`ProfilePage`、`PlansPage`、`TenantSwitcher` 的 Popup，都改为 BottomSheet。面板内容与 `role="listbox"` 等属性不变。

- [ ] **Step 4: 运行全部测试**

Run: `pnpm --filter @saiflow/line-mini test && pnpm --filter @saiflow/line-mini lint && pnpm --filter @saiflow/line-mini build`
Expected: 全部 PASS，测试条数不少于变更前（记下前后条数）。构建成功，包里没有 antd-mobile。

- [ ] **Step 5: Commit**

```bash
git add apps/line-mini pnpm-lock.yaml
git commit -m "[ui-restyle] line-mini: replace antd-mobile with the shadcn/ui components"
```

---

### Task 5: 小程序样式改用令牌

**Files:**
- Modify:
  - `apps/line-mini/src/styles/app.css`；
  - `apps/line-mini/src/features/scan/theme.module.css`，以及 `features/scan/**/*.module.css`、`features/reviews/reviews.module.css`；
  - `apps/line-mini/src/components/{BrandLoading/brand.css,TabBar/tabbar.css,ErrorText/index.tsx}`；
  - `apps/line-mini/src/features/scan/components/StatusChip.tsx`、`StatusChip.module.css`；
  - 内联 SVG 写死色值的 TSX：`ScanHomePage`、`HistoryPage`、`ProcessingPage`、`JobListItem`。
- Test: `apps/line-mini/src/test/guards.test.ts`（追加）、`apps/line-mini/src/features/scan/parts.test.tsx`（追加 StatusChip）

**Interfaces:**
- Consumes：`tokens.css` 的变量名（Task 1）、`--radius-card`、`--radius-control`、`--control-h`（Task 3）。
- Produces：
  - StatusChip 的 tone 类：`processing→warning`、`failed→danger`、`verifying→info`、`review→review`、`completed→success`；
  - 被退回时另加一个 danger 的"已退回"标签（与 FR-SYS-133 一致）。

- [ ] **Step 1: 追加失败的测试**

```ts
it("no hard-coded colours in styles or components (FR-SYS-132)", () => {
  const hex = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;
  const hits = files(SRC, /\.(css|tsx)$/).filter((f) => !/\.test\.tsx$/.test(f) && hex.test(readFileSync(f, "utf8")));
  expect(hits).toEqual([]);
});
it("light only (FR-SYS-132-03)", () => {
  const all = files(SRC, /\.css$/).map((f) => readFileSync(f, "utf8")).join("\n");
  expect(all).not.toMatch(/prefers-color-scheme/);
});
it("main's light secondary grey is gone (FR-SYS-137)", () => {
  const all = files(SRC, /\.(css|tsx)$/).map((f) => readFileSync(f, "utf8")).join("\n");
  expect(all).not.toMatch(/--primary-light|--processing\b|--processing-bg/);
});
```

`parts.test.tsx` 追加以下测试：
- StatusChip 在 `PENDING_REVIEW` 时有 `review` 类，文字为"待一级复核"或"待二级复核"（按 level，用当前语言）；
- 被退回的单据另有一个 danger 标签，文字为 `t("scan.returned")` 或现有的对应键。

- [ ] **Step 2: 运行，确认失败**

Run: `pnpm --filter @saiflow/line-mini test -- guards parts`
Expected: FAIL，列出含色值的文件，StatusChip 缺少 review 类。

- [ ] **Step 3: 实现**
  - **`theme.module.css`：** 删除本地的颜色令牌，只保留页面框架；字体改为 `var(--font-stack)`。全部 CSS 模块中的旧变量名一一替换：

| 旧 | 新 |
|---|---|
| `--primary-light` | `--primary-soft` |
| `--processing` | `--warning-text`（文字）或 `--warning`（图形） |
| `--processing-bg` | `--warning-bg` |
| `--card` | `--surface` |
| `--success`（文字） | `--success-text` |
| `--danger`（文字） | `--danger-text` |
| `--text-secondary`（main 的 `#99A1B0`） | 正文说明用 `--text-secondary`，占位符与禁用用 `--text-tertiary` |

  - **写死的色值：** 改为对应的令牌，就近取色：`#fff`→`var(--surface)`，`#fdeaea`→`var(--danger-bg)`，`#1677ff`/`#1f5fbf`→`var(--primary)`/`var(--primary-pressed)`，`#666`/`#888`→`var(--text-secondary)`，`#e5e6eb`/`#f0f0f0`→`var(--border)`，`#d4380d`→`var(--danger-text)`。半透明的遮罩用 `rgb(23 26 28 / 0.45)`，不使用十六进制。
  - **SVG：** `stroke`/`fill` 改为 `currentColor` 或 `var(--primary)`/`var(--icon)`。
  - **圆角：** 卡片改为 `var(--radius-card)`，按钮与输入框改为 `var(--radius-control)`，胶囊保留 999px。
  - **可点区域：** 小于 44px 的改为 `min-height: var(--control-h)`，图标按钮至少 44×44（FR-SYS-134）。
  - **StatusChip：** 字号由 main 的 9px 改为 12px/18px（STD-008 caption），并加 review tone。
  - **BrandLoading：** 颜色改用 `var(--primary)` 与 `var(--primary-soft)`，动画与 reduced-motion 的行为不变（D5）。
  - **`text-overflow: ellipsis`：** 只保留在显示文件名的类上（JobListItem 文件名、HistoryPage 文件名、ScanHomePage 最近任务的文件名）。`PageHeader` 标题与 `app.css:173` 改为允许换行（FR-SYS-136）；先读规则所在的元素再决定，并记 Ruling。
  - **`app.css`：** 删除 body 的旧字体与背景（由 `index.css` 提供），颜色改用令牌。

- [ ] **Step 4: 运行全部测试**

Run: `pnpm --filter @saiflow/line-mini test && pnpm --filter @saiflow/line-mini lint && pnpm --filter @saiflow/line-mini build`
Expected: 全部 PASS，构建成功。

- [ ] **Step 5: 本机目测**
  - 用 `pnpm dev:line-mini` 加 Chrome 的设备模拟（320px 与 360px，泰语），打开扫描首页、确认页、结果页、组织页、套餐页；
  - 对照样稿 <https://claude.ai/artifact/V5v5R9Pk9ouFR5kbE7bvrG>；
  - 结果记入 ledger（看到什么、改了什么）。

- [ ] **Step 6: Commit**

```bash
git add apps/line-mini
git commit -m "[ui-restyle] line-mini: page styles on STD-008 tokens, status chip tones, tap targets"
```

---

### Task 6: 文档同步与整体检查

**Files:**
- Modify：
  - `docs/00-standards/React-Frontend-Structure.md`（第 23、59、62、76、88、157-158 行：小程序技术栈、`packages/ui` 的内容、主题写法）；
  - `docs/00-standards/Directory-Structure.md`；
  - `docs/30-design/Architecture.md`（第 25-27 行）；
  - `docs/00-standards/UI-Design-System.md`（§11 补 web-pc 的 antd 令牌，与 `pcTheme` 一致，升到 1.1.0）；
  - `docs/30-design/adr/ADR-006-ai-native-workflow.md`（第 125 行加"见 ADR-010"）；
  - `docs/00-standards/Document-Source-Guide.md`（`packages/ui/src/**` 一行加"设计令牌，见 STD-008"）；
  - `openspec/config.yaml`（前端技术栈）；
  - `packages/ui/README.md`。
  - 每份文档改版本号并加 Version History 一行。

- [ ] **Step 1: 改文档**：按上面的行号逐一修改，内容以 ADR-010 为准。

- [ ] **Step 2: 整体检查**

Run: `pnpm -r lint && pnpm -r test && pnpm -r build`
Expected: 全部通过。记录小程序构建产物中 JS 与 CSS 的大小（与 Task 3 之前相比），以及字体文件是否按 unicode-range 拆分。

Run: `grep -rn "fonts.googleapis\|fonts.gstatic" apps/*/dist`
Expected: 没有输出（AC-FR-SYS-132-02）。

- [ ] **Step 3: Commit**

```bash
git add docs openspec/config.yaml packages/ui/README.md
git commit -m "[ui-restyle] docs: STD-006, Architecture, STD-008 §11, ADR-006 note per ADR-010"
```

---

## 验收对照（写 verification.md 时用）

| AC | 证据 |
|---|---|
| AC-FR-SYS-132-01 | Task 1 的 antd 主题测试、Task 2 的 theme 测试、负责人对照样稿 |
| AC-FR-SYS-132-02 | Task 6 Step 2 的 grep，以及负责人在浏览器网络面板中查看 |
| AC-FR-SYS-132-03 | Task 1 的 `color-scheme` 断言、Task 5 的 light only 静态检查 |
| AC-FR-SYS-133-01/02 | Task 2 的 StageTag 测试、Task 5 的 StatusChip 测试 |
| AC-FR-SYS-134-01/02 | Task 3 的 `min-h-11`、Task 5 的可点区域与目测 |
| AC-FR-SYS-135-01/02 | Task 1、Task 2 的主题测试，负责人目测 |
| AC-FR-SYS-136-01/02 | Task 3 的换行测试、Task 5 目测（320px 泰语）、Task 2 的金额右对齐 |
| AC-FR-SYS-137-01/02/03 | Task 1 的对比度测试、Task 3 的 `focus-visible` 与 motion-reduce、BrandLoading 原有测试 |
| AC-FR-SYS-138-01/02 | Task 4 测试条数不减、Ruling 记录；负责人走一遍主流程 |
| AC-FR-SYS-118-01 | 负责人并排对照（布局与文字一致，只有样式不同） |
