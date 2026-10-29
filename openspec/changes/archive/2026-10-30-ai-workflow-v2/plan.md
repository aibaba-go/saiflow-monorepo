# AI 工作流 v2 与旧代码归档 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 ADR-006 部分 A：仓库规则改为“OpenSpec 管需求、SuperPowers 管实现、不用项目自定义 subagent”，并把现有代码移入只读的 `legacy/`。

**Architecture:** 纯文档与仓库结构变更，不写业务代码。规则的唯一操作性来源是重写后的 `AI-WORKFLOW.md` v2.0.0；`AGENTS.md`、`saiflow-*` skill、`openspec/config.yaml` 只做指向与叠加约束。每个任务以 `grep` / CLI 检查作为验证。

**Tech Stack:** Markdown、YAML、git、`openspec` CLI 1.10.0、pnpm。

**Spec:** `docs/30-design/adr/ADR-006-ai-native-workflow.md`（v0.2.0）

## Global Constraints

- 不手改 `.claude/commands/opsx/**` 与 `.claude/skills/openspec-*`（OpenSpec 生成物）。
- 不修改 SuperPowers、OpenSpec 框架的内部定义；只在项目规则中约束“严重重复”的行为。
- `docs/` 下每份被修改的文档：更新 frontmatter `version` / `updated`，在版本历史追加一行；**版本历史不写测试条数、构建哈希、部署比例**。
- 文档使用简体中文，遵循 STD-001（frontmatter、`##`/`###` 不跳级、版本历史为最后一节）。
- 临时文件只放 `./temp/`。
- 日期一律写 `2026-10-30`（执行日不同则用执行当日）。
- 本 change 不含行为需求：不写 delta spec，归档用 `openspec archive ai-workflow-v2 --skip-specs`。
- 推送到远端（`git push`、推送 tag）属于对外操作，执行前必须征得负责人同意。

## Review Focus

1. **残留引用**：任何入口文档仍提到 `requirement-analyst` / `architect` / `coder` / `tester` / “你作为” → AI 会照旧走 subagent 流程。由 Task 7 的全仓 grep 锁定。
2. **归档后仍被加载**：`.claude/agents/` 目录仍存在或仍含文件 → Claude Code 继续加载旧 agent。由 Task 2 验证。
3. **pnpm 工作区在应用移走后报错**：`apps/*` 为空时 `pnpm install` 应成功，lockfile 随之更新。由 Task 6 验证。
4. **真实单据随 legacy 继续入库**：`services/api/storage/` 下 31 个已跟踪的上传/导出文件（PDF、XLSX、PNG、CSV）违反 STD-004 放置规则 9（PDPA）。移动时必须从 git 移除而非搬进 `legacy/`。由 Task 6 验证。
5. **OpenSpec CLI 对无 spec / 无 tasks 的 change 的处理**：`validate` 或 `archive` 可能因缺少 delta 或 `tasks.md` 报错。Task 7 实测；若报错，按 ADR-006“留给实施者决定”生成仅链接 `plan.md` 的最小 `tasks.md`。

---

### Task 1: 分支、ADR 生效与 change 提案

**Files:**
- Modify: `docs/30-design/adr/ADR-006-ai-native-workflow.md`（frontmatter 与“状态”节）
- Create: `openspec/changes/ai-workflow-v2/proposal.md`
- 已在工作区、随本任务提交：`.gitignore`（新增 `*cookies*.txt`）、删除 `services/api/sf-cookies.txt`、`openspec/changes/ai-workflow-v2/{.openspec.yaml,README.md,plan.md}`

**Interfaces:**
- Produces: 分支 `chore/ai-workflow-v2`；ADR-006 `status: accepted`。

- [ ] **Step 1: 建分支**（从当前 HEAD `1dd1e7d`，与 `main` 相同）

Run: `git switch -c chore/ai-workflow-v2`
Expected: `Switched to a new branch 'chore/ai-workflow-v2'`，未提交改动随之带入。

- [ ] **Step 2: ADR-006 改为 accepted**：frontmatter `status: accepted`、`version: 1.0.0`；“状态”节改为 `accepted（2026-10-30 负责人确认）`；版本历史追加 `1.0.0 | 负责人审阅通过，状态改为 accepted`。

- [ ] **Step 3: 写 `proposal.md`**：≤ 30 行，章节 `## Why`（链接 ADR-006 §上下文）、`## What Changes`（列出 Task 2–7 的对象）、`## Non-goals`（不含部分 B、不含夜间自动化、不改 `AGENTS.md` 第 7 条——属于 B-0）。

- [ ] **Step 4: 验证**

Run: `grep -n '^status:' docs/30-design/adr/ADR-006-ai-native-workflow.md && git status --short`
Expected: `status: accepted`；状态列表含 `D services/api/sf-cookies.txt`、` M .gitignore`。

- [ ] **Step 5: Commit**

```bash
git add -A .gitignore services/api/sf-cookies.txt docs/30-design/adr/ADR-006-ai-native-workflow.md openspec/changes/ai-workflow-v2
git commit -m "[ai-workflow-v2] accept ADR-006; add change proposal and plan; drop curl cookie jar"
```

---

### Task 2: 归档项目自定义 agent 与两个 skill

**Files:**
- Move: `.claude/agents/{requirement-analyst,architect,coder,tester}.md` → `.claude/archive/agents/`
- Move: `.claude/skills/saiflow-architecture/`、`.claude/skills/saiflow-testing/` → `.claude/archive/skills/`
- Create: `.claude/archive/README.md`

- [ ] **Step 1: 移动**

```bash
mkdir -p .claude/archive/agents .claude/archive/skills
git mv .claude/agents/*.md .claude/archive/agents/
git mv .claude/skills/saiflow-architecture .claude/skills/saiflow-testing .claude/archive/skills/
```

- [ ] **Step 2: 写 `.claude/archive/README.md`**：3–5 行，说明“已停用，Claude Code 不加载此目录；依据 ADR-006；夜间自动化启用时取回改写”。

- [ ] **Step 3: 验证**

Run: `ls .claude/agents 2>&1; ls .claude/skills; ls .claude/archive/agents .claude/archive/skills`
Expected: `.claude/agents` 不存在（git mv 后空目录消失；若残留空目录则删除）；`.claude/skills` 只剩 `openspec-*` 6 个与 `saiflow-conventions`、`saiflow-requirements`；archive 下 4 个 agent、2 个 skill。

- [ ] **Step 4: Commit** — `git commit -m "[ai-workflow-v2] archive project subagents and saiflow-architecture/testing skills"`

---

### Task 3: 重写 `AI-WORKFLOW.md` 为 v2.0.0（规则的唯一操作性来源）

**Files:**
- Modify: `AI-WORKFLOW.md`（整份重写，保留 `doc_id: WF-001` 与旧版本历史行）

**Interfaces:**
- Produces: 以下章节锚点，供 Task 4/5 链接：`§1 铁律`、`§2 阶段与工具分工`、`§3 改动分级`、`§4 文档分层与需求正本`、`§5 change 目录约定`、`§6 框架使用边界`、`§7 命令速查`。

- [ ] **Step 1: 按下表写入内容**

| 章节 | 内容来源与要求 |
|------|----------------|
| 头部说明 | 一句话：OpenSpec 管需求、SuperPowers 管实现、主会话推进、人确认每个决策点；依据 ADR-006 |
| §1 铁律 | 保留原三条中前两条；第三条改为“需求只有一份正本：`openspec/specs/`” |
| §2 阶段与工具分工 | 照录 ADR-006 §2 阶段表（①–⑦，含确认点） |
| §3 改动分级 | 照录 ADR-006 §3 表；含“不确定时询问负责人，不得自行降级” |
| §4 文档分层与需求正本 | 照录 ADR-006 §4 表与迁移规则 |
| §5 change 目录约定 | `proposal.md`、`specs/<capability>/spec.md`、`plan.md`（必须引用本 change 的 FR/AC ID、遵循 STD-005/006、每个任务写明对应测试、列出负责人确认点）、`verification.md`（至少含 AC ID、测试名、结果、未覆盖说明）；不写 `design.md`、`tasks.md`（CLI 强制时允许只含链接的最小 `tasks.md`）；`/opsx:apply` 不用 |
| §6 框架使用边界 | 需求阶段不调用 `superpowers:brainstorming`；plan 不写 `docs/superpowers/`；框架内部派生的 subagent（如代码审查）照常使用；不使用项目自定义 subagent |
| §7 命令速查 | `/opsx:explore`、`/opsx:propose`、`openspec validate --change <c>`、`/opsx:archive`（基础设施/纯文档 change 用 `openspec archive <c> --skip-specs`）；SuperPowers：`writing-plans`、`using-git-worktrees`、`test-driven-development`、`executing-plans`、`verification-before-completion`、`requesting-code-review`、`finishing-a-development-branch` |
| 版本历史 | 追加 `2.0.0 | 2026-10-30 | 按 ADR-006 重写：取消 subagent 阶段与统一提示词模板；OpenSpec 管需求、SuperPowers 管实现；三级分级；openspec/specs 为需求正本` |

删除原 §4 Subagent Registry、§5 统一提示词模板、§8 中与 subagent 相关的误区行。

- [ ] **Step 2: 验证**

Run: `grep -nE 'requirement-analyst|architect\b|coder\b|tester\b|你作为|Subagent Registry' AI-WORKFLOW.md`
Expected: 无输出（版本历史中的旧行除外；如命中仅允许出现在 `| 1.` 开头的历史行）。

Run: `grep -c '^## ' AI-WORKFLOW.md`
Expected: `8`（§1–§7 + 版本历史）。

- [ ] **Step 3: Commit** — `git commit -m "[ai-workflow-v2] rewrite AI-WORKFLOW.md to v2.0.0 per ADR-006"`

---

### Task 4: 更新入口与叠加约束（`AGENTS.md`、`saiflow-*` skill、`openspec/config.yaml`）

**Files:**
- Modify: `AGENTS.md`（§3 目录树、§4 AI 协作入口、§7 硬规则第 9 条、版本历史）
- Modify: `.claude/skills/saiflow-conventions/SKILL.md`
- Modify: `.claude/skills/saiflow-requirements/SKILL.md`
- Modify: `openspec/config.yaml`

**Interfaces:**
- Consumes: Task 3 的 `AI-WORKFLOW.md` §2–§6 锚点。

- [ ] **Step 1: `AGENTS.md`** → `version: 3.0.0`
  - §3 目录树：新增 `legacy/  # 旧代码只读参考（ADR-006），不参与构建`；`.claude/` 注释改为 `skills / commands；archive 为已停用定义`。
  - §4 整节替换为 4 行：工作流见 `AI-WORKFLOW.md`；需求用 OpenSpec（`/opsx:explore`、`/opsx:propose`）；实现用 SuperPowers（从 `writing-plans` 起）；**需求阶段不调用 `superpowers:brainstorming`，plan 写入 `openspec/changes/<change>/plan.md`**，分级见 `AI-WORKFLOW.md` §3。删除“人类用统一薄提示词驱动……subagent 只回摘要”一句。
  - §7 第 9 条补一句：“验证与部署证据只写 `openspec/changes/<change>/verification.md`，不写入 `docs/`。”新增第 11 条：“`legacy/` 只读：可阅读参考，不修改、不被新代码引用。”
  - §7 第 7 条**不改**（属 B-0）。
  - 版本历史追加 `3.0.0 | 2026-10-30 | 按 ADR-006：取消 subagent 入口，OpenSpec 管需求、SuperPowers 管实现；新增 legacy/ 只读规则与验证证据位置`。

- [ ] **Step 2: `saiflow-conventions`**：删除“subagent 不能调用斜杠命令……”一行；新增 `## 工作流` 小节，3 条：链接 `AI-WORKFLOW.md` §2/§3/§6；plan 与 verification 的位置；`legacy/` 只读。description 去掉与 subagent 有关的字样。

- [ ] **Step 3: `saiflow-requirements`**：description 中“配合 requirement-analyst subagent 使用”改为“配合 `/opsx:propose` 使用”；产物节明确只有 `proposal.md` 与 delta `spec.md`；新增一条“AC 沿用 `AC-FR-<DOMAIN>-NNN-NN` ID；迁移旧 EPIC 时保留原 FR/AC ID”。

- [ ] **Step 4: `openspec/config.yaml`**
  - `context`：技术栈行改为“后端 Python ≥ 3.12 + FastAPI（STD-005）；前端 React（web-pc：Ant Design；line-mini：Ant Design Mobile，STD-006）”；“人类 AI 入口”行补“实现阶段由 SuperPowers 承担，见 AI-WORKFLOW.md”。
  - `rules`：删除 `design`、`tasks` 两项。
  - `operations`：删除 `apply`；`archive.guidance` 改为两条：“归档前确认 `verification.md` 中全部 AC 为通过或已说明”“纯文档/基础设施 change 使用 `--skip-specs`”。

- [ ] **Step 5: 验证**

Run: `grep -rnwE 'requirement-analyst|architect|coder|tester|subagent' AGENTS.md .claude/skills/saiflow-*/SKILL.md openspec/config.yaml | grep -vE '\| [0-9]+\.[0-9]+\.[0-9]+ \|'`
Expected: 不出现角色名；`subagent` 只出现在“不使用项目自定义 subagent / 框架内部 subagent 照常使用”的表述中。

Run: `openspec validate --all 2>&1 | tail -5`（若不支持 `--all`，改为 `openspec list`）
Expected: 配置可被解析，无 YAML 错误。

- [ ] **Step 6: Commit** — `git commit -m "[ai-workflow-v2] point AGENTS.md, saiflow skills and openspec config to workflow v2"`

---

### Task 5: 标准文档登记新目录与产物

**Files:**
- Modify: `docs/00-standards/Directory-Structure.md`（STD-004）
- Modify: `docs/00-standards/Document-Source-Guide.md`（STD-007）

- [ ] **Step 1: STD-004** → `version: 2.5.0`
  - 目录树：新增 `legacy/`（注释同 Task 4）；`openspec/changes/<change>/` 注释改为 `proposal / specs / plan / verification`；`.claude/` 下 `agents/` 行替换为 `archive/  # 已停用的 agent 与 skill（ADR-006）`。
  - §2 分层表：删除“执行 / `.claude/agents/`”行。
  - §3 放置规则新增第 12 条：`legacy/` 为旧代码只读参考，不在 pnpm glob 内，新版本稳定后删除（ADR-006 §6）。
  - 版本历史追加一行。

- [ ] **Step 2: STD-007** → `version: 1.1.0`：§3.2 表中删除 `design.md`、`tasks.md` 两行，新增 `plan.md`（`manual`，SuperPowers writing-plans，负责人确认）与 `verification.md`（`manual`，验证证据）；新增 `legacy/**` 行（`manual`，只读参考）。版本历史追加一行。

- [ ] **Step 3: 验证**

Run: `grep -nE 'legacy/|plan\.md|verification\.md|\.claude/agents' docs/00-standards/Directory-Structure.md docs/00-standards/Document-Source-Guide.md`
Expected: 两份文档均命中 `legacy/`、`plan.md`；`.claude/agents` 只出现在版本历史行或不出现。

- [ ] **Step 4: Commit** — `git commit -m "[ai-workflow-v2] register legacy/, .claude/archive and plan/verification in STD-004/007"`

---

### Task 6: 旧代码移入 `legacy/`

**Files:**
- Remove from git: `services/api/storage/files/**`、`services/api/storage/exports/**`（31 个文件）
- Move: `services/api` → `legacy/services/api`；`apps/web-pc` → `legacy/apps/web-pc`；`apps/line-mini` → `legacy/apps/line-mini`
- Create: `legacy/README.md`；`services/.gitkeep`、`apps/.gitkeep`（保留空的顶层目录）
- Modify: `.gitignore`（新增 `**/storage/files/`、`**/storage/exports/`）、`pnpm-lock.yaml`（由 pnpm 更新）

**Interfaces:**
- Produces: git tag `legacy-v1`，指向移动前的提交。

- [ ] **Step 1: 打 tag**（在移动前的提交上；仅本地）

Run: `git tag legacy-v1 && git tag --list legacy-v1`
Expected: `legacy-v1`

- [ ] **Step 2: 移除已入库的上传与导出文件**（STD-004 规则 9）

```bash
git rm -r -q --cached services/api/storage/files services/api/storage/exports
rm -rf services/api/storage/files services/api/storage/exports
```

在 `.gitignore` 追加 `**/storage/files/` 与 `**/storage/exports/`。

- [ ] **Step 3: 移动代码**

```bash
mkdir -p legacy/apps legacy/services
git mv services/api legacy/services/api
git mv apps/web-pc legacy/apps/web-pc
git mv apps/line-mini legacy/apps/line-mini
touch apps/.gitkeep services/.gitkeep
```

未跟踪的 `dist/`、`node_modules/`、`*.tsbuildinfo` 若留在原位，直接删除。

- [ ] **Step 4: 写 `legacy/README.md`**：说明来源（tag `legacy-v1`）、只读规则（不修改、不引用、不复制未经测试的代码）、不可部署、删除条件（新版本测试通过并运行一段时间后，ADR-006 §6）。

- [ ] **Step 5: 更新 pnpm 工作区**

Run: `pnpm install`
Expected: 成功退出（0 个 workspace 应用），`pnpm-lock.yaml` 中不再有 `apps/web-pc`、`apps/line-mini` importer。

- [ ] **Step 6: 验证**

Run: `git ls-files legacy | grep -cE 'storage/(files|exports)/'`
Expected: `0`

Run: `git ls-files apps services`
Expected: 只有 `apps/.gitkeep`、`services/.gitkeep`。

Run: `git ls-files legacy | grep -iE 'cookies|\.env$' `
Expected: 无输出（`.env.example` 允许）。

- [ ] **Step 7: Commit** — `git commit -m "[ai-workflow-v2] move existing code to read-only legacy/ (tag legacy-v1); untrack uploaded documents"`

---

### Task 7: 收尾检查、归档旧 change、验证记录与归档本 change

**Files:**
- Move（经 CLI）: `openspec/changes/web-pc-frontend-prototype`、`openspec/changes/verification-detail-sticky-layout` → `openspec/changes/archive/`
- Create: `openspec/changes/ai-workflow-v2/verification.md`

- [ ] **Step 1: 归档两个旧 change（不合并 spec）**

Run: `openspec archive web-pc-frontend-prototype --skip-specs -y && openspec archive verification-detail-sticky-layout --skip-specs -y`
Expected: 两个目录出现在 `openspec/changes/archive/` 下，`openspec/specs/` 仍为空。

- [ ] **Step 2: 全仓残留引用检查**（Review Focus 1）

Run: `grep -rnE 'requirement-analyst|\.claude/agents|你作为 ' --include='*.md' --include='*.yaml' . | grep -vE '^\./(legacy|node_modules|openspec/changes/archive|\.claude/archive)/' | grep -v 'ADR-006' | grep -vE '\| [0-9]+\.[0-9]+\.[0-9]+ \|'`
Expected: 无输出。

- [ ] **Step 3: 写 `verification.md`**：表格列 `检查项 | 命令 | 结果`，逐行记录 Task 2–7 的验证命令与实际输出摘要，以及 Review Focus 5 条各自的结论。

- [ ] **Step 4: 归档本 change**

Run: `openspec archive ai-workflow-v2 --skip-specs -y`
Expected: 成功。若因缺少 `tasks.md` 失败：创建只含一行 `见 plan.md` 加一个已勾选任务 `- [x] 按 plan.md 完成` 的 `tasks.md`，在 `verification.md` 中注明原因后重试。

- [ ] **Step 5: Commit** — `git commit -m "[ai-workflow-v2] archive legacy changes and this change; add verification record"`

- [ ] **Step 6: 交付** — 使用 `superpowers:finishing-a-development-branch`。合并方式与是否推送分支、推送 tag `legacy-v1` 由负责人决定；git 历史中仍含已移除的上传文件与 cookie 文件，是否清理历史一并提请负责人决定。
