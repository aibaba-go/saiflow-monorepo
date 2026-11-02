---
doc_id: STD-006
title: "SaiFlow React 前端 — 目录结构"
type: standard
status: active
version: 1.1.0
updated: 2026-11-03
owner: Product Engineering
doc_source: manual
---

# SaiFlow React 前端 — 目录结构

本标准定义 **SaiFlow monorepo 中 React/TypeScript 前端应用与共享库**的目录结构、分层职责与强制约定。所有前端代码修改必须遵循本标准，以保证两个前端（PC Web、Line MiniApp）在共享组件、API 契约与构建方式上保持一致。

---

## 1. 推荐目录树

### 1.1 应用层（`apps/*`）

```text
apps/web-pc/                              # PC Web 端（React + Ant Design + Vite）
├── package.json                          # name: @saiflow/web-pc；依赖本地 packages/* 使用 workspace: 协议
├── tsconfig.json                         # extends @saiflow/tsconfig/react-app
├── vite.config.ts                        # Vite 构建配置
├── index.html
├── .env.example                          # 环境变量示例（不含真实密钥）
├── README.md                             # 应用级说明：启动、测试、构建
└── src/
    ├── main.tsx                          # React 渲染入口
    ├── App.tsx                           # 根组件：Provider 注入、路由挂载
    ├── routes/                           # 路由定义（react-router）
    │   ├── index.tsx
    │   ├── documents.tsx
    │   └── ...
    ├── pages/                            # 页面级组件（按路由对应）
    │   ├── LoginPage.tsx
    │   ├── DocumentListPage.tsx
    │   └── DocumentVerifyPage.tsx
    ├── features/                         # 按业务领域拆分的功能模块
    │   ├── documents/
    │   │   ├── components/               # 本领域内复用的组件
    │   │   ├── hooks/                    # 本领域内的自定义 hook
    │   │   ├── stores/                   # 本领域状态（zustand / context）
    │   │   ├── types.ts
    │   │   └── utils.ts
    │   └── users/
    │       └── ...
    ├── components/                       # 应用内通用组件（不跨应用复用）
    ├── hooks/                            # 应用内通用 hook
    ├── stores/                           # 全局状态（用户会话、权限、通知）
    ├── services/                         # 业务编排层；调用 packages/api-client 而非直接 fetch
    ├── utils/                            # 工具函数
    ├── types/                            # 应用级类型
    ├── styles/                           # 全局样式、CSS 变量、主题覆盖
    └── assets/                           # 静态资源（图片、字体、图标）

apps/web-admin/                           # admin 后台（React + Ant Design + Vite），独立应用
└── ...                                   # 结构与 web-pc 一致

apps/line-mini/                           # Line MiniApp 端（React + Ant Design Mobile + Vite）
└── ...                                   # 结构与 web-pc 一致，组件与样式针对移动端
```

### 1.2 共享库层（`packages/*`）

```text
packages/
├── tsconfig/                             # 共享 TypeScript 配置
│   ├── package.json
│   ├── base.json
│   ├── react-app.json                    # 给 apps/* 用
│   └── react-package.json                # 给 packages/* 用
│
├── ui/                                   # 共享 React 组件库（基于 Ant Design）
│   ├── package.json                      # name: @saiflow/ui
│   ├── tsconfig.json
│   ├── vite.config.ts                    # 库模式构建（或 tsup）
│   ├── README.md
│   └── src/
│       ├── components/                   # 通用组件
│       │   ├── DocumentCard/
│       │   │   ├── index.tsx
│       │   │   ├── DocumentCard.tsx
│       │   │   └── DocumentCard.test.tsx
│       │   └── ...
│       ├── theme/                        # 主题 token、全局样式、Ant Design ConfigProvider 封装
│       ├── hooks/                        # 通用 hook（如 useMediaQuery）
│       ├── utils/
│       ├── types/
│       └── index.ts                      # 统一导出
│
└── api-client/                           # 由后端 OpenAPI 生成的 API 客户端
    ├── package.json                      # name: @saiflow/api-client
    ├── tsconfig.json
    ├── README.md
    ├── scripts/
    │   └── generate.sh                   # openapi-generator 或 orval 生成脚本
    └── src/
        ├── generated/                    # 生成产物：API、模型、DTO
        └── index.ts                      # 统一导出
```

---

## 2. 分层职责

| 层 | 位置 | 职责 | 禁止做的事 |
|----|------|------|-----------|
| **入口** | `src/main.tsx`、`src/App.tsx` | 渲染入口、Provider 注入、路由挂载、全局异常边界 | 写业务逻辑、直接调外部 API |
| **路由** | `src/routes/` | 定义 URL↔页面的映射、懒加载、权限守卫配置 | 写页面 UI、写业务逻辑 |
| **页面** | `src/pages/` | 组合 features 与共享组件，形成完整页面 | 直接调用原始 fetch/axios、写可复用组件 |
| **功能域** | `src/features/<domain>/` | 按业务领域封装组件、hook、状态、类型、工具 | 被其他 feature 直接依赖内部文件（应通过 index.ts 暴露有限接口） |
| **共享组件** | `src/components/` / `packages/ui/src/components/` | 跨页面 / 跨应用复用的纯展示或轻交互组件 | 耦合业务状态、引入应用特有类型 |
| **Hook** | `src/hooks/` / `features/*/hooks/` | 封装副作用、订阅、与框架/浏览器交互 | 写业务规则（应放在 service 或 feature store） |
| **状态** | `src/stores/` / `features/*/stores/` | 管理全局或领域状态 | 直接发起 HTTP 请求 |
| **业务编排** | `src/services/` | 调用 `@saiflow/api-client`，处理分页、错误转换、本地缓存策略 | 直接引入后端 SDK 或手写 URL |
| **API 契约** | `packages/api-client/` | 由后端 OpenAPI 生成的类型、请求函数、响应模型 | 手写第二份 API 契约 |
| **工具** | `src/utils/` | 纯函数：日期、金额、校验、格式化 | 引入 React 生命周期或副作用 |

---

## 3. 强制约定

1. **应用包名**
   - `apps/web-pc` 的 `package.json` 名称为 `@saiflow/web-pc`。
   - `apps/line-mini` 的 `package.json` 名称为 `@saiflow/line-mini`。
   - `apps/web-admin` 的 `package.json` 名称为 `@saiflow/web-admin`。
   - 共享库使用 `@saiflow/ui`、`@saiflow/api-client`、`@saiflow/tsconfig`。

2. **依赖方向**
   - `apps/*` 可以依赖 `packages/*`。
   - `packages/*` 之间：@saiflow/api-client 可被 @saiflow/ui 依赖；@saiflow/ui 不得反向依赖 @saiflow/api-client。
   - 任何包不得依赖 `apps/*`。

3. **API 契约单一来源**
   - `@saiflow/api-client` 必须由后端 OpenAPI 生成，禁止手写第二份 URL/类型。
   - 生成脚本应记录命令并放入 `packages/api-client/scripts/generate.sh`。

4. **组件组织**
   - 组件文件与其样式/测试文件同目录，采用文件夹组件（如 `DocumentCard/index.tsx`、`DocumentCard/DocumentCard.test.tsx`）。
   - 共享组件必须放在 `packages/ui`；仅在单个应用内复用的组件放在 `apps/<app>/src/components/`。
   - 组件 props 类型使用 `interface`，命名与组件同名（如 `DocumentCardProps`）。

5. **状态管理**
   - 服务端状态优先使用 `@saiflow/api-client` + React Query（或 SWR）管理缓存。
   - 客户端全局状态使用 zustand；局部状态优先使用 `useState` / `useReducer`。
   - feature 内部状态不得被其他 feature 直接修改；跨 feature 通信通过全局 store 或 URL/事件。

6. **环境变量**
   - 所有配置通过 `import.meta.env.*` 读取，并在 `src/config.ts` 中集中导出。
   - `.env.example` 只列 key 名，**不得**提交含真实值的 `.env`。
   - 浏览器无法访问的密钥（如后端服务账号、OCR 凭据）禁止出现在前端代码或构建产物中。

7. **样式**
   - 使用 Ant Design 主题 token；全局覆盖写 `packages/ui/src/theme/`。
   - 应用级样式只放 layout/页面级覆盖；组件级样式优先使用 CSS Modules 或 styled-components，避免全局 class 污染。

8. **测试**
   - 单元测试与源文件同目录（`*.test.tsx`），使用 Vitest + React Testing Library。
   - 共享库的测试覆盖率不得低于 60%；关键组件（DocumentCard、OCR 结果展示）必须覆盖。

9. **构建产物隔离**
   - `dist/`、`build/`、`.next/`、`out/` 已加入 `.gitignore` 与 `.claudeignore`，禁止提交。

10. **可追溯性**
    - 每项代码修改至少映射到一个 `FR-*` 或 `NFR-*`。
    - 编码前必须先阅读对应 `AC-*` 验收标准。

---

## 4. 与 monorepo 的关系

- `apps/*` 与 `packages/*` 由 `pnpm-workspace.yaml` 统一管理；`services/` 不在其内。
- 前端命令（`pnpm dev`、`pnpm build`、`pnpm test`、`pnpm lint`）在应用或共享库目录内执行；根目录可运行 `pnpm -r` 批量执行。
- 后端 OpenAPI 更新后，必须重新生成 `packages/api-client`，并同步更新前端调用点。
- 需求、设计、验收标准分别位于 `docs/20-requirements/`、`docs/30-design/`、`docs/40-acceptance/`。

---

## 5. 命名约定

- 目录：小写、kebab-case（`document-card`、`api-client`）。
- 文件：
  - React 组件：PascalCase（`DocumentCard.tsx`）。
  - Hook：camelCase 并以 `use` 开头（`useDocuments.ts`）。
  - 工具/常量：camelCase / UPPER_SNAKE_CASE。
- 类型：
  - 组件 props：`{ComponentName}Props`。
  - API 模型：沿用 `@saiflow/api-client` 生成名，禁止另起名。

---

## Version History

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.1.0 | 2026-11-03 | Product Engineering | B-1：新增 `apps/web-admin`（`@saiflow/web-admin`） |
| 1.0.0 | 2026-10-12 | Product Engineering | 初始 SaiFlow React 前端目录结构标准 |
