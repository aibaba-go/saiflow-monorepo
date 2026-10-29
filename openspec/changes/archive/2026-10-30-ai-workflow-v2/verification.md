# ai-workflow-v2 — 验证记录

本 change 不含行为需求（`skip_specs: true`），没有 AC。以下记录各任务的检查命令与实际结果，执行于 2026-10-30，分支 `chore/ai-workflow-v2`。

## 任务检查

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 前置：历史清理 | `git log --oneline <branch> -- services/api/storage/files services/api/storage/exports services/api/sf-cookies.txt`（5 个本地分支） | 每个分支 0 条提交；旧对象仅剩 `origin/*` 远端跟踪引用可达，force push 后消失 |
| T1 ADR 生效 | `grep '^status:' docs/30-design/adr/ADR-006-ai-native-workflow.md` | `status: accepted` |
| T2 agent 归档 | `ls .claude/agents; ls .claude/skills; ls .claude/archive/*` | `.claude/agents` 不存在；skills 剩 6 个 `openspec-*` + `saiflow-conventions`、`saiflow-requirements`；archive 下 4 个 agent、2 个 skill |
| T3 AI-WORKFLOW v2 | `grep -nE 'requirement-analyst\|你作为\|Subagent Registry' AI-WORKFLOW.md`；`grep -c '^## '` | 无命中；`8` 个二级标题 |
| T4 入口与配置 | `grep -rnwE 'requirement-analyst\|architect\|coder\|tester' AGENTS.md .claude/skills/saiflow-*/SKILL.md openspec/config.yaml` | 无命中 |
| T4 OpenSpec 校验 | `openspec validate --all` | 首次失败：无 delta 的 change 被拒绝；在 `.openspec.yaml` 设 `skip_specs: true` 后 `3 passed, 0 failed` |
| T5 标准登记 | `grep -nE 'legacy/\|plan\.md'` STD-004、STD-007 | 两份均命中 |
| T6 legacy 移动 | `git ls-files apps services` | 只有 `apps/.gitkeep`、`services/.gitkeep` |
| T6 敏感文件 | `git ls-files legacy \| grep -E 'storage/(files\|exports)/'`；`grep -iE 'cookies\|\.env$'` | 均为 0 |
| T6 pnpm 工作区 | `pnpm install` | 退出码 0，移除 409 个包；`pnpm-lock.yaml` 不再含 `apps/web-pc`、`apps/line-mini` |
| T6 tag | `git tag --list legacy-v1` | `legacy-v1`（本地，未推送） |
| T7 旧 change 归档 | `openspec archive <c> --skip-specs -y` ×2 | 归档为 `2026-10-30-web-pc-frontend-prototype`、`2026-10-30-verification-detail-sticky-layout`；`openspec/specs/` 仍不存在 |
| T7 残留引用 | 全仓 grep `requirement-analyst\|\.claude/agents\|你作为`（排除 legacy、archive、历史行、ADR-006） | 只命中本 change 的 `plan.md`、`proposal.md`（描述迁移本身，随本 change 归档） |

## Review Focus 结论

| # | 风险 | 结论 |
|---|------|------|
| 1 | 残留引用 | 已排除，见 T7 |
| 2 | 归档后仍被加载 | `.claude/agents/` 已不存在，见 T2 |
| 3 | pnpm 工作区报错 | `pnpm install` 成功，见 T6 |
| 4 | 真实单据随 legacy 入库 | 31 个上传/导出文件已从全部分支历史中清除，`legacy/` 中为 0，见前置与 T6 |
| 5 | CLI 对无 spec change 的处理 | `validate` 需 `skip_specs: true`，已写入 `AI-WORKFLOW.md` §7 与 `openspec/config.yaml`；`archive --skip-specs` 对旧 change 成功 |

## 未覆盖

- 未推送：分支、tag `legacy-v1`、5 个被改写历史的分支均只在本地，force push 待负责人确认。
- `pnpm -r build/test/lint`：工作区当前没有应用，未运行（B-1 重建后恢复）。

## 终审后订正（2026-10-30）

| 终审发现 | 处理 | 复查 |
|----------|------|------|
| C1 `legacy/services/api/sample/` 两个文件含明文数据库密码（Firestore Mongo、Cloud SQL 公网 IP） | 从当前代码树删除；历史清除与密码轮换待负责人决定 | 见下一行 |
| C1 补充：复扫发现 TextIn App ID / Secret Code（`config.py`、`textin/config.py` 默认值）与 MySQL 主机 / 密码（`migrate_mysql_to_pg.py` 默认值）也是真实值 | 当前代码树中默认值改为空字符串；历史清除与轮换待负责人决定 | 32 位十六进制默认值、`AIza`/`sk-`/私钥/URL 内嵌凭据扫描 `legacy/` 均为 0 |
| C2 tag `20261018`、`20261020` 仍指向未清理的旧历史（各 32 个命中），上文“旧对象仅剩 `origin/*` 可达”的表述**不成立** | 待与 C1 一并改写 tag 后 force push | 见负责人确认后的推送记录 |
| C3 `openspec validate --change` 在 CLI 1.10.0 报 `unknown option` | 全部改为 `openspec validate <change>` | 非归档文档中命中 0 |
| I1 `/opsx:propose` 官方 skill 会继续生成 design/tasks | `AI-WORKFLOW.md` §6 明确“只生成到 specs 为止”，status/archive 提示属预期 | — |
| I2 `AGENTS.md` 读取顺序与规则 6 仍以 EPIC/AC 为正本 | 改为以 `openspec/specs/` 为正本，未迁移时仅作参考 | — |
| I3 STD-004 仍有 subagent 措辞与 `design.md` | 改为 `plan.md` 与新描述 | 命中 0 |
| I4 `apps/`、`services/` 被写成现状 | 标注“B-1 重建的目标结构，当前为空”，禁止在 `legacy/` 执行命令 | — |
