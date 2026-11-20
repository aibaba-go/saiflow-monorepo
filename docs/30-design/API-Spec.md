---
doc_id: DES-003
title: "SaiFlow — API 规范"
type: api
status: active
version: 2.4.0
updated: 2026-11-13
owner: Product Engineering
source: "services/api（FastAPI 导出的 OpenAPI）"
related: [STD-004, FR-PLAT-004]
doc_source: generated
---

# SaiFlow — API 规范

> 对外 API 契约的**唯一来源**是 [`openapi.json`](./openapi.json)，由后端代码导出，禁止手工编辑（`Directory-Structure.md` 规则 5）。本页只说明如何获得与使用它。

- **重新生成：** 在仓库根执行 `pnpm generate:api-client`：先由 `services/api` 导出 `docs/30-design/openapi.json`，再生成前端接口客户端 `packages/api-client/src/generated/schema.ts`。
- **一致性：** CI 的 `contract` 任务重新生成两者，与仓库中的版本不一致时失败（FR-PLAT-004）。
- **运行时：** 后端在 `GET /api/v1/openapi.json` 提供同一份描述；接口前缀为 `/api/v1`。
- **修改接口：** 改 `services/api/app/routers/` 与 `app/schemas/` 中的代码，再重新生成；不要改本页或 `openapi.json`。
- **旧契约：** v1 的接口描述与本页旧内容见 git tag `legacy-v1`。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 2.4.0 | 2026-11-13 | Product Engineering | `customer-email-login`：`openapi.json` 新增邮箱验证码发送（`POST /api/v1/auth/email-code`，用途 `login` / `reset`）、邮箱密码登录（`POST /api/v1/auth/password`）、邮箱验证码登录（`POST /api/v1/auth/email-login`）与重置密码（`POST /api/v1/auth/password-reset`）；注册（`POST /api/v1/me/registration`）增加必填 `password` |
| 2.3.0 | 2026-11-12 | Product Engineering | `admin-impersonate-user`：`openapi.json` 新增管理端签发代登录链接（`POST /api/v1/admin/users/{user_id}/impersonation` → `{url, expires_in}`）与 web-pc 兑换（`POST /api/v1/auth/impersonation`）；`MeResponse` 增加 `impersonated` |
| 2.2.0 | 2026-11-11 | Product Engineering | `template-report-management`：`openapi.json` 新增客户报表（`/api/v1/reports`：目录、草稿、预览、发布/撤回、查询 `/data`、CSV `/csv`）、LINE 用 60 秒 CSV 下载票据（`/api/v1/reports/{report_id}/csv/ticket` → `/api/v1/report-downloads/{token}`）与管理端报表配置（`/api/v1/admin/reports`）；报表详情含所引用模板的数据来源 `sources` |
| 2.1.0 | 2026-11-07 | Product Engineering | `review-flow`：`openapi.json` 新增复核设置（`/api/v1/review-settings`）、复核队列与决定（`/api/v1/reviews`）、修改记录（`/api/v1/ocr/jobs/{job_id}/changes`），结果与任务增加复核状态 |
| 2.0.0 | 2026-11-03 | Product Engineering | 改为说明页：契约以后端导出的 `openapi.json` 为唯一来源（B-1 `rebuild-skeleton`）；v1 内容见 tag `legacy-v1` |
