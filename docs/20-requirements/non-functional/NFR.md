---
doc_id: NFR-000
title: "SaiFlow — 非功能需求"
type: nfr
status: active
version: 1.2.0
updated: 2026-10-31
owner: Product Engineering
source: "PRD-001 §5；document-template-mapping v2 R1–R6；ADR-006/007"
---

# SaiFlow — 非功能需求（NFR）

> 横切质量目标。每项功能需求在其适用范围内继承这些约束；目标不是实测通过结论。分类使用 `ID-Conventions.md` 第 3 节定义的代码。
>
> **适用范围（2026-10-31）：** 保留历史 TextIn → Firestore → Cloud Functions → Cloud SQL 关系投影目标，不撤销其旧方案/另行批准范围；它们不是 FR-OCR-018..021 新 LLM 模板路径的依赖或验收目标。本期以 [ADR-006](../../30-design/adr/ADR-006-relational-template-storage.md)、[ADR-007](../../30-design/adr/ADR-007-llm-only-template-mapping.md) 及 [OCR-Pipeline](../../30-design/OCR-Pipeline.md) 为准。安全、不可变原始数据、版本追溯与持久性约束同时覆盖 PostgreSQL 模板路径，不因旧链路范围化而豁免。

## 1. 性能与可扩展性（`NFR-PERF`）

| ID | 需求 | 目标 | 优先级 |
|----|------|------|--------|
| NFR-PERF-001 | 单份文档端到端识别与转换时间 | 历史事件投影范围：从预处理完成至 TextIn、Firestore 载荷保存和 Cloud SQL 投影完成 ≤ **5 s**（p95；不含人工核验）；不套用于本期 LLM 模板映射 | P0 |
| NFR-PERF-002 | 每张图像预处理（矫正/裁剪）时间 | ≤ **1 s**（p95） | P0 |
| NFR-PERF-008 | Firestore 载荷到 Cloud SQL 转换延迟 | 历史事件投影范围：单份载荷创建后 ≤ **2 s**（p95）完成 Cloud Functions 关系投影；不是本期 MappingWorker 延迟目标 | P0 |
| NFR-PERF-003 | 批量吞吐量 | 批量模式下 ≥ **200 份文档/小时** | P1 |
| NFR-PERF-004 | 字段级 OCR 准确率（V1.0 基线） | 样本集上 ≥ **85%**；各字段目标 = PRD OQ-1 | P0 |
| NFR-PERF-005 | UI 对用户操作的响应 | 本地操作 ≤ **200 ms** | P0 |
| NFR-PERF-006 | 搜索/检索响应（V2.0+） | 筛选查询 ≤ **2 s** | P1 |
| NFR-PERF-007 | 本地存储读/写 | 导出 ≤ 1000 行 Excel 时无可感知延迟 | P0 |

本期 LLM 模板路径的真实匹配/字段准确率、耗时 p95 与 token 基线未运行，不以隔离测试推定性能目标已达标，也不另造延迟阈值。0.7 为未经样本校准的初始低分阈值；验证记录及待办见 [汇总 AC](../../40-acceptance/Acceptance-Criteria.md) 与 [变更任务](../../../openspec/changes/document-template-mapping/tasks.md)。

## 2. 安全与隐私（`NFR-SEC`）

| ID | 需求 | 详细信息 | 优先级 |
|----|------|----------|--------|
| NFR-SEC-001 | 云端静态加密 | GCS 文档、历史 Firestore 原文归档和 Cloud SQL 数据（含不可变 llm_json、模板/版本、映射与结果）均启用云平台静态加密 | P0 |
| NFR-SEC-002 | 私有云对象存储 | 文档字节仅存储于私有 GCS Bucket；不得使用公共 Bucket、匿名访问或由浏览器持有服务凭据 | P0 |
| NFR-SEC-003 | 隔离的操作权限 | 在服务端强制实施会话/任务归属/租户权限；本期 API/Worker 仅后端访问数据库与模型凭据；历史或另获批 Cloud Functions 仍使用职责分离的最小权限服务账号 | P0 |
| NFR-SEC-009 | TextIn 密钥与跨境控制 | TextIn 凭据仅存储于 Secret Manager；生产调用须在 OQ-7 的 PDPA 与跨境评估通过后启用 | P0 |
| NFR-SEC-010 | 原始识别载荷保护 | 历史 Firestore 原文按载荷版本不可变；本期 PostgreSQL raw 快照与模板版本只增不改（依法清理例外），浏览器不得直接读写存储，访问必须经服务端授权 | P0 |
| NFR-SEC-004 | 记录防篡改 | 变更日志与操作日志仅可追加且经过完整性检查 | P0 |
| NFR-SEC-005 | 可追溯操作日志 | 每项改变状态的操作均记录用户、时间、目标和结果 | P0 |
| NFR-SEC-006 | 密码存储 | 使用强单向哈希（bcrypt/argon2）；不得存储明文 | P0 |
| NFR-SEC-007 | PDPA 合规 | 按泰国 PDPA 处理个人数据；保留/删除策略 = PRD OQ-4 | P0 |
| NFR-SEC-008 | 会话安全 | 空闲会话超时；安全的本地会话 token | P1 |

## 3. 兼容性（`NFR-COMPAT`）

| ID | 需求 | 详细信息 | 优先级 |
|----|------|----------|--------|
| NFR-COMPAT-001 | 操作系统支持 | Windows 10/11 和 macOS（当前版本 −2） | P0 |
| NFR-COMPAT-002 | 输入设备 | 普通手机相机和家用扫描仪 | P0 |
| NFR-COMPAT-003 | 文件格式 | JPG、PNG、PDF（见 FR-UPLOAD-003） | P0 |
| NFR-COMPAT-004 | 办公软件 | 导出文件可在 MS Excel 和 LibreOffice Calc 中正确打开 | P0 |
| NFR-COMPAT-005 | 显示分辨率 | 从 1366×768 到 4K 均可用；响应式布局 | P1 |
| NFR-COMPAT-006 | 非标准纸张格式 | 容忍不同的泰国文档版式/尺寸（A4、A5、连续打印纸） | P0 |
| NFR-COMPAT-007 | ERP 兼容性（V2.0） | 为主流泰国本地 SME ERP 版本提供适配器 | P1 |

## 4. 易用性与无障碍性（`NFR-USAB`）

| ID | 需求 | 详细信息 | 优先级 |
|----|------|----------|--------|
| NFR-USAB-001 | 低操作门槛 | 新文员在接受 ≤ 5 分钟指引后完成上传→核验→导出 | P0 |
| NFR-USAB-002 | 零基础快速上手 | 首次运行向导；合理默认值；无需 IT 设置 | P0 |
| NFR-USAB-003 | 本地化交互 | 完整 UI 提供泰语（默认）、英语、中文 | P0 |
| NFR-USAB-004 | 清晰的错误与状态反馈 | 每项操作均有可见状态；错误经过本地化且可操作。LINE Mini App 的启动、页面、局部请求及按钮等待统一使用 SaiFlow F＋圆点标志、saiflow 字标、扫描光线与环绕光点；保留上传百分比、OCR 阶段及本地化操作文字，完成或失败后停止等待；套餐审核状态不作为网络加载。尊重 `prefers-reduced-motion`，等待状态提供可访问文字，不反复播报上传百分比；窄屏与泰语文案不遮挡输入或操作（AC-NFR-USAB-004-01/02/03） | P0 |
| NFR-USAB-005 | 简单直观的流程 | 从上传到结果的核心流程 ≤ 3 步 | P0 |

## 5. 可靠性与可用性（`NFR-REL`）

| ID | 需求 | 详细信息 | 优先级 |
|----|------|----------|--------|
| NFR-REL-001 | 云服务依赖反馈 | 当 Google Cloud 或 TextIn 不可用时，系统必须显示可操作的失败状态，不得声称离线完成 | P0 |
| NFR-REL-002 | 优雅失败 | 一份失败文档不得中止批次；应标记为失败且可重试 | P0 |
| NFR-REL-003 | 数据持久性 | 处理期间崩溃不得损坏 GCS 原件、历史 Firestore 原文、PostgreSQL raw/模板版本/映射及已持久化结果或已归档文档 | P0 |
| NFR-REL-004 | 恢复 | 重启或事件重放后恢复待处理任务，并通过幂等键避免重复关系投影 | P1 |

## 6. 数据完整性、存储与保留（`NFR-DATA`）

| ID | 需求 | 详细信息 | 优先级 |
|----|------|----------|--------|
| NFR-DATA-001 | 双重存储 | 每份已归档文档均保留原始图像 + 结构化数据 | P0 |
| NFR-DATA-002 | 可配置阈值 | 可按文档类型/字段配置置信度/核验阈值 | P1 |
| NFR-DATA-003 | 保留策略 | 可按 PDPA（PRD OQ-4）配置保留/删除 | P1 |
| NFR-DATA-004 | 金额精度 | 历史关系金额目标使用 `decimal(14,2)`；本期模板 JSON 的 decimal/amount 使用十进制字符串，amount 至少两位、超过两位不舍入或截断，保留精度警告；均不得发生浮点漂移 | P0 |
| NFR-DATA-005 | 备份与导出 | 支持 Cloud SQL 关系数据与 GCS/Firestore 对应元数据的受控备份或导出 | P1 |
| NFR-DATA-006 | 原始载荷可追溯性 | 历史关系投影关联 Firestore 载荷版本/已发布模板版本；本期映射固定关联 PostgreSQL raw_result_id、不可变 template_version_id 与结果归属，不设发布流程；转换不得覆盖原始 JSON | P0 |
| NFR-DATA-007 | 转换幂等性 | 历史投影同一 document_id/payload_version 重试不重复创建字段/行；本期映射条件认领、处理中复用及任务锁防重复完成，READY 切换不复制结果；显式 force 可新增尝试但受上限约束 | P0 |

## 7. 本地化与多语言（`NFR-I18N`）

| ID | 需求 | 详细信息 | 优先级 |
|----|------|----------|--------|
| NFR-I18N-001 | 混合文字系统 OCR | 在同一文档中识别泰语 + 英语 + 简体/繁体中文 | P0 |
| NFR-I18N-002 | 泰语日期/数字格式 | 历史标准化目标保留；本期模板日期为 string 原样保留，不转换佛历；数字仅按 string/integer/decimal/amount 的批准规则标准化，不引入日期或多语言字段配置 | P0 |
| NFR-I18N-003 | UI 外部化 | 所有字符串位于资源包中；不得硬编码文本 | P0 |
| NFR-I18N-004 | 货币 | 默认 THB；符号和格式经过本地化 | P0 |

## 8. 参考硬件（用于性能测量）

> 性能目标（NFR-PERF）在此基准上测量；低于该配置的部署可按比例调整目标。

| 组件 | 基准 |
|------|------|
| CPU | 四核 2.0 GHz（2020 年级别） |
| RAM | 8 GB |
| 存储 | SSD，持续写入 ≥ 100 MB/s |
| OS | Windows 10/11 或 macOS 12+ |

## 链接
- 功能需求：`docs/20-requirements/functional/`
- 安全设计决策：`docs/30-design/Architecture.md`

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.0 | 2026-10-31 | Product Engineering | 范围化历史5s/2s事件投影、decimal(14,2)/佛历目标；新模板金额字符串保精度/日期原样，安全/持久性/追溯覆盖PostgreSQL快照与映射；不宣称真实质量/性能或共享库发布验收 |
| 1.1.1 | 2026-10-18 | Product Engineering | 补充 NFR-USAB-004：LINE Mini App 统一品牌等待反馈，保留操作文案、上传进度与 OCR 阶段，支持减少动态效果；套餐审核不作为网络加载 |
| 1.1.0 | 2026-10-07 | Product Engineering | 新增 TextIn、Firestore 原始载荷、Cloud Functions 转换延迟、幂等性与云端可靠性约束 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 5 节生成初始 NFR（性能、兼容性、安全、易用性） |
