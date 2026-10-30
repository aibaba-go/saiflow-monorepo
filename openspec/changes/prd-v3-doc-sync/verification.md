# prd-v3-doc-sync — 验证记录

本 change 只改文档（`skip_specs: true`），没有 AC。以下记录各任务改前、改后检查的实际结果，执行于 2026-10-30，分支 `chore/ai-workflow-v2`，起点 `d7e5fa3`。

## 任务检查

| 检查项 | 命令 | 结果 |
|--------|------|------|
| T1 PRD §4.9 | `grep -c '账户、租户与计费' PRD-SaiFlow.md` | 改前 `0`，改后 `4` |
| T1 无实现标识 | `grep -nE 'tenant_id\|subscriptions\|402\|PLAN_EXPIRED\|user_tenant\|/api/v1'` PRD | 无命中 |
| T1 EPIC 提示框 | `grep -L '以 PRD 为准' EPIC-0{1,2,3,4,6,8}-*.md` | 无输出（6/6 已加） |
| T2 术语 | 25 个术语逐个 `grep "\*\*<术语>"` Glossary | 改前缺 25 个，改后缺 0 个；无实现标识 |
| T3 范围与画像 | `grep -cE '租户\|游客\|web-pc'` Vision-Scope / Personas | 改前 `0`/`0`，改后 `6`/`12`；`P-08\|P-09` 6 行 |
| T4 NFR | `grep -cE 'NFR-SEC-011\|NFR-SEC-012\|NFR-REL-005\|NFR-PERF-009\|NFR-COMPAT-008'` | 改前 `0`，改后 `6`（5 条需求 + 版本历史 1 行） |
| T5 ADR-007 | 存储行计数；`grep -c 'OQ-27'` | 存储行 `10`；OQ-27 `5` |
| T6 Architecture | 旧实现特征 `Cloud Functions（Firestore 触发）\|JSONPath\|psycopg\|index-*.js` | 改前 `5`，改后 `0`；`^## [0-7]\.` 共 `8` 个；ADR-007 引用 `11` |
| T7 Data-Model | 字段表行 `^\| *(id\|tenant_id\|created_at) *\|` | 改前 `21`，改后 `0`；不同 DM ID `34`（21 个实体 + v1 去向表） |
| T8 标准 | `grep -c '代码为唯一来源'` STD-004 / STD-007 / TPL-04 / AI-WORKFLOW | 改前均 `0`，改后 `1`/`2`/`3`/`2`；AGENTS.md 中 ADR-007 `0` → `3` |
| T9 过程证据 | `git diff d7e5fa3..HEAD -- docs AGENTS.md AI-WORKFLOW.md \| grep '^+\|' \| grep -nE '[0-9]+ 项\|通过\|哈希\|切流\|index-*.js'` | 3 处命中，均为正文内容而非过程证据：“11 项决定”、NFR-SEC-011 的“强单向哈希”、NFR-REL-004 的“通过幂等键” |
| T9 相对链接 | 对本 change 修改的 `.md` 提取 `](相对路径)` 并 `test -e` | 1 处缺失，为 `plan.md` 中的字面示例 `](相对路径)`，不是链接 |
| T9 OpenSpec | `openspec validate prd-v3-doc-sync` | `Change 'prd-v3-doc-sync' is valid` |

## Task 7 逐行核对：实体存储与 ADR-007

| ADR-007 数据 | 实体 | ADR-007 存储 | Data-Model 存储 |
|--------------|------|--------------|-----------------|
| 原始单据、导入、导出、头像等对象 | `DM-StoredObject` | 私有 GCS | 私有 GCS |
| 表单数据（结构化结果、版本、状态、核验与复核记录） | `DM-FormDocument` | Firestore | Firestore |
| 原始识别载荷 | `DM-ExtractionPayload` | Firestore | Firestore |
| 用户与关联身份、租户、企业及认证、成员关系、角色、邀请 | `DM-User`、`DM-UserIdentity`、`DM-Tenant`、`DM-Enterprise`、`DM-Membership`、`DM-Role`、`DM-Invitation` | Cloud SQL | Cloud SQL |
| 套餐目录、订阅、申请、到期提醒、站内通知 | `DM-Plan`、`DM-Subscription`、`DM-Application`、`DM-PlanReminder`、`DM-Notification` | Cloud SQL | Cloud SQL |
| 文件元数据、识别任务 | `DM-File`、`DM-OcrJob` | Cloud SQL | Cloud SQL |
| 文档格式模板、系统参数 | `DM-DocumentTemplate`、`DM-SystemSetting` | Cloud SQL | Cloud SQL |
| 操作日志 | `DM-OperationLog` | Cloud SQL | Cloud SQL |
| 平台 admin 账号 | `DM-AdminAccount` | Cloud SQL（分表隔离） | Cloud SQL（分表隔离） |
| 报表数据（方式 B） | 未登记（后续能力，OQ-8） | Cloud SQL | — |

21/21 一致。

## Review Focus 结论

| # | 风险 | 结论 |
|---|------|------|
| 1 | 读者仍按旧 EPIC 实现 | 6 份 EPIC 已加“以 PRD 为准”提示框，见 T1 |
| 2 | 实现细节渗入产品文档 | PRD、Glossary、NFR 新增内容无实现标识，见 T1、T2、T4 |
| 3 | 入站链接失效 | Architecture §5、§6 标题保留；旧 §3.1 锚点与 Data-Model 旧小节不再存在，由 EPIC 提示框指向 tag `legacy-v1`；Data-Model 新增 v1 实体去向表 |
| 4 | 术语遗漏 | 25/25 术语已定义，见 T2 |
| 5 | ADR 与设计文档不一致 | 21/21 一致，见上表 |

## 执行中的裁定

- NFR-PERF-008、PERF-001、REL-004 描述了 ADR-007 取消的 Cloud SQL 关系投影：PERF-008 标为 v3 废弃（保留 ID），另两条改写措辞。
- 删除 Architecture 旧 §3.1（品牌等待设计），以“交互规范见 NFR-USAB-004”代替。
- Data-Model 新增 §2.1“v1 实体去向”，因 `OCR-Pipeline.md`、`API-Spec.md` 与 EPIC 仍引用 v1 实体 ID。
- 登录会话、邮箱验证码不作为实体登记，留到 B-2 的 `plan.md`。
- 归档放在最终审查之后，使本记录能包含审查结论。
