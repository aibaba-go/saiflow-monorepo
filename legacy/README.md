# legacy/ — 旧代码只读参考

本目录是按 ADR-006（`docs/30-design/adr/ADR-006-ai-native-workflow.md` §6）重建前的代码，来源为 git tag `legacy-v1`：

| 目录 | 原位置 | 说明 |
|------|--------|------|
| `services/api/` | `services/api/` | Flask 后端（未按 STD-005） |
| `apps/line-mini/` | `apps/line-mini/` | Vue 版 LINE Mini App（未按 STD-006） |
| `apps/web-pc/` | `apps/web-pc/` | React 原型，全部基于 mock |

## 规则

- **只读**：可阅读参考，不修改。
- **不引用**：新代码不得 import、链接或复制这里未经测试的代码。重建时先把旧代码中已验证的边界处理写成 AC 与测试，再重新实现。
- **不可部署**：不保留构建与部署路径；不在 pnpm 工作区 glob 内，不参与构建与测试。
- **删除条件**：新版本测试通过并运行一段时间后删除本目录，tag `legacy-v1` 保留。
