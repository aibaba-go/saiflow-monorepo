# prd-package-rules — 验证记录

文档类变更，无代码与测试；验证方式为逐条核对与关键词检查。

## 决定 → 落点

| 决定 | 落点 |
|------|------|
| 1 计量单位（每页一次） | PRD §4.9 套餐表；Glossary“OCR 扫描次数”“月扫描配额”；Architecture §数据流；Data-Model `DM-Plan`/`DM-OcrJob` |
| 2 月底清零、次月重发；R9 部分月与年付 | PRD §4.9“月扫描配额”；Glossary“月扫描配额” |
| 3 / Q1 / R2 / R3 免费额度（100 次、可配、归属租户、叠加、先扣、到期暂停） | PRD §4.9、§4.6、§7.3 OQ-28；Glossary；Data-Model `DM-FreeQuota`、`DM-SystemSetting`；ADR-007 |
| 4 / R4 / R5 成员人数上限 | PRD §4.9、§4.6；Glossary；Data-Model `DM-Invitation`、`DM-SystemSetting` |
| 5 / Q3 / R1 团队租户、原地升级、无需认证 | PRD §4.9 用户与租户；Glossary；Personas P-07/P-08；Data-Model `DM-Tenant` |
| 6 开通周期 | PRD §4.9；Glossary“套餐”；Data-Model `DM-Subscription`、枚举“开通周期” |
| 7 复核不变 | PRD 未改动复核相关内容 |
| 8 / Q4 / R7 通知渠道与短信 | PRD §4.9“通知渠道”；Architecture 后端职责 |
| 9 / Q5 用量提醒 | PRD §4.9；Glossary“用量提醒”；Data-Model `DM-PlanReminder` |
| 10 / R6 到期提醒 | PRD §4.9；Glossary“到期提醒” |
| 11 其他档位差异 | PRD §4.9“其他档位差异” |
| 12 游客数据仅本人可见 | PRD §4.9 游客（原有） |
| Q2 / R8 企业认证可选、仅团队租户 | PRD §4.9；Glossary；Data-Model `DM-Enterprise`；ADR-007 |

## Review Focus 检查

1. `git grep "企业租户|月页|企业用户|已认证企业"`（排除 legacy、archive、EPIC、AC、Index、openapi.json、版本历史行）：仅剩 Vision-Scope“企业用户须可访问…Cloud Run”，指一般企业使用者，非租户类型，保留。
2. 企业认证在 PRD、Glossary、Data-Model、ADR-007 中均为可选，不作为升级、付费或订阅前提。
3. 短信仅 Intermediate / Advance 且已验证手机号；不在 B-2 首批。
4. 用量 / 到期提醒的节点、收件人、不补发在 PRD 与 Glossary 一致；Data-Model 只登记记录实体。
5. PRD §4.6 含“免费额度”“各档成员人数上限”两项参数；`DM-SystemSetting` 同步。

## 独立审查（opus，2026-10-30）

无 Critical。处理结果：

- 已修复（c014b96）：PRD §4.9 admin 职责旧措辞（“修改余额”）；使用入口 admin 行；Glossary/Data-Model“开发票前提”措辞；“同一周期”含义；免费额度配置项补入各处 admin 职责；Data-Model / Architecture `source` 版本；决定 11 写入 PRD；ADR-006 B-2 范围补充。
- 经负责人决定后修复（R1–R9）：团队租户到期续 Kinder；Kinder 人数配置与个人租户矛盾；超限处理；免费额度可用租户；到期后免费额度；用量提醒是否含免费额度；短信与手机号验证；到期提醒收件人；企业认证范围；部分月与年付；升级后的 owner 与申请目标（原地升级后自然解决）。

## 裁定（Rulings）

- 游客不接收用量提醒（原只规定不接收到期提醒）——游客无 owner 身份、无联系渠道 — 若错，B-2 需为游客补发站内提醒。
- `docs/30-design/openapi.json` 为 v1 旧接口契约，仍含“企业租户”等旧表述，本次不改，B-1 重建时整体替换 — 若错，读者可能误参照旧契约。
- `NFR.md` 未新增短信条目：短信不在 B-2 首批，随短信平台接入时补 — 若错，短信上线前缺少 NFR。

## 遗留（Minor，未处理）

- “月末前 3 天”未写明具体日（如 28/29/30 日之一），由 B-2 plan 按泰国时区确定。
