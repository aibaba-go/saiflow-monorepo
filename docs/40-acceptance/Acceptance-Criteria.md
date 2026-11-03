---
doc_id: AC-000
title: "SaiFlow — 汇总验收标准（V1.0 / P0）"
type: acceptance
status: active
version: 1.9.7
updated: 2026-11-03
owner: QA
verified_requirements: [FR-UPLOAD, FR-OCR, FR-VERIFY, FR-ENTRY, FR-MGMT, FR-SYS, FR-TEMPLATE]
---

# SaiFlow — 汇总验收标准（V1.0 / P0）

> 验证层。AC 是完成定义，不等于全量 TC 已通过。模板路径以 OCR-018..021、VERIFY-018..020、ENTRY-002 和 TEMPLATE 场景为准；旧分类、confidence/重算/佛历、通用字段删除/数字存储场景不适用于新模板链路。最终契约核对见 [API-Spec §4](../30-design/API-Spec.md#4-尚未对齐的契约差异)，合法历史 Firestore 完整原文归档保留。
>
> **已确认验证（2026-10-31）：** 最终隔离 SQLite/mock 后端 **822 项通过**（93.15 秒），包含 JSON 内容/MIME/.json 下载、显式通用选择审计、增量迁移规划补测；此前 816/819 是历史批次。真实视图/状态/CSS、全合成 API 的浏览器 **32/32 场景通过**，覆盖手机 320/375/430 与宽屏 430 iframe、已有 READY 的 force 失败重试、422 输入聚焦；源码漂移/未知 API/pageerror/未处理服务请求均为 0。另有 35 离线结构断言、14 双语后端错误文案检查、vue-tsc/Vite 构建及新增模板模块/测试 Ruff py310 通过。删除保留 job、同任务锁清理关联与 Worker 阶段中止均有隔离测试。两份获批系统种子正式 CLI validate 通过；共享库仅 transaction_read_only=on 下 SELECT，重复当前版本任务数 0，无 DDL/写入。
>
> **验证边界：** 追溯、复现与证据入口为 [变更任务记录](../../openspec/changes/document-template-mapping/tasks.md)。SQLite/纯迁移规划不等于真实 PostgreSQL 迁移/多实例并发；浏览器为冻结合成 harness 构建，非真实 LINE/iOS/Safari 或供应商端到端，前端合成下载不代表工作簿内容验收（后端另用 openpyxl 检查）。真实 LLM 质量/耗时/token 基线未运行，0.7 未经实测校准；不得用单候选 UI score=1.0 充当模型质量。**2026-10-31 正式发布：** 经用户授权，后端 `saiflow-api-00049-pux`（开关关闭）启动迁移建出模板 4 表/3 列/索引，CLI seed 写入 `system.billing_note`（6 组/22 项）与 `system.tax_invoice`（7 组/34 项）版本 1，前端 `saiflow-line-mini-00043-wuh` 与开关开启的 `saiflow-api-00052-fal` 均已承接 100% 流量；镜像、哈希与核验见 [Architecture §5](../30-design/Architecture.md#5-部署模型)。这只是发布与匿名探针证据，不是真实上传→映射→确认或模型质量验收。

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
    And 三段上传使用同源 XHR，既有 Cookie/CSRF 与原始字节保持不变，每阶段等待上限 120 秒
    Given 上传初始化、内容或完成阶段发生网络错误、中断、超时或状态 0
    Then 结束等待，不自动重发写请求，不执行后续阶段，不显示 100%
    And 状态 0 或异常响应不得造成事件回调未捕获异常而永久等待；保留服务端错误消息与旧会话 401 代次保护

  Scenario: AC-FR-UPLOAD-011-01 保留原件
    Given 已上传的原始文件
    When 预处理生成派生文件
    Then 原始字节在原始存储中保持不变
```

## 2. EPIC-02 — OCR 识别

> 2026-10-29 AC-FR-OCR-017-02 已实现，284 项新增重试隔离回归及 366 项既有后端回归联合通过（650 项）；未调用真实 TextIn/数据库/SMTP，未启动 Worker、未发布。真实供应商扣费与 PostgreSQL 多实例并发未验收，验证范围见 OCR-Pipeline §3.1。

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

  Scenario: AC-FR-OCR-017-02 TextIn 调用失败的有界自动重试
    Given 一个已存在的 OCR job，原件、文件名、页参数与 Prompt 已确定
    When TextIn 调用发生网络/超时、HTTP 408/429/5xx、业务限流 429/458/459/40306、基础服务故障 30203、业务 500..599，或无效响应 JSON/缺失或无效 llm_json（-1）
    Then 仅 services/api/worker.py 执行首次 1 次加额外最多 3 次重试，总调用次数最多 4 次
    And 第 1/2/3 次重试前分别退避 2/4/8 秒，HTTP 客户端及适配器不另加重试
    And 每次沿用同一 job、原件字节、文件名、页参数与 Prompt
    And 自动重试不重新上传、不创建新 job/result、不因失败尝试发通知或额外累计 SaiFlow 月页额度
    Given HTTP 成功但业务 code 失败，或 HTTP 失败但业务 code=200
    Then 均不得视为成功，前者按业务错误分类，后者按 HTTP 错误分类
    And 仅 HTTP 成功（2xx）、业务 code=200 且 llm_json 有效才是调用成功
    Given 任一次遇到余额不足 40003、鉴权/权限/参数等明确永久错误，或本地程序异常
    Then 立即停止自动重试并将同一 job 标记 FAILED，保留该错误，不产生成功结果或完成通知
    Given 任一次调用成功且任务未被取消
    Then 立即停止重试，不再调用 TextIn，仅一次结果持久化/后处理及既有完成通知
    Given 首次及额外 3 次重试均为可重试失败，且任务未被取消
    Then 只将同一 job 标记 FAILED 并保留最后一次错误代码和消息，不产生成功结果或完成通知
    Given 任务在退避期间或下一次重试调用前被请求取消
    When Worker 在每次重试调用 TextIn 前重新读取并检查取消状态
    Then 沿用既有取消处理，不再调用供应商，不产生成功结果/后处理或完成通知
    Given 另一实例已将任务标记为 CANCELLED 或其他终态
    Then 停止本实例的后续调用和结果写入，不覆盖既有终态
    Given Worker 启动恢复发现超过 10 分钟无进展的 PROCESSING/POSTPROCESSING 任务
    Then 保守标记 FAILED/VENDOR_UNCERTAIN，不自动重新入队以重置重试预算
    And 仅尚未开始供应商调用的 PREPROCESSING 阶段允许条件恢复入队；状态推进与结果写入锁行刷新，不覆盖并发取消或终态
    Given 供应商 POST 超时且没有已确认的供应商幂等键
    Then 不承诺供应商未受理或只扣费一次，仅保证本应用自动重试不重复生成结果或额外累计 SaiFlow 月页额度
    And 自动重试不同于用户手动 Retry/rerun，后者仍按 AC-FR-OCR-020-02 创建新任务并关联原任务

  Scenario: AC-FR-OCR-018-01 多候选自动匹配最高合法分
    Given 开关开启且存在本任务可见的启用未删除模板当前版本
    When 多候选DeepSeek排名含合法项、非法ID和越界score
    Then 只接受候选白名单ID，score钳制0到1，保留top-3并选择最高合法分
    And 目录最多50模板按更新时间截取、描述最多120字符，超额记日志，不记录单据内容

  Scenario: AC-FR-OCR-018-02 零与单候选
    Given 开关开启且OCR成功
    When 可用候选为0
    Then 不创建AUTO映射，通用结果可用并提示暂无模板
    When 可用候选为1
    Then 直选该版本，match_score=null、reason=single_candidate，不调用匹配模型

  Scenario: AC-FR-OCR-018-03 低分仍映射与非法排名修复
    Given 至少一项合法排名最高分为0.62且阈值为默认0.7
    When 匹配完成
    Then 仍选择该模板并提示低匹配度，不标记匹配失败
    Given 排名全部非法
    When 一次修复重试后仍无合法项
    Then 映射FAILED/MATCH_FAILED，保留通用结果

  Scenario: AC-FR-OCR-018-04 超大输入不截断
    Given 原始llm_json紧凑JSON超过60000字符
    When 处理映射
    Then FAILED/RAW_TOO_LARGE，不截断发送，不改原始快照或当前通用结果

  Scenario: AC-FR-OCR-019-01 严格模板提取且不推算
    Given 固定模板含字段和表格，原件缺少某字段与合计
    When DeepSeek输出JSON并带模板外键
    Then 仅提取源信息，缺字段/列补null，不推算或计算合计，每行对应源行
    And 结果为分组对象内标量和对象数组，模板外键丢弃并计数，原始快照不变

  Scenario: AC-FR-OCR-019-02 四类型无浮点漂移
    Given type分别为string、integer、decimal、amount
    When 输出含空白、千分位/币种、整数和小数
    Then parse_float=str，string去首尾空白且空串变null
    And integer仅接受绝对值不超过2^53-1的整数，decimal为规范字符串不舍入
    And amount不足2位补齐，超过2位保留并告警amount_precision，日期保持字符串不转佛历

  Scenario: AC-FR-OCR-019-03 类型不匹配与空值
    Given 某数值字段无法转换或integer超安全范围，另一字段为null
    When 标准化
    Then 失败字段保留原文并记录type_mismatch，null不记类型错误
    And 不将警告或required缺失当作OCR失败，仍可核验

  Scenario: AC-FR-OCR-019-04 非法结构有界修复
    Given 输出不是顶层对象、表格不是对象数组或单表超过500行
    When 首次转换校验失败
    Then 仅修复重试一次，仍非法则FAILED/LLM_INVALID_OUTPUT
    And 不发布非法版本、不覆盖当前结果

  Scenario: AC-FR-OCR-020-01 独立Worker与条件认领
    Given 开关开启且有PENDING映射，多实例可能同时取到它
    When MappingWorker每2秒轮询并以id及PENDING状态条件更新认领
    Then 只有更新1行者处理，AUTO先MATCHING再CONVERTING，MANUAL跳过MATCHING
    And 独立线程不占Web请求或阻塞OcrWorker，成功READY，失败FAILED

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

  Scenario: AC-FR-OCR-020-04 READY复用与次数额度
    Given 同模板版本已有READY映射且force不为true
    When 用户请求套用
    Then 同步复用200，不新调用模型或增加映射次数
    Given 已有5个映射含AUTO与FAILED
    When 请求新增或force重做
    Then 返回409 MAPPING_LIMIT_REACHED，不新建映射
    And 映射不消耗SaiFlow月OCR页额度，force不保证结果相同

  Scenario: AC-FR-OCR-020-05 模型调用预算
    Given 匹配或转换发生网络、超时、429、5xx或非法输出
    When 当前阶段调用失败
    Then 该阶段最多首次加1次重试、间隔2秒，连接10秒、读取默认120秒
    And 复用现有DeepSeek，temperature=0，不设response_format，不引入新供应商
    And 耗尽按错误记录FAILED，不把约524秒估算当作端到端实测或硬上限

  Scenario: AC-FR-OCR-020-06 卡住恢复
    Given MATCHING或CONVERTING超过10分钟未更新
    When 启动恢复或每5分钟恢复执行
    Then FAILED/MAPPING_INTERRUPTED并清理仍指向该映射的pending，不覆盖其他pending

  Scenario: AC-FR-OCR-020-07 READY不覆盖编辑或新请求
    Given 映射创建时base版本为v1
    When 生成READY期间用户已保存新版本、切换或请求另一pending映射
    Then 仍生成本映射的分支版本，但不自动设为当前、不覆盖编辑或新pending
    Given pending仍为本映射且base仍当前且任务未确认
    Then READY可自动生效并记录template.applied

  Scenario: AC-FR-OCR-020-08 确认及删除竞态
    Given 映射处理中任务被确认，或删除结果保留job行且在同任务锁事务内清理results/raw/mappings与指针
    When Worker阶段前后重读任务、原始快照、映射及基础结果关联
    Then 已确认可保留生成结果但不自动生效，关联被清理则中止，不生成或迟到写回结果
    And 不以任务行不存在为唯一删除判据，不恢复已清理的raw/mapping或指针

  Scenario: AC-FR-OCR-020-09 处理中复用、显式重试与失败记录
    Given 同模板版本有处理中映射
    When 再次请求套用
    Then pending指向它并返回202，不重复创建
    Given 映射失败且同模板版本可能保留旧READY
    When 用户点击重试映射
    Then apply-template显式传force=true，不复用旧READY，按处理中复用或新建规则返回202并受次数上限约束
    And 保留FAILED摘要和错误，当前结果不变，仍提供其他模板/通用
    And 审计template.mapping_failed，日志仅调用/用量/模型/提示版本/耗时，不含单据内容

  Scenario: AC-FR-OCR-021-01 原始快照同事务不可变
    Given TextIn成功返回llm_json
    When OcrWorker在整理或映射前深拷贝并最终持久化
    Then 每job一份ocr_raw_results与通用v1同事务保存，id即raw_result_id
    And 后续整理、映射、编辑均不改快照，无修改API，失败尝试不生成成功快照

  Scenario: AC-FR-OCR-021-02 关闭开关仍保存快照
    Given TEMPLATE_MAPPING_ENABLED缺省或false
    When OCR成功
    Then 保存快照并返回非空raw_result_id，保留既有可选DeepSeek整理，不建AUTO、不启动MappingWorker
    When 对自己的有效任务请求apply-template
    Then 返回409 TEMPLATE_MAPPING_DISABLED
    And 不可访问任务先返回404，不泄漏任务存在性

  Scenario: AC-FR-OCR-021-03 开启跳整理与回滚历史可用
    Given 开关开启
    When OCR成功
    Then 通用v1直接使用TextIn结构，跳过整理但匹配/转换仍复用DeepSeek
    When 此后关闭开关
    Then 已有映射仍可读取、编辑、导出，通用切换无需开启开关

  Scenario: AC-FR-OCR-021-04 无历史回填与本地关闭
    Given 历史任务没有raw快照且本地与生产共享数据库
    When 读取历史任务或启动本地配置
    Then 仅无快照历史任务的raw_result_id为空，只能通用结果且不回填；本地保持开关关闭，不启动MappingWorker
    And 共享库seed、迁移、开启开关及部署必须另行授权
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

  Scenario: AC-FR-VERIFY-015-06 Continue 保留未点击新增按钮的字段
    Given 核验结果尚未确认，用户在 document_information 新增表单输入 "kkk" 与 "123"，未点击小 "+"
    When 用户显式点击 Continue
    Then 客户端先校验所有有输入的新增表单，再将字段按原分区路径加入草稿，按现有数字类型推断保存
    And 已注册且订阅 ACTIVE 时，确认请求包含该字段，最终只读结果及重新读取当前版本仍包含该字段
    And 游客/未完成注册或订阅失效时，原有分流前的 confirm: false 草稿保存同样包含该字段，不自动确认
    Given 一个或多个新增表单中有输入，但某个名称为空或与该分区现有字段重名
    When 用户点击 Continue
    Then 保留所有输入并定位本地化错误，不部分提交、不发起保存/确认请求、不导航
    And 修正名称后可再次 Continue，全部有效新增字段一起保留；已有字段与数组不变
    Given 用户只打开未填写的新增表单，或已取消新增输入
    Then 不因该表单额外保存草稿或创建结果版本
    Given 只有新增表单中存在未保存输入
    Then Reset 可用，取消重置保留输入，确认重置清空输入并恢复当前版本
    And 320/375/430 像素视口下新增与取消按钮均在卡片内完整可见

  Scenario: AC-FR-VERIFY-016-01 已注册且订阅 ACTIVE 的用户显式确认
    Given 用户已登录并完成注册，任务所属租户订阅为 ACTIVE（默认 Kinder 或已批档位均可），且必填字段有效
    When 用户在 LINE Mini App 结果页显式点击 "Continue"
    Then 客户端检查认证、注册与该租户订阅状态，再提交 confirm:true，独立 pending 不拦确认
    And 服务端强制已注册，注册门禁的无写入副作用见 AC-FR-SYS-011-02
    And 确认成功后才锁定、记录 completed_at，任务为 COMPLETED 并进入最终结果页

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
    Given 用户为游客、未注册者，或任务所属租户订阅为 NONE（企业未认证）/EXPIRED，且任务为 VERIFYING
    When 用户在结果页点击 "Continue"
    Then 游客/未注册者到 auth，订阅 NONE/EXPIRED 仅在已注册用户显式 Continue 时到 plans/plan-pending
    And 不提交确认，任务仍为 "数据验证中"，completed_at 为空
    When 用户随后完成登录/注册、游客数据归集或套餐续期
    Then 未完成任务仅回 result，不自动变为 "最终完成"
    Given 已注册且任务所属租户订阅 ACTIVE 的用户显式 Continue 并确认成功
    Then 该任务显示 "最终完成"，pending 不拦已有权益
    Given 历史 "数据已验证" 任务 completed_at 为空，用户未注册或任务所属租户订阅为 NONE/EXPIRED
    When 用户点击 "Continue"
    Then 未注册到 auth，NONE/EXPIRED 到 plans/plan-pending，不确认且保留 VERIFIED
    Given 该历史任务由已注册且任务所属租户订阅 ACTIVE（含默认 Kinder）的用户显式点击 "继续"
    Then 成功后记录 completed_at 并显示 "最终完成"，不批量转换其他历史任务

  Scenario: AC-FR-VERIFY-017-02 按阶段筛选
    Given 用户位于历史页
    When 用户选择某一阶段筛选
    Then 仅显示该阶段的任务
    And 筛选项始终包含 "数据已验证"

  Scenario: AC-FR-VERIFY-017-03 历史分页加载
    Given 用户当前租户下有 45 条任务
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
    When 用户点击 "OCR 处理中" 或 "模板匹配中" 的任务
    Then 进入处理进度页
    When 用户点击其余阶段的任务
    Then 进入结果页

  Scenario: AC-FR-VERIFY-017-05 处理进度三步流程与模板匹配阶段
    Given 用户提交识别任务，且任务所属租户存在可用模板
    When OCR 任务处于排队/预处理/识别/后处理中
    Then 处理进度页显示 "上传"（完成）→ "OCR 处理"（进行中）→ "模板匹配"（未开始）三步
    And 任务阶段为 "OCR 处理中"
    When OCR 成功且自动模板映射仍在进行（pending_mapping_id 非空）
    Then "OCR 处理" 显示完成，"模板匹配" 显示进行中，并提示正在匹配模板
    And 任务阶段为 "模板匹配中"，历史页按 "模板匹配中" 筛选可查到该任务，按 "数据验证中" 查不到
    When 映射完成或失败（pending_mapping_id 清空），或等待超过 90 秒
    Then 三步均显示完成并进入结果页，任务阶段回到 "数据验证中"
    When OCR 任务 FAILED 或 CANCELLED
    Then "OCR 处理" 显示失败，"模板匹配" 不开始，任务阶段为 "OCR 处理失败"

  Scenario: AC-FR-VERIFY-018-01 选择与预览
    Given 可见启用模板、历史映射和raw_result_id
    When 打开结果页选择框
    Then 显示当前模板或不套用模板（通用结果），推荐/得分/已生成标记及字段分组预览
    And 系统模板对有效会话可读，租户模板只向该租户成员提供，历史版本可读

  Scenario: AC-FR-VERIFY-018-02 无模型切换恢复分支编辑及通用选择审计
    Given READY映射和通用分支各有最近保存的编辑
    When 以正确expected_version切回任一分支
    Then 200，只移动当前标记/指针并清pending，不复制数据、调用模型或新增结果版本，恢复该分支最新保存值并可返回旧号
    And 模板实际切换记录template.switched，每次显式use-generic记录template.generic_selected
    Given 当前已为通用结果且expected_version正确
    When 用户再次显式use-generic，包括失败映射后选择通用
    Then 仍返回当前通用版本、不新增结果版本，但记录template.generic_selected

  Scenario: AC-FR-VERIFY-018-03 未保存修改先保存与等待
    Given 选择其他模板前存在未保存编辑
    When 选择保存并切换或取消
    Then 保存并切换先成功保存草稿再提交，取消则保留编辑且不切换
    Given pending映射存在
    Then 禁止编辑且每2秒轮询最多10分钟，处理页额外等待最多90秒后进入结果页继续轮询

  Scenario: AC-FR-VERIFY-018-04 锁与全任务版本序列
    Given 任务历史最高版本为8，切回旧分支当前版本为3
    When PATCH或READY创建版本，与另一切换请求并发
    Then 在任务行锁下串行，新版本为max(version)+1而非当前+1，PATCH继承当前mapping
    And expected_version过期返回409 VERSION_CONFLICT，无错误分支写入

  Scenario: AC-FR-VERIFY-018-05 确认与归属拒绝
    Given 任务已确认、raw_result_id属于其他任务或模板不可见/已停用/已删除
    When 请求新套用、切换或通用
    Then 已确认返回409 results.already_confirmed；外任务raw返回404；新不可用模板409 TEMPLATE_UNAVAILABLE
    And 原认证、注册、租户与CSRF规则保持，历史READY可追溯不被模板状态改写

  Scenario: AC-FR-VERIFY-018-06 异步套用与反馈
    Given 可用模板无READY或处理中映射且未达上限
    When 用户请求套用
    Then 返回202并创建MANUAL/pending，mapping_id切换只接受READY否则409 MAPPING_NOT_READY
    When 用户最终确认模板结果
    Then 记录一次template.match_feedback关联自动推荐版本与最终版本，不记录内容

  Scenario: AC-FR-VERIFY-019-01 按schema渲染与金额类型
    Given 当前mapping固定历史版本含有序分组/字段/表格列
    When 打开核验页
    Then 按schema顺序和显示名渲染，必填标识/缺失高亮，数值键盘适配类型
    And 金额按type加千分位且至少2位，超过2位不舍入，不按key名称猜测模板金额

  Scenario: AC-FR-VERIFY-019-02 模板补齐保留人工扩展
    Given 草稿缺模板字段/列，并新增模板外字段、分组、列和行
    When 保存草稿
    Then 模板缺项补null而用户extras保留，模板字段仅可清空不可删除，extras仍可增删
    And 表格行可添加/删除，历史版本和原始快照不变

  Scenario: AC-FR-VERIFY-019-03 通用兼容与最终展示
    Given 当前为通用或已确认模板结果
    When 读取results并打开结果/最终/历史页
    Then 通用current_mapping/template_schema为null且沿用旧渲染，模板结果返回schema与validation
    And 最终页只读并显示模板名，历史摘要显示template_name，缺新字段可走原路径

  Scenario: AC-FR-VERIFY-020-01 缺必填确认422无副作用
    Given 已通过既有认证/注册的用户提交confirm:true且模板required字段或已有行required列为空
    When 客户端检查或后端处理提交内容
    Then 前端高亮并定位首个缺项，后端422 INVALID_ARGUMENT/results.required_missing
    And field_errors为structured.<path>及reason=required，不新增版本、不切当前、不写确认/完成状态

  Scenario: AC-FR-VERIFY-020-02 草稿通用与空表豁免
    Given required为空且confirm:false，或当前为通用结果，或required列所在表无行
    When 保存或按既有规则确认
    Then 草稿与通用不受本模板门禁，空表不虚造行或因不存在行的required列阻止确认
    And 缺数据仍可保存并提示，不作为OCR失败，既有认证/注册/租户边界不变

  Scenario: AC-FR-VERIFY-020-03 类型警告不阻止确认
    Given required均非空但存在type_mismatch或amount_precision
    When 显式确认并通过既有确认规则
    Then 警告可见但不因类型警告拦截，成功后只读并保留保存内容
```

## 4. EPIC-04 — 录入与归档

```gherkin
Feature: FR-ENTRY 导出与归档

  Scenario: AC-FR-ENTRY-001-01 模板生成
    Given doc_type = DELIVERY_NOTE
    When 请求导出
    Then 使用适用于 Delivery Note 的标准化 .xlsx 模板

  Scenario: AC-FR-ENTRY-002-01 一键填充与通用兼容
    Given 一份已核验通用结果
    When 文员点击Export to Excel
    Then 沿用既有XLSX导出并包含当前已保存内容

  Scenario: AC-FR-ENTRY-002-02 模板顺序名称与金额精度
    Given 已确认模板结果含人工编辑与extras，模板之后已升版
    When 导出XLSX或CSV
    Then 按mapping固定历史版本的分组/字段/列顺序和显示名输出，extras追加且保留已保存编辑
    And 金额按type加千分位且至少2位，超过2位不舍入，XLSX沿用单Result工作表与既有防公式注入规则
    And 不新增导入标记或Excel往返承诺

  Scenario: AC-FR-ENTRY-002-03 正式JSON原样导出与TXT兼容
    Given 指定已保存结果版本为通用或模板结果，含人工extras、前导零字符串及多位小数
    When 以format=JSON创建导出并下载
    Then 下载MIME为application/json、文件扩展名为.json，内容原样为指定版本structured
    And 保留键顺序、JSON类型、数值精度及extras，不加信封、不替换显示名或格式化金额
    When 以format=TXT导出同一结果
    Then 沿用旧TXT行为，不改为JSON格式别名，既有通用XLSX/CSV导出亦不变

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

  Scenario: AC-FR-ENTRY-015-02 Android LINE 内置浏览器导出
    Given 用户在 Android 手机的 LINE 内打开已确认文档的最终结果页
    When 点击 "Export Excel"
    Then 前端换取 60 秒限时下载票据并在系统浏览器打开，XLSX 以附件下载，页面提示文件保存位置
    And 票据无需会话 Cookie，但签名被改、超过 60 秒、会话已注销、账号停用或无任务访问权时一律返回 404
    And 连续点击复用同一导出记录；iOS 与桌面仍用会话 Cookie 下载且行为不变
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

> 以下“开发环境”仅指 FR-SYS-001 明确启用的本地开发。2026-10-27 启动/认证、退出防复登、仅结果 Continue 触发 auth/注册、续接取消与服务端注册门禁已真实实现并正式发布。本轮 334 项隔离后端回归、最终生产构建 `index-BUTDgRGj.js` 的 21 项全 mock 浏览器场景、6 项 OAuth 源码模块模拟与 9 项前端会话边界测试均通过，类型检查、Vite 构建及 OpenAPI 内部引用校验通过。正式发布、生产只读核验及单次日志审查（非长期保证）引用 [Architecture §5](../30-design/Architecture.md#5-部署模型) / [§6](../30-design/Architecture.md#6-安全性与可靠性) 本轮记录。
>
> 2026-10-28 的租户归属（`tenants`/`enterprises.tenant_id`）、`subscriptions` 默认一个月 Kinder 与到期硬停、`plan_reminders` 到期提醒、通知中心标记已读与手机号可改，是对后端已实现代码的契约同步：本次文档更新**未运行任何测试**，上一段 334/21/6/9 的通过记录属于 2026-10-27 的历史证据，不覆盖本轮新增行为。原“默认 Kinder 由 `registered_at` 动态推导、无新增 schema”的说明已作废——权益改由 `subscriptions` 持久化行表达，并新增 `tenants`/`subscriptions`/`plan_reminders` 三张表、删除 `quota_ledger`。
>
> 隔离测试从未连接数据库、真实 LINE 或 SMTP，也未创建生产账户记录；本轮未发送真实测试邮件，SMTP 模块与 Secret Manager 版本引用未改变，Cloud SQL `postgres.saiflow` 不变。历史 221 项隔离后端、5 项模拟浏览器及本地/Cloud Run SMTP 自测接收证据仍保留，明确不是本轮证据。认证环境、email、TLS SMTP、资料锁后重读与换邮箱规则不变；手机号只读的旧约束已作废（见 AC-FR-SYS-015-02）。不宣称真实 LINE OAuth/完整注册、收件箱、真实数据库并发、验证码防猜码或到期提醒邮件实际投递已验证。下列代表性/汇总 AC 与 EPIC-06 同步，隔离通过与发布不等于真实用户全流程已验收。

```gherkin
Feature: FR-SYS 身份与配置

  Scenario: AC-FR-SYS-001-01 登录成功
    Given 已注册且具有有效凭据的用户
    When 用户登录
    Then 系统 SHALL 创建会话并授予该用户的角色权限

  Scenario: AC-FR-SYS-001-02 登录失败
    Given 无效凭据
    When 用户登录
    Then 拒绝访问并记录该次尝试

  Scenario: AC-FR-SYS-001-03 退出确认、超时与刷新防复登
    Given 已登录用户在个人中心
    When 用户点击 "Sign out" 后取消确认
    Then 用户保持登录，不写 logout-pending、不撤销会话
    When 用户再次点击 "Sign out" 并确认
    Then 先在 localStorage 写非凭据 logout-pending，再以 10 秒超时的请求撤销旧应用 Cookie/会话
    And 清身份、当前租户、CSRF 与待续意图，最佳努力清 LIFF SDK 状态
    When 撤销成功
    Then 清标记、建立游客会话并返回游客 scan 首页，不停留在旧 My 页，不因残留 LIFF token 静默复登
    Given 撤销失败或达到 10 秒超时，浏览器可能仍有正式 Cookie
    Then 保留标记、锁定主壳并提示重试，不复用正式 Cookie 或旧身份
    When 用户点击 "Back" 重试或刷新页面
    Then 先 session CSRF-only 仅取得撤销所需 CSRF，不恢复旧身份，再 logout 撤销旧会话，成功后才 guest 建立游客会话
    And 成功后清标记并返回游客 scan 首页，不停留在旧 My 页；成功前主壳保持锁定，全程不自动 LINE 兑换

  Scenario: AC-FR-SYS-001-04 生产无开发入口且 LINE 按钮仅走真实认证
    Given 前端为生产构建（import.meta.env.DEV=false），包括 VITE_AUTO_DEV_LOGIN=true 的误配置
    When 用户打开登录或注册页
    Then 不显示 Developer sign-in 或其他开发身份入口
    Given 任一环境，包括已明确启用开发入口的本地环境
    When 用户点击 "Login/Register with LINE"
    Then 仅进入真实 LINE OAuth/LIFF 流程，不发送 dev_id、不生成模拟 LINE 身份

  Scenario: AC-FR-SYS-001-05 生产拒绝 dev 请求与旧会话且不回退
    Given 后端为生产环境，包括 APP_ENV/AUTH_DEV_MODE 均未配置的默认情况
    When 向认证接口提交 dev_id，分别不带 id_token 和同时携带有效 LINE id_token
    Then 在任何数据库访问前返回 400 INVALID_ARGUMENT，消息键 auth.id_token_required
    And 不创建用户、会话、配额或业务数据，不触发游客数据归集
    Given 生产环境中保留了旧 dev: 身份及其未过期、未撤销的会话
    When 使用该旧会话访问鉴权 API
    Then 会话视为无效，拒绝访问，历史用户及业务数据保留，不批量清理或迁移
    Given 用户通过真实 LINE 流程取得 id_token
    When 服务端处理 LINE 认证
    Then 服务端验证 issuer（iss）、audience（aud，匹配配置的 LINE Channel ID）和 expiry（exp）
    And 验证失败、LINE 不可用或配置缺失时拒绝认证，不回退至 dev 登录
    And 认证失败不创建用户、会话、配额或业务数据，不触发游客数据归集

  Scenario: AC-FR-SYS-001-06 本地显式启用可开发登录且生产开关不能绕过
    Given 本地前端 import.meta.env.DEV=true 且 VITE_AUTO_DEV_LOGIN=true
    And 本地后端 APP_ENV=development 且显式 AUTH_DEV_MODE=true，未检测到 K_SERVICE
    When 用户通过独立 Developer sign-in 提交 dev_id
    Then 允许开发身份登录，注册框仍仅在 auth 且 needsRegistration 时显示，不在主壳强制注册
    And 本地旧 dev: 身份及未过期、未撤销的旧会话仍可使用
    Given 本地前端 VITE_AUTO_DEV_LOGIN 未配置或不为 true
    When 用户打开登录或注册页
    Then 不显示开发身份入口，LINE 按钮仍仅走真实 OAuth/LIFF
    Given 后端仅设置 AUTH_DEV_MODE=true，但 APP_ENV 未配置、为 production 或其他非 development 值
    When 向认证接口提交 dev_id（包括同时携带有效 LINE id_token）
    Then 在任何数据库访问前返回 400 INVALID_ARGUMENT，消息键 auth.id_token_required，不创建用户、会话、配额或业务数据
    Given APP_ENV=development 但 AUTH_DEV_MODE 未配置或为 false，或两个开发开关均开启但检测到 Cloud Run K_SERVICE
    When 向认证接口提交 dev_id（包括同时携带有效 LINE id_token）
    Then 同样在任何数据库访问前拒绝认证（400 INVALID_ARGUMENT，auth.id_token_required），不创建用户、会话、配额或业务数据

  Scenario: AC-FR-SYS-001-07 LIFF 初始化有界恢复与取消
    Given 生产 LIFF 初始化失败、SDK 会话读取失败或等待达到 20 秒
    Then 不自动跳转，不兑换身份，不修改扫描结果，不暴露原始异常或凭据
    When 用户显式点击 LINE 登录按钮且同一 sessionStorage 上下文尚未重开
    Then 仅重开无查询参数的官方 LIFF 入口一次，重开前保留非凭据登录意图和待续任务
    Given 同一上下文重开后仍失败，或存储不可用，或 LIFF 未配置
    Then 停止跳转并提示重试或从 LINE 重新打开，不回退开发身份
    Given 用户点击登录后在 SDK 完成前返回或登录页卸载
    When SDK 迟到成功、失败或超时
    Then 不兑换身份，不跳 OAuth 或官方恢复入口，不自动导航或确认任务
    And SDK 超时后的迟到成功不能复活初始化缓存
    Given 初始化成功且用户没有取消，并取得 SDK token 或可在已登记 Endpoint 下继续外部 OAuth
    Then 清重开标记，沿用 SDK token 验真或原有 OAuth，不自动确认任务
    Given LINE 内初始化成功但没有 token，或外部浏览器当前域名/路径不在已登记 Endpoint 下
    Then 仅显式点击才恢复无查询参数的官方 LIFF 入口一次，不调用外部 OAuth，不清重开标记导致循环
    Given 外部浏览器位于已登记 Endpoint 下且没有 token
    When 用户显式点击 LINE 登录
    Then 使用 liff.login() 的默认 Endpoint，不把当前 URL 的 code/token/其他查询参数带入 redirectUri
    And 不在不同 Cloud Run 域名上创建跨源 PKCE，不承诺跨源迁移旧 Cookie/游客草稿/sessionStorage
    And 真实手机重开时的 WebView 与存储连续性须另行验证，桌面模拟不算通过证据

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
    When 用户将语言切换为英语
    Then 所有 UI 标签更新为英语，且无需重启应用

  Scenario: AC-FR-SYS-009-01 配置复核权限
    Given 管理员正在编辑角色 "reviewer"
    When 管理员授予 review 权限并保存
    Then 该角色用户可执行待复核数据的复核决定

  Scenario: AC-FR-SYS-010-01 Cookie 或游客启动，不隐式 LINE 登录或强制注册
    Given 浏览器存在残留 LIFF token，但没有显式 LINE 登录意图或对应 OAuth 回跳
    When 启动应用
    Then 仅恢复有效应用 Cookie 或创建游客会话进入主壳，不自动兑换残留 token
    And 已认证未注册者也可进入主壳，首页、上传与开始 OCR 不弹登录/注册框
    When 游客上传、识别并编辑核验草稿
    Then 仅能访问自己的任务与结果，不获得管理、报表或配置权限
    Given 用户显式点击 LINE 按钮或返回该次 OAuth 授权
    Then 才可兑换真实 token，不以 SDK 登录态冒充应用登录
    Given 运行中试用界面返回 401
    Then 清理失效应用身份并恢复游客首页，不自动 LINE
    Given auth 窗口中的请求返回 401
    Then 保留可重试认证入口，不自动 LINE

  Scenario: AC-FR-SYS-010-02 游客数据归集
    Given 游客已完成上传与识别
    When 游客登录或注册为正式用户
    Then 其文档、任务、结果版本与导出记录按 tenant_id 归集至该正式用户的个人租户
    And 游客账户、会话、游客租户上的订阅行与到期提醒记录被删除，游客提交过的申请改指向正式用户的个人租户

  Scenario: AC-FR-SYS-011-01 仅结果 Continue 触发 auth，续接取消与异常
    Given 用户为游客或已认证未注册，任务尚未最终完成
    When 用户在结果核验页点击 "Continue"
    Then 仅 dirty 时先 PATCH confirm:false 保存，无变更不保存，随后进入 auth，不跳 plans、不提交 confirm:true
    And 仅 route=auth 且 needsRegistration 显示注册框，已认证未注册者直接弹注册
    And pendingAuth 与 pendingJob 分开，sessionStorage 只存非凭据上下文，不存 token、Cookie 或 CSRF
    When 认证成功但仍需注册
    Then 保留 pendingJob 供注册，不提前清任务上下文
    When 完成注册且导航成功
    Then 重新读取任务，未完成仅回 result、原已 COMPLETED 可 final，之后才清 pendingJob，不自动 confirm 或跳订阅页
    Given 保存、认证、注册或恢复发生异常
    Then 保留可重试上下文，保存失败不重定向，不误跳 plans
    Given 登录/注册已打开且游客任务可能已归集
    When 用户取消登录或注册
    Then 清显式 pendingAuth 与 pendingJob 续接标记，回原 result，保留已归集任务权限和 LINE/应用会话
    And pendingJob 仅供手动续接，不自动恢复或确认

  Scenario: AC-FR-SYS-011-02 服务端确认注册门禁无写入副作用
    Given 请求者分别为 guest 和已认证但 registered_at 为空的用户，具有自己的试用任务
    When 直接提交 confirm:true，包括携带结构化改动或针对 legacy VERIFIED
    Then guest 返回 401，未注册返回 403 PERMISSION_DENIED / registration.required
    And 在写结果版本、切换 is_current 或写完成状态前拒绝，版本与 completed_at 不变
    When 提交有效 confirm:false 草稿
    Then 仍可按原任务权限保存，不要求注册、不锁定或完成任务

  Scenario: AC-FR-SYS-012-01 个人与游客租户默认开通一个月 Kinder
    Given 用户首次 LINE 登录或匿名访客首次进入应用
    When 服务端建立其个人租户
    Then 订阅为 ACTIVE / KINDER / source=DEFAULT / application_id=null，starts_at 等于 tenants.created_at
    And expires_at 为 starts_at 往后一个自然月，days_remaining 按泰国时区日历日计算
    When 同一用户重复登录
    Then 订阅行不被重置或重复创建（tenant_id 唯一），starts_at 与 expires_at 保持不变
    And 已注册用户在结果页显式 Continue 并通过核验时允许 confirm:true，成功才锁定、记录 completed_at 并进 final

  Scenario: AC-FR-SYS-012-02 企业自认证时起算，未认证为 NONE
    Given 某企业提交认证但尚未通过，用户是其成员
    When 读取该企业租户的订阅
    Then status=NONE，plan_code / starts_at / expires_at / days_remaining 均为 null
    When 该企业租户下新建识别任务
    Then 返回 402 PAYMENT_REQUIRED / PLAN_EXPIRED / plan.expired
    When 运营将企业状态改为 VERIFIED，服务端首次读到该状态
    Then 补填 enterprises.verified_at，并自该时刻起开通一个月 KINDER（source=DEFAULT）
    And 该企业全体 ACTIVE 成员共享同一订阅与月页额度
    When 用户在结果页对无订阅的企业任务显式 Continue
    Then 不提交 confirm:true，进入 plans（默认选择 Kinder）或已有处理中申请时进入 plan-pending，仅 dirty 时先 confirm:false 保存

  Scenario: AC-FR-SYS-012-03 到期硬停但历史可读
    Given 某租户订阅的 expires_at 已过
    When 读取订阅
    Then status=EXPIRED，days_remaining 为负数
    When 在该租户下新建或重跑识别任务
    Then 返回 402 PLAN_EXPIRED / plan.expired，不创建任务
    When 查看历史任务列表、任务详情、结果版本或已有导出
    Then 均正常返回，不受到期影响
    Given 恢复任务为 VERIFYING 或 legacy VERIFIED 且租户订阅为 ACTIVE
    Then 返回 result 等待用户显式确认，不自动确认或批量转换 legacy VERIFIED；原已 COMPLETED 可直接 final

  Scenario: AC-FR-SYS-012-04 线下批准续期、顺延与一次性生效
    Given 某租户订阅为 ACTIVE 且 expires_at 在未来，已提交 PLAN_UPGRADE 申请
    When 运营批准该申请但未填 valid_from，仅填 period_months 或 valid_to
    Then 下次读取订阅时惰性同步为 source=APPROVED、application_id 为该申请
    And 新周期自当前 expires_at 起算（未到期顺延，不截断当前周期）
    When 再次读取订阅
    Then 同一申请不再重复延期（application_id 相同即跳过）
    Given 某租户订阅已 EXPIRED
    When 运营批准其申请
    Then 新周期自批准时的当前时间起算

  Scenario: AC-FR-SYS-012-05 月末夹取与申请档位约束
    Given 某租户的 starts_at 为 2026-01-31
    When 计算一个月后的 expires_at
    Then 结果为 2026-02-28（按目标月实际天数夹取），不溢出到 3 月
    Given 某租户订阅为 ACTIVE 且当前档位为 Starter
    When 提交目标档位为 Kinder 的申请
    Then 返回 409 STATE_CONFLICT / plan.not_upgrade
    When 提交目标档位为 Starter（同档续费）或更高档的申请
    Then 允许提交
    Given 某租户订阅为 EXPIRED 或 NONE
    When 提交任意档位的申请
    Then 允许提交
    Given 该租户已有处理中（SUBMITTED/UNDER_REVIEW/NEEDS_INFO）申请
    When 再次提交申请
    Then 返回 409 STATE_CONFLICT / plan.application_pending
    Given 请求者为企业租户的 MEMBER
    Then 服务端拒绝提交（403 PERMISSION_DENIED / plan.enterprise_owner_only）
    Given 请求者为游客会话
    Then 返回 401

  Scenario: AC-FR-SYS-013-01 已批套餐的展示与月页校验
    Given 用户的 Starter 升级申请已被后台批准且订阅为 ACTIVE
    When 用户打开该租户的首页或套餐页
    Then 当前套餐为 Starter，source=APPROVED、is_paid=true、metering=OCR_PAGE
    And 本月无用量时显示 "5,000 / 5,000 pages left this month"，不显示 free 或 Sign-in bonus
    And 页数按泰国自然月实时统计该租户 ocr_jobs.page_count，FAILED 与 CANCELLED 的任务不计
    And 剩余月页额为 0 时创建 OCR 返回 402 QUOTA_EXCEEDED / quota.exceeded

  Scenario: AC-FR-SYS-013-02 申请更高档套餐
    Given 用户当前套餐为 Starter、订阅 ACTIVE 且没有处理中的申请
    When 用户在套餐页点击 Intermediate 的 "Upgrade"
    Then 系统弹出确认框显示目标套餐 Intermediate；点击取消则不创建申请
    When 用户在确认框中点击确认
    Then 系统创建 PLAN_UPGRADE 申请（target_tenant_id 为当前租户）并提示“您的申请已经收到，我们会尽快联系您”，确认后返回首页
    And 再次打开套餐页时页面顶部显示醒目的处理中卡片（含目标套餐与提交时间），Intermediate 卡片带 "IN REVIEW" 角标并显示 "Upgrade in progress"，其他升级按钮不可用
    And 申请 Kinder 被拒绝（plan.not_upgrade），申请 Starter（同档续费）被允许

  Scenario: AC-FR-SYS-013-03 游客不显示套餐横幅
    Given 未登录的游客
    When 打开首页
    Then 不显示套餐与免费额度横幅

  Scenario: AC-FR-SYS-013-04 只有 OCR_PAGE 一种计量，没有 FREE 与赠送
    Given 任意租户（个人、游客或已认证企业）订阅为 ACTIVE 且本月无用量
    When 打开首页或套餐页
    Then plan.metering 恒为 OCR_PAGE，plan.code 不会是 FREE
    And 默认 Kinder 显示 "Kinder · 1,000 / 1,000 pages left this month"，不显示 Free 或 Sign-in bonus
    And 响应中不包含 free_tasks、paid_pages、free_unit 或 paid_unit 字段
    When 成功识别 2 页
    Then 本月剩余页数减少 2，不存在任何赠送次数或额度流水可供回退
    When 取消一个任务
    Then 该任务不计入本月消耗，且没有额度返还步骤
    When 进入下一个 Asia/Bangkok 自然月且没有当月用量
    Then 月可用额恢复为该档位的每月页数（Kinder 1,000 / Starter 5,000 / Intermediate 10,000 / Advance 100,000）
    Given 租户订阅为 EXPIRED 或 NONE
    Then 剩余页数按 0 展示，新建任务按 plan.expired 拒绝（先于 quota.exceeded 判定）

  Scenario: AC-FR-SYS-018-01 到期提醒按节点幂等且不回补
    Given 某已注册用户的个人租户订阅将在 7 天后到期，当天尚未发送提醒
    When OCR worker 进程执行当日的到期提醒扫描
    Then 写入一条 (tenant_id, period_end, stage=D7) 的 plan_reminders 记录
    And 生成一条 PLAN_EXPIRING 站内通知，并在该用户有邮箱且已完成注册时尝试发送邮件
    When 同一泰国日历日再次扫描
    Then 因 (tenant_id, period_end, stage) 唯一约束不重复发送
    Given 当日距到期为 5 天（非 D7/D3/D1/D0 节点）且此前未发送过 D7
    When 执行扫描
    Then 不发送任何提醒，也不回补已错过的 D7
    Given 到期当天与到期之后
    Then 分别发送 stage=D0 的 PLAN_EXPIRING 与 stage=EXPIRED 的 PLAN_EXPIRED，各只发一次
    Given 该租户随后被批准续期，expires_at 改变
    When 新周期再次临近到期
    Then 因 period_end 不同，按节点重新提醒
    Given 租户为游客个人租户
    Then 不产生任何提醒记录、通知或邮件
    Given 邮件发送失败
    Then 站内通知仍已生成，仅 plan_reminders.email_sent 保持 false

  Scenario: AC-FR-SYS-018-02 企业租户的提醒收件人
    Given 某企业租户订阅临近到期，企业有一名 ACTIVE 的 OWNER 与多名 ACTIVE 成员
    When 执行到期提醒扫描
    Then 通知与邮件发给该 ACTIVE OWNER
    Given 该企业没有 ACTIVE 的 OWNER
    Then 回退给最早的 ACTIVE 成员

  Scenario: AC-FR-SYS-018-03 通知中心未读数与标记已读
    Given 已登录用户有若干未读通知
    When 调用 GET /api/v1/me/notifications
    Then 返回 unread_count 与 items 列表
    When 以 {"ids": [<其中一条通知 id>]} 调用 POST /api/v1/me/notifications/read
    Then 仅该通知被标记已读，返回 {"updated": 1, "unread_count": <剩余未读数>}
    When 以同样的 ids 重复调用
    Then 幂等返回 updated=0，未读数不变
    When 以空数组或省略 ids 调用
    Then 该用户的全部未读通知被标记已读，unread_count 变为 0
    Given 请求体的 ids 不是数组，或数组中含非整数（含布尔值）元素
    Then 返回 400 INVALID_ARGUMENT，field_errors 指向 ids，不修改任何通知
    Given ids 中包含其他用户的通知 id
    Then 这些 id 被忽略，只影响本人的未读通知

  Scenario: AC-FR-SYS-018-04 通知中心只显示账户变动类通知
    Given 用户名下同时有账户变动类通知（如 PLAN_EXPIRING、MEMBERSHIP_ACTIVE）与历史 OCR_DONE / INFO 通知
    When 调用 GET /api/v1/me/notifications
    Then items 只包含账户变动类通知，unread_count 只统计其中的未读行
    When 以空数组调用 POST /api/v1/me/notifications/read
    Then 只标记账户变动类通知，OCR_DONE / INFO 行不被修改
    When OCR 任务成功或失败结束
    Then 不产生任何站内通知

  Scenario: AC-FR-SYS-018-05 账户与公司首次开通通知
    Given 已注册用户的个人租户首次开通默认 Kinder
    Then 该用户收到一条 ACCOUNT_ACTIVATED 通知，按其语言（th/en）显示套餐名与泰国时区到期日
    Given 企业租户首次被看到为 VERIFIED 并开通订阅
    Then 该企业的 ACTIVE OWNER 收到一条 COMPANY_ACTIVATED 通知，正文含公司法定名称
    When 再次读取订阅状态
    Then 不重复发送
    Given 游客租户开通、企业未认证，或租户已有订阅行
    Then 不产生开通通知

  Scenario: AC-FR-SYS-019-01 默认开通套餐与试用时长可配置
    Given 套餐配置将 STARTER 设为默认套餐、trial_months 为 2
    When 新个人租户首次开通订阅
    Then 订阅为 STARTER、source=DEFAULT，有效期为开通时刻起 2 个月
    And 已有订阅行的租户起止日期不变

  Scenario: AC-FR-SYS-019-02 修改月页数对存量订阅立即生效
    Given 租户已订阅 KINDER（每月 1,000 页）
    When 运维用 manage_plans.py 将 KINDER 每月页数改为 2,000 且缓存窗口已过
    Then GET /api/v1/me/quota 的 monthly_total 为 2,000，新建识别任务按 2,000 页校验

  Scenario: AC-FR-SYS-019-03 停用套餐
    Given INTERMEDIATE 被设为 DISABLED
    Then GET /api/v1/plans 不再返回 INTERMEDIATE，申请 INTERMEDIATE 返回 400 INVALID_ARGUMENT
    And 已订阅 INTERMEDIATE 的租户仍按其配置计量
    When 尝试停用默认套餐或把停用套餐设为默认
    Then 命令拒绝执行，不写库

  Scenario: AC-FR-SYS-019-04 泰英双语展示与审批缺省续期
    Given 用户界面语言为泰语
    Then 套餐页的名称、价格文案与特性显示 th 配置，缺失时回退 en；当前套餐卡与首页横幅使用 name_i18n
    And 账户开通通知按收件人语言使用对应套餐名
    Given 某套餐 approved_period_months 为 6，批准申请未写 valid_to 与 period_months
    Then 惰性同步后新周期为 6 个月

  Scenario: AC-FR-SYS-019-05 命令行维护的校验、确认与审计
    Given 导入文件存在未知字段、缺少 th 文案、en/th 特性条数不一致、code 或 sort_order 重复、或默认套餐不唯一
    When 执行 manage_plans.py validate 或 import
    Then 列出全部错误并以退出码 2 结束，不连库（validate）或不写库（import）
    When 合法导入并确认
    Then 按 code 新增或更新（文件外的套餐不动），写审计 plan_config.import，缓存失效
    When 后端启动时 plans 表为空
    Then 自动从 plans_seed.json 写入与原目录一致的 4 个套餐；表非空时不覆盖

  Scenario: AC-FR-SYS-014-01 仅 auth 中 LINE 注册信息录入
    Given 尚未注册的 LINE 账号完成服务端验证的真实认证，渠道启用 email scope 且用户授权并返回 email
    When route=auth 且 needsRegistration
    Then 才显示注册框，邮箱默认取验证后的 LINE id_token 的 email 且可编辑，不采用客户端声明的 LINE 邮箱
    And 手机号若 LINE 返回则预填且可编辑，昵称与头像预填且可修改，提供验证码输入框
    Given 用户处于首页、上传或开始 OCR
    Then 不显示注册框，不强制先完成注册
    When 用户修改资料，向当前邮箱发送验证码并输入有效码后提交注册
    Then 保存手机号、邮箱、昵称与头像并完成注册；注册本身不额外发放权益，个人租户的一个月 Kinder 自租户创建时已开通（见 AC-FR-SYS-012-01）
    And 按 FR-SYS-011 仅回 result（原已 COMPLETED 可 final），不自动 confirm 或跳 plans
    Given LINE 未提供手机号（LINE 不保证提供）
    When 用户手填手机号或留空，其他注册资料与邮箱验证码有效并提交
    Then 均可完成注册，保存手填值或空值，手机号不必填

  Scenario: AC-FR-SYS-014-02 注册邮箱与验证码校验
    Given LINE 未提供邮箱（包括 email scope/用户授权条件不满足），或用户修改了预填邮箱
    When 用户未填写邮箱或填写格式错误的邮箱并点击注册
    Then 系统提示邮箱必填或格式错误，不完成注册
    When 用户未向当前填写的邮箱发送验证码，或未输入验证码并点击注册
    Then 系统提示先发送验证码或验证码必填，不完成注册
    When 用户修改邮箱后使用发往原邮箱的验证码提交
    Then 拒绝注册，要求向当前邮箱重新发送验证码
    When 用户向有效的当前邮箱发送验证码、输入匹配且未过期未使用的验证码并提交
    Then 系统消费验证码、完成注册并保存该邮箱（生产环境校验验证码，仅 FR-SYS-001 明确启用的本地开发不校验）

  Scenario: AC-FR-SYS-014-03 取消注册保留任务权限与已注册资料保护
    Given auth 中注册框已弹出，游客任务已归集到正式账户
    When 用户点击取消
    Then 返回原 result，保留已归集任务访问权限与 LINE/应用会话，不调用退出
    And 清显式 pendingAuth 和 pendingJob 续接标记，不自动续接或 confirm，服务端草稿仍可手动继续
    Given 已注册用户保存过手机号、邮箱、昵称与头像
    When 用户再次通过 LINE 登录
    Then 这些资料保持用户保存的值，不被 LINE 返回值覆盖，不再弹出注册信息框
    Given LINE 登录初查时账号尚未注册，但注册请求随后完成提交
    When 登录刷新取得该用户行锁并重新读取注册状态
    Then 已注册状态与用户保存的资料保持不变，不按初查旧状态写入 LINE 默认资料
    And 按 FR-SYS-015 个人中心手机号可在注册后修改或清空（见 AC-FR-SYS-015-02）

  Scenario: AC-FR-SYS-014-04 注册验证码实际发送、有效期与重发
    Given 生产环境已配置可用的 TLS SMTP，用户已通过真实 LINE 认证但尚未完成注册，填写了有效邮箱
    When 用户点击发送验证码（POST /api/v1/me/email/code）
    Then 服务端通过 ssl 或 starttls SMTP 向当前邮箱实际发送 6 位数字验证码，收件邮箱可收到该码，不以日志或写库替代发送
    And 仅发送成功后记录有效新码的哈希、发送时间及 10 分钟 TTL，按钮进入 60 秒倒计时，发送本身不完成注册
    When 距上次成功发送不足 60 秒再次请求发送
    Then 返回 429，不发送、不产生有效新码
    When 距上次成功发送已满 60 秒再次请求且 SMTP 发送成功
    Then 发送并记录新的 6 位码，重新计算 10 分钟 TTL 与 60 秒重发间隔，旧码失效
    When 用户用旧码提交注册
    Then 拒绝注册（error.email_code_invalid），registered_at 保持为空
    When 用户在新码的 10 分钟有效期内提交匹配且未使用的新码，其他注册资料有效
    Then 消费新码并完成注册

  Scenario: AC-FR-SYS-014-05 发信故障与无效验证码不得完成注册
    Given 生产环境用户尚未完成注册，当前邮箱有效
    When SMTP 未配置，或连接、TLS、认证、发送、超时等任一环节失败，用户请求发送或重发验证码
    Then 返回 503 EMAIL_SERVICE_UNAVAILABLE，不记录有效新码，不完成注册，registered_at 保持为空
    And 不将失败显示为发送成功，不以日志中的码或未发送的新码通过注册校验
    Given 尚未注册用户的当前邮箱验证码分别为错误、已到期（满 10 分钟）或已使用
    When 用户提交注册
    Then 各种情况均拒绝（error.email_code_invalid），registered_at 保持为空，不消费为有效注册、不完成注册

  Scenario: AC-FR-SYS-015-01 修改昵称与头像
    Given 已登录用户在个人中心
    When 用户点击资料卡，修改昵称或头像并保存
    Then 个人中心立即显示新的昵称与头像；昵称为空时不可保存

  Scenario: AC-FR-SYS-015-02 修改与清空手机号
    Given 已注册用户在个人中心资料卡（手机号不再只读）
    When 用户填入合法手机号并保存（PATCH /api/v1/me 带 phone）
    Then 保存成功并回显新手机号，校验规则与注册完全一致：长度 ≤ 32、仅允许 `+`、数字、空格、`(`、`)`、`.`、`-`，去掉非数字后为 6–15 位
    When 用户把手机号清空后保存（phone 传空串）
    Then 手机号被清空，不报错，个人中心显示为空
    When 用户填入超长、含非法字符或数字位数不足/超限的手机号并保存
    Then 返回 400 INVALID_ARGUMENT，field_errors 含 `{field: "phone", message_key: "error.phone_invalid"}`，原手机号不变
    Given 请求者处于游客会话
    When 请求携带 phone 调用 PATCH /api/v1/me
    Then 返回 403 PERMISSION_DENIED，不写入任何联系方式（头像同样受此限制）

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

  Scenario: AC-FR-SYS-017-01 租户刷新后保持
    Given 已登录用户在首页将当前租户切换为已认证企业（租户列表取自 GET /api/v1/me/tenants）
    When 用户刷新页面或重新登录
    Then 当前租户仍为该企业租户（本地仅存 tenant_id）
    And 若该企业已解绑或不再可用，则回落为本人个人租户

  Scenario: AC-FR-SYS-017-02 个人与企业数据隔离、企业成员共享
    Given 用户 A（企业 OWNER）与用户 B（企业 MEMBER）各有个人任务，并各在企业租户下有任务
    When A 处于本人个人租户
    Then 首页最近任务与历史页仅显示 A 的个人任务
    When A 或 B 切换到该企业租户（GET /api/v1/ocr/jobs?tenant_id=…）
    Then 仅显示该企业租户的任务，且包含 A 与 B 在企业租户下创建的任务
    Given 请求携带无法解析的 tenant_id 或他人的个人租户
    Then 分别返回 400 INVALID_ARGUMENT / error.invalid_workspace 与 403 PERMISSION_DENIED（列表接口对不可见租户返回 404）
    Given 成员关系不再 ACTIVE、企业不再 VERIFIED 或租户非 ACTIVE
    Then 返回 403 ENTERPRISE_ACCESS_REVOKED / error.enterprise_access_revoked

  Scenario: AC-FR-SYS-017-03 企业租户单独申请套餐
    Given 企业租户订阅已到期（EXPIRED），企业 OWNER 处于该企业租户
    When OWNER 在套餐页申请 Kinder 并确认
    Then 创建 target_tenant_id 为该企业租户的 PLAN_UPGRADE 申请，本人个人租户的订阅状态不变
    And 该企业的 MEMBER 在套餐页看到同一处理中申请，但不能提交（403 plan.enterprise_owner_only）
    When 后台批准该申请并写入有效期
    Then 下次读取订阅时惰性同步为 APPROVED Kinder，企业全体 ACTIVE 成员共享该订阅与月页额，个人租户独立计量不受影响
```

## 7. EPIC-08 — 文档格式模板配置

> FR-TEMPLATE-001..005/007 为 P0，006 管理 UI 为 P1，非本期交付。以下为批准验收定义，隔离后端及两种子正式 CLI validate 的已确认记录见文首；不等于共享库 seed 或真实 LLM 验收。无草稿发布、路径映射或 REST 写接口。

```gherkin
Feature: FR-TEMPLATE 后台CLI与有序模板

  Scenario: AC-FR-TEMPLATE-001-01 CLI读取与导出
    Given 系统和租户作用域有模板及历史版本
    When 使用list/show/export及作用域或include-deleted筛选
    Then 列出id/code/显示名/作用域/状态/当前版本/更新时间，show可指定版本，export输出当前模板JSON
    And 不打印凭据，不提供本期模板管理UI或REST写接口

  Scenario: AC-FR-TEMPLATE-002-01 幂等不可变导入
    Given 同作用域code已有版本和规范化name/description/groups哈希
    When import相同内容
    Then 无数据变更、无新版本、无审计
    When import变更内容
    Then 追加不可变版本并更新current_version_id，旧版本不变，无draft/publish

  Scenario: AC-FR-TEMPLATE-002-02 dry-run与写入确认
    Given 有效模板文件且写操作默认需要二次确认
    When import或seed使用dry-run
    Then 不写入，不能据此假设不连接数据库
    When 实际写操作未确认或显式yes
    Then 未确认不写入，yes可跳确认，校验失败均先于写入退出

  Scenario: AC-FR-TEMPLATE-002-03 两个系统种子
    Given system.billing_note和system.tax_invoice种子已获业务批准（后者含合并送货单），正式CLI validate均通过
    When 在隔离测试库执行seed，或获得共享库seed的单独授权后执行
    Then 按系统作用域幂等导入，仅这两个首批模板
    And 其他单据待样本，业务批准与validate通过不等于共享库seed完成

  Scenario: AC-FR-TEMPLATE-003-01 有序KV与描述
    Given 模板含groups和kind=field的key/name/description/type/required
    When 校验并导入
    Then 分组/items顺序保留，类型缺省string、required缺省false，一个显示名可为English / ไทย
    And 不配置doc_type、TextIn引用、路径、计算、标准化规则或主要字段

  Scenario: AC-FR-TEMPLATE-003-02 四类型与日期字符串
    Given 字段或列type为string/integer/decimal/amount或不支持类型
    When validate
    Then 仅四类型合法，不支持number/date/boolean，日期以string保留不转佛历
    And 字段与列的API YAML及JSON镜像type枚举均为string/integer/decimal/amount

  Scenario: AC-FR-TEMPLATE-004-01 有序表格列
    Given kind=table项具有key/name/description及有序columns，每列含字段属性
    When 校验导入并生成模板结果
    Then columns顺序保留，结果表格为对象数组，每列按key取值且required仅检查已有行

  Scenario: AC-FR-TEMPLATE-005-01 格式与命名空间全量错误
    Given code或key不符合正则，或组重复、组内字段/表格重名、表内列重名
    When validate
    Then 一次返回全部带路径错误，不连接数据库
    And code遵循^[a-z0-9][a-z0-9._-]{0,63}$，key遵循^[a-z][a-z0-9_]{0,63}$

  Scenario: AC-FR-TEMPLATE-005-02 结构与长度上限
    Given 模板无组、组无item、表无列或超过20组/200字段加列/10表
    And name超过100或description超过500（模板级1000）
    When validate或import前校验
    Then 返回所有相关路径错误且不写入

  Scenario: AC-FR-TEMPLATE-006-01 管理UI延后（P1）
    Given 本期仅后台CLI维护且006为P1
    When 检查本期交付边界
    Then web-pc和line-mini不提供模板创建/编辑管理UI，结果选择框仍是P0核验能力
    And 后续管理UI须按获批P1范围再验收，当前不宣称已交付

  Scenario: AC-FR-TEMPLATE-007-01 作用域与未删code唯一
    Given 同code系统模板与租户N模板，以及另一个租户模板
    When 导入和选择任务模板
    Then 系统与不同租户作用域可各有该code，同作用域未删除code唯一
    And 任务只能使用系统或本租户模板，索引使用COALESCE(tenant_id,0)与deleted_at IS NULL

  Scenario: AC-FR-TEMPLATE-007-02 停用删除升版保留历史
    Given mapping引用固定模板版本
    When CLI停用、软删除或升版模板
    Then 新选择仅启用未删除当前版本，已有mapping仍可读取、编辑、导出原历史版本
    And 模板状态为ENABLED/DISABLED加deleted_at，旧内容不被改写

  Scenario: AC-FR-TEMPLATE-007-03 版本读取隔离与描述裁剪
    Given 系统历史版本和租户历史版本内部含完整name/description/groups不可变快照
    When 持有效会话含游客请求GET模板版本
    Then 系统版本可读，租户版本只对本租户成员可读，跨租户返回404，历史停用删除不破坏追溯
    And 对前端裁剪模板/分组/项/列各层description，保留渲染所需名称、顺序、类型与required
    And 内部不可变快照仍保留完整description供模型使用，不因公开裁剪而变更，无公开description需求

  Scenario: AC-FR-TEMPLATE-007-04 CLI审计与共享库安全
    Given 已授权实际CLI写操作
    When 创建/升版/启用/停用/删除成功
    Then 记录template.created/versioned/enabled/disabled/deleted、source=cli、actor可空
    And 不打印凭据，本地共享数据库保持映射关闭，共享库写入与部署须单独授权
    Given 2026-10-31共享库只读核查
    Then transaction_read_only=on且仅SELECT，重复当前版本任务数0，无DDL/写入，不视为索引补建或seed完成
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
| EPIC-02 | 16（含新增021，按Epic主FR行） | 本期018..021已定义 | 最终822项隔离后端批次（非本Epic逐项数），含删除关联中止与迁移规划；真实LLM/数据库多实例另验，见文首 |
| EPIC-03 | 18（含新增018..020） | 本期018..020已定义 | 显式通用审计后端补测、32场景浏览器及35离线断言通过；有旧READY的force重试、422聚焦覆盖，真机另验，见文首 |
| EPIC-04 | 9 | 本期002已定义，JSON为正式验收 | 模板/通用JSON内容、MIME/.json下载与TXT兼容补测通过；XLSX/CSV后端内容另验，前端合成下载不代表工件验收，见文首 |
| EPIC-05 | 2（P0 子集） | ✔ | 是 |
| EPIC-06 | 19 | ✔ | 2026-11-01 新增 FR-SYS-019 套餐配置化（AC-FR-SYS-019-01..05）：后端 863 项隔离测试、前端类型检查与 Vite 构建通过，已于 2026-11-01 发布（后端 saiflow-api-00056-ril、前端 saiflow-line-mini-00048-max），共享库只读核验 plans 已播种 4 个套餐，未做真实账号/真机验证；2026-10-27 已实现并正式发布的部分：334 项隔离后端、final `index-BUTDgRGj.js` 21 项全 mock 浏览器、6 项 OAuth 源码模拟、9 项前端会话边界及类型检查/Vite 构建/OpenAPI 内部引用通过；2026-10-28 新增的 FR-SYS-018 与改写的 FR-SYS-012/013/015/017 相关 AC（AC-FR-SYS-012-01..05、013-01..04、015-02、017-01..03、018-01/02/03）为契约同步，**本轮未运行任何测试**；历史 221/5 与 SMTP 自测非本轮证据，真实 LINE/收件箱/数据库并发/防猜码/提醒邮件实际投递未验证（见 §6） |
| EPIC-08 | 6（001..005/007）；006为P1 | 7项FR场景已定义，006不纳入P0交付 | 两种子业务批准且正式CLI validate通过；2026-10-31 已 seed 至共享库并随开关开启上线；真实端到端/模型基线待验 |
| NFR | 门槛 | ✔ | 混合（性能/安全测试工具） |

> 每项需求完整的 AC ID 列于每个 epic 的“验证方式”列以及 `Requirements-Index.md` 中。

## 链接
- 需求：`docs/20-requirements/Requirements-Index.md`
- 设计：`docs/30-design/`

## 版本历史
| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.9.7 | 2026-11-03 | Product Engineering | 新增 AC-FR-ENTRY-015-02：Android LINE 内置浏览器经 60 秒限时下载票据在系统浏览器下载，票据篡改/过期/会话注销/账号停用/无权一律 404，重复点击复用导出，iOS/桌面不变 |
| 1.9.6 | 2026-11-01 | Product Engineering | 新增 AC-FR-SYS-019-01..05（默认套餐/试用月数可配、月页数修改对存量订阅 ≤60 秒生效、停用套餐、泰英双语与审批缺省续期、CLI 校验/确认/审计与空表播种）；EPIC-06 计数 19；后端 863 项隔离测试、前端类型检查与构建通过，2026-11-01 正式发布：后端 saiflow-api-00056-ril、前端 saiflow-line-mini-00048-max（bundle index-SFvaHz8q.js）no-traffic 部署→tag 核验 /api/health 200、未登录接口 401、bundle 哈希一致→只读核验共享库自动建表并播种 4 个套餐（属主 saiflow_api，与种子一致）→手动切 100%，环境变量（22 项）与并发 12 与上一版一致；未建游客会话、未用真实账号做端到端核验 |
| 1.9.5 | 2026-10-31 | Product Engineering | 新增 AC-FR-SYS-018-04（通知中心只显示账户变动类、OCR 完成不通知）与 AC-FR-SYS-018-05（个人/公司账户首次开通通知）；后端 831 项隔离测试通过；2026-10-31 正式发布：后端 saiflow-api-00054-mol、前端 saiflow-line-mini-00046-god（bundle index-IPu3DEpl.js）no-traffic 部署→tag 核验 /api/health 200、通知接口未登录 401→手动切 100%，环境变量与并发 12 与上一版一致，切流后 15 分钟内无 5xx；含同日 TEMPLATE_MATCHING 三步流程；未用真实账号做端到端核验 |
| 1.9.4 | 2026-10-31 | Product Engineering | AC-FR-VERIFY-017-04 增加「模板匹配中」任务打开处理页；新增 AC-FR-VERIFY-017-05：处理进度三步流程（上传/OCR 处理/模板匹配）与 TEMPLATE_MATCHING 阶段筛选 |
| 1.9.3 | 2026-10-31 | Product Engineering | 记录模板映射正式发布：迁移建表、两个系统模板 seed、前端与开关开启 revision 切流及匿名核验；真实端到端、模型基线与多实例并发仍未验收 |
| 1.9.2 | 2026-10-31 | Product Engineering | 记录最终822隔离后端、32浏览器/35离线/14双语、构建与新增Ruff通过，包含JSON/显式通用审计/增量迁移补测及force/422修复；不将其视为真实模型/供应商/真机/PostgreSQL多实例或共享库seed/部署验收 |
| 1.9.1 | 2026-10-31 | Product Engineering | 收尾修正JSON正式导出/MIME/.json与TXT兼容、内部描述/公开裁剪、raw返回、旧号切回/通用审计、force重试与删除关联中止AC；记录816隔离后端、两种子批准/正式validate和共享库只读重复数0，不预填补测数，真实基线/seed/部署边界保留 |
| 1.9.0 | 2026-10-31 | Product Engineering | 重写模板与OCR018..020并新增OCR021/VERIFY018..020/ENTRY002场景，覆盖P0 CLI/P1 UI、schema/四类型、开关/分支并发/422/导出；保留历史TextIn与通用AC |
| 1.8.24 | 2026-10-29 | Product Engineering | AC-FR-OCR-017-02：TextIn 首次+最多 3 次重试、2/4/8 秒、单层与错误分类、取消/终态、未知结果恢复不重置预算、锁行刷新、结果唯一及供应商扣费边界；284 项新增+366 项既有隔离回归联合通过，未发布，真实厂商/数据库并发未验收，见 OCR-Pipeline §3.1 |
| 1.8.23 | 2026-10-29 | Product Engineering | 新增 AC-FR-VERIFY-015-06：Continue 纳入未点击小「+」的有效新增输入，空名/重名不部分提交、不导航，认证/订阅分流前草稿保留；空表单/取消不额外写版本，Reset 包含表单输入，小屏控件完整可见；25新增+25原浏览器及6模块、366隔离后端通过，真机未验收；发布状态与验证边界见 Architecture §5 |
| 1.8.22 | 2026-10-29 | Product Engineering | 扩充 AC-FR-SYS-001-07 的 LINE 内无 token、Endpoint 同源/路径、默认 OAuth 与恢复防循环；扩充 AC-FR-UPLOAD-010-01 的同源 XHR、120 秒上限、状态 0/异常响应/中断与无自动重发；23 项 LIFF 源码、14 项上传源码和 2 项 Chromium 上传检查通过；真实手机登录/上传及底层断连另验，发布状态见 Architecture §5 |
| 1.8.21 | 2026-10-28 | Product Engineering | 新增 AC-FR-SYS-001-07：20 秒有界初始化、显式一次官方恢复、同上下文停止重复跳转、非凭据续接、取消与迟到结果保护；16 项隔离源码检查、25 项冻结构建浏览器与6项源码模块通过；前端22版100%切流及真实域名7静态哈希见Architecture §5，真实手机存储连续性与完整 LINE 授权不视为通过 |
| 1.8.20 | 2026-10-27 | Product Engineering | FR-SYS-001/010..014：更新当前说明与覆盖矩阵为已真实实现、隔离通过并正式发布；334 项后端、final index-BUTDgRGj.js 的 21 项全 mock 浏览器、6 项 OAuth 源码模拟、9 项会话边界及类型检查/Vite 构建/OpenAPI 283 个内部引用通过；同步 AC-001-03 失败/10 秒超时锁主壳、Back/刷新先 session CSRF-only→logout→guest，成功回 scan 不留旧 My、不自动 LINE 兑换；registered_at 动态默认 Kinder 每泰国月 1,000 页，无新增 schema/默认申请/付款/历史迁移；发布引用 Architecture §5/§6，历史 221/5 与 SMTP 接收非本轮证据，SMTP 模块/秘密版本引用不变、本轮未实发邮件，隔离不连接数据库/真实 LINE/SMTP、不创建生产账户；真实 LINE/收件箱/数据库并发/防猜码仍未验证，保留旧版本事实与原业务规则 |
| 1.8.19 | 2026-10-27 | Product Engineering | 同步 SYS-001/010..014/017 与 VERIFY-016/017：退出超时/刷新不复登、Cookie/游客主壳、显式 LINE、仅 Continue 到 auth 注册、pending/取消/恢复不自动确认；默认 Kinder 真正月页额与赠送隔离、已批优先/pending 不拦/企业不继承；新增 SYS-011-02 服务端注册门禁无版本写入副作用；与 EPIC-06 代表性 AC 同步，均为本轮待验证目标，历史发布与 SMTP 测试不覆盖本轮 |
| 1.8.18 | 2026-10-27 | Product Engineering | FR-SYS-014：补充 AC-03 登录刷新与注册并发资料保护；记录 221 项隔离测试、5 项模拟浏览器和 SMTP 自测接收证据，完整验收未宣称通过；发布与收件箱/真实 LINE/数据库并发、防猜码剩余边界见 Architecture §6 |
| 1.8.17 | 2026-10-27 | Product Engineering | FR-SYS-014：同步 AC-01/02/03 的注册手机号可编辑且可选、验证后的 LINE token 邮箱默认值及 email scope/用户授权；新增 AC-04/05 覆盖 TLS SMTP 实发六位码、10 分钟 TTL、60 秒重发、旧码失效、503 不记有效新码/不注册与错误/过期/已用拒绝；本次验证与发布未完成，保留历史，不改变 SYS-010/011/015 流程 |
| 1.8.16 | 2026-10-27 | Product Engineering | 新增 AC-FR-SYS-001-04/05/06：生产无开发入口、LINE 按钮仅真实认证、dev 请求在数据库访问前拒绝、旧 dev 会话无效但保留数据、不回退及本地显式启用/生产防绕过；注明 FR-SYS-014/016 发信未支持与真实 LINE 授权联调尚未完成；已收到并配置 LINE/LIFF ID，不改变既有注册及游客 AC |
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
