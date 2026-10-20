---
doc_id: AC-000
title: "SaiFlow — 汇总验收标准（V1.0 / P0）"
type: acceptance
status: active
version: 1.8.15
updated: 2026-10-20
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

  Scenario: AC-FR-UPLOAD-010-01 上传进度反馈
    Given 文员在 LINE Mini App 选择支持的相机照片、相册图片或本地文件
    When 文件处于上传预检、传输或后端校验阶段
    Then 百分比与进度条按文件大小估算和已上传字节持续更新且不回退
    And 后端确认文件可用前不超过 95%，成功后为 100% 并进入上传确认页
    And 上传失败后停止进度、显示本地化错误并恢复选择入口，再次选择时从 0% 开始

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

  Scenario: AC-FR-OCR-020-02 失败任务可读原因与重试
    Given 一个 status=FAILED 且 error_code=TEXTIN_ERROR_40003 的 OCR 任务
    When 用户从 History 打开该任务
    Then 显示本地化的失败原因与 Retry 操作，而非 404
    When 用户点击 Retry
    Then 创建新的 QUEUED 任务并进入处理页

  Scenario: AC-FR-OCR-020-03 取消任务需确认
    Given 一个 status 为 QUEUED 或 RUNNING 的 OCR 任务处理页
    When 用户点击 Cancel task
    Then 系统显示确认对话框，说明识别将停止、任务标记为失败且可稍后重新执行
    When 用户选择 Keep processing
    Then 对话框关闭，任务继续处理
    When 用户在对话框中确认 Cancel task
    Then 任务被取消并标记为失败
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

  Scenario: AC-FR-ENTRY-015-01 最终结果页导出
    Given 一份已确认且包含已编辑数量的文档
    When 用户在最终结果页点击 "Export Excel"
    Then 生成仅含一个工作表的 XLSX，字段区块与表格区块的顺序、标题与列名与解析结果页一致
    And 导出内容反映当前已确认的结构化结果
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

  Scenario: AC-FR-SYS-001-03 登出需确认
    Given 已登录用户在个人中心
    When 用户点击 "Sign out"
    Then 系统弹出登出确认框
    When 用户点击取消
    Then 确认框关闭，用户仍保持登录
    When 用户再次点击 "Sign out" 并在确认框中确认
    Then 会话被撤销并回到登录页

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

  Scenario: AC-FR-SYS-010-01 游客试用
    Given 匿名访客首次进入应用
    When 访客上传文档并完成识别与核验
    Then 访客仅能访问自己的任务与结果，且不获得管理、报表或配置权限

  Scenario: AC-FR-SYS-010-02 游客数据归集
    Given 游客已完成上传与识别
    When 游客登录或注册为正式用户
    Then 其文档、任务、结果版本、导出记录与配额消耗流水归集至该正式用户
    And 游客账户及其会话被删除，游客的首登赠送不叠加到正式用户

  Scenario: AC-FR-SYS-011-01 确认前登录或注册与任务恢复
    Given 用户为游客或尚未完成注册信息录入，任务尚未最终完成
    When 用户在 LINE Mini App 结果页点击 "Continue"
    Then 在提交确认前进入 auth，用户可登录或注册，不提交 confirm: true
    When 用户完成登录或注册，系统归集游客数据并读取该任务工作空间的订阅
    Then NONE 进入 plans，PENDING 且无已开通付费套餐进入 plan-pending
    And ACTIVE 返回该未完成任务的结果页（result）等待用户显式继续，不自动确认或进入最终结果页
    Given 恢复的任务已为 COMPLETED 且该任务工作空间订阅 ACTIVE
    Then 可直接进入最终结果页

  Scenario: AC-FR-SYS-012-01 Free/NONE 确认前提交套餐升级申请
    Given 用户已登录并完成注册，未确认任务所属工作空间为 Free/NONE 且没有套餐升级申请，即使其他工作空间已开通付费套餐
    When 用户在结果页点击 "Continue"
    Then 不提交 confirm: true，进入订阅计划检查页（plans），默认选中 `Kinder`，按钮显示 "Upgrade to Kinder"
    And 重定向前仅有未保存变更时以 PATCH confirm: false 保存，无变更不保存；结果不锁定、任务保持 VERIFYING、completed_at 为空
    When 用户选择套餐并点击按钮，在套餐升级确认框中确认申请
    Then 系统创建状态为 SUBMITTED 的 PLAN_UPGRADE 申请，并提示“您的申请已经收到，我们会尽快联系您”
    And 用户确认提示后返回首页，任务仍未确认且未最终完成

  Scenario: AC-FR-SYS-012-02 无已开通付费套餐的 PENDING
    Given 用户已登录并完成注册，未确认任务所属工作空间无已开通付费套餐且存在处理中的套餐升级申请（PENDING）
    When 用户在结果页点击 "Continue"
    Then 不提交 confirm: true，直接进入“套餐升级处理中”页（plan-pending），显示申请套餐与提交时间
    And 重定向前仅有未保存变更时以 PATCH confirm: false 保存，无变更不保存；结果不锁定、任务保持 VERIFYING、completed_at 为空

  Scenario: AC-FR-SYS-012-03 ACTIVE 显式确认与套餐可用性恢复
    Given 用户已登录并完成注册，任务所属工作空间存在 APPROVED 的付费套餐申请（ACTIVE），包括另有更高档升级申请处理中的情况
    When 用户在结果页点击 "Continue" 且通过核验校验
    Then 先检查认证与该任务工作空间订阅，再提交 confirm: true
    And 仅确认成功后锁定结果、记录 completed_at 并进入最终结果页
    Given 因订阅检查中断的任务尚为 VERIFYING 或历史 VERIFIED
    When 该任务工作空间套餐开通或可用性恢复为 ACTIVE，用户恢复该任务
    Then 返回结果页（result）等待用户显式继续，不自动提交确认或进入最终结果页
    When 用户在结果页再次显式继续并确认成功
    Then 任务变为 COMPLETED 并进入最终结果页
    Given 恢复的任务已经 COMPLETED 且其工作空间订阅 ACTIVE
    Then 可直接进入最终结果页，无需再次确认

  Scenario: AC-FR-SYS-013-01 已开通套餐的展示
    Given 用户的 Starter 升级申请已被后台批准
    When 用户打开首页或套餐页
    Then 首页横幅与当前套餐卡显示 "Starter"，套餐页将 Starter 标记为当前套餐
    And 首页横幅与当前套餐卡按套餐每月页数显示 "5,000 / 5,000 pages left this month"（随本月已识别页数递减），不含 "free" 描述与 Sign-in bonus 角标；未开通套餐时保留 "free scans left"
    And 本月剩余页数为 0 时创建 OCR 任务被拒绝（quota_exceeded），且不消耗免费任务

  Scenario: AC-FR-SYS-013-02 升级至更高档套餐
    Given 用户当前套餐为 Starter 且没有处理中的申请
    When 用户在套餐页点击 Intermediate 的 "Upgrade"
    Then 系统弹出确认框显示目标套餐 Intermediate；点击取消则不创建申请
    When 用户在确认框中点击确认
    Then 系统创建 PLAN_UPGRADE 申请并提示“您的申请已经收到，我们会尽快联系您”，确认后返回首页
    And 再次打开套餐页时页面顶部显示醒目的处理中卡片（含目标套餐与提交时间），Intermediate 卡片带 "IN REVIEW" 角标并显示 "Upgrade in progress"，其他升级按钮不可用
    And 申请 Kinder 或 Starter 被拒绝（plan.not_upgrade）

  Scenario: AC-FR-SYS-013-03 游客不显示套餐横幅
    Given 未登录的游客
    When 打开首页
    Then 不显示套餐与免费额度横幅

  Scenario: AC-FR-SYS-013-04 注册后为免费版
    Given 刚完成注册且没有已批准套餐升级申请的用户
    When 用户打开首页或套餐页
    Then 首页横幅显示 "Free · 1000 / 1000 free scans left"，套餐页当前套餐卡显示 "Free" 与 Sign-in bonus 角标
    And 套餐目录中 Kinder 不标记为当前套餐，Kinder、Starter、Intermediate、Advance 均显示 "Upgrade"
    And 申请 Kinder 被接受（不返回 plan.not_upgrade）

  Scenario: AC-FR-SYS-014-01 LINE 注册信息录入
    Given 一个尚未注册的 LINE 账号完成 LINE 认证
    Then 系统弹出注册信息框，手机号预填且只读，邮箱、昵称与头像预填且可修改，并提供验证码输入框
    When 用户修改邮箱、昵称或头像，向该邮箱发送验证码并输入验证码后点击注册
    Then 系统完成注册，保存修改后的邮箱、昵称与头像，并继续进入应用

  Scenario: AC-FR-SYS-014-02 注册邮箱与验证码校验
    Given LINE 未提供邮箱，或用户修改了预填邮箱
    When 用户未填写邮箱或填写格式错误的邮箱并点击注册
    Then 系统提示邮箱必填或格式错误，不完成注册
    When 用户未向当前填写的邮箱发送验证码，或未输入验证码并点击注册
    Then 系统提示先发送验证码或验证码必填，不完成注册
    When 用户向有效邮箱发送验证码、输入验证码并提交
    Then 系统完成注册并保存该邮箱（生产环境校验验证码，开发环境不校验）

  Scenario: AC-FR-SYS-014-03 取消注册与已注册用户登录
    Given 注册信息框已弹出
    When 用户点击取消
    Then 本次会话被撤销并回到登录页
    Given 已注册用户修改过昵称与头像
    When 用户再次通过 LINE 登录
    Then 昵称与头像保持用户修改后的值，不再弹出注册信息框

  Scenario: AC-FR-SYS-015-01 修改昵称与头像
    Given 已登录用户在个人中心
    When 用户点击资料卡，修改昵称或头像并保存
    Then 个人中心立即显示新的昵称与头像；昵称为空时不可保存

  Scenario: AC-FR-SYS-016-01 更换邮箱
    Given 已登录用户在个人中心点击邮箱「更换」
    When 用户输入新邮箱并点击发送验证码
    Then 系统向新邮箱发送验证码，按钮进入 60 秒倒计时
    When 用户输入验证码并确认
    Then 邮箱更新为新邮箱

  Scenario: AC-FR-SYS-016-02 更换邮箱校验
    Given 用户正在更换邮箱
    Then 新邮箱与当前邮箱相同或格式错误时不可发送验证码
    And 未向当前输入的新邮箱发送验证码或未输入验证码时不可确认
    And 生产环境验证码错误或过期时拒绝更换（开发环境不校验验证码）

  Scenario: AC-FR-SYS-017-01 工作空间刷新后保持
    Given 已登录用户在首页将工作空间切换为已认证企业
    When 用户刷新页面或重新登录
    Then 当前工作空间仍为该企业
    And 若该企业已解绑或不再可用，则回落为个人空间

  Scenario: AC-FR-SYS-017-02 个人与企业数据隔离、企业成员共享
    Given 用户 A（企业 OWNER）与用户 B（企业 MEMBER）各有个人任务，并各在企业空间有任务
    When A 处于个人空间
    Then 首页最近任务与历史页仅显示 A 的个人任务
    When A 或 B 切换到企业空间
    Then 仅显示该企业空间的任务，且包含 A 与 B 在企业空间创建的任务

  Scenario: AC-FR-SYS-017-03 企业空间单独购买套餐
    Given 企业空间未开通付费套餐，企业 OWNER 处于企业空间
    When OWNER 在套餐页申请升级 Kinder 并确认
    Then 创建归属该企业的 PLAN_UPGRADE 申请，个人空间的订阅状态不变
    And 该企业的 MEMBER 在套餐页看到同一处理中申请，但不能提交升级
    When 后台批准该申请
    Then 该企业全体成员在企业空间看到 Kinder 套餐及共享的本月剩余页数，个人空间仍为 Free
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

  Scenario: AC-NFR-USAB-004-01 统一品牌等待反馈
    Given 用户使用 LINE Mini App
    When 启动、页面读取、局部请求或按钮操作处于等待中
    Then 显示 SaiFlow F＋圆点标志、saiflow 字标与本地化操作文字
    And 扫描光线、光环及环绕光点适配所在布局，标志本身不旋转
    And 上传百分比与进度条、OCR 阶段保留；等待不改变认证、套餐分流或确认行为

  Scenario: AC-NFR-USAB-004-02 等待结束与失败恢复
    Given 页面或操作正在等待
    When 请求成功或失败
    Then 对应等待效果消失，恢复结果或可操作的本地化错误
    And 已有防重复提交、验证码冷却及禁用规则保持不变
    And OCR 终态不再显示加载动效，套餐审核状态不冒充网络等待

  Scenario: AC-NFR-USAB-004-03 动效与移动端可访问性
    Given 用户使用泰语或英语界面及 320px 宽屏幕
    When 显示页面、局部或按钮等待效果
    Then 标志、字标与操作文字不遮挡输入框或溢出操作区域
    And 等待状态有可访问文字，上传百分比不作为持续 live 播报
    When 用户启用 prefers-reduced-motion
    Then 加载动画停止且扫描光线隐藏，状态文字仍可见
```

## 9. 覆盖矩阵（摘要）

| Epic | P0 需求 | 已有 AC | 自动化？ |
|------|---------|---------|----------|
| EPIC-01 | 8 | ✔ | 是（相机硬件除外，人工） |
| EPIC-02 | 16 | ✔ | 是（基于样本与集成桩） |
| EPIC-03 | 17 | ✔ | 是 |
| EPIC-04 | 9 | ✔ | 是 |
| EPIC-05 | 2（P0 子集） | ✔ | 是 |
| EPIC-06 | 17 | ✔ | 是 |
| EPIC-08 | 0（P1，待 OQ-9） | ✔ | 是 |
| NFR | 门槛 | ✔ | 混合（性能/安全测试工具） |

> 每项需求完整的 AC ID 列于每个 epic 的“验证方式”列以及 `Requirements-Index.md` 中。

## 链接
- 需求：`docs/20-requirements/Requirements-Index.md`
- 设计：`docs/30-design/`

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.8.15 | 2026-10-20 | Product Engineering | 新增 AC-FR-VERIFY-015-04：核验结果页新增/删除字段与表格增删行（含空卡片继续添加、新增金额值格式化、确认后只读与导出一致）；新增 AC-FR-VERIFY-015-05：Reset 按钮确认后放弃未保存改动 |
| 1.8.14 | 2026-10-19 | Product Engineering | 新增 AC-FR-VERIFY-015-03：金额数字千分位 + 保留 2 位小数（页面与导出一致），计数字段按原值，编辑后保持数字类型；更新 AC-FR-VERIFY-014-01：结果页/最终结果页原图与公司证书使用全屏查看器 |
| 1.8.13 | 2026-10-19 | Product Engineering | 新增 AC-FR-VERIFY-014-02：上传确认页预览全屏缩放与双指触控捏合缩放 |
| 1.8.12 | 2026-10-18 | Product Engineering | 新增 AC-NFR-USAB-004-01/02/03：统一品牌等待反馈、等待结束与失败恢复、减少动态效果及移动端可访问性；保留进度和既有业务行为 |
| 1.8.11 | 2026-10-18 | Product Engineering | 补充 AC-FR-VERIFY-017-04：最终结果页保留任务阶段标签，不重复显示 Confirmed，仍只读且可导出 |
| 1.8.10 | 2026-10-18 | Product Engineering | 新增 AC-FR-VERIFY-015-02：电话号码等标量数组逐项编辑，保留数组、未编辑元素及历史快照，确认锁定后只读 |
| 1.8.9 | 2026-10-18 | Product Engineering | 修订 AC-FR-VERIFY-016-01/02、017-01 与 AC-FR-SYS-011-01、012-01/02/03：LINE 确认前认证/工作空间订阅检查、仅变更草稿保存、ACTIVE 显式确认、恢复未完成任务返回结果页及历史 VERIFIED 兼容 |
| 1.8.8 | 2026-10-18 | Product Engineering | 补充 AC-FR-UPLOAD-010-01：上传进度持续更新，确认成功前不满，失败与重试正确复位 |
| 1.8.7 | 2026-10-18 | Product Engineering | 修订 AC-FR-SYS-010-02：归集后删除游客账户，游客首登赠送不叠加 |
| 1.8.6 | 2026-10-18 | Product Engineering | 修订 AC-FR-ENTRY-015-01：XLSX 导出为单工作表，版式与解析结果页一致 |
| 1.8.5 | 2026-10-18 | Product Engineering | 新增 AC-FR-VERIFY-017-04：点击「最终完成」任务直接进入最终结果页 |
| 1.8.4 | 2026-10-18 | Product Engineering | 修订 AC-FR-VERIFY-017-01/02：阶段按确认时注册状态判定，筛选始终含「数据已验证」 |
| 1.8.3 | 2026-10-18 | Product Engineering | 新增 AC-FR-VERIFY-017-03：历史筛选项完整显示与每页 20 条滚动分页 |
| 1.8.2 | 2026-10-18 | Product Engineering | 新增 AC-FR-OCR-020-03：取消任务前需确认 |
| 1.8.1 | 2026-10-18 | Product Engineering | 新增 AC-FR-VERIFY-017-01/02：任务流程阶段展示与按阶段筛选 |
| 1.8.0 | 2026-10-18 | Product Engineering | 新增 AC-FR-SYS-017-01/02/03：工作空间刷新保持、个人/企业数据隔离与企业成员共享、企业空间单独购买套餐 |
| 1.7.3 | 2026-10-18 | Product Engineering | 新增 AC-FR-SYS-001-03：个人中心登出前须确认 |
| 1.7.2 | 2026-10-18 | Product Engineering | 新增 AC-FR-SYS-013-04：注册后未开通付费套餐为免费版 `Free`（1,000 次赠送扫描），Kinder 可升级 |
| 1.7.1 | 2026-10-18 | Product Engineering | AC-FR-SYS-014-01/02：注册邮箱可修改并须输入验证码 |
| 1.7.0 | 2026-10-17 | Product Engineering | 新增 AC-FR-SYS-014-01/02/03、AC-FR-SYS-015-01、AC-FR-SYS-016-01/02：LINE 注册信息录入、修改昵称与头像、更换邮箱 |
| 1.6.1 | 2026-10-17 | Product Engineering | AC-FR-SYS-013-02：套餐页处理中提示改为顶部醒目卡片，处理中套餐带 IN REVIEW 角标 |
| 1.6.2 | 2026-10-17 | Product Engineering | AC-FR-SYS-013-01：付费套餐按每月页数展示与校验，去掉 free 描述 |
| 1.6.0 | 2026-10-17 | Product Engineering | 新增 AC-FR-SYS-013-01/02/03：已开通套餐展示、升级至更高档、游客隐藏套餐横幅 |
| 1.5.0 | 2026-10-17 | Product Engineering | 新增 AC-FR-SYS-012-01/02/03：确认后按订阅状态分流；移除 AC-FR-SYS-011-02 |
| 1.4.0 | 2026-10-17 | Product Engineering | 新增失败 OCR 任务可读原因与重试验收场景 |
| 1.3.0 | 2026-10-17 | Product Engineering | 新增原图置顶与缩放、结构化版本化编辑、游客试用与归集、确认后登录/订阅、最终页 XLSX 导出验收场景 |
| 1.2.0 | 2026-10-07 | Product Engineering | 新增 TextIn、Firestore、Cloud Functions 转换及模板配置验收场景；移除离线归档假设 |
| 1.1.0 | 2026-10-06 | Product Engineering | 新增无需复核、二级复核门控、最终复核通过和复核日志验收场景 |
| 1.0.1 | 2026-10-02 | Product Engineering | 将人类可读内容与验收场景翻译为简体中文 |
| 1.0.0 | 2026-09-10 | Product Engineering | V1.0/P0 初始汇总验收标准 |
