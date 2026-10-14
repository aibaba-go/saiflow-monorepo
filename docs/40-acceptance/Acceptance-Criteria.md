---
doc_id: AC-000
title: "SaiFlow — 汇总验收标准（V1.0 / P0）"
type: acceptance
status: active
version: 1.2.0
updated: 2026-10-07
owner: QA
verified_requirements: [FR-UPLOAD, FR-OCR, FR-VERIFY, FR-ENTRY, FR-MGMT, FR-SYS, FR-TEMPLATE]
---

# SaiFlow — 汇总验收标准（V1.0 / P0）

> 验证层。每个 `AC-*` 与测试用例 `TC-*` 和 `docs/20-requirements/` 中的一项需求一一对应。将这些标准作为 V1.0 的完成定义。适用时，场景使用 `thai-sample-forms-for-ocr/` 中的真实样本。

## 0. 测试数据引用

| 样本文件 | 文档类型 | 使用位置 |
|----------|----------|----------|
| `..._ใบส่งของ ช้าง.pdf` | Delivery Note | AC-FR-OCR-003-01 |
| `..._ใบส่งของ กูลิโกะ.pdf` | Delivery Note | AC-FR-OCR-010-01 |
| `..._ใบส่งของ รีกาลอส.pdf` | Delivery Note | AC-FR-OCR-011-01 |
| `doc-001.jpg` | 图像样本 | AC-FR-UPLOAD-* |

---

## 1. EPIC-01 — 上传与预处理

```gherkin
Feature: FR-UPLOAD 文档接收

  Scenario: AC-FR-UPLOAD-001-01 相机上传
    Given 文员在移动设备上拍摄了一张 Delivery Note 照片
    When 上传该照片
    Then 创建一条 DM-Document，其 source_channel = "camera" 且 status = "uploaded"

  Scenario: AC-FR-UPLOAD-003-01 接受支持的格式
    Given 文件 "invoice.pdf"
    When 上传该文件
    Then 系统 SHALL 接受该文件并将其加入处理队列

  Scenario: AC-FR-UPLOAD-003-02 拒绝不支持的格式
    Given 文件 "invoice.docx"
    When 上传该文件
    Then 系统 SHALL 使用本地化错误 "Unsupported file type" 拒绝该文件

  Scenario: AC-FR-UPLOAD-005-01 批量上传
    Given 一次选择 10 个图像文件
    When 提交该批次
    Then 全部 10 个文件均被排入队列，且显示每个文件的状态

  Scenario: AC-FR-UPLOAD-006-01 自动矫正
    Given 一张倾斜的文档照片
    When 运行预处理
    Then 输出图像被校正倾斜，边缘与轴对齐，耗时不超过 1 s（p95）

  Scenario: AC-FR-UPLOAD-011-01 保留原件
    Given 已上传的原始文件
    When 预处理生成派生文件
    Then 原始字节在原始存储中保持不变
```

## 2. EPIC-02 — OCR 识别

```gherkin
Feature: FR-OCR 多类型识别

  Scenario: AC-FR-OCR-001-01 文档类型
    Given 一次上传未显式提供 doc_type
    When 运行检测
    Then 系统分配一个带置信度评分的 DocumentType

  Scenario: AC-FR-OCR-003-01 Delivery Note 字段
    Given 样本 "ใบส่งของ ช้าง.pdf"
    When 使用 doc_type = DELIVERY_NOTE 运行提取
    Then delivery_note_number、receiving_enterprise、product_list、
         delivery_quantity 和 outbound_time 均已填充置信度评分

  Scenario: AC-FR-OCR-010-01 行项目表
    Given 一份包含 5 行项目表的 Delivery Note
    When 运行提取
    Then 返回 5 条 DM-LineItem 记录，每条包含产品、数量和 line_total

  Scenario: AC-FR-OCR-011-01 混合语言
    Given 一份包含泰语、英语和中文文本的文档
    When 运行提取
    Then 每个区域均以其自身文字系统识别并保留在 raw_text 中

  Scenario: AC-FR-OCR-012-01 每字段置信度
    Given 任意已提取字段
    When 提取完成
    Then 该字段携带介于 0.00 和 1.00 之间的 confidence 值

  Scenario: AC-FR-OCR-013-01 金额重算（通过）
    Given 一份 Invoice，其中 Σ(quantity × unit_price) 等于打印总额
    When 运行金额纠错
    Then amount_mismatch = false

  Scenario: AC-FR-OCR-013-02 金额不匹配（失败）
    Given 一份 Invoice，其打印总额相差 5.00 THB
    When 运行金额纠错
    Then amount_mismatch = true，且该文档被标记以供核验

  Scenario: AC-FR-OCR-015-01 低置信度标记
    Given 一个提取结果 confidence 为 0.60 的字段
    When 提取完成
    Then needs_review = true（阈值 0.85）

  Scenario: AC-FR-OCR-016-01 标准化
    Given 一个泰国佛历日期 "10 ก.ย. 2569"
    When 运行标准化
    Then 存储的 doc_date 为 "2026-09-10"

  Scenario: AC-FR-OCR-018-01 保存 TextIn 原始 JSON
    Given 已完成预处理的 Invoice 和已发布的 INVOICE 模板版本 3
    When TextIn 返回结构化 JSON
    Then Firestore 保存完整原始 JSON、document_id、模板版本和供应商请求标识

  Scenario: AC-FR-OCR-019-01 Cloud Functions 关系转换
    Given Firestore 中存在一个 INVOICE 原始载荷和已发布模板版本 3
    When Firestore 创建事件触发 Cloud Functions
    Then Cloud SQL 写入该文档的规范字段和行项目，并记录成功的 DM-ConversionJob

  Scenario: AC-FR-OCR-020-01 幂等转换重试
    Given 同一 document_id 和 payload_version 的转换已经成功
    When Cloud Functions 再次接收该 Firestore 事件
    Then Cloud SQL 不新增重复字段或行项目
```

## 3. EPIC-03 — 核验

```gherkin
Feature: FR-VERIFY Human-in-the-loop

  Scenario: AC-FR-VERIFY-001-01 并排视图
    Given 一份已提取的文档
    When 打开核验界面
    Then 每个字段显示在其源图像区域旁

  Scenario: AC-FR-VERIFY-002-01 单字段编辑
    Given total_price = 12000.00
    When 文员将其编辑为 12500.00 并保存
    Then 新值被持久化，并创建一条 DM-ChangeLog 记录

  Scenario: AC-FR-VERIFY-006-01 确认并锁定
    Given 所有必填字段均存在且没有字段被标记
    When 文员点击 "Confirm"
    Then status 变为 "verified"，且字段变为只读

  Scenario: AC-FR-VERIFY-006-02 确认被阻止
    Given 必填字段 "invoice_number" 为空
    When 文员点击 "Confirm"
    Then 使用 "Missing required field: invoice_number" 阻止确认

  Scenario: AC-FR-VERIFY-007-01 变更日志内容
    Given 已发生字段编辑
    When 读取变更日志
    Then 它包含 field、old_value、new_value、user_id 和 timestamp

  Scenario: AC-FR-VERIFY-010-01 无需复核
    Given Delivery Note 流程被配置为 0 级复核
    When 文档完成核验确认
    Then 文档状态变为 "approved_for_business"，且可进入业务流程

  Scenario: AC-FR-VERIFY-012-01 二级复核尚未完成
    Given Invoice 流程被配置为 2 级复核且仅一级复核通过
    When 请求正式业务录入
    Then 系统拒绝请求，且文档不进入 "approved_for_business"

  Scenario: AC-FR-VERIFY-012-02 二级复核已完成
    Given Invoice 流程被配置为 2 级复核且一级、二级复核均通过
    When 请求正式业务录入
    Then 系统允许请求，且文档状态为 "approved_for_business"

  Scenario: AC-FR-VERIFY-013-01 复核日志
    Given 复核人员通过一份待复核文档
    When 保存复核决定
    Then DM-ReviewRecord 包含 review_level、reviewer_id、reviewed_at、decision 和 comment
```

## 4. EPIC-04 — 录入与归档

```gherkin
Feature: FR-ENTRY 导出与归档

  Scenario: AC-FR-ENTRY-001-01 模板生成
    Given doc_type = DELIVERY_NOTE
    When 请求导出
    Then 使用适用于 Delivery Note 的标准化 .xlsx 模板

  Scenario: AC-FR-ENTRY-002-01 一键填充
    Given 一份已核验的 Delivery Note
    When 文员点击 "Export to Excel"
    Then 创建的 .xlsx 中已填充所有映射字段

  Scenario: AC-FR-ENTRY-003-01 批量导出
    Given 20 份已核验文档
    When 运行批量导出
    Then 一个工作簿（或文件）包含全部 20 份文档的数据

  Scenario: AC-FR-ENTRY-005-01 双重存储
    Given 一份已核验的 Invoice
    When 运行归档
    Then 原始图像和结构化数据文件均被存储

  Scenario: AC-FR-ENTRY-006-01 自动命名
    Given 一份来自 ACME、日期为 2026-09-10 的 Invoice INV-2026-001
    When 执行归档
    Then 文件命名为 "INVOICE_INV-2026-001_20260910_ACME.<ext>"

  Scenario: AC-FR-ENTRY-007-01 分类文件夹
    Given 一份已归档的 Invoice
    When 检查文件夹树
    Then 它存储在 <root>/INVOICE/2026/09/ACME/ 下

  Scenario: AC-FR-ENTRY-008-01 私有 GCS 归档
    Given 一份已核验文档
    When 任意文档被归档
    Then 原始对象和结构化归档工件仅写入私有 GCS，且浏览器不获得 GCS 凭据
```

## 5. EPIC-05 — 管理（P0 子集）

```gherkin
Feature: FR-MGMT 分类与预览

  Scenario: AC-FR-MGMT-001-01 分类
    Given 已归档文档
    When 加载管理视图
    Then 文档按类型、企业和日期分组

  Scenario: AC-FR-MGMT-006-01 预览
    Given 一份已归档文档
    When 用户打开预览
    Then 原始图像和提取数据均被显示
```

## 6. EPIC-06 — 基础系统

```gherkin
Feature: FR-SYS 身份与配置

  Scenario: AC-FR-SYS-001-01 登录成功
    Given 有效凭据
    When 用户登录
    Then 创建带有用户角色权限的会话

  Scenario: AC-FR-SYS-001-02 登录失败
    Given 无效凭据
    When 用户登录
    Then 拒绝访问并记录该次尝试

  Scenario: AC-FR-SYS-002-01 权限强制执行
    Given 角色为 "viewer" 的用户
    When 用户尝试导出
    Then 操作被拒绝（403）并记录

  Scenario: AC-FR-SYS-003-01 操作日志
    Given 一项改变状态的操作（导出）
    When 操作完成
    Then 一条操作日志记录用户、操作、目标、时间和结果

  Scenario: AC-FR-SYS-004-01 语言切换
    Given UI 当前为泰语
    When 用户切换为英语
    Then 所有标签更新，且无需重启应用

  Scenario: AC-FR-SYS-009-01 配置复核权限
    Given 管理员正在编辑角色 "reviewer"
    When 管理员授予 review 权限并保存
    Then 该角色用户可执行待复核数据的复核决定
```

## 7. EPIC-08 — 文档格式模板配置

```gherkin
Feature: FR-TEMPLATE 文档格式模板配置

  Scenario: AC-FR-TEMPLATE-003-01 配置字段映射
    Given 管理员创建了一个 INVOICE 模板草稿
    When 将 JSONPath "$.invoice.no" 映射至字段 "invoice_number" 并设为必填字符串
    Then 草稿保存该字段映射，且尚未用于转换任务

  Scenario: AC-FR-TEMPLATE-005-01 发布校验失败
    Given 模板草稿将两个 JSONPath 映射到同一个非重复目标字段
    When 管理员尝试发布模板
    Then 系统拒绝发布并指出重复的目标字段

  Scenario: AC-FR-TEMPLATE-006-01 使用已发布版本
    Given INVOICE 模板版本 3 已发布并启用，版本 4 仍为草稿
    When 新的 Invoice JSON 进入转换任务
    Then 任务使用版本 3，且记录 template_version = 3
```

## 8. 非功能验收（V1.0 门槛）

```gherkin
Feature: NFR V1.0 门槛

  Scenario: AC-NFR-PERF-001-01 识别延迟
    Given 参考硬件上一份清晰的单份文档
    When 运行识别
    Then 在 5 秒内完成（p95）

  Scenario: AC-NFR-PERF-004-01 准确率基线
    Given 样本文档集
    When 跨全部样本运行提取
    Then 字段级准确率 >= 85%

  Scenario: AC-NFR-SEC-001-01 静态加密
    Given 文档原件、原始识别载荷和关系数据已分别写入 GCS、Firestore 与 Cloud SQL
    When 检查存储配置
    Then 三类数据在静态时均被加密

  Scenario: AC-NFR-REL-001-01 云服务不可用
    Given TextIn 或必需的 Google Cloud 服务不可用
    When 上传一份文档并开始处理
    Then 该文档显示可操作的失败状态，且其他批次文档不受影响并可重试
```

## 9. 覆盖矩阵（摘要）

| Epic | P0 需求 | 已有 AC | 自动化？ |
|------|---------|---------|----------|
| EPIC-01 | 8 | ✔ | 是（相机硬件除外，人工） |
| EPIC-02 | 14 | ✔ | 是（基于样本与集成桩） |
| EPIC-03 | 11 | ✔ | 是 |
| EPIC-04 | 8 | ✔ | 是 |
| EPIC-05 | 2（P0 子集） | ✔ | 是 |
| EPIC-06 | 6 | ✔ | 是 |
| EPIC-08 | 0（P1，待 OQ-9） | ✔ | 是 |
| NFR | 门槛 | ✔ | 混合（性能/安全测试工具） |

> 每项需求完整的 AC ID 列于每个 epic 的“验证方式”列以及 `Requirements-Index.md` 中。

## 链接
- 需求：`docs/20-requirements/Requirements-Index.md`
- 设计：`docs/30-design/`

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.0 | 2026-10-07 | Product Engineering | 新增 TextIn、Firestore、Cloud Functions 转换及模板配置验收场景；移除离线归档假设 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增无需复核、二级复核门控、最终复核通过和复核日志验收场景 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | V1.0/P0 初始汇总验收标准 |
