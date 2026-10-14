---
doc_id: STD-001
title: "AI 就绪文档标准"
type: standard
status: active
version: 1.0.2
updated: 2026-10-12
owner: Product Engineering
applies_to: All documents under /docs
doc_source: manual
---

# AI 就绪文档标准

本标准规定**如何编写需求文档，以便 AI 编码代理（以及人类）能够确定性地使用它们**。遵循本标准的文档应当完整、明确、原子化、可追溯且可被机器解析。

---

## 1. 为什么 AI 开发需要专门的标准

AI 代理与人类读者有三项差异，本标准将分别弥补：

| AI 局限 | 忽略后的后果 | 本标准的应对措施 |
|---------|-------------|------------------|
| 上下文窗口有限 | 无法一次读取整个仓库 | **渐进式披露**：分层文档 + `AGENTS.md` 索引 |
| 没有隐含知识或常识 | 用臆造行为填补缺口 | **显式需求**、术语表和“禁止假设”规则 |
| 会话之间无状态 | 遗忘决策和理由 | **稳定 ID**、版本历史和 ADR |

目标是：代理只需取得**一份**需求文件，即可在不读取该文件明确链接之外的任何文件的情况下正确实现需求。

---

## 2. 七项编写原则

### P1 — 原子性
一项需求 = 一个可独立测试的行为。
- ✅ `FR-OCR-004`：“系统必须从采购订单图像中提取 PO 编号。”
- ❌ “系统必须提取 PO 编号、日期和总额，然后验证并提交至 ERP。”
  （这包含 5 个行为 → 应拆分为 5 项需求。）

### P2 — 明确性
使用 SHALL / SHOULD / MAY（RFC-2119 风格）以及可量化术语。
- 禁止模糊词：*快速、用户友好、健壮、智能、适当* 等。
- 应替换为数字：“在 **5 秒**内完成单份文档识别（p95）。”

### P3 — 可追溯性
每项需求都带有**稳定且唯一的 ID**（见 `ID-Conventions.md`），并声明其上下游关联：`source`（PRD 章节）、`depends_on`、`related`、`verified_by`。

### P4 — 可测试性
每项功能需求都至少有 1 条使用 Gherkin（Given / When / Then）编写的**验收标准**。若无法编写 AC，则该需求尚未就绪。

### P5 — 自包含元数据
每份文件开头均包含 **YAML frontmatter**，使工具和代理无需解析正文即可筛选和建立索引。

### P6 — 分层（渐进式披露）
产品 → 需求 → 设计 → 验收。每一层只向下层链接，绝不重复其他层的内容。术语只在术语表中定义。

### P7 — 已版本化且 ID 不可变
ID 永不复用或重新编号。已废弃项目保留其 ID，并设为 `status: deprecated`。每份文档底部均有版本历史表。

---

## 3. 必需的文件结构

`/docs` 下的每份文档必须按以下顺序包含：

1. **YAML frontmatter**（见第 4 节）
2. 与 `title` 含义一致的 **H1 标题**
3. **用途说明块** — 1–3 句：说明本文档是什么以及何时阅读
4. **正文** — 只使用 `##`/`###` 标题（不跳级）
5. **链接** — 指向相关文档的明确相对路径
6. **版本历史**表（最后一节）

---

## 4. YAML frontmatter 架构

```yaml
---
doc_id: STD-001              # unique, stable, never reused
title: "Human-readable title"
type: index | standard | prd | epic | feature | nfr | design | data-model | api | acceptance | adr | glossary
status: draft | in-review | active | deprecated
version: 1.0.0               # semver: MAJOR.MINOR.PATCH
updated: YYYY-MM-DD
owner: <role or team>
priority: P0 | P1 | P2       # optional, for requirements
source: <PRD section or doc_id>   # optional, traceability upstream
depends_on: [IDs]            # optional
related: [IDs]               # optional
verified_by: [AC ids]        # optional
tags: [free, form, keywords]
doc_source: manual              # manual | generated | generated-but-curated
generated_by: ""                # 仅 generated / generated-but-curated 填写
---
```

**规则：**
- `doc_id`、`title`、`type`、`status`、`version`、`updated` 始终必填。
- `doc_source` 必填，标明文件是人工维护还是自动生成。
- `generated_by` 仅当 `doc_source` 为 `generated` 或 `generated-but-curated` 时填写。
- 日期使用 ISO-8601（`YYYY-MM-DD`）。列表使用行内数组。

### 4.1 generated 文件的额外标识

`doc_source: generated` 的文件必须在正文第一行放置统一警告框：

```markdown
> 本文件由 **<生成工具>** 自动生成。
> 禁止手工编辑；如需修改内容，请更新 `<来源路径>` 后重新生成。
```

完整规则与来源速查表见 `docs/00-standards/Document-Source-Guide.md`（STD-007）。

---

## 5. 需求陈述格式

每项需求应为表格行或结构化块。规范块如下：

```markdown
### FR-<DOMAIN>-NNN — <short name>

| Field | Value |
|-------|-------|
| **Statement** | The system SHALL <single observable behavior>. |
| **Priority** | P0 / P1 / P2 |
| **Source** | PRD §4.2 |
| **Depends on** | FR-UPLOAD-002 |
| **Verified by** | AC-FR-OCR-004-01, AC-FR-OCR-004-02 |

**Notes / rules:** bullet list of edge cases, tolerances, and constraints.

**Acceptance criteria:**
```gherkin
Feature: FR-OCR-004 Extract PO Number
  Scenario: Clean PO image
    Given an uploaded Purchase Order image of legible quality
    When OCR extraction runs
    Then the field "po_number" is populated with confidence >= 0.85
```
```

---

## 6. 语言与风格规则

- 使用**简体中文**；泰语、英文术语仅作为数据示例出现，并在术语表中定义。
- 使用**主动语态**、现在时和“系统必须……”。
- 尽可能使句子不超过 25 个词；每个列表项只表达一个观点。
- 对每个项目有至少 2 个属性的内容使用**表格**（字段、端点、参数）。
- 对架构、JSON、Gherkin、SQL、HTTP 使用带语言标签的**围栏代码块**。
- 数值、单位和容差必须明确（`±0.01 THB`、`300 DPI`、`5 s`）。
- 需求和设计文档中不得使用营销语言。

---

## 7. 就绪定义（DoR）— 一项需求仅在满足以下条件后才能进入开发：

- [ ] 具有稳定 ID 和完整 frontmatter。
- [ ] 陈述具备原子性，并使用 SHALL/SHOULD/MAY。
- [ ] 已设置优先级（P0/P1/P2）。
- [ ] 至少存在一条 Gherkin 验收标准。
- [ ] 所有使用的领域术语均已在 `Glossary.md` 中定义。
- [ ] `depends_on` 链接均能解析为现有 ID。
- [ ] 不存在未解决的 `TBD`/`TODO` 标记（或已作为明确的开放问题跟踪）。

## 8. 完成定义（DoD）— 一项需求仅在满足以下条件后才算完成：

- [ ] 代码已合并，并在提交/PR 中引用需求 ID。
- [ ] 所有验收标准均通过自动化测试。
- [ ] 已满足该项目的非功能约束（见 `NFR.md`）。
- [ ] 如契约变更，数据模型 / API 文档已更新。
- [ ] 每份修改过的文档均已添加版本历史条目。

---

## 9. 反模式（评审时应拒绝）

| 反模式 | 修复方法 |
|--------|----------|
| “系统应当易于使用” | 替换为可量化的易用性 NFR |
| 一个列表项描述 4 个行为 | 拆分为 4 项原子需求 |
| 没有 ID 的需求 | 分配 `FR-<DOMAIN>-NNN` |
| 同一术语在 2 份文档中定义 | 仅保留在术语表中；其他文档链接至术语表 |
| 变更后重新编号 ID | 将旧项标记为 `deprecated`，新增 ID |
| 仅用正文列出字段 | 转换为包含类型/是否必填/示例的表格 |

---

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.2 | 2026-10-12 | Product Engineering | 新增 `doc_source` / `generated_by` frontmatter 字段；新增 generated 文件正文警告框规则；引用 STD-007 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 初始 AI 就绪文档标准 |
