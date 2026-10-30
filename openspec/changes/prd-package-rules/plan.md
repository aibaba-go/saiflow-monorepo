# prd-package-rules Implementation Plan

**Goal:** 把 `proposal.md` 的 12 项决定与 Q1–Q5 评审结论写入 PRD 3.2.0 及受影响的产品级文档。

**Spec:** `openspec/changes/prd-package-rules/proposal.md`

## Global Constraints

- 只改 `docs/`、`AGENTS.md`（如需）与本 change 目录；不改 `legacy/`、`EPIC-*`、`docs/40-acceptance/`（已有“以 PRD 为准”提示框）。
- 产品层面表述，不写表名、字段、接口；字段以代码为唯一来源（ADR-007）。
- 术语：“企业租户” → **团队租户**；“月页额度” → **月扫描配额**（单位：OCR 扫描次数，每识别一页计一次）。
- 价格不写入 PRD；免费额度数量与和“自动开通一个月 Kinder”的关系登记为 OQ-28，不臆造。

## Review Focus

1. 全仓（排除 legacy、archive、EPIC、AC、Index）不再出现“企业租户”“升级为企业用户”“月页额度”“已认证企业”。
2. 企业认证不再是升级、付费或任何业务行为的前提，但仍保留在 V1.0。
3. 短信只对 Intermediate / Advance 且已验证手机号；其余渠道全档。
4. 用量提醒与到期提醒的收件人、节点、不补发三处一致（PRD / Glossary / Data-Model）。
5. 成员人数上限由平台 admin 配置，PRD §4.6 系统参数表同步。

## Tasks

### Task 1: PRD 3.2.0
- §4.9 用户与租户：团队租户、升级仅需付费、企业认证解耦（只影响身份显示，供后续开发票）。
- §4.9 套餐与计量：表头改为“每月扫描次数”“成员人数上限”；按月/按年开通；免费额度；月底清零次月重发；通知渠道；用量提醒；到期提醒保留。
- §4.6 系统参数表：新增“各档成员人数上限”。
- §1.3、§4 表、§7.2 新增 OQ-28、版本号与版本历史、同步说明。
- 检查：`grep -n "企业租户\|月页\|已认证企业" PRD` 无结果。
- 提交：`[prd-package-rules] PRD 3.2.0: package rules`

### Task 2: 下游文档
- Glossary 1.3.0、Vision-Scope 1.3.0、Personas 1.3.0、Data-Model 2.1.0、Architecture 3.1.0、ADR-007 措辞（不升 status）。
- 检查：Review Focus 第 1 条 grep 无结果。
- 提交：`[prd-package-rules] downstream docs: team tenant, scan quota, reminders`

### Task 3: 验证、审查、归档
- `verification.md`：逐条决定 → 落点；Review Focus 检查结果。
- 独立审查（opus），Important 一次修复。
- `openspec archive prd-package-rules --skip-specs -y`；提交。
