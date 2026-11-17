# Proposal

## Why

LINE 小程序的访客不登录也能上传、识别和核验，只有在确认提交时才要求登录或注册。web-pc 目前一打开就要求登录（FR-SYS-090 "SHALL NOT 提供游客试用"），两端体验不一致，PC 访客在看到识别效果前就被挡住。用户要求 PC 与移动端保持一致：未登录也能上传文件或图片进行 OCR 识别，点击"确认"时才判断是否登录并触发登录或注册。

后端已经支持游客会话与登录后的数据归集（[FR-SYS-010](../../specs/identity/spec.md)），游客可以使用上传、识别、结果读取与草稿保存；确认、通知、租户列表等只对已登录用户开放。本次只改 web-pc 前端与其规格。

## What Changes

- 游客可使用"首页""上传""核验"三页：打开这三页时没有会话，web-pc 自动建立游客会话，不显示登录页。其他页面仍要求登录。
- 游客的菜单只显示首页、上传、核验；顶部栏不显示当前租户、通知与用户昵称，改为显示语言与"登录"按钮。
- 游客在核验页点"确认"：先把修改保存为草稿，记住本任务待确认，再打开登录页；登录（未注册用户先完成注册引导）后回到本任务并自动确认一次。游客的文件与任务在登录时归入该用户的个人租户（FR-SYS-010）。
- 已登录用户会话失效后打开这三页仍显示登录页并提示"登录已过期"，不自动变为游客；游客会话失效时建立新的游客会话并提示。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-pc`：修改 FR-SYS-090（游客可用的页面、游客的菜单与顶部栏、游客会话失效）与 FR-SYS-129（游客确认时先保存草稿、登录后自动确认）。FR-SYS-090 以 `customer-email-login` 的最新文本为基础，FR-SYS-129 以 `owner-review-ui-fixes` 的最新文本为基础。

## Impact

涉及 `apps/web-pc/src/App.tsx`、`auth/session.ts`、新增的游客路由守卫与待确认标记、`layout/AppLayout.tsx`、`tenants/useCurrentTenant.ts`、`tenants/useTenant.ts`、`pages/VerifyPage.tsx`、三语资源与对应测试。

不新增接口、实体、数据库迁移或前端依赖；后端游客权限不变。主规格 `openspec/specs/web-pc/spec.md` 的 Purpose 仍写着"没有游客"，归档时一并更正。

## 非目标（Non-goals）

- 不向游客开放单据库、复核、组织、模板、报表、套餐、通知、个人资料等其他页面，不改变后端对游客的接口限制。
- 不改变 LINE 小程序的游客流程，不改变已登录用户的菜单、权限与租户切换。
- 不在 web-pc 中提供注册表单：未注册用户仍按 FR-SYS-091 到 LINE 小程序注册。
- 术语遵循 [Glossary](../../../docs/10-product/Glossary.md)。
