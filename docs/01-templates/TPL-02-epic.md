---
doc_id: TPL-02
title: "模板 — Epic / 功能需求集"
type: standard
status: active
version: 1.0.2
updated: 2026-10-02
---

# 模板 — Epic / 功能需求集

> 每个 Epic 使用一份文件（`EPIC-NN-kebab-name.md`）。一个 Epic 为一个能力领域归集相关的原子化 `FR-*` 需求。每个 FR 均为自包含区块。

```markdown
---
doc_id: EPIC-NN
title: "EPIC-NN — <能力名称>"
type: epic
status: draft
version: 0.1.0
updated: YYYY-MM-DD
owner: <团队>
priority: P0
source: PRD §x.y
---

# EPIC-NN — <能力名称>

## 1. Epic 摘要
- **目标：** 此 Epic 要实现的业务成果。
- **范围内：** …    **范围外：** …
- **主要参与者：** …（链接至 Personas.md）
- **关键实体：** DM-…（链接至 Data-Model.md）

## 2. 需求

### FR-<DOMAIN>-001 — <简短名称>
| 字段 | 值 |
|------|----|
| **陈述** | 系统必须 <一个可观察到的行为>。 |
| **优先级** | P0 |
| **来源** | PRD §x.y |
| **依赖项** | — |
| **验证方式** | AC-FR-<DOMAIN>-001-01 |

**规则 / 边界情况：**
- …

**验收标准：**
```gherkin
Scenario: <场景名称>
  Given …
  When …
  Then …
```

### FR-<DOMAIN>-002 — <简短名称>
…（重复此区块）

## 3. 可追溯性
| FR ID | 标题 | 优先级 | 验证方式 | 设计引用 |
|-------|------|--------|----------|----------|

## 4. 待决问题

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
```

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.2 | 2026-10-02 | Product Engineering | 完成模板面向读者内容的第二轮中文化 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 初始 Epic / 功能需求集模板 |
