# @saiflow/web-admin

SaiFlow Admin 前端（B-1 空壳：只有一个页面，显示后端健康检查结果，FR-PLAT-004）。结构见 `docs/00-standards/React-Frontend-Structure.md`。

```bash
pnpm --filter @saiflow/web-admin dev     # http://localhost:5175，/api 代理到 http://localhost:8000
pnpm --filter @saiflow/web-admin test
pnpm --filter @saiflow/web-admin build   # 产物在 dist/
```

后端只通过 `@saiflow/api-client` 调用；部署时与后端同源（Caddy 转发 `/api`）。
