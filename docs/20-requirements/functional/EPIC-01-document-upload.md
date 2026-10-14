---
doc_id: EPIC-01
title: "EPIC-01 — 文档上传与预处理"
type: epic
status: active
version: 1.0.1
updated: 2026-10-02
owner: Product Engineering
priority: P0
source: "PRD-001 §4.1"
related: [DM-Document, API-1]
---

# EPIC-01 — 文档上传与预处理

## 1. Epic 摘要
- **目标：** 让文员以最少操作将纸质单据作为干净、可进行 OCR 的图像录入系统（拍照、扫描或文件导入），支持单个或批量。
- **范围内：** 采集/导入、格式校验、批量上传、预处理（矫正、去阴影、降噪、裁剪）、上传状态反馈。
- **范围外：** OCR 识别（EPIC-02）、存储/归档（EPIC-04）。
- **主要参与者：** P-01 文员、P-03 仓库管理员、P-04 采购专员（见 `Personas.md`）。
- **关键实体：** `DM-Document`（见 `docs/30-design/Data-Model.md`）。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-UPLOAD-001 | 接受通过手机相机拍摄的图像上传 | P0 | §4.1 | — | AC-FR-UPLOAD-001-01 |
| FR-UPLOAD-002 | 接受从扫描仪或本地文件导入的图像/PDF | P0 | §4.1 | — | AC-FR-UPLOAD-002-01 |
| FR-UPLOAD-003 | 仅接受 JPG、PNG 和 PDF 格式 | P0 | §4.1 | — | AC-FR-UPLOAD-003-01/02 |
| FR-UPLOAD-004 | 使用清晰的本地化错误消息拒绝不支持的格式 | P0 | §4.1 | FR-UPLOAD-003 | AC-FR-UPLOAD-003-02 |
| FR-UPLOAD-005 | 支持在一次操作中批量上传多份文档 | P0 | §4.1 | — | AC-FR-UPLOAD-005-01 |
| FR-UPLOAD-006 | 应用自动矫正（倾斜与透视校正） | P0 | §4.1 | FR-UPLOAD-001 | AC-FR-UPLOAD-006-01 |
| FR-UPLOAD-007 | 对上传图像应用去阴影 | P1 | §4.1 | FR-UPLOAD-001 | AC-FR-UPLOAD-007-01 |
| FR-UPLOAD-008 | 对上传图像应用降噪 | P1 | §4.1 | FR-UPLOAD-001 | AC-FR-UPLOAD-008-01 |
| FR-UPLOAD-009 | 按文档内容边界自动裁剪 | P0 | §4.1 | FR-UPLOAD-006 | AC-FR-UPLOAD-009-01 |
| FR-UPLOAD-010 | 在队列中显示每个文件的上传/处理状态 | P0 | §4.1 | FR-UPLOAD-005 | AC-FR-UPLOAD-010-01 |
| FR-UPLOAD-011 | 原样保留原始文件（双重存储输入） | P0 | §4.1,§4.4 | — | AC-FR-UPLOAD-011-01 |
| FR-UPLOAD-012 | 当图像质量低于可读性阈值时发出警告 | P1 | §5.4 | FR-UPLOAD-006 | AC-FR-UPLOAD-012-01 |

## 3. 详细规格与规则

### FR-UPLOAD-003 — 支持的格式
- 允许的 MIME/扩展名：`.jpg/.jpeg`、`.png`、`.pdf`。
- 多页 PDF：每页成为一张用于 OCR 的 `DM-Document` 页面图像。
- 最大文件大小：**每个文件 20 MB**（可配置，见 `NFR-PERF`）。

### FR-UPLOAD-006/009 — 矫正与裁剪
- 检测文档四边形；通过透视变换生成矩形页面。
- 目标输出分辨率为等效 ≥ **300 DPI**；不得超出源图像细节进行放大。

### FR-UPLOAD-011 — 原件保留
- 上传的原始字节以只读方式存储；预处理写入**派生**图像，绝不覆盖原件（支持 `dual storage`、EPIC-04）。

### FR-UPLOAD-012 — 质量阈值
- 如果估计可读性低于阈值，显示非阻塞警告：*“图像质量较低；识别准确性可能降低。”*（本地化为 TH/EN/ZH）。

## 4. 代表性验收标准（P0）

```gherkin
Feature: EPIC-01 文档上传

  Scenario: AC-FR-UPLOAD-003-01 接受支持的格式
    Given 文员上传文件 "invoice.pdf"
    When 提交上传
    Then 系统 SHALL 接受该文件并将其添加到处理队列

  Scenario: AC-FR-UPLOAD-003-02 拒绝不支持的格式
    Given 文员上传文件 "invoice.docx"
    When 提交上传
    Then 系统 SHALL 拒绝该文件，并显示本地化错误 "Unsupported file type"

  Scenario: AC-FR-UPLOAD-005-01 批量上传
    Given 文员一次选择 10 个图像文件
    When 提交批量上传
    Then 系统 SHALL 将全部 10 个文件排入队列，并显示每个文件的状态

  Scenario: AC-FR-UPLOAD-006-01 自动矫正
    Given 一张倾斜的 Delivery Note 照片
    When 运行预处理
    Then 输出图像 SHALL 被校正倾斜，且文档边缘与轴对齐
```

## 5. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-UPLOAD-001..012 | AC-FR-UPLOAD-* | `DM-Document`、`API-1`、OCR-Pipeline 第“预处理”节 |

## 6. 开放问题
- OQ：可靠 OCR 所需的最低可接受相机分辨率是多少？（关联 PRD 中的 OQ-1）

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.1 节生成初始上传/预处理需求 |
