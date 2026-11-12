# admin-impersonate-user — 验证记录

## 授权与边界

负责人 2026-11-12 要求在管理后台"用户"页每条记录上增加按钮，点击后无需用户名密码即以该用户身份进入系统；并指示"按推荐的方式直接全部开发完成并测试完成"。该指示**不含**提交、推送或部署授权；本地交付阶段未提交、未发布；随后的发布授权与结果见文末"正式发布"节。

验证只在本机隔离环境进行：API `127.0.0.1:8010`（`saiflow_dev`，已迁移到 0018）、web-admin `:5175`、web-pc `:5174`；集成测试只连 `127.0.0.1:25432/saiflow_test_full1`。未触碰生产 `38.60.156.234` 或 `81.68.72.120`，未调用付费 OCR。

## 逐项证据（2026-11-12）

| 需求 | 自动化测试 | 浏览器检查 |
|---|---|---|
| FR-SYS-145 代登录链接（签发、一次性、60 秒、仅已注册用户、审计） | `tests/integration/test_impersonation.py` 11 passed（9 个用例，会话时限 3 种参数化）：签发并进入、票据只存 SHA-256 哈希、签发与开始各记一条操作日志；用过/过期票据 401 且不影响兑换者原会话；未注册用户 409、不存在 404、客户会话调用 401 且不留票据；未配置 `WEB_PC_ORIGIN` 时 503；缺 CSRF 头 403 | 确认后只签发 1 次；同一链接再次打开被拒；操作日志有"签发"与"开始" |
| FR-SYS-148 代登录会话（标记、30 分钟闲置/2 小时上限、管理员停用即失效、替换本浏览器会话、不归集游客） | 同上集成测试：`/me` 的 `impersonated` 标记、Cookie 仅滑动 30 分钟；闲置 30 分钟、满 2 小时、管理员停用三种情况均 401；替换本浏览器游客会话且游客数据不归集、用户自己设备上的会话不受影响且标记为 false；之后在该浏览器 LINE 登录即为普通会话。导出与 CSV 下载凭证的会话校验改用同一存活判断，由全量回归覆盖 | `/me` 返回 `impersonated: true`；结束后 `/me` 401 |
| FR-SYS-146 后台"以此用户登录" | web-admin `people.test.tsx` 新增 3 例：仅已注册行有按钮、取消不发请求、确认后签发 1 次且新标签页 `opener` 为 null；新标签页被拦截时显示可点击链接；409 显示"该用户尚未注册"并关闭空白标签页 | 仅已注册行有按钮；取消不签发；新标签页打开后管理后台页面不变；管理员仍保持登录 |
| FR-SYS-147 web-pc 入口与横幅 | web-pc `auth/impersonate.test.tsx` 5 例：先从地址栏移除票据再兑换（REPLACE 导航）、失效链接提示并提供登录链接、无票据不发请求、结束代登录退出并回登录页、普通会话无横幅 | 新标签页落在 web-pc 首页且地址栏无票据；横幅显示"管理员代登录：正在以 SaiFlow Dev 的身份操作"，滚动后仍置顶可见；结束后回登录页且无横幅 |

浏览器检查脚本 `temp/impersonate/browser.cjs`（Playwright，zh 与 en 各一轮），结果 `temp/impersonate/shots/results.json`：**26 PASS / 0 FAIL**，控制台无错误；截图同目录（`admin-confirm-zh.png`、`pc-impersonated-zh.png` 等）。

## 全量检查

| 检查 | 结果 |
|---|---|
| 后端 `ruff check` / `ruff format --check` | 通过 |
| 后端全量 `pytest`（`saiflow_test_full1`，`REQUIRE_INTEGRATION=1`） | 1227 passed（38 分 33 秒） |
| 部署配置测试（compose，含 `WEB_PC_ORIGIN`） | 79 passed |
| OpenAPI 与 `packages/api-client` schema 重新生成 | 契约一致性测试通过 |
| web-admin vitest（单 worker） | 16 files，89 passed |
| web-pc vitest（单 worker） | 22 files，228 passed |
| line-mini vitest（单 worker） | 33 files，319 passed |
| tsc `--noEmit` 与 eslint（web-admin、web-pc、line-mini） | 均 rc=0 |
| vite build（三个应用，输出到 `temp/impersonate/build-*`） | 均构建成功 |

### 过程中修正

- 浏览器脚本：antd 中文确认按钮文字渲染为"确 定"，改用 `.ant-popconfirm .ant-btn-primary` 选择器；web-pc 语言键为 `saiflow.pc.lang`（原脚本误用 `saiflow.lang`）。
- 本机 web-admin 开发配置的代理固定指向 8000，验证时改用 `temp/impersonate/vite.admin.config.mjs` 指向 8010，正式配置未改动。

## 上线注意

- 新增迁移 0018（`impersonation_tickets` 表、`customer_sessions.impersonated_by_admin_id` 列）尚未在生产执行；执行前须先备份数据库。已部署的 0015–0017 未改动。
- 生产 `WEB_PC_ORIGIN` 由 compose 从 `APP_HOST` 生成（`https://${APP_HOST}`），无需新增密钥。
- `MeResponse.impersonated` 为必填字段，web-pc 与 line-mini 需与 API 同批发布。

## 正式发布（2026-11-12，已完成）

负责人在本地交付后明确回复 **"提交并部署"**，授权本变更与 admin-line-feedback-fixes 的提交、推送和既有 GitHub Actions 正式发布。只操作发布分支 `chore/ai-workflow-v2` 与生产 `38.60.156.234`，未手动 SSH，未做登录后业务写入，未调用付费 OCR。

- 代码提交 `fb1a5ee`（73 文件，两个变更合并提交；`.qoder/` 与 `docs/10-product/user-manuals/` 排除）。其 [CI 43123434871](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43123434871) 的 scripts 作业因 shellcheck SC2016（新增 compose 检查用了单引号中的 `${APP_HOST:?}`）失败；改为与相邻检查一致的双引号转义写法，本机 compose 测试仍 79 passed，另作提交 **`78e144425f069bc23679359fd3c429903de35067`**。
- [CI 43124397561](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43124397561) 对 `78e1444` completed/success：backend、frontend、contract、scripts、stack 五项全部 success（00:10:01Z）。
- [Deploy 43125365719](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/43125365719) 以 workflow_dispatch 于 00:10:44Z 触发，headSha 为 `78e1444`，completed/success（00:15:39Z）；CI 门禁、镜像构建推送、迁移重启、三站健康、外部 5432 关闭、runner SSH key 清理全部 success。
- 生产日志：00:15:00Z 写入 `saiflow-20261112T001459Z.dump`（292,131 bytes），00:15:04Z 上传 `gs://saiflow-db-backup/` 成功后才迁移；实际 **0017 → 0018**；00:15:20Z remote-deploy done。日志存 `temp/impersonate/deploy.log`。
- 只读线上检查：三站 `/api/v1/health` 均 status/database ok、version `78e1444…`；web-pc `/impersonate` 返回 200，入口 `index-BNe3jkX3.js` 含 `/api/v1/auth/impersonation`，CSS 含 `pc-impersonation`；web-admin 入口 `index-CMxpLoNg.js` 含签发接口；匿名 `/me` 401。

### 未验证

生产上未实际点击"以此用户登录"或兑换票据（会产生代登录会话与审计记录，属于真实业务写入）。该流程的证据为本机隔离环境的集成测试与浏览器 26 项检查；上线后可由管理员对测试账号实际试用一次确认。未做生产备份恢复演练。
