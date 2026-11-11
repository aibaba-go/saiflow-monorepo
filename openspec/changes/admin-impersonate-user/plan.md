# Plan：admin-impersonate-user

负责人 2026-11-12 要求在管理后台用户行上直接以用户身份进入系统；沿用"按推荐的方式做"。下列默认值为推荐方案，规格见 delta。

## 方案选择

- 一次性票据，而不是直接给管理员下发客户 cookie：admin 与 web-pc 是不同站点（`saiflow-admin` / `saiflow-app`），cookie 为 host-only，必须在 web-pc 站点由浏览器自己换会话。票据 60 秒、单次、只存哈希，放在 URL 片段里，不进服务器访问日志。
- 会话沿用 `customer_sessions`，增加 `impersonated_by_admin_id`：现有权限、租户与所有接口无需改动；时限比普通会话短（闲置 30 分钟、最长 2 小时），与管理员会话时限一致。
- 只支持已注册用户：未注册用户进入后只会落到注册引导，没有排查价值，还可能被误替用户注册。
- 生成链接用后端配置 `WEB_PC_ORIGIN`，compose 取 `https://${APP_HOST}`，不需要新的 GitHub 变量。

## 步骤

| # | 内容 | 追溯 | 文件 |
|---|---|---|---|
| 1 | 迁移 0018：`impersonation_tickets`（token_hash 唯一、admin_id、user_id、expires_at、used_at）与 `customer_sessions.impersonated_by_admin_id` | FR-SYS-145、FR-SYS-148 | `alembic/versions/0018_impersonation.py`、`models/impersonation.py`、`models/session.py` |
| 2 | 签发 `POST /api/v1/admin/users/{user_id}/impersonation` → `{url, expires_in}`；兑换 `POST /api/v1/auth/impersonation {ticket}` → `MeResponse` 并设置 cookie（Max-Age 30 分钟） | FR-SYS-145 | `services/impersonation_service.py`、`routers/admin_query.py`、`routers/auth.py`、`config.py` |
| 3 | 会话解析：代登录会话按 30 分钟闲置 / 2 小时上限 / 管理员停用判断；cookie 续期用 30 分钟；`/me` 返回 `impersonated` | FR-SYS-148 | `session_service.py`、`dependencies.py`、`me_service.py`、`schemas/auth.py` |
| 4 | 集成测试 AC-145-01..03、AC-148-01..03 | FR-SYS-145、FR-SYS-148 | `tests/integration/test_impersonation.py` |
| 5 | 重新生成契约 | FR-PLAT-004 | `docs/30-design/openapi.json`、`packages/api-client/src/generated/schema.ts` |
| 6 | admin 用户行"以此用户登录"：Popconfirm；确认处理中同步打开空白标签页，签发后跳转；被拦截时弹出链接 | FR-SYS-146 | `UsersPage.tsx`、`people.test.tsx`、中英资源 |
| 7 | web-pc `/impersonate`（不在 RequireUser 内）；`AppLayout` 顶部横幅与"结束代登录" | FR-SYS-147 | `auth/ImpersonatePage.tsx`、`App.tsx`、`layout/AppLayout.tsx`、样式、三语资源、测试 |
| 8 | 部署与本地配置 `WEB_PC_ORIGIN` | FR-SYS-145 | `scripts/deploy/compose.yaml`、`scripts/dev/local-env.sh` |

验证：后端单元与全部集成测试（`saiflow_test_*`）、迁移测试；web-admin、web-pc vitest；lint、tsc、build；本机浏览器端到端（admin 点按钮 → web-pc 新标签页进入 → 横幅 → 结束）。结果写入 `verification.md`。不提交、不部署，等待"提交并部署"。
