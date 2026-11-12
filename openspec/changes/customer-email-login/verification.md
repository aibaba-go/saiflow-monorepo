# customer-email-login — 验证记录

## 授权与边界

负责人要求：注册增加密码与确认密码；登录支持 LINE、邮箱 + 密码、邮箱 + 验证码（仅已注册用户）；可通过邮箱验证码重置密码；小程序与 web-pc 同时提供。已确认的规则：密码 8–64 位且同时含字母和数字；未注册邮箱明确提示"该邮箱未注册"；连续错 5 次锁定 5 分钟；重置后其他会话全部失效；小程序弹出登录面板，LINE 为主按钮。

本地交付阶段**未提交、未推送、未部署**，没有任何生产操作。验证只在本机隔离环境进行：API `127.0.0.1:8010`（`saiflow_dev`），集成测试只连 `127.0.0.1:25432/saiflow_test_shard1–4`；没有连接 `38.60.156.234` 或 `81.68.72.120`，也没有调用付费 OCR。

## 自动化检查（2026-11-13）

| 检查 | 结果 |
|---|---|
| 后端 `ruff check` / `ruff format --check` | 通过 |
| 后端单元测试 | 589 passed |
| 后端集成测试（4 个分片，`REQUIRE_INTEGRATION=1`） | 721 passed（183 + 169 + 188 + 181） |
| web-pc vitest | 23 files，249 passed |
| line-mini vitest（含样式守卫 `guards.test.ts`） | 36 files，397 passed |
| web-admin vitest | 89 passed |
| packages/ui、packages/api-client vitest | 162 passed、5 passed |
| tsc `--noEmit`（web-pc、line-mini） | rc=0 |
| `pnpm -r lint` | 6 个项目全部通过 |
| `pnpm -r build` | web-pc、line-mini、web-admin 均构建成功 |

最后一轮前端检查是在两处样式修正之后重跑的：web-pc 登录页和重置页的主按钮改用统一渐变；小程序输入框去掉了重复的下划线。

## 浏览器检查（本机 API 8010）

| 端 | 检查内容 | 结果 |
|---|---|---|
| web-pc 登录 | 邮箱与密码格式校验；未注册邮箱 | 格式错误在字段下提示；未注册邮箱显示"该邮箱未注册，请先在 SaiFlow 的 LINE 小程序中注册。" |
| web-pc 验证码登录 | 切换到验证码标签并发送 | 标签切换正常；本机未配置 SMTP，显示"暂时无法发送邮件"（见下方限制） |
| web-pc 重置密码 | "忘记密码？"入口 | 打开 `/reset-password`，有邮箱、验证码、新密码、确认密码四个字段，以及"发送验证码"和"重置并登录"两个按钮 |
| 小程序登录面板 | 主按钮与标签 | LINE 是主按钮，下面是密码和验证码两个标签；未注册邮箱显示"该邮箱未注册。可以先用 LINE 登录后完成注册。" |
| 小程序重置面板 | 字段与按钮 | 有邮箱、验证码、新密码、确认密码四个字段，以及"发送验证码""重置并登录""返回登录" |

截图在 `temp/e2e/`：`pc-login.png`、`pc-login-unregistered.png`、`pc-login-code.png`、`pc-reset.png`、`mini-login.png`、`mini-login-unregistered.png`、`mini-reset.png`。

## 限制

- 本机开发环境没有配置 SMTP，发送验证码会先返回 503（"暂时无法发送邮件"），排在"是否已注册"检查之前。所以浏览器里没有真的收到验证码；验证码签发、校验、错误次数、锁定 5 分钟、重置后撤销其他会话，都由后端集成测试覆盖。上线前要确认生产环境的 SMTP 配置可用。
- LINE 原生环境里的登录面板没有在真机上检查。

## 测试数据清理

- 本轮集成测试使用的 `saiflow_test_shard1–4` 和 `saiflow_test_email` 数据库已删除。默认测试库 `saiflow_test_regression` 保留，测试夹具每次运行都会清空它。
- `saiflow_dev` 全库文本字段中检索不到 `saiflow-e2e`。最近两天 `email_codes` 没有新行，因为 SMTP 不可用，验证码在写入之前就被拒绝。用户表仍只有原来的 1 个开发用户，所以没有需要删除的记录。
- 截图工具的临时浏览器配置目录 `temp/shot/profile-*` 已删除；`temp/e2e/` 和 `temp/beautify/` 里的截图作为证据保留。
