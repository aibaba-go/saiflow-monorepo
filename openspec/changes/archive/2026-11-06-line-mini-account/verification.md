# line-mini-account 验证记录

## 1. 自动化测试

- **小程序（apps/line-mini）：** `pnpm test` **113 passed**（Vitest + React Testing Library），`pnpm lint`、`pnpm build` 通过。
  - 后端调用用 `src/test/mockApi.ts` 模拟；LIFF 用 `src/test/fakeLiff.ts` 模拟。
- **后端：** `uv run pytest -q` **465 passed**（本机 Docker PostgreSQL 18，`REQUIRE_INTEGRATION=1`，接口测试以应用账号运行）。
- **脚本与契约：** `scripts/tests/*.test.sh` 全部通过；shellcheck、actionlint 无告警；接口契约重新生成后与提交一致。
- **镜像：** 本机用 `--build-arg VITE_LIFF_ID=test-liff-123` 构建 line-mini 镜像，确认 ID 写入了打包后的代码。
- **CI：** 提交 `96abbb3` 的 CI 全部通过（backend、frontend、contract、scripts、stack）。

## 2. 验收标准 → 测试

下表的小程序测试在 `apps/line-mini/src/` 下，后端测试在 `services/api/tests/integration/` 下。

| 需求 | 验收标准 | 测试 |
|---|---|---|
| FR-SYS-040 启动与身份恢复 | 040-01～04 | `features/auth/auth.test.tsx`（boot：已有会话、成为游客、残留 LIFF 状态不登录、过期的登录意图、LIFF 超时重试、游客数量限制） |
| FR-SYS-041 LINE 登录 | 041-01～03 | `auth.test.tsx`（LINE 内登录、LINE 外跳转与意图、`entry=register`、失败仍为游客） |
| FR-SYS-042 注册 | 042-01～04 | `features/profile/profile.test.tsx`（预填与注册、60 秒倒计时、错误保留内容、关闭后需要时再出现、连点只提交一次） |
| FR-SYS-043 登出 | 043-01～03 | `auth.test.tsx`（退出、取消、失败锁定与重试、启动时先完成未完成的退出、锁定时收到 401）；`features/review-fixes.test.tsx`（退出过程中的 401） |
| FR-SYS-044 个人中心 | 044-01～03 | `profile.test.tsx` |
| FR-SYS-004 界面语言 | 004-01～03 | `i18n/i18n.test.ts`（三种语言的键一致、无空值、占位符一致）；`stores/language.test.ts`；`features/shell.test.tsx`（切换立即生效） |
| FR-SYS-046 租户切换 | 046-01～03 | `features/tenants/tenants.test.tsx`；`features/orgs/orgs.test.tsx`（无权限不显示按钮） |
| FR-SYS-047 建组织申请 | 047-01～04 | `orgs.test.tsx`（organization application） |
| FR-SYS-048 组织资料与成员 | 048-01～04 | `orgs.test.tsx`（organization page）；`review-fixes.test.tsx`（分享失败时保留链接）；后端 `test_organization_seats.py` |
| FR-SYS-049 角色管理 | 049-01～03 | `orgs.test.tsx`（roles） |
| FR-SYS-050 owner 转让与退出组织 | 050-01～02 | `orgs.test.tsx` |
| FR-SYS-051 企业认证申请 | 051-01～02 | `orgs.test.tsx` |
| FR-SYS-052 接受邀请 | 052-01～03 | `features/invite/invite.test.tsx`；`review-fixes.test.tsx`（旧的"加入"标记不会自动加入） |
| FR-SYS-053 套餐、用量与续费申请 | 053-01～05 | `features/billing/billing.test.tsx`；`shell.test.tsx`（用量卡片） |
| FR-SYS-054 通知中心 | 054-01～04 | `features/notifications/notifications.test.tsx` |
| FR-SYS-055 等待与错误反馈 | 055-01～04 | `hooks/useSubmit.test.tsx`、`services/errors.test.ts`、`services/api.test.ts`、`profile.test.tsx`（字段错误）、`auth.test.tsx`（会话失效） |
| FR-SYS-056 底部导航 | 056-01～04 | `features/tenants/reportTab.test.ts`、`shell.test.tsx`（含 LIFF 网址片段的情况） |
| FR-SYS-030（修改）套餐目录与价格 | 030-01、06～08 | 后端 `test_billing_prices.py`；030-02～05 仍由 `test_billing_plans.py` 等覆盖 |
| FR-SYS-024（修改）查看邀请 | 024-08、09 | 后端 `test_invitation_preview.py` |

## 3. 部署与手机实测（2026-11-05～06）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42031498174 | `7308ef6` | 首次部署 B-5a；LIFF ID 为旧值 `2011688528-…` |
| Deploy 42042960531 | `7308ef6` | GitHub 变量 `LIFF_ID` 改为 Developing 版本的 `2012285576-KbzpK5mY` 后重新打包 |
| Deploy 42049059428 | `96abbb3` | 修复：LINE 内打开时底部导航不显示 |

外网检查：
- 健康检查正常；
- 游客可以查看套餐目录，价格正确；
- 用无效凭据查看邀请返回 410；
- 线上小程序打包后的代码里是新的 LIFF ID。

负责人在 LINE 内实测（`https://liff.line.me/2012285576-KbzpK5mY`）：

| 项目 | 结果 |
|---|---|
| 1. 首次打开为英文游客界面，底部有 Home / History / My | 第一次失败：底部导航不显示。原因是 LIFF 把令牌放在网址 `#` 后面，被路由当成未知页面。修复为未知路径回到首页（`96abbb3`，加了复现测试）后通过 |
| 2. LINE 登录与注册 | 第一次显示 "LINE login failed"。原因是服务器 `.env` 的 `LINE_CHANNEL_ID` 是旧频道，负责人改为新频道 `2012285576` 并重启后端后，登录、注册通过 |
| 3. 切换语言 | 通过 |
| 4. 建组织申请，admin 用接口批准，切换到新组织 | 通过 |
| 5. 邀请成员（第二个 LINE 账号） | **延后**（负责人 2026-11-06） |
| 6. 套餐页价格与申请 | 通过 |
| 7. 通知中心 | 通过 |
| LINE OA 底部菜单的 `register` 入口 | **延后**：菜单暂时仍指向旧版应用，负责人以后修改 |

## 4. 最终审查

独立审查员检查了整个分支：0 Critical、3 Important、8 Minor。

### 已修复（每项都先复现失败，修复后通过）

1. 在组织里退出登录时，后台请求的 401 会再建一个游客身份，并误报"登录已过期"。
2. 之前未完成的"加入"标记，会在打开另一个邀请链接时自动加入用户没看过的组织。
3. 分享失败或取消时，邀请链接丢失，而这条邀请仍占一个名额。

### 暂不处理的 Minor

- 游客点"加入"，以及撤销邀请、移除成员、转让、退出组织、删除角色这些先确认后执行的操作，快速连点可能发出两次请求。
- 游客进入只有登录用户才能看的页面（如按返回键回到建组织申请页）时，会提示"登录已过期"并回到首页。
- 修改资料后刷新身份时如果正好登录过期，会静默变成游客，旧数据仍显示；建组织申请页的一处刷新失败时没有处理。
- 已退出的组织的通知，所属租户显示为"个人账户"。
- 后台价格输入接受泰文数字和末尾的换行。
- 构建时没有 LIFF ID 时，邀请链接是坏的。
- 游客身份过期时也提示"请重新登录"。

### 实施中做出的判断

记录在执行台账中，共 25 条，要点：
- 登录意图 5 分钟后作废；
- 必填项先在小程序里检查，不发请求；
- 字段错误显示在输入框下；
- 不可用的组织回到个人账户；
- 邀请分享失败时改为复制或显示链接；
- 申请套餐先选周期再确认；
- 通知用"加载更多"按钮；
- 游客点"加入"后，登录注册完成即自动加入（只限点过的那条邀请）；
- 组织信息增加"已用人数 / 人数上限"（FR-SYS-048 需要，属本 change 增加的后端字段）；
- 三个前端镜像都传入 LIFF ID 构建参数；
- 底部导航用自己写的组件。

## 5. 未覆盖

- 第 5 项邀请成员、LINE OA `register` 入口的实机测试：延后，由负责人安排。
- 上传、识别、核验、历史、报表的页面：B-5d 及以后。
- admin 后台（B-5b）、web-pc（B-5c）。
