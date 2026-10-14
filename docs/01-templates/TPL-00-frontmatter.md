---
doc_id: TPL-00
title: "模板 — Frontmatter 与章节骨架"
type: standard
status: active
version: 1.0.2
updated: 2026-10-02
---

# 模板 — Frontmatter 与章节骨架

> 将以下区块作为**任何**新文档的起点。发布前删除说明性注释（`#…`）。参见 `AI-Documentation-Standard.md` 第 3–4 节。

## 最小 frontmatter（始终必填）

```yaml
---
doc_id: <TYPE>-NNN            # 唯一且稳定，例如 FR 文档、PRD-001、ADR-001
title: "人类可读的标题"
type: index|standard|prd|epic|feature|nfr|design|data-model|api|acceptance|adr|glossary
status: draft|in-review|active|deprecated
version: 0.1.0                # 草稿阶段从 0.1.0 开始；启用时为 1.0.0
updated: YYYY-MM-DD
owner: <角色/团队>
---
```

## 扩展 frontmatter（需求与设计文档）

```yaml
priority: P0|P1|P2
source: <PRD 第 x.y 节或 doc_id>
depends_on: [FR-XXX-000]
related: [DM-Entity, API-N]
verified_by: [AC-FR-XXX-000-01]
tags: [关键词1, 关键词2]
---
```

## 正文骨架

```markdown
# <H1 标题>

<用途：本文档是什么，以及应在何时阅读，使用 1–3 句说明。>

## 1. <第一节>
...

## 2. <第二节>
...

## 链接
- 相关文档：docs/…/X.md
- 上游来源：docs/10-product/PRD-SaiFlow.md 第 x.y 节

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 0.1.0 | YYYY-MM-DD | <姓名> | 初始草稿 |
```

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.2 | 2026-10-02 | Product Engineering | 完成模板面向读者内容的第二轮中文化 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 初始 frontmatter 与章节骨架模板 |
