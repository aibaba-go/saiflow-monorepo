# web-pc-account 验证记录

## 1. 自动化测试

- **web-pc（apps/web-pc）：** `pnpm test` **73 passed**（Vitest + React Testing Library）；`pnpm lint`、`pnpm build` 通过。
- **其他前端：** line-mini 142、web-admin 55、api-client 5，全部通过（2026-11-06，与 `ocr-scan-flow` 同一分支）。
- **后端：** `pytest -q` **735 passed**，ruff 无告警（本机 Docker PostgreSQL，`REQUIRE_INTEGRATION=1`）。部署后新增的 web-pc 独立登录频道由 `test_line_login.py` 的两条测试覆盖（§3）。
- **脚本与契约：** `scripts/tests/*.test.sh` 全部通过（compose 检查 78 项）；接口契约重新生成后与提交一致；`openspec validate web-pc-account` 通过。
- **CI：** 提交 `590020b` 的 CI 通过。

## 2. 验收标准 → 测试

下表的测试都在 `apps/web-pc/src/` 下。

| 需求 | 验收标准 | 测试 |
|---|---|---|
| FR-SYS-090 LINE 登录与会话 | 090-01～04 | `auth/auth.test.tsx`（授权码登录、`state` 校验、过期回到原页、使用中过期的提示） |
| FR-SYS-091 未注册用户 | 091-01～03 | `auth/auth.test.tsx`（引导到小程序注册，链接与二维码） |
| FR-SYS-092 退出登录 | 092-01～02 | `auth/auth.test.tsx` |
| FR-SYS-093 界面语言 | 093-01～03 | `stores/language.test.ts`、`i18n/i18n.test.ts` |
| FR-SYS-094 布局与首页 | 094-01～03 | `pages/shell.test.tsx` |
| FR-SYS-095 个人资料 | 095-01～03 | `pages/shell.test.tsx` |
| FR-SYS-096 租户切换 | 096-01～04 | `pages/shell.test.tsx` |
| FR-SYS-097 建组织申请 | 097-01～03 | `pages/orgs.test.tsx` |
| FR-SYS-098 组织资料与成员 | 098-01～04 | `pages/orgs.test.tsx`（含邀请链接与二维码） |
| FR-SYS-099 角色管理 | 099-01～02 | `pages/orgs.test.tsx` |
| FR-SYS-100 owner 转让与退出组织 | 100-01～02 | `pages/orgs.test.tsx` |
| FR-SYS-101 企业认证申请 | 101-01～02 | `pages/orgs.test.tsx` |
| FR-SYS-102 套餐、用量与续费申请 | 102-01～03 | `pages/billing.test.tsx` |
| FR-SYS-103 通知中心 | 103-01～02 | `pages/billing.test.tsx` |
| FR-SYS-104 等待、确认与错误反馈 | 104-01～04 | `components/ConfirmButton.test.tsx`、`services/errors.test.ts`、`pages/orgs.test.tsx` |

## 3. 部署后的调整：web-pc 用单独的 LINE Login 频道

实测前发现，小程序所在的频道 `2012285576`（tai-ocr）是 **LINE MINI App 频道**，没有 LINE Login 标签，无法登记网页登录的回调地址。负责人在同一个 Provider "SaiFlow" 下另建了 LINE Login 频道 `saiflow-web`（`2012428743`，App types 为 Web app，不要求两步验证）。同一个 Provider 下，用户的 LINE 身份 ID 相同，所以网页登录与小程序登录对应同一个账号。

- **后端（提交 `590020b`）：** 新增 `LINE_WEB_CHANNEL_ID`、`LINE_WEB_CHANNEL_SECRET`。web-pc 的授权码换取与身份核验改用这个频道；小程序的 LIFF 身份核验仍用 `LINE_CHANNEL_ID`。两项都不填时，web-pc 沿用原来的频道。测试：`test_web_login_uses_its_own_channel`、`test_web_client_built_from_settings`。
- **配置：** compose 与 `env.example` 增加两项；部署说明 §2.6 改写（v1.8.0）；GitHub 变量 `LINE_CHANNEL_ID` 填 web-pc 的频道 ID `2012428743`。

## 4. 部署与浏览器实测（2026-11-06）

| 部署 | 提交 | 说明 |
|---|---|---|
| Deploy 42204747236 | `017d0a4` | 与 `ocr-scan-flow` 一同发布；三个站点健康检查正常，5432 端口外部不可连 |
| Deploy 42214719310 | `590020b` | web-pc 独立登录频道；打包产物中含频道 ID `2012428743`；健康检查正常 |

负责人在电脑浏览器中实测（2026-11-06）：

| 项目 | 结果 |
|---|---|
| LINE 登录 | 通过：跳到 LINE 授权页，同意后回到 web-pc；是小程序里注册的同一个账号，能看到小程序中建立的两个组织，用户名一致。授权页没有显示频道名 `saiflow-web`（显示的是 Provider 的信息），不影响登录 |
| 退出登录 | 通过 |
| 未注册账号的引导 | **延后**：没有第二个 LINE 账号 |
| 界面语言 | 通过 |
| 切换租户 | 通过 |
| 个人资料 | 通过 |
| 建组织申请 | 通过 |
| 邀请链接与二维码 | 通过：在 LINE 中扫码能打开邀请页并点"接受邀请"；因为是同一个账号，显示"您已经在组织内了"。用第二个账号接受邀请延后 |
| 角色 | 通过：新建角色后显示的权限点与勾选的一致 |
| 套餐 | 通过：能查看套餐与价格，能提交开通申请 |
| 通知 | 通过：能打开通知中心（当时没有通知） |

## 5. 遗留事项

- **延后的实测：** 未注册账号的引导；用第二个 LINE 账号接受邀请。
- **延后的次要问题**（最终评审，未修）：
  - 回到 LINE 登录后的测试用的是重新加载页面，而不是同一个 QueryClient（与正式环境的整页加载一致）；
  - 邀请链接只显示一次，没复制就关掉对话框时，要撤销后重新邀请；
  - 没有角色管理权限的人直接打开 `/roles` 时，看到的是只读页面，而不是"无权限"；
  - 角色权限出错时显示通用文字（没有 `field.permissions` 文案）；
  - 企业认证卡片上，"Status:" 的冒号是写死的，没有跟随翻译。
- **LINE 频道：** `saiflow-web` 还处于 Developing 状态，只有管理员和测试人员能登录；给其他用户使用前，需要补隐私政策与使用条款链接并发布频道。
