# Plan：owner-review-ui-fixes

负责人 2026-11-10 授权"按照推荐的方式做，不用询问"。每项都对应 delta 中的 requirement；纯样式项对应既有 requirement，不改变行为。

| # | 问题 | 方案 | 追溯 | 文件 |
|---|---|---|---|---|
| 1 | owner 不能复核本人确认的单据 | `block_reason` 对 owner 返回 `None`；`summary` 对 owner 不过滤确认人与一级复核人；`decide` 沿用 `block_reason` | FR-VERIFY-012、FR-SYS-120、FR-SYS-123/124 | `services/api/app/services/review_service.py`；`tests/integration/test_reviews.py` |
| 2/4 | 原件随页面滚出 | 原件外层 `.pc-sticky-original`：`position: sticky; top: 88px`，查看器高度 `calc(100dvh - 104px)` | FR-SYS-129、FR-SYS-124、FR-SYS-131 | `VerifyPage.tsx`、`DocumentPage.tsx`、`ReviewDetailPage.tsx`、`styles/app.css` |
| 3 | 明细表格子太小 | 表头显示行数与"展开编辑"；AntD Modal（`modalRender` + 标题栏 pointer 拖动 `translate`）中显示宽表，编辑同一份草稿；"新增行""完成"；嵌套对象为 fieldset，行列表为表格 | FR-SYS-129 AC-11、AC-12 | `ocr/EditableResult.tsx`、`ocr/ocr.test.tsx`、三语资源 |
| 5 | 套餐页按钮不齐 | 改为 CSS grid 卡片：顶部色条、角标"当前"、徽标、价格区固定高度、特性列表 `flex: 1`、操作区 `margin-top: auto` 等高；不能申请时显示原因文字 | FR-SYS-102 | `PlansPage.tsx`、`billing.test.tsx`、`styles/app.css`、三语资源 |
| 6 | 更换邮箱输入框与按钮重叠 | `.pc-email-row` flex：输入框 `flex: 1; min-width: 0`，发送验证码按钮不收缩；取消与确认右对齐 | FR-SYS-095（仅样式） | `ProfilePage.tsx`、`EmailCodeButton.tsx`、`styles/app.css` |
| 7 | 管理端套餐申请按钮重叠 | 操作列 `fixed: right; width: 176`，按钮 `nowrap`；标签面板去掉多余间距 | FR-SYS-067（仅样式） | `web-admin/src/components/ApplicationQueue.tsx`、`styles/app.css` |
| 8 | LINE 内退出后无法再登录 | LINE 内不调用 `liff.logout()`（LIFF 浏览器没有可回来的 `liff.login()`）；LINE 内"登录"改为重新载入，由启动流程按意图完成登录；退出后提示 | FR-SYS-043 | `line-mini/src/features/auth/session.ts`、`auth.test.tsx`、三语资源 |
| 9a | 首页文字重叠 | 欢迎语移到标题前、改为普通文档流 | FR-SYS-109（仅样式） | `ScanHomePage.tsx`、`ScanHomePage.module.css` |
| 9b | 扫描后剩余不减 | 计量规则不变（FR-SYS-013 先用免费额度）；免费额度旁说明"优先于本月额度使用" | FR-SYS-053 | `ScanHomePage.tsx`、三语资源 |

验证：后端复核集成测试；三端全量 vitest；`pnpm -r lint`、tsc 与 build；浏览器在固定尺寸 iframe 中测量套餐卡片、邮箱行与小程序首页。结果写入 `verification.md`。
