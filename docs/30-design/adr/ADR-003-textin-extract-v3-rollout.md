---
doc_id: ADR-003
title: "ADR-003 — OCR 提取路径以 extract-v3 为主、Prompt 模式为兜底双轨灰度"
type: adr
status: proposed
version: 1.0.0
updated: 2026-10-20
owner: Product Engineering
related: [openspec/changes/textin-extract-v3, EPIC-02, ADR-002]
---

# ADR-003 — OCR 提取路径以 extract-v3 为主、Prompt 模式为兜底双轨灰度

## 状态

建议中（随变更 `textin-extract-v3` 落地、extract-v3 契约确认后转为已接受）。

## 背景

- 当前唯一提取路径是 TextIn Prompt 模式（`extract_with_prompt`）→ 解析 `llm_json` → 可选 DeepSeek 二次整理。抽取字段由模型自由生成，schema 不受控。
- TextIn 提供 extract-v3 智能抽取接口：先 `parse/sync` 拿 OCR JSON，再把 OCR JSON 回传给 extract-v3，由**厂商侧 schema**决定抽取哪些 key，输出结构稳定、延迟更可控。
- schema 字段由 TextIn web 控制台配置，API 侧不传 schema，符合「产物即契约、单一事实来源」的原则。
- 厂商契约（字段集合、confidence、bbox、是否含表格）尚未确认，存在实现返工风险，因此必须能一键退回旧路径。

## 决策

- **双轨并存**：extract-v3 作为可选支路，Prompt 模式保留为回退，不再删除。DeepSeek 二次整理在两条支路后都继续生效。
- **输入形态**：extract-v3 支路走 `parse/sync → extract_v3_from_ocr_json`，OCR JSON 在服务内串联，不落库、不回调。
- **开关**：`EXTRACT_V3_ENABLED`（环境变量，缺省 `false`）作全局总开关；任务级 `params.extract_v3`（`bool | null`）可单独覆盖，优先级高于全局。
- **回退**：extract-v3 支路任一阶段失败即自动回退 Prompt 模式，实际路径与失败原因回写 `ocr_jobs.capability.extractor` / `.fallback_reason`，便于事后统计回退率。
- **灰度顺序**：契约对齐 → 影子比对（结果不写库）→ 小流量开全局开关 → 全量。

## 后果

**正面**

- 抽取字段由厂商 schema 约束，字段集稳定，核验页返工率下降。
- 两轨并存使厂商故障、契约变更、效果回退都只需翻开关，不发版。
- `capability` 记录实际路径，回退率、尾延迟可直接从库中统计，不依赖日志。

**负面 / 代价**

- 两条支路的结构化结果形状不同（v3 为扁平 KV，Prompt 为嵌套 JSON），`normalize_v3_to_ir` 需要长期维护对齐逻辑。
- 灰度期需同时观测两条支路的字段数、KV 空率与尾延迟。
- 依赖厂商侧 schema 配置：控制台改动不在本仓库代码评审范围内，schema 变更不可追溯。

**风险与对策**

| 风险 | 对策 |
|------|------|
| extract-v3 契约与假设不符 | 影子期只比对不写库；不符即保持 `EXTRACT_V3_ENABLED=false`，代码路径已就绪不发版 |
| extract-v3 回退率上升 | 阈值 >30% 告警；回退本身不影响任务可用性 |
| extract-v3 尾延迟不达 NFR-PERF-001 | 影子期看尾延迟；不达标即保持 Prompt 模式为默认 |
| schema 在厂商控制台被误改 | 影子期每周核对字段集命中率，异常时回退并联系厂商 |

## 回滚

| 层级 | 操作 | 生效时间 |
|------|------|----------|
| 全局 | `EXTRACT_V3_ENABLED=false` + 重启 / PM 推送 | 约 5 分钟 |
| 任务级 | 创建任务时传 `params.extract_v3=false` | 立即，不需重启 |

## 关联

- 变更目录：`openspec/changes/textin-extract-v3/`（design.md 含契约假设与 TODO 清单）
- 能力字段契约：design §7.2；错误与回退矩阵：design §6