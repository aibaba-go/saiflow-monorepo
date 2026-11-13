# Verification：line-register-prefill

## 本地验证（2026-11-13）

- 后端 `services/api`：`ruff check`、`ruff format --check` 通过；单元测试 590 passed（含 `test_verify_reads_phone_number_when_line_shares_it`）。
- 集成测试全量 724 passed（4 个分片，库 `saiflow_test_shard1..4`，127.0.0.1:25432，`DB_APP_USER=saiflow_v3_app`），包括：
  - AC-FR-SYS-014-08：`test_line_phone_prefills_registration`（未注册用户登录取 LINE 手机号；之后 token 不带手机号时保留原值）。
  - AC-FR-SYS-014-06：`test_line_phone_never_replaces_a_registered_phone`。
  - FR-SYS-001 诊断日志：`test_login_logs_only_which_claims_line_shared`，日志只有 `line_login_claims email=True phone=True registered=False`，不含邮箱、手机号或 LINE 用户 ID。
- line-mini：vitest 400 passed（含 AC-FR-SYS-014-08 注册表单预填手机号且可修改），eslint、tsc、`vite build` 通过。
- `openspec validate line-register-prefill --strict` 通过。

## 同批 S 级小修（不改变 SHALL）

- 套餐页（FR-SYS-053）顶部加"返回首页"链接：套餐页没有底部标签栏，且常由链接直接打开。加载失败时也显示该链接。测试 `links back to home`；本地 dev（localhost:5173）核对：链接 138×40 位于左上，点击回到 `#/`。

## CI、部署与生产核验（2026-11-13）

- 业务提交 `0131856`（注册预填与诊断日志）与 `3bb9db3165cac7acead120317b0398bf5e67d65d`（套餐页返回首页与本地验证），已推送并经 `git ls-remote` 确认远端为 `3bb9db3…`。CI run `43347711471` 对该 SHA 结论 success。
- 手动触发标准 Deploy run `43348607899`（workflow_dispatch，SHA 精确一致），结论 success（`temp/deploy-43348607899.log`）：迁移前备份 `saiflow-20261113T020042Z.dump`（257435 bytes）已上传 `gs://saiflow-db-backup/`；本次无新迁移；`remote-deploy: done (3bb9db3…)`；三站健康与数据库端口外部关闭步骤通过。未改 GitHub 变量、LIFF 或频道配置。
- 发布后只读核验（02:02:37 UTC，`temp/line-register-prefill/production-check.json`，passed）：三站健康接口 HTTP 200、`status=ok`、`database=ok`、版本均为 `3bb9db3…`；LINE 站首页脚本 `/assets/index-SMNbSy8I.js` 含 `Back to home` / `返回首页` / `กลับหน้าหลัก` 与样式类 `back-home`。
- 限制：未在原生 LINE 内实际登录，`line_login_claims` 生产日志与真实 LINE 手机号下发仍待下节确认。

## 上线后待确认

- 生产 API 日志中 `line_login_claims` 的 `email` / `phone` 取值，判断 LINE 是否下发邮箱与手机号（见 plan「上线后排查」）。

## 后续 S 级修复：未注册用户分流与 LINE 授权重试（2026-11-13，未提交、未发布）

本节仅记录上一批发布后的本地修复，不代表线上版本已更新。不新增接口、实体或迁移，不改变既有 SHALL。

- 只读生产证据：`temp/xlsx-share/line-login-logs.json` 中，02:17:41、02:18:03 UTC 的 `POST /api/v1/auth/line` 返回 401；02:34:29 的 LINE 登录返回 200，之后注册验证码发送返回 204、注册返回 200。不能据此认定为同一账号，也不能确定被拒绝令牌的具体原因。公开 LIFF 所属频道与当前后端频道 ID 一致；未打印 token、secret 或个人信息，未改变生产配置或业务记录。
- FR-SYS-041/042：服务端已验证但未注册的用户，打开登录入口或 OA 注册入口时直接显示注册表单，不重复请求 LINE 登录；LINE 登录成功后清除登录面板与旧错误，依据服务端注册状态显示注册。LINE 校验失败仍保留错误，不将 401 当作注册身份或绕过校验。
- AC-FR-SYS-041-03：只有用户明确重试 `line_token_invalid` / `line_token_required` 时才重新授权。真实 SDK 先清除授权缓存；原生 LINE 经正式 LIFF URL 重新进入，外部浏览器重新启动 OAuth。保留返回页面与待确认标记；再次失败仍可重试，不自动形成跳转循环。`auth.test.tsx` 与 `services/liff.test.ts` 覆盖分流、重试、返回意图消费及适配器调用顺序。
- FR-SYS-106：`final.test.tsx` 的完整 DOM 回归覆盖「编辑核验结果 → 保存未确认草稿 → LINE 登录 → 未注册显示注册 → 完成注册 → 自动确认草稿 → Final result」。注册前不确认，返回时仍使用编辑后的数据；测试只使用模拟 API，不发送真实注册邮件或触发 OCR。
- 最终本地验证：line-mini 全量 vitest **37 个文件、410 项测试通过**（`temp/line-register-prefill/register-flow-full-verified.log`）；eslint、`tsc --noEmit`、Vite 构建通过（`temp/line-register-prefill/register-flow-build.log`，构建产物置于 `temp/line-register-prefill/register-flow-build/`）；`git diff --check` 通过。
- 限制：原生 LINE 清除 SDK 授权后重新进入、实际令牌刷新及同窗口返回意图保存，仅完成源码/官方文档核对和适配器模拟测试，尚未进行 iPhone 真机验证。本次没有提交、推送或部署；此前已有的部署脚本改动不属于此修复。

## 后续 S 级修复发布核验（2026-11-13）

本节更新上述本地修复的发布状态。用户明确要求「提交并发布」，授权限定本次注册分流、授权重试和草稿续确认修复。

- 业务提交 `fa0e3fc4d3acc02cb2d708018a113144ae8956af` 已推送至 `chore/ai-workflow-v2`，仅包含本次 7 个文件；未提交工作区已有的部署脚本、`.qoder/`、用户手册或 `temp/`。
- [CI run 43422257181](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43422257181) 对精确 SHA 结论 success：backend、frontend、contract、scripts、stack 全通过。后端 1314 项；前端 api-client 5、ui 162、line-mini 410、web-admin 89、web-pc 249 项测试通过；lint、构建、接口生成一致性、隔离栈及备份恢复演练通过。日志：`temp/line-register-prefill/register-fix-ci-43422257181.log`。
- CI 成功且远端分支仍为该 SHA 后，触发标准 [Deploy run 43423290149](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43423290149)（workflow_dispatch），精确 SHA 一致、结论 success。迁移前备份 `saiflow-20261113T121705Z.dump`（256531 bytes）已上传 `gs://saiflow-db-backup/`；本次无新迁移。日志包含 `remote-deploy: done (fa0e3fc…)`；三站健康及数据库端口外部关闭步骤通过。证据：`temp/line-register-prefill/register-fix-deploy-43423290149.json`、同名 `.log`。
- 发布后只读核验（12:18:27 UTC）：三站健康均 HTTP 200、`status=ok`、`database=ok`、版本为完整 `fa0e3fc…`；LINE 首页及引用资源可读取，新脚本 `/assets/index-CPO6ULXA.js` 含 `reauthorize`、正式 LIFF URL、两种 token 错误码及待确认标记。`temp/line-register-prefill/register-fix-production-check.json` 结论 passed。只请求健康接口和静态资源，未创建 guest、注册账号、发送验证码、触发 OCR 或再次清理业务数据；未修改 GitHub 变量、LIFF 或频道配置。
- 验证边界：本次发布与资源核验不能代替原生 LINE 验收；iPhone 实际未注册分流、重新授权、返回意图保留及注册后续确认仍需用户实机测试。此证据后续仅作独立文档提交，不重新部署文档 SHA。

## 后续 S 级修复：注册后确认完成但停留核验页（2026-11-13）

范围：用户反馈注册后 Continue 长时间等待、页面不变但后台已处理，并明确要求定向清理其测试账号后提交发布。遵循 FR-SYS-106/107、FR-VERIFY-006/009/015；不新增接口、实体、迁移，不改变确认门控或既有 SHALL。

- 只读生产证据（`temp/line-confirm-resume-20261113/production-evidence.json`）：12:25:21 UTC 注册返回 200；12:25:24 首次确认 PATCH 返回 200、33ms，数据库已 CONFIRMED；12:26:10 再次 PATCH 返回 409、15ms。首次确认后未立即出现对应 job/result GET，12:26:52 才再读。可确认后端已完成，不能确认原生客户端为何未收到/应用响应；没有原生 JS 错误或响应交付证据。同租户 claim 与异租户 merge 的完整注册测试均通过，未将缓存清理推断为已证实根因。
- 失败回归先行：`recovery-red.log` 为 4 failed / 22 passed，分别复现确认响应丢失、重复确认 `result_confirmed` 未进入最终页、无响应无限等待，以及前缀缓存写入污染其他任务/租户。
- 修复：草稿与确认请求每次最多等待 10 秒（覆盖 fetch 和响应体解析），超时取消本地等待不代表服务器未提交。确认网络错误/超时或 `result_confirmed` 时，仅进行一次同任务只读 GET（也限 10 秒）；只有服务端返回 `confirmed=true` 才进入最终页，待复核保留提交提示。不自动重放 PATCH，不自动确认冲突版本；套餐、权限、必填与注册门控不变。草稿响应不确定时保留编辑并显示错误，不擅自继续确认。
- 并发与缓存：自动续确认/手动点击共用同步防重入，保存到确认全程保持 busy；模板处理结束后仍可自动续确认。只更新精确 tenant/job 的结果缓存，取消迟到 GET；迟到草稿不能覆盖更高版本或已锁定缓存。身份、租户或页面变化后不应用旧响应，草稿/确认/恢复读取的迟到 401 不对新身份触发恢复。
- 审查：首轮指出草稿未限时、迟到草稿覆盖缓存、busy 时提前消费自动确认、迟到 401 副作用，已补修复及对应测试。第二轮完整只读复核未发现阻止发布的问题。
- 本地第一轮全量：37 个文件 / 423 项通过（`line-mini-full.log`）。审查补充回归后的最终全量：**37 个文件 / 427 项全部通过**，耗时 216.75 秒（`temp/line-confirm-resume-20261113/line-mini-final-full.log`）；eslint、`tsc --noEmit`、Vite 构建及 `git diff --check` 通过，最终构建产物位于 `temp/line-confirm-resume-20261113/build/`。`openspec validate line-register-prefill --strict` 通过。全部 API 测试均为模拟，不发送真实验证码或触发 OCR。

### 第二次指定测试账号重置

- 重新盘点目标为新注册 user 4 / 个人租户 95，无组织成员关系；未重放首次 user 3 / tenant 91 的清理。独立证据目录：`temp/account-reset-20261113-second/`。
- 删除范围为 13 张表共 36 行：会话 3、验证码 1、导出 1、文件 5、免费额度 1、OCR 任务 4、原始结果 4、修改记录 1、结果版本 9、套餐 1、模板转换 4、个人租户 1、用户 1。5 个文件曾经游客租户迁移，按当前专属文件的精确 storage_path 选对象，不按旧租户前缀扩大删除。共享模板样例、系统审计、其他租户与配额记录均保留。
- 独立备份 `/opt/saiflow/backups/account-reset-second-user4-tenant95-20261113T125853Z/`：database.dump 262170 bytes，SHA256 `56291708fcddefe70ad7fe629796bf84a73a3af50d94c390cfaa4e84da517cfd`；objects.tar 包含 11 个对象、1818390 bytes，SHA256 `53f7400d667f55380fa1b855cdb188b0fcf9998d53d8d4cb64833a99a90ec291`。数据库清单、对象逐项长度/摘要、归档读取均校验通过；完整 DELETE 后 ROLLBACK 排练恢复目标摘要。
- 12:59–13:00 UTC 定向删除已完成。锁内复核归属、FK 闭包、备份后行摘要、对象共享引用及活动状态；提交前 42 张表非目标行数量/内容摘要一致、102 个 FK 完整。原始结果 append-only 绕过仅限该次专属 DELETE，立即恢复 origin，未改变持久权限/触发器。11 个原件/预览/导出对象按 generation 条件删除。
- 后置只读核验（`verification.json`，13:00:10 UTC）：原 user/tenant、邮箱及 LINE 邮箱账号、验证码、全部旧 scope 与对象均为 0；非目标数据与对象状态未变，schema 0019、trigger_mode origin，三站健康 200/ok。验证没有重建账号或游客会话；受限备份保留供回滚。
- 原生验收边界：自动化与静态/健康核验不能代替 iPhone LINE 实际注册和 Continue。需在本次发布后由用户关闭重开 LINE 再测。
