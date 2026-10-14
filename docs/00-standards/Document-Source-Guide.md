---
doc_id: STD-007
title: "SaiFlow — 文档来源与可编辑性指南"
type: standard
status: active
version: 1.0.0
updated: 2026-10-12
owner: Product Engineering
applies_to: [docs, openspec, packages, apps, services]
doc_source: manual
---

# SaiFlow — 文档来源与可编辑性指南

本标准规定仓库中各类文档/代码的来源类型，以及如何通过文件头 frontmatter 和正文提示，让人类和 AI 一眼判断“**这份文件能不能手写**”。

---

## 1. 来源类型

| 类型 | 含义 | 人类能否编辑 | 修改路径 |
|------|------|:------------:|----------|
| `manual` | 由人编写和维护 | 可以 | 直接编辑本文件 |
| `generated` | 由工具/流程自动生成 | **禁止手写** | 修改生成源，再重新生成/同步 |
| `generated-but-curated` | 由工具生成，但允许人类做格式/注释级润色 | 有限（只允许标注的润色范围） | 先修改生成源；润色需在同一次提交中说明 |

---

## 2. 快速识别规则

### 2.1 frontmatter 字段

所有文档文件必须在 frontmatter 中声明 `doc_source` 字段：

```yaml
---
doc_id: STD-007
title: "SaiFlow — 文档来源与可编辑性指南"
type: standard
status: active
version: 1.0.0
updated: 2026-10-12
owner: Product Engineering
doc_source: manual                    # manual | generated | generated-but-curated
generated_by: ""                      # 仅 generated / generated-but-curated 填写
---
```

- `doc_source`：必填；标明文件来源类型。
- `generated_by`：仅当 `doc_source` 为 `generated` 或 `generated-but-curated` 时填写，说明生成工具/流程（例如 `"OpenAPI → openspec sync"`）。

### 2.2 正文顶部警告框

`doc_source: generated` 的文件必须在正文第一行放置统一警告框：

```markdown
> 本文件由 **OpenAPI → openspec sync** 自动生成。
> 禁止手工编辑；如需修改接口定义，请更新 `services/api/` 中的路由与 schema，然后重新运行生成/同步流程。
```

`doc_source: generated-but-curated` 的文件需额外声明允许润色的范围：

```markdown
> 本文件由 **XXX** 自动生成，允许人工润色：仅可调整 Markdown 格式、补充注释，不得修改字段/行为定义。
> 如需修改业务内容，请更新 `<源路径>` 后重新生成。
```

---

## 3. 目录/文件来源速查表

### 3.1 产品级持久文档（`docs/`）

| 路径 | `doc_source` | 生成工具/来源 | 说明 |
|------|:------------:|---------------|------|
| `docs/00-standards/*.md` | `manual` | Product Engineering | 工程标准，人工维护 |
| `docs/01-templates/*.md` | `manual` | Product Engineering | 文档模板，人工维护 |
| `docs/10-product/*.md` | `manual` | Product / PM | PRD、Vision、Glossary、Personas |
| `docs/20-requirements/**/*.md` | `manual` | Product / 需求分析 | EPIC、FR、NFR |
| `docs/30-design/API-Spec.md` | `generated` | 后端 OpenAPI → OpenSpec sync | **唯一 API 契约发布点，禁止手写** |
| `docs/30-design/Data-Model.md` | `manual` | 架构师 | 数据模型设计 |
| `docs/30-design/OCR-Pipeline.md` | `manual` | 架构师 | OCR 流程设计 |
| `docs/30-design/Architecture.md` | `manual` | 架构师 | 系统架构 |
| `docs/30-design/adr/*.md` | `manual` | 架构师 | 架构决策记录 |
| `docs/40-acceptance/*.md` | `manual` | 测试 / 需求 | Gherkin 验收标准 |

### 3.2 OpenSpec 变更流程产物（`openspec/`）

| 路径 | `doc_source` | 生成工具/来源 | 说明 |
|------|:------------:|---------------|------|
| `openspec/config.yaml` | `manual` | 工程标准 | OpenSpec 配置，人工维护 |
| `openspec/specs/<capability>/` | `generated` | OpenSpec sync | 主能力契约，由变更归档后同步 |
| `openspec/changes/<change>/proposal.md` | `generated` | OpenSpec propose | 变更提案 |
| `openspec/changes/<change>/specs/<capability>/spec.md` | `generated` | OpenSpec propose | delta spec |
| `openspec/changes/<change>/design.md` | `generated` | OpenSpec update | 变更级设计 |
| `openspec/changes/<change>/tasks.md` | `generated` | OpenSpec apply 前派生 | 编码任务列表 |
| `openspec/changes/<change>/archive/*` | `generated` | OpenSpec archive | 已归档变更 |

### 3.3 代码目录

| 路径 | `doc_source` | 说明 |
|------|:------------:|------|
| `apps/*/src/**` | `manual` | 前端业务代码，开发者手写 |
| `packages/ui/src/**` | `manual` | 共享 UI 组件，开发者手写 |
| `packages/tsconfig/**` | `manual` | 共享 TS 配置，开发者手写 |
| `packages/api-client/**` | `generated` | 由后端 OpenAPI 生成，**禁止手写第二份** |
| `services/api/**` | `manual` | 后端 FastAPI 代码，是 API 契约的真实来源 |
| `scripts/**` | `manual` | 仓库级脚本，开发者手写 |

---

## 4. 修改 generated 文件的流程

如果一份 `generated` 文件需要变化：

1. 找到它的**真实来源**（见上表“来源”列）。
2. 修改来源文件。
3. 运行对应的生成/同步命令（如 `openspec sync`、openapi-generator 脚本）。
4. 检查生成的 diff 是否合理。
5. 提交时说明变更来源，不要只提交 generated 文件而不说明生成命令。

---

## 5. 校验提示

- 人类：打开文件先看正文顶部是否有“自动生成”警告框。
- AI：读取 frontmatter 的 `doc_source` 字段；若为 `generated`，拒绝直接修改，提示用户修改来源。
- CI（可选）：扫描 `doc_source: generated` 的文件，校验其是否包含 `generated_by` 字段和统一警告框。

---

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-10-12 | Product Engineering | 初始文档来源与可编辑性指南 |
