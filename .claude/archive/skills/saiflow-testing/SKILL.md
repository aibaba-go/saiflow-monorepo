---
name: saiflow-testing
description: SaiFlow 测试与验证纪律（只读）。运行测试并把结果映射到验收标准，如实报告，不修改业务代码。配合 tester subagent 使用。
---

# 测试与验证纪律

## 输入
- `openspec/changes/<change>/tasks.md` 与 `.../specs/**`（验收标准 AC）
- 相关实现代码（**只读**）

## 要求
- **只读**：不改业务代码、不改测试代码、不绕过门禁。发现缺陷应回报给 `coder`，不自行修复。
- **如实报告**：未运行 / 未覆盖的项必须显式标注，禁止把“未验证”报成“通过”。
- 运行后端 `pytest`、前端 `vitest`（以仓库实际命令为准），以及 `openspec validate --change <change>`。
- 测试产物（快照、日志）置于 `./temp/`。

## 产物（以摘要回报）
- 测试命令与结果；
- **AC 覆盖矩阵**（AC → 通过 / 失败 / 未覆盖）；
- 失败项与阻塞项。
