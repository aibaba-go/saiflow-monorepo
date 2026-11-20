# adopt-vps-docker — 验证记录

只改文档，无代码与测试。

| 检查 | 方法 | 结果 |
|------|------|------|
| 负责人决定 H1–H9、S1–S9 全部写入 | 对照 proposal 与 `docs/30-design/adr/ADR-008-vps-docker-hosting.md` | 通过 |
| 现行文档不再把 Cloud Run / Cloud SQL / Firestore / Secret Manager / Dataflow / Cloud Functions 当作现行方案 | `git grep` 上述词，排除 `legacy/`、已归档 change、`rebuild-skeleton`、EPIC/AC/需求索引、`OCR-Pipeline.md`、被取代的 ADR；剩余命中均为版本历史、v2.2.2 对比列、已标注“按 ADR-008 修订”的原结论或 ADR-008 自身的背景说明 | 通过 |
| ADR 状态 | ADR-001、ADR-007 为 superseded；ADR-005 补充说明；Architecture §7 列出 ADR-008 | 通过 |
| 未改的文件 | EPIC-*、Acceptance-Criteria、Requirements-Index（AGENTS.md 规则 6，迁入 openspec/specs 时改写）；`OCR-Pipeline.md` 只加过时说明（B-3 重写）；`openapi.json`（B-1 Task 4 替换） | 已记录于 proposal“实施说明” |
| 负责人审阅 | 2026-11-03 | 无需修改 |
