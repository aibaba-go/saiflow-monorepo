# @saiflow/api-client

由后端接口描述自动生成的接口客户端（FR-PLAT-004）。前端只通过本包调用后端，不手写第二份接口定义。

- 重新生成：在仓库根执行 `pnpm generate:api-client`（先导出 `docs/30-design/openapi.json`，再生成 `src/generated/schema.ts`）。
- `src/generated/` 不得手改；CI 会在它与后端重新生成的结果不一致时失败。
- 用法：`createApiClient()`（默认同源）；`getBackendHealth(client)` 返回 `ok` / `degraded` / `unreachable`，从不抛错。
