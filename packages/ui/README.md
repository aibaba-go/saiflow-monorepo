# @saiflow/ui

SaiFlow 的设计令牌与主题，是 STD-008（`docs/00-standards/UI-Design-System.md`）取值的唯一来源（ADR-010 §4）。

- `src/tokens.ts`：颜色、字体栈、密度与对比度计算；
- `src/styles/tokens.css`：CSS 变量（与 `tokens.ts` 一致，有测试比对）；
- `src/styles/theme.css`：Tailwind v4 主题（LINE 小程序用）；应用自己设置 `--card-radius`、`--control-radius`、`--control-h`；
- `src/styles/fonts.css`：随应用打包的字体；
- `src/antdTheme.ts`：web-pc 与 admin 的 Ant Design 主题。
