---
doc_id: EPIC-03
title: "EPIC-03 — 数据人工核验与修改"
type: epic
status: active
version: 1.6.0
updated: 2026-11-06
owner: Product Engineering
priority: P0
source: "PRD-001 §3.1 场景 3, §4.3"
related: [DM-Document, DM-ExtractedField, DM-ChangeLog, DM-ReviewRecord, DM-ResultVersion, API-4]
---

# EPIC-03 — 数据人工核验与修改

> **注意（2026-10-30）：** 本 Epic 尚未按 PRD v3 改写，与 `PRD-SaiFlow.md` v3.1 冲突时以 PRD 为准；将随 ADR-006 §7 的重建步骤迁入 `openspec/specs/`。文中引用的 `Architecture` / `Data-Model` 旧章节细节见 git tag `legacy-v1` 中的版本。

## 1. Epic 摘要
- **目标：** 让人员在录入或归档前确认/更正 OCR 输出（human-in-the-loop），并以可配置的 0/1/2 级复核控制数据是否可正式进入业务流程。
- **范围内：** 并排展示结果、单字段编辑、批量更正、错误红色标记、缺失字段提醒、核验确认、固定层级复核、变更/复核日志。
- **范围外：** OCR 提取本身（EPIC-02）；录入/归档（EPIC-04）；通用工作流引擎、任意审批流编排、条件分支和跨系统任务调度。
- **主要参与者：** P-01 文员、P-02 财务人员、P-04 采购专员、被授予复核权限的管理层人员。
- **关键实体：** `DM-Document`、`DM-ExtractedField`、`DM-ChangeLog`、`DM-ReviewRecord`、`DM-ReviewPolicy`。

## 2. 需求

| ID | 陈述（系统必须……） | 优先级 | 来源 | 依赖项 | 验证方式 |
|----|--------------------|--------|------|--------|----------|
| FR-VERIFY-001 | 将识别字段与其源图像区域并排显示 | P0 | §4.3 | FR-OCR-012 | AC-FR-VERIFY-001-01 |
| FR-VERIFY-002 | 允许编辑单个字段值 | P0 | §4.3 | FR-VERIFY-001 | AC-FR-VERIFY-002-01 |
| FR-VERIFY-003 | 允许跨多个文档/字段批量更正 | P1 | §4.3 | FR-VERIFY-002 | AC-FR-VERIFY-003-01 |
| FR-VERIFY-004 | 将校验失败或置信度低的字段标为红色 | P0 | §4.3 | FR-OCR-015 | AC-FR-VERIFY-004-01 |
| FR-VERIFY-005 | 对缺失的必填字段显示提醒 | P0 | §4.3 | FR-VERIFY-001 | AC-FR-VERIFY-005-01 |
| FR-VERIFY-006 | **已迁移至 `openspec/specs/results/spec.md`（deprecated，`ocr-scan-flow`）** 提供可锁定记录的核验确认操作 | P0 | §4.3 | FR-VERIFY-002 | AC-FR-VERIFY-006-01/02 |
| FR-VERIFY-007 | 在变更日志中记录每次修改（修改前/后、用户、时间） | P0 | §4.3 | FR-VERIFY-002 | AC-FR-VERIFY-007-01 |
| FR-VERIFY-008 | 选中字段时高亮显示源边界框 | P1 | §4.3 | FR-VERIFY-001 | AC-FR-VERIFY-008-01 |
| FR-VERIFY-009 | **已迁移至 `openspec/specs/results/spec.md`（deprecated，`ocr-scan-flow`）** 任一必填字段缺失或被标记时阻止确认 | P0 | §4.3 | FR-VERIFY-005 | AC-FR-VERIFY-006-02 |
| FR-VERIFY-010 | 允许按单据处理流程配置无需复核、一级复核或二级复核 | P0 | §3.1 场景 3, §4.3 | FR-SYS-002 | AC-FR-VERIFY-010-01 |
| FR-VERIFY-011 | 对配置为一级或二级复核的已核验数据创建对应级别的待复核记录 | P0 | §3.1 场景 3 | FR-VERIFY-006, FR-VERIFY-010 | AC-FR-VERIFY-011-01 |
| FR-VERIFY-012 | 仅在最终所需复核级别通过后允许数据正式进入业务流程 | P0 | §3.1 场景 3, §4.3 | FR-VERIFY-011 | AC-FR-VERIFY-012-01/02 |
| FR-VERIFY-013 | 记录每次复核决定、复核级别、复核人、时间与意见 | P0 | §3.1 场景 3 | FR-VERIFY-011 | AC-FR-VERIFY-013-01 |
| FR-VERIFY-014 | 核验结果页仅保留原图预览与结构化数据，原图位于表格上方；上传确认页预览、核验结果页/最终结果页原图与公司证书图片点击后均以全屏查看器打开，支持双指触控捏合缩放 | P0 | 界面调整 2026-10-17/19 | FR-VERIFY-001 | AC-FR-VERIFY-014-01/02 |
| FR-VERIFY-015 | **已迁移至 `openspec/specs/results/spec.md`（deprecated，`ocr-scan-flow`）** 允许直接编辑结构化字段与表格单元格，并可新增/删除字段与表格行、通过 Reset 放弃未保存改动，以新结果版本保存；金额数字统一千分位 + 保留 2 位小数显示与导出 | P0 | 界面调整 2026-10-17/20 | FR-VERIFY-002 | AC-FR-VERIFY-015-01/02/03/04/05 |
| FR-VERIFY-016 | LINE Mini App 结果页 Continue 在确认前检查认证、注册完成状态与任务所属工作空间的订阅；仅已注册且已开通付费套餐的用户可显式确认、锁定结果后进入最终结果页 | P0 | 界面调整 2026-10-17/18 | FR-VERIFY-006, FR-SYS-011, FR-SYS-012 | AC-FR-VERIFY-016-01/02 |
| FR-VERIFY-017 | **已迁移至 `openspec/specs/results/spec.md`（deprecated，`ocr-scan-flow`）** 在任务列表与结果页按流程阶段（OCR 处理中 / OCR 处理失败 / 数据验证中 / 数据已验证 / 最终完成）展示任务状态，并支持按阶段筛选历史任务，历史列表每页 20 条滚动分页加载 | P0 | 界面调整 2026-10-18 | FR-VERIFY-016 | AC-FR-VERIFY-017-01/02/03 |

## 3. 规则

### 3.1 文档、核验与复核状态

`extracted → in_review → verified → pending_review_level_1 → pending_review_level_2 → approved_for_business → entered → archived`。

- 配置为 `0` 级复核时：核验确认使状态从 `in_review → approved_for_business`。
- 配置为 `1` 级复核时：核验确认使状态进入 `pending_review_level_1`；一级通过后进入 `approved_for_business`。
- 配置为 `2` 级复核时：核验确认使状态进入 `pending_review_level_1`；一级通过后进入 `pending_review_level_2`；二级通过后进入 `approved_for_business`。
- 被拒绝的记录回到 `in_review`，并保留复核意见；重新提交会创建新的待复核记录。
- `approved_for_business` 是允许进入业务流程的唯一状态。`verified` 或待复核状态不得导出为正式业务录入。
- `verified` 记录只能由具有 `verify` 权限的用户重新打开，且重新打开会被记录。

> 本状态机仅支持固定的 0/1/2 级复核，不能配置任意分支、会签、或条件路由，因此不构成 Workflow Engine。

### 3.2 变更日志（FR-VERIFY-007）
每次编辑写入一条 `DM-ChangeLog`：`field`、`old_value`、`new_value`、`user_id`、`timestamp`、`reason (optional)`。日志只可追加并具有防篡改证据（见 `NFR-SEC`）。

### 3.3 校验门控（FR-VERIFY-009）
以下情况会阻止确认：任一必填字段为空；任一 `needs_review = true` 的字段未被处理；`amount_mismatch = true` 且未解决。

### 3.4 结果工作台与确认流转（FR-VERIFY-014..016）
- 结果工作台仅呈现原图预览与结构化字段/表格，不再提供原始 JSON 分页；原图位于表格数据上方。
- LINE Mini App 中所有图片/PDF 查看入口统一使用全屏查看器（`ImageViewer`）：上传确认页预览、核验结果页与最终结果页原图（`OriginalPreview`，以当前页打开，翻页后同步回页码按钮）、公司页证书缩略图（列表与编辑表单，PDF 按页数逐页翻看）。
- 全屏查看器（`ImageViewer`）交互：双指捏合缩放（以两指中点为焦点）、双击放大/复原、−/+ 按钮与百分比复原、放大后单指拖动（不露出图片外空白），缩放范围 100%–500%；PDF 按服务端逐页预览图翻页并显示页码。
- 结构化字段与表格单元格可直接编辑。每次保存生成新的 `DM-ResultVersion`，旧版本保留为历史快照，原始识别结果不被覆盖。
- 电话号码等标量数组叶字段（含表格单元格）按原顺序逐项提供独立输入框，以原字段路径追加数组索引（`path + [index]`）发出 `string` 编辑事件，仅替换对应元素；保留数组类型、顺序、长度与所有未编辑元素，不合并为逗号或换行分隔字符串。单一字符串电话号码仍可直接编辑；确认锁定后上述字段均只读。此为 FR-VERIFY-002/015 的可编辑性修复，不改变确认、认证或订阅流程。
- 结构化结果中的数字默认按金额显示：整数部分加千分位逗号，至少保留 2 位小数，末尾 0 不省略（`29650` → `29,650.00`，`68523.4` → `68,523.40`），超过 2 位的原样保留、不截断不四舍五入；字符串值原样显示。字段名为计数/比率（序号 seq、数量 qty/quantity、count、页码、税率 rate/percent、id、电话等）的数字按原值显示；编号类（no/number/item/code）除非字段名同时含金额词（amount/price/total/vat/tax/discount 等）也按原值显示。核验结果页、最终结果页与 Excel/CSV 导出使用同一规则（`structured.ts` 与 `routes/exports.py`）。输入框同样以该格式回显；编辑数字字段后离开输入框时，若可解析为数字（允许千分位逗号）则以数字类型保存，保持 JSON 类型不变。CSV/Excel 中纯数字文本（含负数如 `-1,370.47`）不加防公式注入前缀。
- LINE Mini App 结果页（`ResultPage`）点击 `Continue` 时，必须在提交确认之前检查认证、注册完成状态与**任务所属工作空间**的订阅（`FR-SYS-011/012`）：游客或未完成注册者→登录/注册页（`auth`）；已注册 Free/NONE→订阅计划检查页（`plans`，默认 `Kinder`）；无已开通付费套餐的 PENDING→套餐升级处理中页（`plan-pending`）。上述分支均不提交 `confirm: true`，未确认任务保持可编辑。
- 重定向前，仅在结构化内容存在未保存变更时，以现有 PATCH 结果操作的 `confirm: false` 保存新结果版本；无变更不保存。此保存不锁定结果、不记录 `completed_at`。
- 已注册且订阅 ACTIVE（含已有付费套餐且另有更高档升级申请处理中）的用户，才可在结果页显式继续、通过 §3.3 校验后提交 `confirm: true`；确认成功后结果只读并进入最终结果页。
- 登录/注册、游客数据归集或套餐可用性恢复后，重新检查该任务所属工作空间的订阅：ACTIVE 的未完成任务（含历史 `VERIFIED`）返回结果页，须用户再次显式继续，不自动确认；只有已经 `COMPLETED` 的任务可直接进入最终结果页。NONE/PENDING 仍按上述分流，提交升级申请及提示后的首页流转见 `FR-SYS-012`。

### 3.5 任务流程阶段（FR-VERIFY-017）
任务摘要（`GET /api/v1/ocr/jobs`、`GET /api/v1/ocr/jobs/{id}`）返回服务端推导的 `stage`，前端状态标签与历史筛选均以其为准：

| stage | 显示 | 推导条件 |
|-------|------|----------|
| `OCR_PROCESSING` | OCR 处理中 | OCR 任务处于排队/预处理/识别/后处理/取消中 |
| `OCR_FAILED` | OCR 处理失败 | OCR 任务 `FAILED` 或 `CANCELLED` |
| `VERIFYING` | 数据验证中 | OCR 成功（含部分成功）且结果尚未确认 |
| `VERIFIED` | 数据已验证 | 历史已确认结果，`completed_at` 为空；保留兼容 |
| `COMPLETED` | 最终完成 | 结果已确认且 `completed_at` 已记录 |

- `ocr_jobs.completed_at` 仅在显式完成时记录，不随之后登录/注册、游客数据归集或套餐开通而自动变化；本次 LINE 客户端流转调整不批量转换历史数据，也不改变服务端阶段推导契约。
- 游客、未完成注册者以及无已开通付费套餐的 Free/NONE 或 PENDING 用户点击 `Continue` 时不提交确认；未确认任务（含重定向前以 `confirm: false` 保存变更的任务）保持「数据验证中」，不锁定、不记录 `completed_at`。
- 已注册且任务所属工作空间订阅 ACTIVE 的用户在结果页显式确认成功后，任务直接进入「最终完成」，不经过「数据已验证」；另有更高档升级申请处理中不影响此资格。
- 历史「数据已验证」任务仍可展示与筛选；登录/注册或套餐开通后不自动完成，只有已注册付费用户在结果页再次显式点击「继续」，才记录 `completed_at` 并进入「最终完成」。
- 历史页筛选项固定为：全部 / OCR 处理中 / OCR 处理失败 / 数据验证中 / 数据已验证 / 最终完成。筛选项超出一行宽度时自动换行，所有筛选项必须完整可见。
- 历史页分页加载：每页 20 条，按创建时间倒序；列表滚动至底部时自动加载下一页，加载中显示「加载更多…」，全部加载完毕（且超过一页）时显示「没有更多记录」。
- 阶段筛选（`stage`）与文件名搜索（`q`，不区分大小写的包含匹配）均在服务端分页之前执行，保证每页结果完整；切换筛选、修改关键字（300 ms 防抖）或切换工作空间时从第 1 页重新加载。
- 打开任务（历史页与首页最近任务）：OCR 处理中→处理进度页；最终完成→最终结果页；其余阶段→结果页。
- 最终结果页仅显示任务阶段标签，不再重复显示 `Confirmed` 标签；结果保持只读，原图与 Excel 导出功能不变。

## 4. 代表性验收标准（P0）

```gherkin
Feature: EPIC-03 核验与修改

  Scenario: AC-FR-VERIFY-002-01 单字段编辑
    Given 一份待核验的 Invoice，其 total_price = 12000.00
    When 文员将 total_price 编辑为 12500.00 并保存
    Then 该字段显示新值，且创建一条 DM-ChangeLog 记录

  Scenario: AC-FR-VERIFY-006-01 确认并锁定
    Given 所有必填字段均存在且没有字段被标记
    When 文员点击 "Confirm"
    Then 文档状态变为 "verified"，且字段变为只读

  Scenario: AC-FR-VERIFY-006-02 因缺失字段阻止确认
    Given 必填字段 "invoice_number" 为空
    When 文员点击 "Confirm"
    Then 系统 SHALL 阻止确认并显示 "Missing required field: invoice_number"

  Scenario: AC-FR-VERIFY-010-01 无需复核
    Given Delivery Note 流程被配置为 0 级复核
    And 文档已完成核验确认
    Then 文档状态为 "approved_for_business"，可以进入业务流程

  Scenario: AC-FR-VERIFY-012-01 二级复核门控
    Given Invoice 流程被配置为 2 级复核
    And 一级复核已通过
    When 二级复核尚未通过时请求正式业务录入
    Then 系统 SHALL 拒绝该请求

  Scenario: AC-FR-VERIFY-012-02 二级复核通过
    Given Invoice 流程被配置为 2 级复核
    And 一级及二级复核均已通过
    When 请求正式业务录入
    Then 系统 SHALL 允许录入，且文档状态为 "approved_for_business"

  Scenario: AC-FR-VERIFY-013-01 复核日志
    Given 一级复核人员通过一份待复核文档
    When 保存复核决定
    Then 创建 DM-ReviewRecord，包含复核级别、复核人、时间、决定和意见

  Scenario: AC-FR-VERIFY-014-01 原图与表格布局
    Given 一份已完成识别的文档
    When 打开核验结果页
    Then 页面仅显示原图预览与结构化字段/表格，且原图位于表格数据上方
    When 点击原图（核验结果页或最终结果页）
    Then 以当前页打开全屏查看器，支持双指捏合缩放、双击放大/复原、拖动平移与多页翻页
    And 在查看器中翻页后关闭，原图卡片的页码按钮同步为查看器最后所在页
    Given 公司 OWNER 已上传公司证书（图片或 PDF）
    When 在公司页点击证书缩略图（公司列表或编辑表单）
    Then 打开同一全屏查看器，PDF 证书逐页可翻看

  Scenario: AC-FR-VERIFY-014-02 上传确认页预览缩放
    Given 用户在 LINE Mini App 上传单据后进入上传确认页
    When 点击预览图
    Then 打开全屏查看器，缩放为 100%，多页 PDF 显示页码并可左右滑动或按钮翻页
    When 用户双指捏合张开、双击图片或点击 "+"
    Then 图片放大（双指以两指中点、双击以双击点为焦点，最大 500%），放大后可单指拖动且不露出图片外空白
    When 用户双击已放大的图片、点击百分比按钮或捏合收拢
    Then 复原为 100%，不小于 100%
    When 用户点击关闭按钮
    Then 查看器关闭，仍停留在上传确认页，可继续 "Start processing"

  Scenario: AC-FR-VERIFY-015-01 结构化编辑生成新版本
    Given 当前结果版本为 1，某个表格单元格数量为 120
    When 用户将该单元格改为 135 并保存
    Then 系统生成版本 2，且版本 1 仍可作为历史快照读取

  Scenario: AC-FR-VERIFY-015-02 标量数组逐项编辑并保留数组
    Given LINE Mini App 核验结果尚未确认，当前版本为 1，seller.tel = ["065-205-8258", "065-205-8259"]
    When 用户打开核验结果页
    Then 两个号码各自显示独立可编辑输入框，表格单元格中的标量数组亦逐项可编辑，单一字符串号码仍可直接编辑
    When 用户仅将第一个号码改为 "065-205-8268" 并保存
    Then 编辑事件以原路径追加索引 0 和 string 值发出，系统生成版本 2，seller.tel = ["065-205-8268", "065-205-8259"]
    And 数组类型、顺序、长度及未编辑的第二个元素保持不变，不合并为逗号或换行字符串，版本 1 保留原数组快照
    When 用户仅将第二个号码改为 "065-205-8269" 并保存
    Then 编辑事件以原路径追加索引 1 和 string 值发出，系统生成版本 3，seller.tel = ["065-205-8268", "065-205-8269"]
    And 数组类型、顺序、长度及本次未编辑的第一个元素保持不变，版本 1 和版本 2 的快照不被覆盖
    When 用户按现有确认流程成功确认并锁定结果
    Then 两个号码及其他结构化字段与表格单元格均为只读

  Scenario: AC-FR-VERIFY-015-03 金额数字千分位与 2 位小数
    Given 结构化结果中 items[0] = {seq: 1, quantity: 990, price: 26.96, amount: 29650}，totals.sub_total = 68523.4
    When 用户打开核验结果页、最终结果页或导出 Excel/CSV
    Then amount 显示为 "29,650.00"，sub_total 显示为 "68,523.40"，price 仍为 "26.96"
    And seq 显示为 "1"，quantity 显示为 "990"（计数/标识字段不补小数、不加千分位）
    When 用户将 amount 改为 "29650.5" 并离开输入框
    Then 该值以数字 29650.5 保存（JSON 类型不变为字符串），并回显为 "29,650.50"

  Scenario: AC-FR-VERIFY-015-04 新增与删除字段、表格行
    Given LINE Mini App 核验结果尚未确认，字段分区包含 seller.name、totals.sub_total，明细表 items 有 3 行
    When 用户点击字段分区的 "Add field"，输入字段名 "tax_id" 与值 "0105551234567" 并确认
    Then 该字段追加到对应 JSON 对象末尾，与原有字段一样可继续编辑
    And 字段名留空或与该分区现有字段重名时，确认按钮不可用
    When 用户删除某个字段
    Then 仅移除该字段，其他字段、表格与历史结果版本不受影响
    When 用户在明细表点击 "Add row"
    Then items 末尾追加一行，所有列均可编辑，单元格初始为空
    When 用户在新增行或新增字段的金额类列填入 "29650" 并离开输入框
    Then 该值按金额格式回显为 "29,650.00" 并以数字保存
    When 用户删除明细表的某一行
    Then 仅移除该行，其余行的顺序与数据保持不变
    And 删除某分区最后一个字段或表格最后一行后，页面保留该空卡片及 "Add field"/"Add row" 入口，可继续添加
    When 用户按现有确认流程保存并确认
    Then 增删后的结构生成新的结果版本，导出 Excel/CSV 与页面显示一致
    And 结果确认锁定后，增删按钮与输入框均不可用

  Scenario: AC-FR-VERIFY-015-05 重置未保存的改动
    Given 用户在核验结果页修改了字段值或增删了字段/表格行，尚未点击 Continue
    When 用户点击 Continue 左侧的 "Reset"
    Then 弹出确认框，说明所有编辑以及新增/删除的字段和行都会被放弃
    When 用户选择取消
    Then 确认框关闭，页面上的改动保持不变
    When 用户确认重置
    Then 页面恢复为当前结果版本的结构与原值，空卡片等临时状态一并清除
    And 未做任何改动时 Reset 按钮不可用；结果已确认锁定时不显示 Reset 按钮

  Scenario: AC-FR-VERIFY-016-01 已注册付费用户显式确认
    Given 用户已登录并完成注册，任务所属工作空间订阅为 ACTIVE，且所有必填字段均有效
    When 用户在 LINE Mini App 结果页点击 "Continue"
    Then 客户端先检查认证、注册完成状态与该任务工作空间订阅，再提交 confirm: true
    And 确认成功后结果被锁定、记录 completed_at，任务为 COMPLETED 并进入最终结果页

  Scenario: AC-FR-VERIFY-016-02 游客确认前重定向与草稿保存
    Given 用户处于游客会话，任务为 VERIFYING，且有未保存的结构化编辑
    When 用户在 LINE Mini App 结果页点击 "Continue"
    Then 仅以 PATCH confirm: false 保存变更为新结果版本，再进入登录/注册页（auth），不提交 confirm: true
    And 任务保持 VERIFYING、结果仍可编辑，completed_at 为空
    Given 游客没有未保存的结构化变更
    When 用户点击 "Continue"
    Then 进入 auth，不发送结果保存或确认请求

  Scenario: AC-FR-VERIFY-017-01 流程阶段展示
    Given 用户的任务分别处于 OCR 识别中、OCR 失败、OCR 识别成功未确认
    When 用户打开历史页
    Then 各任务分别显示 "OCR 处理中"、"OCR 处理失败"、"数据验证中"
    Given 用户为游客、未完成注册者，或任务工作空间为 Free/NONE、无已开通付费套餐的 PENDING，且任务为 VERIFYING
    When 用户在结果页点击 "Continue"
    Then 不提交确认，任务仍为 "数据验证中"，completed_at 为空
    When 用户随后完成登录/注册、游客数据归集或套餐开通
    Then 任务不自动变为 "最终完成"
    Given 已注册且任务工作空间订阅 ACTIVE 的用户在结果页显式继续并确认成功
    Then 该任务直接显示 "最终完成"
    Given 一个历史 "数据已验证" 的任务，completed_at 为空，用户未完成注册或该任务工作空间未开通付费套餐
    When 用户点击 "Continue"
    Then 按认证与订阅检查进入 auth、plans 或 plan-pending，不提交确认，任务仍为 VERIFIED
    Given 该历史任务由已注册且任务工作空间订阅 ACTIVE 的用户在结果页显式点击 "继续"
    Then 确认成功后记录 completed_at，任务变为 "最终完成"，不批量转换其他历史任务

  Scenario: AC-FR-VERIFY-017-02 按阶段筛选
    Given 用户位于历史页
    When 用户选择某一阶段筛选
    Then 仅显示该阶段的任务
    And 筛选项始终包含 "数据已验证"

  Scenario: AC-FR-VERIFY-017-03 历史分页加载
    Given 用户当前工作空间有 45 条任务
    When 用户打开历史页
    Then 首次仅显示最新的 20 条任务，且所有筛选项完整可见
    When 用户将列表滚动至底部
    Then 自动加载并追加第 21–40 条任务
    When 用户再次滚动至底部
    Then 追加剩余 5 条，并显示 "没有更多记录"

  Scenario: AC-FR-VERIFY-017-04 按阶段打开任务
    Given 用户在历史页或首页最近任务中看到不同阶段的任务
    When 用户点击 "最终完成" 的任务
    Then 直接进入该任务的最终结果页，不再显示需要 Continue 确认的结果页
    And 最终结果页仅显示任务阶段标签，不再重复显示 Confirmed 标签，结果保持只读且可导出
    When 用户点击 "OCR 处理中" 的任务
    Then 进入处理进度页
    When 用户点击其余阶段的任务
    Then 进入结果页
```

## 5. 可追溯性
| FR ID | 验证方式 | 设计引用 |
|-------|----------|----------|
| FR-VERIFY-001..017 | AC-FR-VERIFY-* | `DM-ExtractedField`、`DM-ChangeLog`、`DM-ReviewRecord`、`DM-ReviewPolicy`、`API-4` |

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.6.0 | 2026-11-06 | Product Engineering | FR-VERIFY-006, FR-VERIFY-009, FR-VERIFY-015, FR-VERIFY-017 迁移至 `openspec/specs/`（变更 `ocr-scan-flow`），本文件中对应条目只作参考 |
| 1.5.8 | 2026-10-20 | Product Engineering | FR-VERIFY-015：核验结果页支持新增/删除字段与表格增删行（删除到空时保留空卡片入口，新增金额类值按金额格式保存与显示）；Continue 旁新增 Reset 按钮，确认后放弃未保存改动；新增 AC-FR-VERIFY-015-04/05 |
| 1.5.7 | 2026-10-19 | Product Engineering | FR-VERIFY-015：金额数字千分位逗号 + 至少保留 2 位小数（不省略 .00），计数/标识字段按原值；页面与 Excel/CSV 导出一致，编辑后保持数字类型；新增 AC-FR-VERIFY-015-03。FR-VERIFY-014：核验结果页/最终结果页原图与公司证书统一使用全屏查看器（双指捏合缩放）；更新 AC-FR-VERIFY-014-01 |
| 1.5.6 | 2026-10-19 | Product Engineering | FR-VERIFY-014：上传确认页预览图支持全屏缩放与双指触控捏合缩放；新增 AC-FR-VERIFY-014-02 |
| 1.5.5 | 2026-10-18 | Product Engineering | FR-VERIFY-017：最终结果页移除重复 Confirmed 标签，保留任务阶段、只读结果与导出；同步 AC-FR-VERIFY-017-04 |
| 1.5.4 | 2026-10-18 | Product Engineering | FR-VERIFY-002/015 修复说明：电话号码等标量数组逐项编辑并保留数组与历史快照；新增 AC-FR-VERIFY-015-02，不改变确认、认证或订阅流程 |
| 1.5.3 | 2026-10-18 | Product Engineering | FR-VERIFY-016/017：LINE Continue 改为确认前认证与工作空间订阅检查，仅保存未保存变更（confirm: false）；已注册付费用户显式确认，恢复未完成任务返回结果页；保留历史 VERIFIED、不批量转换；同步 AC |
| 1.5.2 | 2026-10-18 | Product Engineering | FR-VERIFY-017：点击「最终完成」任务直接进入最终结果页；新增 AC-FR-VERIFY-017-04 |
| 1.5.1 | 2026-10-18 | Product Engineering | FR-VERIFY-017 修正：阶段按确认时的注册状态持久化（`completed_at`），注册后不自动转为最终完成；历史筛选始终包含「数据已验证」；更新 AC-FR-VERIFY-017-01/02 |
| 1.5.0 | 2026-10-18 | Product Engineering | FR-VERIFY-017 扩展：历史筛选项换行完整显示；历史列表每页 20 条滚动分页，阶段筛选与文件名搜索在服务端执行；新增 AC-FR-VERIFY-017-03 |
| 1.4.0 | 2026-10-18 | Product Engineering | 新增 FR-VERIFY-017：任务按流程阶段（OCR 处理中/失败、数据验证中、数据已验证、最终完成）展示与筛选；新增 AC-FR-VERIFY-017-01/02 |
| 1.3.0 | 2026-10-17 | Product Engineering | 确认后流转改为按订阅状态分流（FR-SYS-012） |
| 1.2.0 | 2026-10-17 | Product Engineering | 新增原图置顶与缩放、结构化结果版本化编辑、确认后的登录/订阅/最终页流转 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增可配置 0/1/2 级复核、最终复核门控与复核日志；明确不支持 Workflow Engine |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | 根据 PRD 第 4.3 节生成初始核验需求 |
