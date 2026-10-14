---
doc_id: REQ-INDEX
title: "SaiFlow — 需求索引与可追溯性矩阵"
type: index
status: active
version: 1.2.0
updated: 2026-10-07
owner: Product Engineering
---

# SaiFlow — 需求索引与可追溯性矩阵

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
| FR-UPLOAD-003 | 接受 JPG/PNG/PDF | P0 | §4.1 | — | AC-FR-UPLOAD-003-01/02 | API-1 | active |
| FR-UPLOAD-004 | 拒绝不支持的格式 | P0 | §4.1 | 003 | AC-FR-UPLOAD-003-02 | API-1 | active |
| FR-UPLOAD-005 | 批量上传 | P0 | §4.1 | — | AC-FR-UPLOAD-005-01 | API-1 | active |
| FR-UPLOAD-006 | 自动矫正 | P0 | §4.1 | 001 | AC-FR-UPLOAD-006-01 | OCR-Pipeline | active |
| FR-UPLOAD-007 | 去除阴影 | P1 | §4.1 | 001 | AC-FR-UPLOAD-007-01 | OCR-Pipeline | active |
| FR-UPLOAD-008 | 降噪 | P1 | §4.1 | 001 | AC-FR-UPLOAD-008-01 | OCR-Pipeline | active |
| FR-UPLOAD-009 | 自动裁剪 | P0 | §4.1 | 006 | AC-FR-UPLOAD-009-01 | OCR-Pipeline | active |
| FR-UPLOAD-010 | 上传状态队列 | P0 | §4.1 | 005 | AC-FR-UPLOAD-010-01 | API-1 | active |
| FR-UPLOAD-011 | 保留原件 | P0 | §4.1 | — | AC-FR-UPLOAD-011-01 | DM-Document | active |
| FR-UPLOAD-012 | 低质量警告 | P1 | §5.4 | 006 | AC-FR-UPLOAD-012-01 | OCR-Pipeline | active |
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
| FR-OCR-013 | 金额纠错 | P0 | §4.2 | OCR-010 | AC-FR-OCR-013-01/02 | OCR-Pipeline | active |
| FR-OCR-014 | 签字检测 | P1 | §4.2 | OCR-001 | AC-FR-OCR-014-01 | DM-ExtractedField | active |
| FR-OCR-015 | 低置信度标记 | P0 | §3.1 | OCR-012 | AC-FR-OCR-015-01 | DM-ExtractedField | active |
| FR-OCR-016 | 标准化日期/数值/THB | P0 | §3.1 | OCR-002 | AC-FR-OCR-016-01 | OCR-Pipeline | active |
| FR-OCR-017 | 服务端调用 TextIn | P0 | §4.2 | UPLOAD-006/TEMPLATE-006 | AC-FR-OCR-017-01 | OCR-Pipeline | active |
| FR-OCR-018 | 保存 Firestore 原始 JSON | P0 | §4.2 | OCR-017 | AC-FR-OCR-018-01 | DM-ExtractionPayload | active |
| FR-OCR-019 | Cloud Functions 模板转换 | P0 | §4.2 | OCR-018/TEMPLATE-006 | AC-FR-OCR-019-01 | DM-ConversionJob | active |
| FR-OCR-020 | 转换幂等重试 | P0 | §4.2 | OCR-019 | AC-FR-OCR-020-01 | DM-ConversionJob | active |
| FR-VERIFY-001 | 并排展示结果 | P0 | §4.3 | OCR-012 | AC-FR-VERIFY-001-01 | API-4 | active |
| FR-VERIFY-002 | 单字段编辑 | P0 | §4.3 | VERIFY-001 | AC-FR-VERIFY-002-01 | DM-ChangeLog | active |
| FR-VERIFY-003 | 批量更正 | P1 | §4.3 | VERIFY-002 | AC-FR-VERIFY-003-01 | API-4 | active |
| FR-VERIFY-004 | 错误红色标记 | P0 | §4.3 | OCR-015 | AC-FR-VERIFY-004-01 | API-4 | active |
| FR-VERIFY-005 | 缺失字段提醒 | P0 | §4.3 | VERIFY-001 | AC-FR-VERIFY-005-01 | API-4 | active |
| FR-VERIFY-006 | 确认锁定 | P0 | §4.3 | VERIFY-002 | AC-FR-VERIFY-006-01/02 | DM-Document | active |
| FR-VERIFY-007 | 变更日志 | P0 | §4.3 | VERIFY-002 | AC-FR-VERIFY-007-01 | DM-ChangeLog | active |
| FR-VERIFY-008 | 边界框高亮 | P1 | §4.3 | VERIFY-001 | AC-FR-VERIFY-008-01 | API-4 | active |
| FR-VERIFY-009 | 确认门控 | P0 | §4.3 | VERIFY-005 | AC-FR-VERIFY-006-02 | API-4 | active |
| FR-VERIFY-010 | 配置 0/1/2 级复核 | P0 | §3.1/§4.3 | SYS-002 | AC-FR-VERIFY-010-01 | DM-ReviewPolicy | active |
| FR-VERIFY-011 | 创建待复核记录 | P0 | §3.1 | VERIFY-006/010 | AC-FR-VERIFY-011-01 | DM-ReviewRecord | active |
| FR-VERIFY-012 | 最终复核门控业务录入 | P0 | §3.1/§4.3 | VERIFY-011 | AC-FR-VERIFY-012-01/02 | DM-Document | active |
| FR-VERIFY-013 | 复核日志 | P0 | §3.1 | VERIFY-011 | AC-FR-VERIFY-013-01 | DM-ReviewRecord | active |
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
| FR-SYS-001 | 注册/登录 | P0 | §4.6 | — | AC-FR-SYS-001-01/02 | DM-User, API-8 | active |
| FR-SYS-002 | RBAC 权限 | P0 | §4.6 | SYS-001 | AC-FR-SYS-002-01 | DM-Role | active |
| FR-SYS-003 | 操作日志 | P0 | §4.6/§5.3 | SYS-001 | AC-FR-SYS-003-01 | DM-OperationLog | active |
| FR-SYS-004 | 语言切换 | P0 | §4.6 | — | AC-FR-SYS-004-01 | NFR-I18N-003 | active |
| FR-SYS-005 | 参数配置 | P0 | §4.6 | SYS-002 | AC-FR-SYS-005-01 | DM-Settings | active |
| FR-SYS-006 | 归档与 GCS 存储设置 | P0 | §4.6 | SYS-002 | AC-FR-SYS-006-01 | DM-Settings | active |
| FR-SYS-007 | 账户锁定 | P1 | §5.3 | SYS-001 | AC-FR-SYS-007-01 | DM-User | planned |
| FR-SYS-008 | 用户偏好 | P1 | §4.6 | SYS-001 | AC-FR-SYS-008-01 | DM-Settings | planned |
| FR-SYS-009 | 配置复核与报表权限 | P0 | §1.2/§4.6 | SYS-002 | AC-FR-SYS-009-01 | DM-Role | active |
| FR-REPORT-001 | 管理层访问运营报表 | P1 | §3.1/§4.7 | SYS-002 | AC-FR-REPORT-001-01 | API-9（待设计） | in-review |
| FR-REPORT-002 | 展示已配置运营指标 | P1 | §1.2/§4.7 | REPORT-001/OQ-5 | AC-FR-REPORT-002-01 | DM-ReportDefinition（待设计） | in-review |
| FR-REPORT-003 | 报表授权范围限制 | P1 | §4.7 | SYS-002 | AC-FR-REPORT-003-01 | API-9（待设计） | in-review |
| FR-REPORT-004 | 记录报表访问 | P1 | §1.2 | SYS-003 | AC-FR-REPORT-004-01 | DM-OperationLog | in-review |
| FR-TEMPLATE-001 | 查看模板列表 | P1 | §4.8 | SYS-002 | AC-FR-TEMPLATE-001-01 | API-10 | in-review |
| FR-TEMPLATE-002 | 创建模板草稿 | P1 | §4.8 | TEMPLATE-001 | AC-FR-TEMPLATE-002-01 | DM-DocumentTemplate | in-review |
| FR-TEMPLATE-003 | 配置字段 JSON 映射 | P1 | §4.8 | TEMPLATE-002 | AC-FR-TEMPLATE-003-01 | DM-TemplateFieldMapping | in-review |
| FR-TEMPLATE-004 | 配置行项目映射 | P1 | §4.8 | TEMPLATE-003 | AC-FR-TEMPLATE-004-01 | DM-TemplateFieldMapping | in-review |
| FR-TEMPLATE-005 | 发布前校验模板 | P1 | §4.8 | TEMPLATE-003/004 | AC-FR-TEMPLATE-005-01 | API-10 | in-review |
| FR-TEMPLATE-006 | 使用已发布模板版本 | P1 | §4.8 | TEMPLATE-005 | AC-FR-TEMPLATE-006-01 | DM-DocumentTemplate | in-review |
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
| 功能需求 | 80 |
| — P0 | 49 |
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
| 1.2.0 | 2026-10-07 | Product Engineering | 新增 TextIn、Firestore、Cloud Functions 转换需求及 EPIC-08 文档格式模板配置 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增 EPIC-07 运营报表及 FR-REPORT-001..004；新增 FR-VERIFY-010..013 固定层级复核需求 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 所有 epic 的初始可追溯性矩阵 |
