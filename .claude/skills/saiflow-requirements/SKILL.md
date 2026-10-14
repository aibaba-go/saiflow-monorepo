---
name: saiflow-requirements
description: SaiFlow 需求分析纪律。在 OpenSpec propose 之上叠加：读 docs/10-product 与 docs/20-requirements、产出 Gherkin 验收标准、术语精确、禁止臆造需求。配合 requirement-analyst subagent 使用。
---

# 需求分析纪律（叠加在 `openspec-propose` 之上）

## 输入
- 必读：`docs/10-product/**`、`docs/20-requirements/**`。
- 变更名 `<change>`，使用 kebab-case。

## 要求
- 每条需求至少 1 条 **Gherkin 验收标准**（Given / When / Then）。
- 需求**原子化、可测**；无法编写验收标准的需求视为未就绪。
- 术语使用术语表的精确名称。
- 缺口写为 **open question**，不得自行假设。
- 使用**主动语态 + SHALL/SHOULD/MAY**；禁止模糊词（快速、友好、健壮等）。

## 产物
- `openspec/changes/<change>/proposal.md`
- `openspec/changes/<change>/specs/<capability>/spec.md`
- 完成后执行 `openspec validate --change <change>` 并通过。

## 不做
- 不写业务代码；不直接改主 specs（用 `/opsx:sync` 或 `/opsx:archive`）。
