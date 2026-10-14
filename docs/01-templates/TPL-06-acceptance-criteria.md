---
doc_id: TPL-06
title: "模板 — 验收标准（Gherkin）"
type: standard
status: active
version: 1.0.2
updated: 2026-10-02
---

# 模板 — 验收标准（Gherkin）

> 验收标准使需求可测试，并可直接转换为自动化测试。每个 `AC-<REQID>-NN` 与一个 `TC-<REQID>-NN` 测试用例一一对应。

```markdown
---
doc_id: AC-NNN
title: "验收标准 — <范围>"
type: acceptance
status: draft
version: 0.1.0
updated: YYYY-MM-DD
owner: QA
verified_requirements: [FR-XXX-000]
---

# 验收标准 — <范围>

## 编写规则
- 每个行为对应一个场景；使用具体且可量化的值。
- 每项需求均覆盖正常路径**以及**至少一个错误或边界路径。
- 引用测试数据（例如 `thai-sample-forms-for-ocr/` 中的样本文件）。

## AC-FR-<DOMAIN>-000-01 — <场景名称>
**需求：** FR-<DOMAIN>-000    **测试用例：** TC-FR-<DOMAIN>-000-01    **类型：** automated

```gherkin
Feature: FR-<DOMAIN>-000 <简短名称>

  Scenario: <正常路径>
    Given <前置条件 / 测试数据>
    When  <操作>
    Then  <可观察且可量化的结果>

  Scenario: <错误 / 边界路径>
    Given <无效前置条件>
    When  <操作>
    Then  系统必须 <拒绝 / 标记 / 显示消息 "...">
```

## 覆盖矩阵
| 需求 | AC ID | 测试类型 | 状态 |
|------|-------|----------|------|

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
```

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.2 | 2026-10-02 | Product Engineering | 完成模板面向读者内容的第二轮中文化 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 初始验收标准模板 |
