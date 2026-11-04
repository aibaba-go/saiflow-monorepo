---
doc_id: EPIC-01
title: "EPIC-01 — 文档上传与预处理"
type: epic
status: active
version: 1.1.2
updated: 2026-11-04
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
| FR-UPLOAD-010 | 在队列中显示每个文件的上传/处理状态；LINE Mini App 显示按文件大小与传输估算的上传百分比及进度条 | P0 | §4.1；用户反馈 2026-10-18 | FR-UPLOAD-005 | AC-FR-UPLOAD-010-01 |
| FR-UPLOAD-011 | 原样保留原始文件（双重存储输入） | P0 | §4.1,§4.4 | — | AC-FR-UPLOAD-011-01 |
| FR-UPLOAD-012 | 当图像质量低于可读性阈值时发出警告 | P1 | §5.4 | FR-UPLOAD-006 | AC-FR-UPLOAD-012-01 |
| FR-UPLOAD-013 | LINE Mini App 上传与处理分离：上传成功的文件进入首页「Pending 待处理」；可单条/批量预览后开始处理、单条/批量删除；上传中可取消所有或取消单个文件 | P0 | 用户反馈 2026-11-04（设计 V5 已确认） | FR-UPLOAD-005、FR-UPLOAD-010 | AC-FR-UPLOAD-013-01/02/03/04 |

## 3. 详细规格与规则

### FR-UPLOAD-003 — 支持的格式
- 允许的 MIME/扩展名：`.jpg/.jpeg`、`.png`、`.pdf`。
- 多页 PDF：每页成为一张用于 OCR 的 `DM-Document` 页面图像。
- 最大文件大小：**每个文件 20 MB**（可配置，见 `NFR-PERF`）。

### FR-UPLOAD-002/003/004/005 — LINE Mini App 相机与文件多选
- 首页只有 `Camera` 与 `Files` 两个选择入口（`Photos` 入口已于 2026-11-04 移除，图片从 Files 选择）。`Camera` 保持单次拍照；`Files` 不设 `accept` 格式过滤，系统选择器中任意类型文件均可选择、可一次多选。
- 选择后在上传前逐个判定类型：MIME 为 `image/jpeg`、`image/png`、`application/pdf` 时接受；MIME 为空或 `application/octet-stream` 时按扩展名 `.jpg/.jpeg/.png/.pdf` 判定；其余（如 Word、Excel、HEIC）直接标记失败，显示本地化错误「Unsupported file type. Use JPG, PNG or PDF.」，不调用上传接口，同批其余文件照常上传。后端仍校验扩展名和真实文件内容，不扩大支持格式（FR-UPLOAD-003 不变）。
- iOS/LINE 的原生选择器菜单由宿主控制；去掉格式过滤后 iPhone 从「文件」选取的照片可能为 HEIC 而被拒绝，拍照应使用 Camera，此点需真机确认。
- 选择后复制完整文件列表，固定本次租户与会话，按选择顺序逐个上传；显示各文件的等待、上传百分比、已上传或失败状态。单个普通失败不阻止后续文件，失败文件不自动重发；401 或会话切换停止剩余上传，旧结果不进入新会话。
- 上传结束后不再跳转确认页，成功文件进入首页 Pending（见 FR-UPLOAD-013）；部分失败时只保留失败文件及其本地化错误。失败行（上传进行中或结束后）各自提供 `Retry` 与 `Cancel`：Retry 将该文件重新排入当前队列（批次已结束则开始新一轮），先尽力删除失败尝试遗留的上传会话；Cancel 直接移除该失败记录（不弹确认），并尽力删除其遗留会话。本地类型校验失败的行只提供 Cancel。仍可点击 Retry failed 一次重传全部可重试的失败文件。URL 导入仍进入上传确认页。

### FR-UPLOAD-013 — Pending 待处理、取消上传与删除（LINE Mini App）
- **Pending 来源：** 服务端 `GET /files/pending` 返回当前用户在当前租户上传、`purpose=OCR_TASK`、`status=READY` 且未被任何 OCR 任务引用的文件（最新在前，最多 100 条），刷新或重新打开后仍可见；切换租户后重新加载，旧租户/旧会话响应丢弃。Pending 位于 Recent tasks 上方，Recent tasks 只展示已开始处理的任务。
- **处理：** 单条 `Process` 打开原有上传确认页（原件预览、缩放、PDF 翻页），点击 `Start processing` 才创建 OCR 任务并进入处理页；返回不改变 Pending。勾选多条后 `Process (N)` 打开多文件预览，可切换文件，点击 `Start processing (N files)` 后按顺序为每个文件创建任务，全部成功回到首页；部分失败时停止，已开始的不重复，剩余文件需用户再次点击，复用各自幂等键，不自动重试。
- **删除：** 单条垃圾桶或勾选后 `Delete (N)`，先在 Pending 上方确认（列出文件名，说明不开始处理、不影响 Recent tasks）；确认后调用 `DELETE /files/{id}`。删除为软删除：文件 `status=DELETED` 并尽力删除存储原件与预览缓存，写 `file.deleted` 审计；仅创建者可删，已被任务引用返回 409 `files.in_use`，失败条目保留并显示本地化错误。
- **取消上传：** 批次标题右侧 `Cancel all` 先确认（显示将取消的份数与保留份数），确认后中止当前上传、清空等待队列，上传中与等待中的记录移除，已上传成功的保留在 Pending。上传中的单个文件 `Cancel` 先确认「正在上传，确定取消吗？」，确认后只中止该文件并继续下一份；等待中的单个文件 `Cancel` 直接移出队列。被中止的上传会话由前端尽力调用 `DELETE /files/{id}` 清理，取消不显示 100%，不自动重发。
- **并发：** 删除与创建任务对文件行加锁串行化；内容上传或完成校验与删除并发时，已删除的会话不得恢复为 UPLOADED/READY（返回 409）。本需求不新增数据库表或列。

### FR-UPLOAD-006/009 — 矫正与裁剪
- 检测文档四边形；通过透视变换生成矩形页面。
- 目标输出分辨率为等效 ≥ **300 DPI**；不得超出源图像细节进行放大。

### FR-UPLOAD-010 — 上传状态反馈
- LINE Mini App 选择相机、相册或本地文件后，显示从 0% 到 100% 的百分比与进度条。
- 按文件大小估算预检、存储与校验期间的进度，并结合实际已上传字节比例更新；显示值不回退，后端确认文件可用前最多为 95%。
- 后端确认成功后该文件进度为 100% 并进入首页 Pending（不跳转确认页，见 FR-UPLOAD-013）；失败时停止进度、显示本地化错误并允许重新选择文件，每次上传从 0% 开始。多文件时显示批次序号、成功/剩余/失败数量与按文件分段的总进度条。
- 移动端的预检 POST、原字节 PUT 与完成 POST 统一走同源 XHR（沿用 `/api/v1/uploads`），携带既有 Cookie/CSRF，不向浏览器暴露 GCS 或 TextIn 凭据；每阶段等待上限 120 秒。网络错误、中断、超时或状态 0 必须结束等待，不自动重发写请求，后续阶段不执行且不显示 100%；仅由用户重新选择发起新上传。兼容性加固不等于已证实真机底层断连原因，也不证明 OCR 已执行。

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

  Scenario: AC-FR-UPLOAD-003-03 Files 可选任意文件，仅上传支持的格式
    Given 首页只显示 Camera 与 Files 两个入口，不显示 Photos
    When 用户点击 Files
    Then 原生选择器不设格式过滤，任意类型文件均可多选
    When 选择中包含 Word、Excel、HEIC 等不支持的文件
    Then 该文件行标记失败并显示本地化错误 "Unsupported file type. Use JPG, PNG or PDF."，不发起该文件上传
    And 同批 JPG、PNG、PDF 照常上传并进入 Pending；不承诺网页可移除 iOS/LINE 原生菜单

  Scenario: AC-FR-UPLOAD-005-02 LINE 多选与部分失败
    Given 用户在 Files 一次选择多个支持的文件
    When 开始上传
    Then 全部文件按序使用各自的三段 XHR 上传，展示逐文件状态与百分比
    And 固定批次租户，上传期间不能交叉切换身份或发起 URL 导入
    When 某文件发生普通上传错误
    Then 该文件标记失败且不自动重试，继续其余文件，并可查看成功文件
    And 失败行提供 Retry 与 Cancel：Retry 将该文件重新排队上传（批次已结束则开始新一轮），Cancel 直接移除该记录且不弹确认
    And 本地类型校验失败的行只提供 Cancel
    When 收到 401 或会话已切换
    Then 停止后续上传，旧文件结果不显示给新会话
    When 全部上传成功
    Then 不跳转确认页，全部文件进入首页 Pending，不创建 OCR 任务

  Scenario: AC-FR-UPLOAD-013-01 Pending 待处理与预览后开始处理
    Given 用户在当前租户上传成功若干文件且未开始处理
    Then 首页 Recent tasks 上方的 Pending 列出这些文件，刷新后仍在，切换租户只显示该租户的本人文件
    When 点击某条 Process
    Then 打开原有上传确认页预览，Pending 与 Recent tasks 不变
    When 点击 Start processing
    Then 仅为该文件创建 OCR 任务并进入处理页，该文件不再出现在 Pending

  Scenario: AC-FR-UPLOAD-013-02 批量预览后开始处理
    Given 用户在 Pending 勾选 N 条并点击 Process (N)
    Then 打开多文件预览，可切换文件，未点击开始前不创建任务
    When 点击 Start processing (N files)
    Then 按顺序为每个文件创建任务，全部成功回到首页并显示在 Recent tasks
    When 中途某个创建失败
    Then 停止并显示本地化错误，已开始的不重复创建，再次点击只处理剩余文件且复用各自幂等键

  Scenario: AC-FR-UPLOAD-013-03 单条与批量删除
    Given Pending 中有记录
    When 点击单条垃圾桶或勾选后点击 Delete (N)
    Then 先显示确认并列出文件名，点击 Keep records 不做任何改动
    When 确认删除
    Then 文件软删除（status=DELETED，尽力删除原件与预览），从 Pending 移除，Recent tasks 不变
    And 他人文件 404，已被任务引用 409 files.in_use，失败条目保留并提示

  Scenario: AC-FR-UPLOAD-013-04 取消上传
    Given 多文件上传进行中
    When 点击 Cancel all
    Then 先确认将取消的份数与保留份数；确认后中止当前上传并移除上传中与等待中的记录，已上传的保留在 Pending
    When 点击上传中文件的 Cancel
    Then 先提示正在上传、确定取消吗；确认后只中止该文件并继续下一份，被中止的会话被清理且不显示 100%
    When 点击等待中文件的 Cancel
    Then 直接从队列移除且不上传，不影响其他文件
    And 被删除的上传会话后续内容或完成请求返回 409，不会变回 UPLOADED/READY

  Scenario: AC-FR-UPLOAD-006-01 自动矫正
    Given 一张倾斜的 Delivery Note 照片
    When 运行预处理
    Then 输出图像 SHALL 被校正倾斜，且文档边缘与轴对齐

  Scenario: AC-FR-UPLOAD-010-01 上传进度反馈
    Given 文员在 LINE Mini App 选择支持的相机照片、相册图片或本地文件
    When 文件处于上传预检、传输或后端校验阶段
    Then 百分比与进度条按文件大小估算和已上传字节持续更新且不回退
    And 后端确认文件可用前不超过 95%，成功后为 100% 并进入首页 Pending
    And 上传失败后停止进度、显示本地化错误并恢复选择入口，再次选择时从 0% 开始
    And 三段上传使用同源 XHR，保持 Cookie/CSRF/原始字节，每阶段上限 120 秒
    Given 任一上传阶段发生网络错误、中断、超时或状态 0
    Then 结束等待，不自动重发、不执行后续阶段、不显示 100%，仅用户重新选择可开始新上传
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
| 1.1.2 | 2026-11-04 | Product Engineering | FR-UPLOAD-002/003/004/005：首页移除 Photos 入口（只留 Camera/Files，设计已确认）；Files 去掉格式过滤可选任意文件，前端上传前按 MIME/扩展名拒绝 JPG/PNG/PDF 以外的文件（本地化错误、只可 Cancel），后端支持格式不变；改写 AC-FR-UPLOAD-003-03、更新 AC-005-02 |
| 1.1.1 | 2026-11-04 | Product Engineering | FR-UPLOAD-005：多文件上传中失败行不中断后续文件，并各自提供 Retry（重新排队，尽力清理遗留会话）与 Cancel（直接移除）；Photos 类型校验失败只可 Cancel；AC-FR-UPLOAD-005-02 补充 |
| 1.1.0 | 2026-11-04 | Product Engineering | 新增 FR-UPLOAD-013（设计 V5 已确认）：上传成功进入首页 Pending（服务端 GET /files/pending）、单条/批量预览后开始处理、单条/批量软删除（DELETE /files/{id}，status=DELETED）、Cancel all 与单文件取消；FR-UPLOAD-010/005 改为成功后进入 Pending 而非确认页；新增 AC-FR-UPLOAD-013-01..04 |
| 1.0.4 | 2026-11-04 | Product Engineering | FR-UPLOAD-002/003/005/010：Photos 图片限定与 Photos/Files 多选逐文件上传、部分失败及会话隔离、多文件确认；新增 AC-003-03/005-02。第 3 条首页待处理区与批量开始处理仅设计待确认，原生相册菜单与真机多选需另验 |
| 1.0.3 | 2026-10-29 | Product Engineering | FR-UPLOAD-001/010：三段上传统一同源 XHR，Cookie/CSRF/原始字节与进度不变，120 秒有界失败且不自动重发；14 项隔离源码与 2 项 Chromium 上传检查通过，真机断连根因与效果未据此宣称已验收 |
| 1.0.2 | 2026-10-18 | Product Engineering | 明确 FR-UPLOAD-010 与 AC-FR-UPLOAD-010-01：上传百分比和进度条结合文件大小估算与实际传输，成功确认前不显示 100% |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.1 节生成初始上传/预处理需求 |
