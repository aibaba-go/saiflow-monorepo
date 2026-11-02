---
doc_id: DES-003
title: "SaiFlow — API 规范"
type: api
status: active
version: 2.0.0
updated: 2026-11-03
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
| 2.0.0 | 2026-11-03 | Product Engineering | 改为说明页：契约以后端导出的 `openapi.json` 为唯一来源（B-1 `rebuild-skeleton`）；v1 内容见 tag `legacy-v1` |
