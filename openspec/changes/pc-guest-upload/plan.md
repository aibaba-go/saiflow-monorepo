# pc-guest-upload — 实施计划

## 1. 输入与范围

输入：[proposal](proposal.md)、[web-pc delta spec](specs/web-pc/spec.md)。用户已确认：游客可用"首页+上传+核验"；游客确认时先保存草稿，登录（及注册）后自动确认。只改 `apps/web-pc`，按 TDD 推进。

## 2. 已核实的实现与决策

- 后端：`POST /api/v1/auth/guest` 建立游客会话（已有会话时返回当前身份）；任何登录方式都会归集游客租户（FR-SYS-010）。游客可用 `/ocr/jobs*`、`/uploads*`、`/files/*`、`/billing/usage`、结果读取与草稿保存；`/me/tenants`、`/me/notifications`、确认（401）只对已登录用户开放。后端不改。
- 身份：`ME_KEY` 缓存改为保存任一身份（用户或游客）。`useMe()` 仍只返回用户（`select`），已有页面与 `RequireUser` 的行为不变；新增 `useIdentity()` 返回包括游客在内的身份。
- 路由：`RequireVisitor` 包住整个应用区，其下只有一个 `AppLayout`（游客页与用户页之间切换时布局不重新挂载）；`/`、`/upload`、`/verify`、`/verify/:id` 直接在布局下，其余页面再由 `RequireUser` 保护。`RequireVisitor`：用户按原规则（未注册去注册引导）；游客放行（其余页面由 `RequireUser` 转登录页）；没有会话时，在游客页且不是刚因用户会话失效则 `POST /auth/guest` 后放行，否则去登录页。
- 租户：游客的当前租户是它自己的租户，沿用 `resolveTenant` 已有的回退（`kind: "personal"`、`is_owner: true`；`UsableTenantOut.kind` 只有 personal/organization）；`useTenant` 改用 `useIdentity`；游客不请求 `/me/tenants`，`AppLayout` 不等待租户列表。
- 布局：游客菜单只保留 home/upload/verify；顶部栏去掉租户切换、通知、昵称与退出，改为"登录"按钮（`/login?next=当前页`）。
- 会话失效：`SessionWatcher` 区分游客与用户。游客 401：清除缓存，不设"登录已过期"，提示 `err.guest_expired`，守卫随即建立新游客会话；用户 401 保持原行为。
- 确认：`ocr/confirmAfterLogin.ts` 以 `sessionStorage` 键 `saiflow.confirm-after-login.<jobId>` 记住待确认（同 line-mini）。游客点"确认"：有修改先保存草稿，记住，跳到 `/login?next=/verify/<id>`。登录后 `AppLayout` 绑定用户时若有待确认则当前租户切到个人租户；`Workspace` 在已注册用户、结果已载入且有标记时先清除标记再确认一次。

## 3. 执行步骤与验收映射

### P1 — 先写失败的测试

- [x] `pages/guest.test.tsx`：无会话打开 `/` 与 `/upload` 建立游客会话，菜单只有三项、有"登录"按钮、没有租户/通知/昵称，不请求 `/me/tenants`、`/me/notifications`（AC-FR-SYS-090-08）；游客打开 `/library` 显示登录页（090-09）；游客 401 时建立新游客会话并提示（090-10）；用户会话失效后打开 `/` 去登录页（090-11）。
- [x] 游客在核验页修改后点"确认"：先 PATCH 草稿（`confirm: false`），不请求确认，进入登录页并带 `next=/verify/A`；登录后回到 A 自动确认一次并提示"已确认"（AC-FR-SYS-129-14）；未注册用户先看到注册引导，点"我已完成注册"后自动确认（129-15）；自动确认缺少必填字段时标红且不再自动确认（129-16）。
- [ ] 运行确认新测试失败，已有测试仍通过。（未单独记录红灯运行：测试写成时本机尚未装好 pnpm；实现后新测试与已有测试全部通过，见 verification.md。）

### P2 — 实现

- [x] `auth/session.ts`：`fetchIdentity`、`useIdentity`、`useMe` 的 `select`。
- [x] `auth/RequireVisitor.tsx`、`App.tsx` 路由分组与 `SessionWatcher`。
- [x] `tenants/useTenant.ts`：游客租户（`useCurrentTenant.ts` 的回退已满足，未改）。
- [x] `layout/AppLayout.tsx`：游客菜单与顶部栏、租户加载、待确认时切到个人租户。
- [x] `ocr/confirmAfterLogin.ts`、`pages/VerifyPage.tsx`：游客确认与自动确认。
- [x] 三语资源：`layout.login`、`err.guest_expired`。

### P3 — 验证

- [x] `pnpm -r lint`、`pnpm -r test`、`pnpm -r build`。
- [ ] 本地开发服务器浏览器验证：游客上传→核验→确认→登录→自动确认；游客打开单据库；已登录用户菜单不变。（已做：游客首页/上传页与菜单、游客打开单据库；未做：需要真实 OCR 的确认流程与已登录用户菜单，见 verification.md。）
- [x] 结果写入 [verification.md](verification.md)。

### P4 — 收尾、提交与发布

- [ ] 只提交本 change 与 web-pc 相关文件，推送 `chore/ai-workflow-v2`，等待 CI 通过后触发 Deploy，检查三个站点的健康检查与版本，并把证据补入 verification.md。

## 4. 确认点

- 范围与交互已确认（见 §1）；实施到发布已获授权（"全部完成后测试完，提交并发布"）。
