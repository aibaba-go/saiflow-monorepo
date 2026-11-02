# SaiFlow

> **We turn paper into process.**

面向泰国 SME 制造企业的纸质单据 OCR 数字化录入系统（PO / Delivery Note / Invoice / Receipt / Credit Note / Tax Receipt）。部署于 LightNode VPS（曼谷）的 Docker Compose：后端、三个前端、PostgreSQL 与 Caddy；原件等对象存私有 GCS（见 `docs/30-design/adr/ADR-008-vps-docker-hosting.md`）。

## monorepo 结构

| 目录 | 内容 | 工具链 |
|------|------|--------|
| `apps/` | 可部署前端应用（`web-pc`、`web-admin`、`line-mini`） | pnpm |
| `packages/` | 共享库（`api-client`、`ui`、`tsconfig`） | pnpm |
| `services/api/` | FastAPI 后端 | Python（pnpm 不扫描） |
| `openspec/` | 变更流程与行为契约 | OpenSpec |
| `docs/` | 产品级持久文档 | Markdown |

## 从哪开始

1. **人 / AI 入口**：[`AGENTS.md`](./AGENTS.md)
2. **协作工作流**：[`AI-WORKFLOW.md`](./AI-WORKFLOW.md)
3. **目录与文档标准**：[`docs/00-standards/Directory-Structure.md`](./docs/00-standards/Directory-Structure.md)

需求、设计、架构与验收标准均位于本仓库 `docs/`（唯一文档根）。旧 `saiflow-docs` 已废弃，内容已完成迁移。

## 常用命令

```bash
# 后端（在 services/api/ 内，需要 uv；配置见 services/api/.env.example）
uv sync
uv run uvicorn app.main:app --reload --port 8000   # 健康检查 http://localhost:8000/api/v1/health
uv run pytest -v

# 前端（仓库根，pnpm；开发服务器把 /api 代理到 localhost:8000）
pnpm install
pnpm dev:web-pc       # http://localhost:5174
pnpm dev:web-admin    # http://localhost:5175
pnpm dev:line-mini    # http://localhost:5173
pnpm test && pnpm lint && pnpm build

# 后端接口变化后重新生成接口客户端（CI 会检查是否一致）
pnpm generate:api-client
```

部署（GitHub Actions 手动触发）与备份见 [`docs/deployment/README.md`](./docs/deployment/README.md)。

> 所有临时产物放置于仓库根 `./temp/`，不得提交。
