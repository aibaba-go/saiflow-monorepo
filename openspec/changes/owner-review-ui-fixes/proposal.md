# Proposal：owner 全权复核与 2026-11-10 界面修正

## Why

负责人于 2026-11-10 提出 9 项问题，并要求"按照推荐的方式做，不用询问"：

1. 组织 owner 拥有全部操作权限，包括复核所有单据（含本人确认、本人已做一级复核的单据）；
2. / 4. 核验工作台、单据库（单据详情）的原件预览滚动后看不到，需要固定在可视区域；
3. 核验工作台的明细表单元格太小，需要可拖动的弹出框编辑；
5. 套餐页按钮没有对齐，需要美化；
6. 个人资料"更换邮箱"的输入框与按钮重叠；
7. 管理端"套餐申请"的操作按钮重叠；
8. LINE 小程序登录后无法退出；
9. LINE 小程序首页文字重叠；扫描后套餐剩余量没有减少。

第 9 项的"剩余量不减"经核对属于既定规则：FR-SYS-013 先用免费额度、不足部分再用当月配额，因此免费额度未用完时本月剩余不变。本变更只在界面上说明这一规则，不改变计量。

## What Changes

- 变更分级：M。修改既有 P0 行为与界面，无新实体、无迁移、无 API 契约变化（`block_reason` 字段保持原样，owner 时为 `null`）。
- `reviews`：FR-VERIFY-012 第 2 项检查改为"非 owner 适用"，owner 不受本人确认、本人已做一级复核的限制；AC-03 改为非 owner 的复核人，新增 AC-06。
- `web-pc`：
  - FR-SYS-124、FR-SYS-131：原件在页面滚动时固定在可视区域；
  - FR-SYS-129：同上；明细表显示行数并提供"展开编辑"，弹出框可按标题栏拖动，与页面编辑同一份草稿；嵌套对象显示为分组字段、行列表显示为表格，不显示 JSON 文本（AC-11、AC-12）；
  - FR-SYS-102：卡片等高、操作区底部对齐、当前档位突出；不能申请的档位显示原因文字代替按钮。
- `line-mini`：
  - FR-SYS-043：退出成功后提示"已退出登录"；在 LINE 内退出只结束 SaiFlow 会话，不注销 LINE 账号，再次登录可用；
  - FR-SYS-053：免费额度旁说明"优先于本月额度使用"；
  - FR-SYS-120：owner 不标"本人确认"等原因，可以通过或退回（AC-03 改为非 owner）。
- 纯样式修正（第 6、7 项与第 9 项的文字重叠）不改变行为，按 FR-SYS-095、FR-SYS-067、FR-SYS-109 与 FR-SYS-138"只改样子"处理，不另写 delta。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `reviews`：FR-VERIFY-012。
- `web-pc`：FR-SYS-102、FR-SYS-124、FR-SYS-129、FR-SYS-131。
- `line-mini`：FR-SYS-043、FR-SYS-053、FR-SYS-120。

## 归档顺序

- FR-SYS-129（web-pc）与 FR-SYS-120（line-mini）的正文以 `verify-template-custom-fields` 的 delta 为基础（包含额外表头字段的条款与 AC-06～10）。本变更 SHALL 在 `verify-template-custom-fields` 之后归档；若先归档本变更，将丢失对方的条款。
- 其余 requirement 目前没有其他未归档变更修改。

## Impact

- 后端：`services/api/app/services/review_service.py`（`block_reason`、`summary`）；集成测试 `tests/integration/test_reviews.py`。
- web-pc：`EditableResult.tsx`、`VerifyPage.tsx`、`DocumentPage.tsx`、`ReviewDetailPage.tsx`、`ReviewsPage.tsx`、`PlansPage.tsx`、`ProfilePage.tsx`、`EmailCodeButton.tsx`、`styles/app.css`、三语资源。
- web-admin：`ApplicationQueue.tsx`、`styles/app.css`。
- line-mini：`features/auth/session.ts`、`features/scan/ScanHomePage.tsx` 与 CSS、三语资源。

## Non-goals

- 不改变计量顺序（先免费额度、后月配额），不改变复核层级与 409 并发规则。
- 不改变权限点定义；owner 本来持有全部权限点，本变更只取消复核人冲突检查对 owner 的限制。
- 不为明细表弹出框增加列宽调整、保存位置等功能。
