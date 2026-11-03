---
doc_id: REQ-INDEX
title: "SaiFlow — 需求索引与可追溯性矩阵"
type: index
status: active
version: 1.6.1
updated: 2026-11-03
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
| EPIC-08 | 文档格式模板与CLI | `functional/EPIC-08-document-template-configuration.md` | P0（001..005/007） / P1（006管理UI） | §3.2/4.8 R1–R6 |
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
| FR-OCR-017 | 服务端TextIn与有界自动重试 | P0 | §4.2 | UPLOAD-006 | AC-FR-OCR-017-01/02 | OCR-Pipeline §3.1/6.1 | active |
| FR-OCR-018 | 自动匹配最高合法模板/低分提示 | P0 | §3.2/4.2 R5/R6 | OCR-021/TEMPLATE-007 | AC-FR-OCR-018-01/02/03/04 | OCR-Pipeline §4 | active |
| FR-OCR-019 | 现有DeepSeek严格模板转换/四类型 | P0 | §3.2/4.2 R2–R5 | OCR-018/TEMPLATE-003/004 | AC-FR-OCR-019-01/02/03/04 | DM-TemplateMapping、ADR-007 | active |
| FR-OCR-020 | 独立Worker/重试恢复/READY复用与次数上限；保留手动Retry/取消 | P0 | §3.2/4.2 R5/R6 | OCR-019 | AC-FR-OCR-020-01..09 | OCR-Pipeline §6 | active |
| FR-OCR-021 | 不可变关系型llm_json快照/默认关与本地关 | P0 | §3.2/4.2 R6 | OCR-017 | AC-FR-OCR-021-01/02/03/04 | DM-OcrRawResult、ADR-006 | active |
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
| FR-VERIFY-014 | 原图置顶与全屏触控缩放（上传确认页、结果页、最终结果页、公司证书） | P0 | 界面调整 2026-10-17/19 | VERIFY-001 | AC-FR-VERIFY-014-01/02 | OriginalPreview、ImageViewer | active |
| FR-VERIFY-015 | 结构化结果版本化编辑（含字段/表格行增删、Reset 放弃改动）；金额千分位 + 2 位小数 | P0 | 界面调整 2026-10-17/20 | VERIFY-002 | AC-FR-VERIFY-015-01/02/03/04/05 | DM-ResultVersion | active |
| FR-VERIFY-016 | LINE 确认前认证与工作空间订阅检查；已注册付费用户显式确认后进入最终页，恢复未完成任务返回结果页 | P0 | 界面调整 2026-10-17/18 | VERIFY-006/SYS-011/SYS-012 | AC-FR-VERIFY-016-01/02 | DM-ResultVersion | active |
| FR-VERIFY-017 | 任务流程阶段展示、历史筛选与分页加载 | P0 | 界面调整 2026-10-18 | VERIFY-016 | AC-FR-VERIFY-017-01/02/03/04/05 | DM-OcrJob | active |
| FR-VERIFY-018 | 选择/预览/保存后切换/异步/通用分支 | P0 | §3.2 R5/R6 | OCR-018..021/TEMPLATE-007 | AC-FR-VERIFY-018-01..06 | API-Spec、DM-ResultVersion | active |
| FR-VERIFY-019 | 固定schema渲染/结构补齐保留extras/类型显示 | P0 | §3.2/4.8 R2/R3 | VERIFY-015/018 | AC-FR-VERIFY-019-01/02/03 | DM-ResultVersion、OCR-Pipeline | active |
| FR-VERIFY-020 | required确认422无写入，草稿/通用豁免 | P0 | §3.2 R4 | VERIFY-019 | AC-FR-VERIFY-020-01/02/03 | API-Spec §3 | active |
| FR-ENTRY-001 | 生成 Excel 模板 | P0 | §4.4 | VERIFY-006 | AC-FR-ENTRY-001-01 | DM-ExportJob | active |
| FR-ENTRY-002 | 模板XLSX/CSV顺序/显示名/金额与保存extras；正式JSON原样导出（application/json、.json），TXT兼容 | P0 | §4.4 D15 | ENTRY-001/VERIFY-019 | AC-FR-ENTRY-002-01/02/03 | API-Spec §2/4、OCR-Pipeline §5 | active |
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
| FR-ENTRY-015 | 最终结果页查看与 XLSX 导出（Android LINE 经限时下载票据） | P0 | 界面调整 2026-10-17；2026-11-03 | VERIFY-016 | AC-FR-ENTRY-015-01/02 | DM-ExportJob | active |
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
| FR-SYS-001 | 注册/登录：线上真实 LINE 联合认证；本地开发明确启用的独立 Developer sign-in | P0 | §4.6；用户认证边界调整 2026-10-27 | — | AC-FR-SYS-001-01/02/03/04/05/06 | DM-User, API-8, Architecture §6 | active |
| FR-SYS-002 | RBAC 权限 | P0 | §4.6 | SYS-001 | AC-FR-SYS-002-01 | DM-Role | active |
| FR-SYS-003 | 操作日志 | P0 | §4.6/§5.3 | SYS-001 | AC-FR-SYS-003-01 | DM-OperationLog | active |
| FR-SYS-004 | 语言切换 | P0 | §4.6 | — | AC-FR-SYS-004-01 | NFR-I18N-003 | active |
| FR-SYS-005 | 参数配置 | P0 | §4.6 | SYS-002 | AC-FR-SYS-005-01 | DM-Settings | active |
| FR-SYS-006 | 归档与 GCS 存储设置 | P0 | §4.6 | SYS-002 | AC-FR-SYS-006-01 | DM-Settings | active |
| FR-SYS-007 | 账户锁定 | P1 | §5.3 | SYS-001 | AC-FR-SYS-007-01 | DM-User | planned |
| FR-SYS-008 | 用户偏好 | P1 | §4.6 | SYS-001 | AC-FR-SYS-008-01 | DM-Settings | planned |
| FR-SYS-009 | 配置复核与报表权限 | P0 | §1.2/§4.6 | SYS-002 | AC-FR-SYS-009-01 | DM-Role | active |
| FR-SYS-010 | 游客试用与数据归集 | P0 | 用户流程调整 2026-10-17 | SYS-001 | AC-FR-SYS-010-01/02 | DM-User | active |
| FR-SYS-011 | LINE 确认前登录/注册；认证后按任务工作空间订阅恢复，不自动确认 | P0 | 用户流程调整 2026-10-17/18 | SYS-001/SYS-010 | AC-FR-SYS-011-01 | API-8 | active |
| FR-SYS-012 | 每租户只开通一个月 Kinder（个人自 tenants.created_at、企业自 enterprises.verified_at，未认证为 NONE），到期硬停 402 plan.expired、历史仍可读；续费/升级由线下审批写入有效期后惰性生效 | P0 | 用户流程调整 2026-10-17/18；套餐到期调整 2026-10-28 | SYS-011 | AC-FR-SYS-012-01/02/03/04/05 | DM-ResultVersion, API-8 | active |
| FR-SYS-013 | 唯一计量 OCR_PAGE 月页数（按泰国自然月实时统计，FAILED/CANCELLED 不计），无 FREE 档与赠送额度；用尽返回 402 quota.exceeded | P0 | 用户流程调整 2026-10-27；套餐到期调整 2026-10-28 | SYS-012 | AC-FR-SYS-013-01/02/03/04 | API-8 | active |
| FR-SYS-015 | 个人中心可修改昵称、头像与手机号（可清空，按格式校验，游客不可改） | P0 | 用户流程调整 2026-10-17；资料调整 2026-10-28 | SYS-014 | AC-FR-SYS-015-01/02 | DM-User, API-8 | active |
| FR-SYS-017 | 租户保持、个人/企业隔离与企业成员共享（含企业单独申请套餐） | P0 | 用户流程调整 2026-10-18；归属调整 2026-10-28 | SYS-002/SYS-012 | AC-FR-SYS-017-01/02/03 | DM-Application, API-8 | active |
| FR-SYS-018 | 套餐到期提醒（D7/D3/D1/D0/EXPIRED，按 (tenant_id, period_end, stage) 幂等、不回补、游客不提醒）与通知中心（仅账户变动类：到期、升级、个人/公司账户开通、加入公司；OCR 完成不通知）未读数/标记已读 | P0 | 套餐到期调整 2026-10-28；通知收敛 2026-10-31 | SYS-012 | AC-FR-SYS-018-01..05 | API-8 | active |
| FR-SYS-019 | 套餐配置化：plans 表维护目录、价格展示、月页数、席位、泰英文案、排序、启停、默认套餐、试用月数与审批续期月数，CLI manage_plans.py 维护（PC 管理端后续），修改对全部租户（含存量订阅）在 ≤60 秒缓存窗口内生效、不做快照；停用套餐不可申请但已有订阅仍可解析 | P0 | 订阅配置化 2026-11-01 | SYS-012/SYS-013 | AC-FR-SYS-019-01..05 | DM-Plan, API-8 | active |
| FR-REPORT-001 | 管理层访问运营报表 | P1 | §3.1/§4.7 | SYS-002 | AC-FR-REPORT-001-01 | API-9（待设计） | in-review |
| FR-REPORT-002 | 展示已配置运营指标 | P1 | §1.2/§4.7 | REPORT-001/OQ-5 | AC-FR-REPORT-002-01 | DM-ReportDefinition（待设计） | in-review |
| FR-REPORT-003 | 报表授权范围限制 | P1 | §4.7 | SYS-002 | AC-FR-REPORT-003-01 | API-9（待设计） | in-review |
| FR-REPORT-004 | 记录报表访问 | P1 | §1.2 | SYS-003 | AC-FR-REPORT-004-01 | DM-OperationLog | in-review |
| FR-TEMPLATE-001 | 后台CLI list/show/export | P0 | §4.8 R1/R6 | — | AC-FR-TEMPLATE-001-01 | Data-Model §2.4、ADR-006 | active |
| FR-TEMPLATE-002 | 哈希幂等导入/不可变版本/两种子 | P0 | §4.8 R1/R6 | TEMPLATE-005 | AC-FR-TEMPLATE-002-01/02/03 | DM-DocumentTemplate | active |
| FR-TEMPLATE-003 | 有序分组KV、名称描述与四类型 | P0 | §4.8 R2/R3 | TEMPLATE-002 | AC-FR-TEMPLATE-003-01/02 | Data-Model §2.5 | active |
| FR-TEMPLATE-004 | 有序表格与列 | P0 | §4.8 R2/R3 | TEMPLATE-003 | AC-FR-TEMPLATE-004-01 | Data-Model §2.5 | active |
| FR-TEMPLATE-005 | 完整校验/路径错误/validate不连库 | P0 | §4.8 R2/R3 | — | AC-FR-TEMPLATE-005-01/02 | Data-Model §2.5 | active |
| FR-TEMPLATE-006 | 模板管理UI延后，本期无UI/REST写 | P1 | §4.8 R1 | TEMPLATE-001..005/007 | AC-FR-TEMPLATE-006-01（P1） | EPIC-08 §3 | planned |
| FR-TEMPLATE-007 | 系统/租户隔离、状态历史版本、CLI审计 | P0 | §4.8 R1/R6 | TEMPLATE-002/SYS-003 | AC-FR-TEMPLATE-007-01/02/03/04 | DM-DocumentTemplate、API-Spec | active |

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
| §4.8 文档格式模板配置 | EPIC-08（P0 CLI/结构/版本；006管理UI P1） |
| §5 非功能需求 | NFR.md |
| §3.1 业务场景 | EPIC-02/04（卖方与买方流程）、EPIC-03（复核）、EPIC-07（报表） |
| §3.2 优先级（P0/P1/P2） | 上方优先级列 |
| §3.3 约束 | NFR-SEC / NFR-COMPAT / NFR-I18N |

## 4. 汇总计数

| 指标 | 数量 |
|------|------|
| Epics | 8 |
| 本索引功能需求行 | 105 |
| — P0 | 74 |
| — P1 | 26 |
| — P2 | 5 |
| NFR 项目 | 46（历史统计，本期未重算） |

> 功能数按本索引§2主FR行计算，不等于所有Epic完整覆盖或已验收。历史索引尚有非本期漏项/旧API编号，未据本任务补造需求；本期OCR018..021、VERIFY018..020、ENTRY002、TEMPLATE001..007的AC已逐项定义，P1管理UI不作为P0门禁。

## 链接
- 标准：`docs/00-standards/ID-Conventions.md`
- 验收：`docs/40-acceptance/Acceptance-Criteria.md`
- 设计：`docs/30-design/`

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.6.1 | 2026-11-03 | Product Engineering | FR-ENTRY-015 增补 Android LINE 内置浏览器限时下载票据，AC 列补 AC-FR-ENTRY-015-02 |
| 1.6.0 | 2026-11-01 | Product Engineering | 新增 FR-SYS-019（套餐配置化：plans 表 + CLI 维护，默认套餐/试用月数/续期月数可配，泰英双语，立即生效），AC-FR-SYS-019-01..05 |
| 1.5.3 | 2026-10-31 | Product Engineering | FR-SYS-018 通知中心收敛为账户变动类（新增 ACCOUNT_ACTIVATED / COMPANY_ACTIVATED），AC 列补齐至 AC-FR-SYS-018-05 |
| 1.5.2 | 2026-10-31 | Product Engineering | FR-VERIFY-017 新增 TEMPLATE_MATCHING 阶段与处理页三步流程，AC 列补齐至 AC-FR-VERIFY-017-05 |
| 1.5.1 | 2026-10-31 | Product Engineering | FR-ENTRY-002索引改为正式JSON原样导出及application/json/.json验收，保留TXT兼容；移除待契约对齐状态 |
| 1.5.0 | 2026-10-31 | Product Engineering | 同步模板CLI P0/UI P1、OCR018..021、VERIFY018..020与ENTRY002及AC/设计追溯；移除模板管理UI对TextIn错误依赖；汇总按本索引行计数 |
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
