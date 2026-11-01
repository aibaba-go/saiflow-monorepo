---
doc_id: GLO-001
title: "SaiFlow — 术语表（唯一事实来源）"
type: glossary
status: active
version: 1.2.1
updated: 2026-10-31
owner: Product
---

# SaiFlow — 术语表

> **领域术语的唯一事实来源。** 其他所有文档均链接至此，不应重复定义术语。AI 代理必须使用这些精确的术语和含义。

## 1. 产品与业务术语

| 术语 | 定义 |
|------|------|
| **SaiFlow** | 本产品：面向泰国 SME 制造企业纸质单据的 OCR 数字化录入系统。标语：“We turn paper into process.”（将纸张变为流程。） |
| **SME** | Small and Medium Enterprise（中小型企业）；目标客户群体。 |
| **上游 / 下游** | 制造企业单据流中的供应商（上游）和客户（下游）。 |
| **卖方场景** | 企业作为卖方：生产与开票（客户 PO → SO → Delivery Note → Invoice）。 |
| **买方场景** | 企业作为买方：收货与付款（Invoice/DN → 3-way match → AP → 付款）。 |
| **Local-first** | 默认在客户本地计算机上存储和处理数据；不强制上传云端。 |
| **Human-in-the-loop** | 在录入或归档前，由人员复核/更正 OCR 输出。 |

## 2. 文档类型（规范枚举 `DocumentType`）

| 术语 | 泰语 | 定义 |
|------|------|------|
| **Purchase Order（PO）** | ใบสั่งซื้อ | 客户/买方发出的订单单据，指定项目、数量和价格。 |
| **Delivery Note（DN）** | ใบส่งของ | 随已交付货物附送的单据；列明已交付项目和数量。 |
| **Delivery Order / Instruction** | ใบสั่งจ่าย | 分发、包装和特殊处理的指示（固定字段与自由文本混合）。 |
| **Invoice** | ใบแจ้งหนี้ / ใบกำกับภาษี | 要求付款的账单单据；可能是税务发票。 |
| **Receipt** | ใบเสร็จ | 已收到付款的凭证。 |
| **Credit Note** | ใบลดหนี้ | 从发票总额中扣减金额的单据（退货/折扣）。 |
| **Tax Receipt / Withholding Tax** | หนังสือหักภาษี ณ ที่จ่าย | 付款后保留的税务单据；可为税务目的检索。 |
| **Bill** | บิล | 包含周期、金额、税额和结算方式的对账单。 |

## 3. 数据与处理术语

| 术语 | 定义 |
|------|------|
| **OCR** | Optical Character Recognition（光学字符识别）：将图像/PDF 转换为机器可读文本。 |
| **AI-OCR extraction** | 使用能理解版式和表格的模型，在 OCR 基础上提取结构化字段。 |
| **字段（Field）** | 从文档提取的单个具名数据元素（例如 `po_number`、`total_amount`）。 |
| **置信度评分（Confidence score）** | 表示模型对提取字段确定程度的 0.0–1.0 值。 |
| **行项目（Line item）** | 文档项目表中的一行（产品、数量、单价、金额）。 |
| **数据主档 / 主数据（Data master / Master data）** | ERP 中的参考数据：客户主档、供应商主档、物料主档、价目表、收货地址。 |
| **主数据映射（Data master mapping）** | 将提取字段与主数据匹配；未匹配项 → 标记以供核验。 |
| **3-way matching** | 在容差范围内对账 Invoice ↔ PO ↔ Delivery Note（数量、价格、总额）。 |
| **容差（Tolerance）** | 匹配允许的偏差（数量容差、价格容差、总额比较）。 |
| **标记以供核验（Flag for review）** | 标记需人工核验的文档/字段（低置信度、未匹配、不匹配）。 |
| **标准化（Normalization / Standardization）** | 将提取值转换为一致的结构化格式（日期、数值、THB）。 |
| **重复检测（Duplicate detection）** | 识别已处理的文档（例如相同发票编号）以避免重复录入。 |
| **去重（Deduplication）** | 移除/合并重复的文档记录。 |
| **预处理（Preprocessing）** | OCR 前的图像清理：矫正、去阴影、降噪、裁剪。 |
| **双重存储（Dual storage）** | 同时归档原始图像文件与识别/结构化数据文件。 |
| **Merge PDF** | 将多个文档（PO + DN + Invoice）合并为一个账单包 PDF。 |
| **TextIn** | 外部 OCR 与结构化文档识别服务；SaiFlow 仅在服务端调用，并保存其原始 JSON 响应。 |
| **原始识别载荷（Raw extraction payload）** | TextIn 返回、原样保存于 Firestore 的完整 JSON 及其关联元数据。 |
| **文档格式模板（Document template）** | 具有 code、名称、描述、有序分组（KV 字段/表格）的字段契约；字段有 key/name/description/type/required，type 仅 string/integer/decimal/amount；内容变化生成不可变版本，系统或租户作用域。描述仅供模型匹配/转换，内部不可变快照完整保留，GET 版本对前端裁剪 description，无公开描述需求。作为映射、核验展示与导出的依据，不含路径规则或 TextIn 参数引用。 |
| **JSONPath 映射** | 历史受限路径规则的名称；已被此次大模型模板映射取代，不是本期模板属性或执行路径。 |
| **OCR 解析结果** | TextIn llm_json 在整理、映射及人工编辑前深拷贝的不可变原始结果，每任务一条 PostgreSQL ocr_raw_results；开关关闭也保存并返回 raw_result_id，仅无历史快照时为空。不同于 Firestore 保存全量响应及元数据的原始识别载荷。 |
| **基于模板的解析结果** | 由 OCR 解析结果与固定不可变模板版本经大模型转换、严格结构/类型校验生成的有序分组字段与表格；结果版本固定归属该映射，人工编辑生成后续快照。所有新结果版本采用全任务 max(version)+1，切回可恢复旧号而不新增版本。 |
| **不套用模板（通用结果）** | 未归属映射的任务结果版本及结果页选项；切换时恢复通用分支最新保存的编辑，不调用模型或新增结果版本。每次显式 use-generic 均记录 template.generic_selected，即使已为通用。开关开启时初始通用结果为 TextIn llm_json，关闭时为既有整理结果；不是 P1 自由格式（由大模型生成新结构）。 |
| **模板映射** | 独立异步阶段：在可用系统/租户模板中自动匹配或手动选定版本，再经大模型转换及严格校验生成基于模板的解析结果；状态 PENDING/MATCHING/CONVERTING/READY/FAILED，与 OCR 状态独立。 |
| **幂等转换（Idempotent conversion）** | 既有原始载荷到关系投影的去重语义；本期同模板版本复用 READY 映射且只切换当前指针，force 显式重映射不承诺生成完全相同内容。 |

## 4. 角色（见 `Personas.md`）

| 术语 | 定义 |
|------|------|
| **文员（Clerk）** | 上传文档并核验 OCR 输出的办公室人员。 |
| **财务人员（Financial staff）** | 处理发票、AR/AP、对账和税务单据。 |
| **仓库管理员（Warehouse administrator）** | 处理 Delivery Note 和库存同步。 |
| **采购专员（Procurement specialist）** | 处理供应商 PO 和收货。 |
| **企业所有者（Enterprise owner）** | 间接用户；负责监督和审批。 |
| **业务协调员（Business coordinator）** | 上游/下游合作伙伴处的间接用户。 |
| **系统管理员（System administrator）** | 管理账户、权限、配置和存储设置。 |

## 5. 标准与缩写

| 术语 | 定义 |
|------|------|
| **PDPA** | 泰国《个人数据保护法》— 管辖个人数据的处理。 |
| **ERP** | Enterprise Resource Planning（企业资源计划）系统（本地和泰国 SME 的不同版本）。 |
| **AR / AP** | Accounts Receivable / Accounts Payable（应收账款 / 应付账款）。 |
| **SO** | Sales Order（销售订单）；PO 校验后在 ERP 中创建的草稿。 |
| **SKU** | Stock Keeping Unit（库存量单位）；区分不同物料/产品的编码。 |
| **THB** | 泰铢（货币）。历史业务投影金额使用 `decimal(14,2)`；本期模板 amount 为规范字符串，至少两位小数，超过两位保留、不舍入，不受该历史投影精度约束。 |
| **DPI** | Dots per inch（每英寸点数）；扫描分辨率。目标为等效 ≥ 300 DPI。 |
| **P0 / P1 / P2** | 优先级层级：发布必需 / 迭代 / 长期。 |
| **FR / NFR / AC / TC** | Functional requirement / Non-functional requirement / Acceptance criterion / Test case（功能需求 / 非功能需求 / 验收标准 / 测试用例）。 |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.1 | 2026-10-31 | Product Engineering | 明确关闭仍保存raw_result_id、内部完整描述与公开裁剪、新版本max+1及旧号切回、显式通用选择审计且不升版 |
| 1.2.0 | 2026-10-31 | Product Engineering | 同步模板契约，新增OCR解析结果、基于模板的解析结果、不套用模板（通用结果）、模板映射；区分历史Firestore归档和关系型快照 |
| 1.1.0 | 2026-10-07 | Product Engineering | 新增 TextIn、Firestore 原始识别载荷、模板映射和幂等转换术语 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD v2 生成初始术语表 |
