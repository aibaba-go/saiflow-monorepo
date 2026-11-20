---
doc_id: REQ-INDEX
title: "SaiFlow — 需求索引与可追溯性矩阵"
type: index
status: active
version: 1.15.0
updated: 2026-11-07
owner: Product Engineering
---

# SaiFlow — 需求索引与可追溯性矩阵

> **注意（2026-10-30）：** 本文件尚未按 PRD v3 改写，与 `PRD-SaiFlow.md` v3.1 冲突时以 PRD 为准；将随 ADR-006 §7 的重建步骤迁入 `openspec/specs/`。文中引用的 `Architecture` / `Data-Model` 旧章节细节见 git tag `legacy-v1` 中的版本。

> 所有需求的主索引。用于保持 PRD → 需求 → 设计 → 验收链路可导航且可审计。每当需求变更时更新本文件（见 `ID-Conventions.md` 第 6 节）。

## 1. Epic 概览

| Epic | 能力 | 文档 | 优先级（V1.0） | PRD 来源 |
|------|------|------|----------------|----------|
| EPIC-01 | 文档上传与预处理 | `functional/EPIC-01-document-upload.md` | P0 | §4.1 |
| EPIC-02 | 多类型文档 OCR 识别 | `functional/EPIC-02-ocr-recognition.md` | P0 | §4.2 |
| EPIC-03 | 数据核验与修改 | `functional/EPIC-03-data-verification.md` | P0 | §4.3 |
| EPIC-04 | 多渠道录入与归档 | `functional/EPIC-04-entry-archiving.md` | P0 / P1 | §4.4 |
| EPIC-05 | 文档管理与检索 | `functional/EPIC-05-doc-management.md` | P1 / P2 | §4.5 |
| EPIC-06 | 基础系统（账户/配置/i18n） | `functional/EPIC-06-system-base.md` | P0 | §4.6 |
| EPIC-07 | 运营报表 | `functional/EPIC-07-operational-reporting.md` | P1（待 OQ-5） | §3.1 场景 3、§4.7 |
| EPIC-08 | 文档格式模板配置 | `functional/EPIC-08-document-template-configuration.md` | P1（待 OQ-9） | §4.8 |
| NFR | 非功能需求 | `non-functional/NFR.md` | P0 | §5 |

## 2. 功能需求矩阵

| ID | 标题 | 优先级 | 来源 | 依赖项 | 验证方式 | 设计引用 | 状态 |
|----|------|--------|------|--------|----------|----------|------|
| FR-UPLOAD-001 | 手机相机上传 | P0 | §4.1 | — | AC-FR-UPLOAD-001-01 | API-1 | active |
| FR-UPLOAD-002 | 扫描仪/文件导入 | P0 | §4.1 | — | AC-FR-UPLOAD-002-01 | API-1 | active |
| FR-UPLOAD-003 | 支持的格式与上限 | P0 | EPIC-01（已迁移，`ocr-scan-flow`） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-UPLOAD-004 | 拒绝不支持的格式 | P0 | §4.1 | 003 | AC-FR-UPLOAD-003-02 | API-1 | active |
| FR-UPLOAD-005 | 分步上传与批量上传 | P0 | EPIC-01（已迁移，`ocr-scan-flow`） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-UPLOAD-006 | 矫正与裁剪 | P0 | EPIC-01（已迁移，`ocr-scan-flow`） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-UPLOAD-007 | 去除阴影 | P1 | §4.1 | 001 | AC-FR-UPLOAD-007-01 | OCR-Pipeline | active |
| FR-UPLOAD-008 | 降噪 | P1 | §4.1 | 001 | AC-FR-UPLOAD-008-01 | OCR-Pipeline | active |
| FR-UPLOAD-009 | 自动裁剪 | P0 | §4.1 | 006 | AC-FR-UPLOAD-009-01 | OCR-Pipeline | active |
| FR-UPLOAD-010 | 上传状态 | P0 | EPIC-01（已迁移，`ocr-scan-flow`） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-UPLOAD-011 | 原件保留与读取 | P0 | EPIC-01（已迁移，`ocr-scan-flow`） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-UPLOAD-012 | 低质量警告 | P1 | §5.4 | 006 | AC-FR-UPLOAD-012-01 | OCR-Pipeline | active |
| FR-UPLOAD-013 | 待处理记录 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-UPLOAD-014 | 按链接导入 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/documents/spec.md` | `openspec/specs/documents/spec.md` | active |
| FR-OCR-001 | 文档类型处理 | P0 | §4.2 | UPLOAD-006 | AC-FR-OCR-001-01 | OCR-Pipeline | active |
| FR-OCR-002 | PO 字段提取 | P0 | §4.2 | OCR-001 | AC-FR-OCR-002-01 | DM-ExtractedField | active |
| FR-OCR-003 | Delivery Note 提取 | P0 | §4.2 | OCR-001 | AC-FR-OCR-003-01 | DM-ExtractedField | active |
| FR-OCR-004 | Invoice 提取 | P0 | §4.2 | OCR-001 | AC-FR-OCR-004-01 | DM-ExtractedField | active |
| FR-OCR-005 | Receipt 提取 | P0 | §4.2 | OCR-001 | AC-FR-OCR-005-01 | DM-ExtractedField | active |
| FR-OCR-006 | Bill 提取 | P1 | §4.2 | OCR-001 | AC-FR-OCR-006-01 | DM-ExtractedField | active |
| FR-OCR-007 | Credit Note 提取 | P1 | §4.2 | OCR-001 | AC-FR-OCR-007-01 | DM-ExtractedField | active |
| FR-OCR-008 | Tax Receipt 提取 | P1 | §4.2 | OCR-001 | AC-FR-OCR-008-01 | DM-ExtractedField | active |
| FR-OCR-009 | Delivery Instruction（自由文本） | P2 | §4.2 | OCR-001 | AC-FR-OCR-009-01 | DM-ExtractedField | active |
| FR-OCR-010 | 行项目表提取 | P0 | §4.2 | OCR-001 | AC-FR-OCR-010-01 | DM-LineItem | active |
| FR-OCR-011 | 泰语/英语/中文混合识别 | P0 | §4.2 | OCR-001 | AC-FR-OCR-011-01 | OCR-Pipeline | active |
| FR-OCR-012 | 按字段输出置信度评分 | P0 | §3.2 | OCR-002 | AC-FR-OCR-012-01 | DM-ExtractedField | active |
| FR-OCR-013 | 金额校验 | P0 | EPIC-02（已迁移，`ocr-ui-parity`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-014 | 签字检测 | P1 | §4.2 | OCR-001 | AC-FR-OCR-014-01 | DM-ExtractedField | active |
| FR-OCR-015 | 低置信度标记 | P0 | §3.1 | OCR-012 | AC-FR-OCR-015-01 | DM-ExtractedField | active |
| FR-OCR-016 | 标准化 | P0 | EPIC-02（已迁移，`ocr-ui-parity`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-017 | 识别任务 | P0 | EPIC-02（已迁移，`ocr-scan-flow`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-018 | 原始识别结果 | P0 | EPIC-02（已迁移，`ocr-scan-flow`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-019 | 大模型匹配模板 | P0 | EPIC-02（已迁移，`ocr-scan-flow`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-020 | 按模板转换与重试 | P0 | EPIC-02（已迁移，`ocr-scan-flow`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-021 | OCR 引擎与切换 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-022 | 后台处理与恢复 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-023 | 通用结果 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-OCR-024 | 模板匹配的展示信息 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-VERIFY-001 | 并排展示结果 | P0 | §4.3 | OCR-012 | AC-FR-VERIFY-001-01 | API-4 | active |
| FR-VERIFY-002 | 单字段编辑 | P0 | §4.3 | VERIFY-001 | AC-FR-VERIFY-002-01 | DM-ChangeLog | active |
| FR-VERIFY-003 | 批量更正 | P1 | §4.3 | VERIFY-002 | AC-FR-VERIFY-003-01 | API-4 | active |
| FR-VERIFY-004 | 错误红色标记 | P0 | §4.3 | OCR-015 | AC-FR-VERIFY-004-01 | API-4 | active |
| FR-VERIFY-005 | 缺失字段提醒 | P0 | §4.3 | VERIFY-001 | AC-FR-VERIFY-005-01 | API-4 | active |
| FR-VERIFY-006 | 确认后锁定 | P0 | EPIC-03（已迁移，`ocr-scan-flow`） | — | `openspec/specs/results/spec.md` | `openspec/specs/results/spec.md` | active |
| FR-VERIFY-007 | 修改记录 | P0 | EPIC-03（已迁移，`review-flow`） | — | `openspec/specs/results/spec.md` | `openspec/specs/results/spec.md` | active |
| FR-VERIFY-008 | 边界框高亮 | P1 | §4.3 | VERIFY-001 | AC-FR-VERIFY-008-01 | API-4 | active |
| FR-VERIFY-009 | 确认门控 | P0 | EPIC-03（已迁移，`ocr-scan-flow`） | — | `openspec/specs/results/spec.md` | `openspec/specs/results/spec.md` | active |
| FR-VERIFY-010 | 复核层级设置 | P0 | EPIC-03（已迁移，`review-flow`） | — | `openspec/specs/reviews/spec.md` | `openspec/specs/reviews/spec.md` | active |
| FR-VERIFY-011 | 确认后进入复核 | P0 | EPIC-03（已迁移，`review-flow`） | — | `openspec/specs/reviews/spec.md` | `openspec/specs/reviews/spec.md` | active |
| FR-VERIFY-012 | 复核通过 | P0 | EPIC-03（已迁移，`review-flow`） | — | `openspec/specs/reviews/spec.md` | `openspec/specs/reviews/spec.md` | active |
| FR-VERIFY-013 | 退回与复核记录 | P0 | EPIC-03（已迁移，`review-flow`） | — | `openspec/specs/reviews/spec.md` | `openspec/specs/reviews/spec.md` | active |
| FR-VERIFY-019 | 复核队列与查看 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/reviews/spec.md` | `openspec/specs/reviews/spec.md` | active |
| FR-VERIFY-014 | 原图置顶与全屏触控缩放（上传确认页、结果页、最终结果页、公司证书） | P0 | 界面调整 2026-10-17/19 | VERIFY-001 | AC-FR-VERIFY-014-01/02 | OriginalPreview、ImageViewer | active |
| FR-VERIFY-015 | 结构化结果的版本化修改 | P0 | EPIC-03（已迁移，`ocr-scan-flow`） | — | `openspec/specs/results/spec.md` | `openspec/specs/results/spec.md` | active |
| FR-VERIFY-016 | LINE 确认前认证与工作空间订阅检查；已注册付费用户显式确认后进入最终页，恢复未完成任务返回结果页 | P0 | 界面调整 2026-10-17/18 | VERIFY-006/SYS-011/SYS-012 | AC-FR-VERIFY-016-01/02 | DM-ResultVersion | active |
| FR-VERIFY-017 | 任务阶段与列表 | P0 | EPIC-03（已迁移，`ocr-scan-flow`） | — | `openspec/specs/results/spec.md` | `openspec/specs/results/spec.md` | active |
| FR-ENTRY-001 | 生成 Excel 模板 | P0 | §4.4 | VERIFY-006 | AC-FR-ENTRY-001-01 | DM-ExportJob | active |
| FR-ENTRY-002 | 一键填充 Excel | P0 | §4.4 | ENTRY-001 | AC-FR-ENTRY-002-01 | API-5 | active |
| FR-ENTRY-003 | 批量导出 | P0 | §4.4 | ENTRY-002 | AC-FR-ENTRY-003-01 | API-5 | active |
| FR-ENTRY-004 | 自定义保存路径 | P0 | §4.4 | ENTRY-002 | AC-FR-ENTRY-004-01 | DM-Settings | active |
| FR-ENTRY-005 | 双重存储归档 | P0 | §4.4 | UPLOAD-011 | AC-FR-ENTRY-005-01 | DM-ArchiveRecord | active |
| FR-ENTRY-006 | 自动文件命名 | P0 | §4.4 | ENTRY-005 | AC-FR-ENTRY-006-01 | DM-ArchiveRecord | active |
| FR-ENTRY-007 | 分类文件夹 | P0 | §4.4 | ENTRY-005 | AC-FR-ENTRY-007-01 | DM-ArchiveRecord | active |
| FR-ENTRY-008 | 私有 GCS 归档 | P0 | §4.4/§5.3 | — | AC-FR-ENTRY-008-01 | Architecture | active |
| FR-ENTRY-009 | 合并 PDF 账单包 | P1 | §3.1 | VERIFY-006 | AC-FR-ENTRY-009-01 | API-6 | active |
| FR-ENTRY-010 | 本地 ERP 对接 | P1 | §4.4 | VERIFY-006 | AC-FR-ENTRY-010-01 | API-6 | planned |
| FR-ENTRY-011 | 手动/自动 ERP 同步 | P1 | §4.4 | ENTRY-010 | AC-FR-ENTRY-011-01 | API-6 | planned |
| FR-ENTRY-012 | 管理系统字段映射 | P1 | §4.4 | ENTRY-010 | AC-FR-ENTRY-012-01 | API-6 | planned |
| FR-ENTRY-013 | JSON/CSV/Excel 导出 | P1 | §3.1 | ENTRY-002 | AC-FR-ENTRY-013-01 | API-5 | planned |
| FR-ENTRY-014 | 云端文件夹归档 | P2 | §4.4 | ENTRY-005 | AC-FR-ENTRY-014-01 | API-6 | planned |
| FR-ENTRY-015 | 已确认结果导出为 XLSX | P0 | EPIC-04（已迁移，`ocr-scan-flow`） | — | `openspec/specs/exports/spec.md` | `openspec/specs/exports/spec.md` | active |
| FR-MGMT-001 | 分类 | P0 | §4.5 | ENTRY-005 | AC-FR-MGMT-001-01 | DM-ArchiveRecord | active |
| FR-MGMT-002 | 按编号搜索 | P1 | §4.5 | MGMT-001 | AC-FR-MGMT-002-01 | API-7 | planned |
| FR-MGMT-003 | 按日期搜索 | P1 | §4.5 | MGMT-001 | AC-FR-MGMT-003-01 | API-7 | planned |
| FR-MGMT-004 | 按企业搜索 | P1 | §4.5 | MGMT-001 | AC-FR-MGMT-004-01 | API-7 | planned |
| FR-MGMT-005 | 按类型搜索 | P1 | §4.5 | MGMT-001 | AC-FR-MGMT-005-01 | API-7 | planned |
| FR-MGMT-006 | 文档预览 | P0 | §4.5 | ENTRY-005 | AC-FR-MGMT-006-01 | API-7 | active |
| FR-MGMT-007 | 历史记录查询 | P2 | §4.5 | VERIFY-007 | AC-FR-MGMT-007-01 | DM-ChangeLog | planned |
| FR-MGMT-008 | 关键词搜索 | P2 | §4.5 | OCR-002 | AC-FR-MGMT-008-01 | API-7 | planned |
| FR-MGMT-009 | 重复检测 | P1 | §4.5 | OCR-002 | AC-FR-MGMT-009-01 | DM-Document | planned |
| FR-MGMT-010 | 去重 | P2 | §4.5 | MGMT-009 | AC-FR-MGMT-010-01 | DM-Document | planned |
| FR-SYS-001 | LINE 登录与会话 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-002 | 角色与权限点（含原 FR-SYS-009） | P0 | PRD §4.9 v3.4 | SYS-001 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-003 | 操作日志 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-004 | 界面语言（英语默认） | P0 | PRD §4.6 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-005 | OCR 引擎与大模型配置 | P0 | PRD §4.6 v3.8 | SYS-002 | `openspec/specs/ocr-settings/spec.md` | `openspec/specs/ocr-settings/spec.md` | active |
| FR-SYS-006 | 归档与 GCS 存储设置 | P0 | §4.6 | SYS-002 | AC-FR-SYS-006-01 | DM-Settings | active |
| FR-SYS-007 | 账户锁定 | P1 | §5.3 | SYS-001 | AC-FR-SYS-007-01 | DM-User | planned |
| FR-SYS-008 | 用户偏好 | P1 | §4.6 | SYS-001 | AC-FR-SYS-008-01 | DM-Settings | planned |
| FR-SYS-009 | 并入 FR-SYS-002 | P0 | PRD §4.9 v3.4 | SYS-001 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-010 | 游客会话与数据归集 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-011 | LINE 确认前登录/注册；认证后按任务工作空间订阅恢复，不自动确认 | P0 | 用户流程调整 2026-10-17/18 | SYS-001/SYS-010 | AC-FR-SYS-011-01 | API-8 | active |
| FR-SYS-012 | 订阅与到期即停 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-013 | 扫描次数的预占与退还 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-014 | 注册 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-015 | 修改个人资料 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-016 | 更换邮箱 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-017 | 租户访问规则 | P0 | PRD §4.9 v3.4 | SYS-001 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-018 | 到期提醒 | P0 | PRD §4.9 v3.6 | SYS-012 | `openspec/specs/notifications/spec.md` | `openspec/specs/notifications/spec.md` | active |
| FR-SYS-019 | 平台管理员后台账号 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-020 | 邮箱验证码 | P0 | EPIC-06 v1.7.3（已迁移） | — | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-021 | 组织的申请与审批 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-022 | 平台 admin 管理组织 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-023 | 组织资料修改 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-024 | 成员邀请（一次性链接） | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-025 | 成员人数上限 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-026 | 成员移除与退出 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-027 | 企业认证 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-028 | 组织操作写入操作日志 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-029 | owner 转让 | P0 | PRD §4.9 v3.4 | SYS-017 | `openspec/specs/tenancy/spec.md` | `openspec/specs/tenancy/spec.md` | active |
| FR-SYS-030 | 套餐目录 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-031 | 免费额度 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-032 | 续费与开通申请 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-033 | 用量查询 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-034 | 计费操作写入操作日志 | P0 | PRD §4.9 v3.5 | — | `openspec/specs/billing/spec.md` | `openspec/specs/billing/spec.md` | active |
| FR-SYS-035 | 用量提醒 | P0 | PRD §4.9 v3.6 | SYS-012 | `openspec/specs/notifications/spec.md` | `openspec/specs/notifications/spec.md` | active |
| FR-SYS-036 | 通知中心 | P0 | PRD §4.9 v3.6 | SYS-012 | `openspec/specs/notifications/spec.md` | `openspec/specs/notifications/spec.md` | active |
| FR-SYS-037 | 提醒的收件人与投递 | P0 | PRD §4.9 v3.6 | SYS-012 | `openspec/specs/notifications/spec.md` | `openspec/specs/notifications/spec.md` | active |
| FR-SYS-038 | 组织免费额度的到期提醒 | P0 | PRD §4.9 v3.6 | SYS-012 | `openspec/specs/notifications/spec.md` | `openspec/specs/notifications/spec.md` | active |
| FR-SYS-040 | LINE 小程序启动与身份恢复 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-041 | LINE 登录 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-042 | 注册（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-043 | 登出 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-044 | 个人中心 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-046 | 租户切换 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-047 | 建组织申请（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-048 | 组织资料与成员 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-049 | 角色管理（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-050 | owner 转让与退出组织（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-051 | 企业认证申请（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-052 | 接受邀请 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-053 | 套餐、用量与续费申请（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-054 | 通知中心（小程序） | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-055 | 等待与错误反馈 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-056 | 底部导航 | P0 | PRD §4.9 v3.7 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-057 | 扫描与上传 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-058 | 待处理与开始识别 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-059 | 识别进度 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-060 | 登录、会话与首页（admin 后台） | P0 | PRD §4.9 v3.8 | — | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-061 | 修改本人口令（admin 后台） | P0 | PRD §4.9 v3.8 | SYS-019 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-062 | 界面语言（admin 后台，中文默认） | P0 | PRD §4.6 v3.8 | — | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-063 | 建组织申请审批 | P0 | PRD §4.9 v3.8 | SYS-021 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-064 | 组织管理 | P0 | PRD §4.9 v3.8 | SYS-022 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-065 | 企业认证审核 | P0 | PRD §4.9 v3.8 | SYS-027 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-066 | 订阅与预占 | P0 | PRD §4.9 v3.8 | SYS-012, SYS-013 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-067 | 续费与开通申请审批 | P0 | PRD §4.9 v3.8 | SYS-032 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-068 | 套餐目录与价格 | P0 | PRD §4.9 v3.8 | SYS-030 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-069 | 系统参数 | P0 | PRD §4.6 v3.8 | SYS-025, SYS-031 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-070 | 查询用户（admin 后台） | P0 | PRD §4.9 v3.8 | SYS-080 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-071 | 操作日志（admin 后台） | P0 | PRD §4.6 v3.8 | SYS-003 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-072 | OCR 与大模型配置（admin 后台） | P0 | PRD §4.6 v3.8 | SYS-005 | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-073 | 等待、确认与错误反馈（admin 后台） | P0 | PRD §4.9 v3.8 | — | `openspec/specs/web-admin/spec.md` | `openspec/specs/web-admin/spec.md` | active |
| FR-SYS-080 | 后台查询用户 | P0 | PRD §4.9 v3.8 | SYS-001 | `openspec/specs/identity/spec.md` | `openspec/specs/identity/spec.md` | active |
| FR-SYS-090 | LINE 登录与会话（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-091 | 未注册用户（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-092 | 退出登录（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-093 | 界面语言（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-094 | 布局与首页（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-095 | 个人资料（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-096 | 租户切换（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-097 | 建组织申请（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-098 | 组织资料与成员（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-099 | 角色管理（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-100 | owner 转让与退出组织（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-101 | 企业认证申请（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-102 | 套餐、用量与续费申请（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-103 | 通知中心（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-104 | 等待、确认与错误反馈（web-pc） | P0 | PRD §4.9 v3.9 | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-105 | 识别结果 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-106 | 确认结果 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-107 | 最终结果与导出 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-108 | 历史 | P0 | `ocr-scan-flow`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-109 | 扫描首页的配额与最近任务 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-110 | 上传队列与按链接导入 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-111 | 待处理的多选 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-112 | 确认页逐个浏览 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-113 | 原件查看器 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-114 | 结果页的视图与重置 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-115 | 更换模板面板 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-116 | 识别进度与最终结果的补充 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-117 | 历史搜索 | P0 | `ocr-ui-parity`（2026-11-06） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-118 | 界面与 main 一致（颜色、字体、圆角与间距改按 STD-008） | P0 | `ocr-ui-parity`（2026-11-06）；`ui-restyle`（2026-11-07）修改 | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-119 | 首页的待复核入口 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-120 | 复核队列与复核详情 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-121 | 复核设置 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-122 | 修改记录 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/line-mini/spec.md` | `openspec/specs/line-mini/spec.md` | active |
| FR-SYS-123 | 复核队列 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-124 | 复核详情 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-125 | 复核设置 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-126 | 待复核通知 | P0 | `review-flow`（2026-11-07） | — | `openspec/specs/notifications/spec.md` | `openspec/specs/notifications/spec.md` | active |
| FR-SYS-127 | 上传（web-pc） | P0 | `web-pc-ocr`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-128 | 识别状态（web-pc） | P0 | `web-pc-ocr`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-129 | 核验（web-pc） | P0 | `web-pc-ocr`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-130 | 单据库（web-pc） | P0 | `web-pc-ocr`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-131 | 单据详情与导出（web-pc） | P0 | `web-pc-ocr`（2026-11-07） | — | `openspec/specs/web-pc/spec.md` | `openspec/specs/web-pc/spec.md` | active |
| FR-SYS-132 | 统一的颜色与字体 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-SYS-133 | 单据状态的颜色 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-SYS-134 | 小程序的尺寸 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-SYS-135 | web-pc 与 admin 后台的尺寸 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-SYS-136 | 三种语言的显示 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-SYS-137 | 可访问性 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-SYS-138 | 只改样子，不改行为 | P0 | `ui-restyle`（2026-11-07） | — | `openspec/specs/ui-style/spec.md` | `openspec/specs/ui-style/spec.md` | active |
| FR-REPORT-001 | 管理层访问运营报表 | P1 | §3.1/§4.7 | SYS-002 | AC-FR-REPORT-001-01 | API-9（待设计） | in-review |
| FR-REPORT-002 | 展示已配置运营指标 | P1 | §1.2/§4.7 | REPORT-001/OQ-5 | AC-FR-REPORT-002-01 | DM-ReportDefinition（待设计） | in-review |
| FR-REPORT-003 | 报表授权范围限制 | P1 | §4.7 | SYS-002 | AC-FR-REPORT-003-01 | API-9（待设计） | in-review |
| FR-REPORT-004 | 记录报表访问 | P1 | §1.2 | SYS-003 | AC-FR-REPORT-004-01 | DM-OperationLog | in-review |
| FR-TEMPLATE-001 | 查看模板列表 | P1 | §4.8 | SYS-002 | AC-FR-TEMPLATE-001-01 | API-10 | in-review |
| FR-TEMPLATE-002 | 创建模板草稿 | P1 | §4.8 | TEMPLATE-001 | AC-FR-TEMPLATE-002-01 | DM-DocumentTemplate | in-review |
| FR-TEMPLATE-003 | 配置字段 JSON 映射 | P1 | §4.8 | TEMPLATE-002 | AC-FR-TEMPLATE-003-01 | DM-TemplateFieldMapping | in-review |
| FR-TEMPLATE-004 | 配置行项目映射 | P1 | §4.8 | TEMPLATE-003 | AC-FR-TEMPLATE-004-01 | DM-TemplateFieldMapping | in-review |
| FR-TEMPLATE-005 | 发布前校验模板 | P1 | §4.8 | TEMPLATE-003/004 | AC-FR-TEMPLATE-005-01 | API-10 | in-review |
| FR-TEMPLATE-006 | 已发布的文档格式模板 | P0 | EPIC-08（已迁移，`ocr-scan-flow`） | — | `openspec/specs/recognition/spec.md` | `openspec/specs/recognition/spec.md` | active |
| FR-TEMPLATE-007 | 模板变更与转换审计 | P1 | §4.8 | SYS-003 | AC-FR-TEMPLATE-007-01 | DM-OperationLog | in-review |

## 3. PRD 覆盖检查

| PRD 章节 | 覆盖内容 |
|----------|----------|
| §4.1 文档上传 | EPIC-01 |
| §4.2 OCR 识别 | EPIC-02 |
| §4.3 核验 | EPIC-03 |
| §4.4 录入与归档 | EPIC-04 |
| §4.5 管理与检索 | EPIC-05 |
| §4.6 基础系统 | EPIC-06 |
| §4.7 运营报表 | EPIC-07（待 OQ-5） |
| §4.8 文档格式模板配置 | EPIC-08（待 OQ-9） |
| §5 非功能需求 | NFR.md |
| §3.1 业务场景 | EPIC-02/04（卖方与买方流程）、EPIC-03（复核）、EPIC-07（报表） |
| §3.2 优先级（P0/P1/P2） | 上方优先级列 |
| §3.3 约束 | NFR-SEC / NFR-COMPAT / NFR-I18N |

## 4. 汇总计数

| 指标 | 数量 |
|------|------|
| Epics | 8 |
| 功能需求 | 87 |
| — P0 | 56 |
| — P1 | 26 |
| — P2 | 5 |
| NFR 项目 | 46 |

> 计数仅供参考；新增/移除需求时应保持同步。

## 链接
- 标准：`docs/00-standards/ID-Conventions.md`
- 验收：`docs/40-acceptance/Acceptance-Criteria.md`
- 设计：`docs/30-design/`

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.15.0 | 2026-11-07 | Product Engineering | `ui-restyle`：新增 FR-SYS-132…138（`openspec/specs/ui-style`，依据 STD-008、ADR-010）；FR-SYS-118 的颜色、字体、圆角与间距改按 STD-008 |
| 1.14.0 | 2026-11-07 | Product Engineering | `web-pc-ocr`：新增 FR-SYS-127…131；FR-VERIFY-017 增加按模板与建立日期筛选；FR-MGMT-001、006 由 web-pc 单据库与详情覆盖 |
| 1.13.0 | 2026-11-07 | Product Engineering | `review-flow`：FR-VERIFY-007、010～013 迁入 `openspec/specs/reviews` 与 `results`；新增 FR-VERIFY-019、FR-SYS-119…126 |
| 1.12.0 | 2026-11-06 | Product Engineering | `ocr-ui-parity`：新增 FR-UPLOAD-014、FR-OCR-024、FR-SYS-109…118；FR-OCR-013、016 迁入 `openspec/specs/recognition` |
| 1.11.0 | 2026-11-06 | Product Engineering | B-3（`ocr-scan-flow`）：上传、识别、模板匹配与转换、结果、导出与小程序扫描页面的需求迁入 `openspec/specs/{documents,recognition,results,exports,line-mini}`；新增 FR-UPLOAD-013、FR-OCR-021…023、FR-SYS-057…059、FR-SYS-105…108 |
| 1.10.0 | 2026-11-06 | Product Engineering | B-5c：新增 FR-SYS-090…104（web-pc 企业版） |
| 1.9.0 | 2026-11-06 | Product Engineering | B-5b：FR-SYS-005 指向 `openspec/specs/ocr-settings/spec.md`；新增 FR-SYS-060…073（admin 后台）与 FR-SYS-080（后台查询用户）；FR-SYS-003、019 的新增场景在 `openspec/specs/identity/spec.md` |
| 1.8.0 | 2026-11-05 | Product Engineering | B-5a：FR-SYS-004 指向 `openspec/specs/line-mini/spec.md`；新增 FR-SYS-040…044、046…056（LINE 小程序） |
| 1.7.0 | 2026-11-05 | Product Engineering | FR-SYS-018 指向 `openspec/specs/notifications/spec.md`；新增 FR-SYS-035…038；身份类需求的来源改为 EPIC-06，FR-SYS 行按编号排序（rebuild-notifications M7） |
| 1.6.0 | 2026-11-05 | Product Engineering | 身份类需求指向 `openspec/specs/identity/spec.md`；FR-SYS-012、013 与新增 FR-SYS-030…034 指向 `openspec/specs/billing/spec.md` |
| 1.5.0 | 2026-11-04 | Product Engineering | 新增 FR-SYS-021…029（组织、成员、角色、企业认证）；FR-SYS-002、009、017 指向 `openspec/specs/tenancy/spec.md` |
| 1.4.0 | 2026-10-28 | Product Engineering | 新增 FR-SYS-018（套餐到期提醒与通知中心标记已读）；补录并改写 FR-SYS-012（每租户一个月 Kinder、到期硬停）、FR-SYS-013（唯一 OCR_PAGE 月页计量，无 FREE 与赠送）、FR-SYS-015（个人中心可改手机号）与 FR-SYS-017（按租户隔离）索引行，与 EPIC-06 v1.7.0 对齐 |
| 1.3.8 | 2026-10-27 | Product Engineering | 仅同步既有 FR-SYS-001：线上真实 LINE 联合认证、本地开发明确启用的独立 Developer sign-in；新增 AC-FR-SYS-001-04/05/06 与 Architecture §6 引用，不补录无关索引项 |
| 1.3.7 | 2026-10-20 | Product Engineering | FR-VERIFY-015 扩展为字段/表格行增删与 Reset 放弃改动，新增 AC-FR-VERIFY-015-04/05 |
| 1.3.6 | 2026-10-19 | Product Engineering | FR-VERIFY-015 增加金额千分位 + 2 位小数显示/导出规则，新增 AC-FR-VERIFY-015-03；FR-VERIFY-014 扩展全屏触控缩放至结果页、最终结果页与公司证书 |
| 1.3.5 | 2026-10-19 | Product Engineering | FR-VERIFY-014 增加上传确认页触控缩放，新增 AC-FR-VERIFY-014-02 |
| 1.3.4 | 2026-10-18 | Product Engineering | 对齐 FR-VERIFY-016、FR-SYS-011 的 LINE 确认前认证与任务恢复描述；补列既有 FR-SYS-012 工作空间订阅分流及验收引用 |
| 1.3.3 | 2026-10-18 | Product Engineering | FR-VERIFY-017 扩展历史分页加载，新增 AC-FR-VERIFY-017-03 |
| 1.3.2 | 2026-10-18 | Product Engineering | 新增 FR-VERIFY-017（任务流程阶段展示与历史筛选） |
| 1.3.1 | 2026-10-18 | Product Engineering | 新增 FR-SYS-017（工作空间保持、个人/企业数据与套餐隔离、企业成员共享） |
| 1.3.0 | 2026-10-17 | Product Engineering | 新增原图置顶、结构化版本化编辑、最终页导出、游客试用与登录后订阅检查需求 |
| 1.2.0 | 2026-10-07 | Product Engineering | 新增 TextIn、Firestore、Cloud Functions 转换需求及 EPIC-08 文档格式模板配置 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增 EPIC-07 运营报表及 FR-REPORT-001..004；新增 FR-VERIFY-010..013 固定层级复核需求 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 所有 epic 的初始可追溯性矩阵 |
