# 设计：Web PC 前端原型（web-pc-frontend-prototype）

## Context

- `apps/web-pc/` 为空（仅 `.gitkeep`）；根 `package.json` 已有 `dev:web-pc` 脚本，按 `@saiflow/web-pc` 过滤——应用包名必须为 `@saiflow/web-pc`。
- `pnpm-workspace.yaml` 仅 glob `apps/*` 与 `packages/*`；`packages/ui`、`packages/api-client`、`packages/tsconfig` 均为空目录。
- 技术栈已由 `docs/30-design/Architecture.md` 与 ADR-001 确定：React + TypeScript + Vite + Ant Design；测试 Vitest + React Testing Library。
- 后端 `services/api` 尚未提供可调用接口，本原型以 Mock 数据驱动（见 proposal.md 的动机与范围）。
- 需求依据：delta specs `specs/web-pc/*`（FR 引用见各 spec）；关键数值：单文件 ≤ 20 MB（EPIC-01 §3）、置信度阈值 0.85（EPIC-02 §4.4）、列表分页默认 20（EPIC-05 §3）、核验状态机（EPIC-03 §3.1）。

## Goals / Non-Goals

**Goals:**

- 一个 `pnpm dev:web-pc` 即可在浏览器跑通 P0 闭环 + 2 个关键 P1 页面（搜索、批量更正）。
- Mock 层与 UI 严格分层：未来用真实 API 客户端（`packages/api-client`）整体替换 Mock 适配器，不改页面代码。
- 核验状态机（0/1/2 级复核）在 Mock 层忠实实现，保证界面演示与真实业务规则一致。

**Non-Goals:**

- 不创建/修改 `packages/*`（共享包抽取是后续变更）；主题 token 暂放 app 内。
- 不做真实鉴权、加密、审计持久化；不做 Docker/Cloud Run 部署配置。
- 不引入 MSW、Redux、React Query 等重型设施（见决策 2/3）。

## Decisions

### 1. 工程与依赖

- Vite + React 18 + TypeScript（strict）+ Ant Design 5 + react-router（library 模式）。
- i18n：`i18next` + `react-i18next`，资源包外置（NFR-I18N-003）；AntD `ConfigProvider` locale 随语言联动；默认泰语（EPIC-06 §4）。
- Excel 导出：`xlsx`（SheetJS CE）在浏览器端生成真实可打开的 `.xlsx`。备选 `exceljs`——体积更大，无必要。
- 测试：Vitest + React Testing Library，仅对状态机、门控与命名规则等纯逻辑做单测（架构约定的最小集）。
- 包名 `@saiflow/web-pc`；`tsconfig` 暂在 app 内自持，未来统一到 `packages/tsconfig`。
- 目录按 feature 组织：`src/features/{upload,verification,entry-archiving,archive-browser,settings,auth}`、`src/api/`（接口 + Mock 实现）、`src/i18n/`、`src/layouts/`、`src/mock/`（数据集与内存 store）。

### 2. Mock 层：类型化 ApiClient 适配器（ADR-002）

- 定义 `ApiClient` 接口（对齐 `docs/30-design/API-Spec.md` 中 API-1/4/5/7/8 的语义），默认实现 `MockApiClient`：内存 store + 300–800 ms 模拟延迟 + 少量可控失败用例（上传失败样例）。
- 页面只依赖接口；接真实后端 = 新增 `RealApiClient`（基于 OpenAPI 生成的 `packages/api-client`）并替换 Provider 注入。
- 备选 MSW（service worker 拦截网络层）：更贴近真实网络，但原型阶段徒增配置且 handler 同样要维护内存状态，收益不足。决策记录于 `docs/30-design/adr/ADR-002-web-pc-mock-adapter.md`。

### 3. 状态管理

- 会话 / 语言 / 设置（保存路径、命名规则、复核级别）：React Context + `localStorage` 持久化（满足"刷新不丢会话/语言"的场景）。
- 单据数据：内存 mock store，**刷新后重置**——保证每次演示数据确定性；不持久化到 localStorage。
- 不引入 Redux/React Query；跨页共享数据经 mock store 订阅（简单 observer 模式）。

### 4. 核验状态机与复核策略

- 按 EPIC-03 §3.1 在 `src/mock/stateMachine.ts` 实现纯函数状态机：`extracted → in_review → verified → pending_review_level_1 → pending_review_level_2 → approved_for_business → entered → archived`；拒绝 → `in_review`。该模块有单测。
- 复核级别（0/1/2）按单据类型存于 mock settings，设置页修改后立即驱动核验工作台行为（spec: settings-admin「复核级别配置」）。
- 确认门控规则同 EPIC-03 §3.3：必填为空、`needs_review` 未处理、`amount_mismatch` 未解决三者任一即阻止。

### 5. Mock 数据集

- 覆盖 4 种 P0 单据类型（PO、Delivery Note、Invoice、Receipt），文案含泰/英/中混合字段（呼应 NFR-I18N-001）。
- ≥ 20 份单据，覆盖状态机全部状态；含低置信度字段（< 0.85 → `needs_review=true`）、缺失必填字段、金额不一致、上传失败等负样例。
- 原图用本地占位图（`apps/web-pc/public/samples/` 内简单生成的 SVG，标注单据类型与编号），不引入外部网络资源。

### 6. RBAC（原型级）

- Mock 用户集覆盖 `clerk`/`finance`/`reviewer`/`viewer`/`admin`；路由守卫 + 菜单过滤按 EPIC-06 §3 权限矩阵实现；无权限路由显示提示页。

## Risks / Trade-offs

- [Mock 类型与未来真实 API 契约漂移] → `ApiClient` 接口按 `API-Spec.md` 端点命名与 `Data-Model.md` 字段命名；接后端时以 OpenAPI 生成为准替换。
- [原型状态机与后端实现不一致] → 状态机规则直接抄自 EPIC-03 §3.1 并加单测；后端实现后对齐其行为。
- [内存 store 刷新重置导致用户误以为丢数据] → 界面在原型构建中明示 "Mock 模式" 徽标。
- [i18n 文案遗漏硬编码] → lint 阶段人工检查 + 资源键集中管理；不引入额外工具。
- [`xlsx` 社区版维护节奏] → 原型仅用写入（write）能力，替换成本低。

## Migration Plan

1. 接真实后端：新增 `RealApiClient`（基于 `packages/api-client` 生成物）→ 替换 Provider 注入 → 删除/保留 Mock 开关（环境变量 `VITE_USE_MOCK`）。
2. 回滚：原型独立于后端，无部署依赖；git revert 即可。

## Open Questions

- 主题 token 抽取到 `packages/ui` 的时机（建议：正式前端第一个变更时）。
- `packages/tsconfig` 是否在原型阶段即建立（建议：暂缓，避免扩大本变更范围）。
