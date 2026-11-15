# recognition Spec Delta

## MODIFIED Requirements

### Requirement: FR-OCR-021 OCR 引擎与切换
识别 SHALL 按 ocr-settings（FR-SYS-005）的配置调用首选引擎（TextIn 或 Google Document AI OCR）：

- **单份重试与改用备用：** 单份单据在一个引擎上遇到服务层面的失败（超时、连接失败、限流、服务报错、余额不足、凭据或权限无效、处理器不存在等）时，SHALL 退避后重试，直到达到配置的"单据重试次数"。仍失败且配置了备用引擎时，SHALL 改用备用引擎；备用引擎同样按重试次数处理。都失败时，任务失败。
- **不重试的失败：** 内容层面的失败（图片无法识别、参数错误、文件损坏）SHALL NOT 重试，也 SHALL NOT 改用备用引擎；任务直接失败。
- **全局切换：** 首选引擎全局连续的服务层面失败达到"全局切换阈值"时，SHALL 整体改用备用引擎。此后每隔"首选引擎试探间隔"，SHALL 用一个新任务试探首选引擎；试探成功即切回首选。
- **记录：** 每个任务 SHALL 记录实际使用的引擎。
- **未配置：** 引擎的密钥或必需配置没有配置时（Google Document AI OCR 为凭据文件、项目或处理器任一缺失），视为该引擎不可用。

#### Scenario: AC-FR-OCR-021-01 单份改用备用引擎
- **GIVEN** 首选 TextIn、备用 Google Document AI OCR，单据重试次数为 3；TextIn 对任务 J 连续超时
- **WHEN** J 被处理
- **THEN** TextIn 共调用 4 次（首次加 3 次重试）后改用 Google Document AI OCR；J 成功，记录使用的引擎为 Google Document AI OCR

#### Scenario: AC-FR-OCR-021-02 内容失败不重试
- **GIVEN** TextIn 对任务 J 返回"图片无法识别"
- **WHEN** J 被处理
- **THEN** 只调用一次，J 失败，不调用备用引擎，不计入全局连续失败

#### Scenario: AC-FR-OCR-021-03 全局切换与切回
- **GIVEN** 全局切换阈值为 5，试探间隔为 300 秒
- **WHEN** TextIn 连续 5 次服务层面失败
- **THEN** 之后的新任务直接使用 Google Document AI OCR
- **WHEN** 300 秒后新任务到来，TextIn 已恢复
- **THEN** 该任务用 TextIn 试探成功，之后的任务改回 TextIn

#### Scenario: AC-FR-OCR-021-04 没有备用引擎
- **GIVEN** 备用引擎设为"不使用"
- **WHEN** 首选引擎对任务 J 重试达到次数仍失败
- **THEN** J 失败，错误代码表明 OCR 服务不可用，预占被退还

#### Scenario: AC-FR-OCR-021-05 Document AI 首选时的失败分类
- **GIVEN** 首选 Google Document AI OCR、备用 TextIn，单据重试次数为 1
- **WHEN** Document AI 对任务 J 分别返回权限不足（403）、处理器不存在（404）、限流（429）或服务错误（503）
- **THEN** 每种情况下 Document AI 调用 2 次后改用 TextIn，并计入 Document AI 的全局连续失败
- **WHEN** Document AI 对任务 K 返回参数错误（400）
- **THEN** 只调用一次，K 失败，错误代码表明 Document AI 的错误，不调用 TextIn

### Requirement: FR-OCR-025 无厂商结构时的通用结果形状保障
OCR 没有直接提供结构时，系统 SHALL 验证大模型通用输出为可编辑的非空 JSON 对象：字段及语义分组为键值，明细表为对象数组，且至少有一个非空文本或有效数值/布尔值。标量根、根数组、全空内容或非法表格结构 SHALL 不作为正常抽取结果保存。有效输出 SHALL 不增加统一外层包装，不改文本、字段层级或精确数值；新通用结果的整数在 JavaScript 安全范围内保持整数，超出范围 SHALL 转为精确十进制字符串，避免两端读取时舍入，不因此拒绝整个对象。模板转换与现有厂商直接结构保持原契约。

#### Scenario: AC-FR-OCR-025-01 Vision 生成可用通用结果
- **GIVEN** Document AI 提供真实接口形状的多页原始载荷，大模型返回含基本信息、买卖双方、明细对象数组及金额的通用对象
- **WHEN** 完成识别且没有匹配模板
- **THEN** 保存通用分组和表格，结果接口正常返回，PC/LINE 核验可读取、修改和确认，授权 XLSX 可导出；不增加 header_groups/tables 包装

#### Scenario: AC-FR-OCR-025-02 非法输出不能进入正常结果
- **GIVEN** Document AI 已成功，原文可读
- **WHEN** 大模型分别返回 null、字符串、数字、布尔根、空对象、根数组、全空分组，或含非对象行的表格
- **THEN** 输出被判为不可用并进入 FR-OCR-026 的原文保底；不保存会导致结果接口校验失败的标量，也不把空对象作为字段抽取成功

#### Scenario: AC-FR-OCR-025-03 零值、空字段与精度
- **GIVEN** 有效对象包含金额字符串 "123456789012.30"、非空原文、数值 0、布尔 false、可空字段及空明细表
- **WHEN** 校验并保存通用结果
- **THEN** 不因 0/false 或部分空字段拒绝整体对象，不改金额精度和非空原文；纯空内容仍不可用，合法空明细表不制造行

#### Scenario: AC-FR-OCR-025-04 双向首选兼容已有模板
- **GIVEN** 相同合成单据分别由 TextIn 首选与 Document AI 首选识别，均按同一已发布模板转换
- **WHEN** 经结果接口读取、保存、确认及授权 XLSX 导出
- **THEN** 模板分组/字段/表格路径相同，日期和金额沿用 FR-OCR-016/020，确认与导出契约不变；原始载荷各自原样保存并记录实际引擎，不要求两厂商逐字识别值相同

#### Scenario: AC-FR-OCR-025-05 大整数跨两端精确往返
- **GIVEN** 新通用对象的平铺字段、分组字段及表格单元格包含整数 12345678901234567890、-12345678901234567890、边界值 ±9007199254740991 和越界值 ±9007199254740992，同时含 0 和 false
- **WHEN** 保存识别结果，经结果接口读取、PC/LINE 显示与编辑保存，再确认并授权导出 XLSX
- **THEN** 安全范围整数在初次结果中保持整数，越界整数保存为原十进制数字字符串；两端显示、编辑请求和导出单元格保留全部数字，不舍入、不经浮点、不丢弃有效对象，false 不被当作整数处理；原始载荷不变

### Requirement: FR-OCR-026 大模型通用整理失败时保留原文
无厂商结构且大模型未配置、调用失败、解析失败或输出不可用时，系统 SHALL 从厂商原始载荷取逐页 OCR 文字（FR-OCR-028 的逐页原文视图），生成现有通用键值结构的原文保底。文字与页序 SHALL 保留，空页不编造；展示 SHALL 明确这是 OCR 原文而非完整业务字段抽取。保底 SHALL 可读取、编辑、按现有规则确认与导出，不修改 raw，不因整理失败重调 OCR，不阻止之后按原始载荷转换模板。

#### Scenario: AC-FR-OCR-026-01 大模型不可用但原文可读
- **GIVEN** Document AI 成功并返回多页 OCR 文字
- **WHEN** 大模型分别未配置、超时、返回非 200、不可解析 JSON 或 FR-OCR-025 的无效结构
- **THEN** 通用结果保留各页可读原文，明确为原文内容，结果接口不因空值或标量出错；没有新增 TextIn/Document AI 请求，不伪造发票号、金额或行项目

#### Scenario: AC-FR-OCR-026-02 页序和空页
- **GIVEN** 原始载荷包含泰语、中文、英文文字及一张无文字页
- **WHEN** 使用原文保底
- **THEN** 按原页序保存文字，换行、数值字符和原文语言不变；空页保持空内容而非虚构结果，厂商原始载荷不被裁剪或重写

#### Scenario: AC-FR-OCR-026-03 保底之后核验与模板转换
- **GIVEN** 保底任务可进入待核验，用户具有相应权限
- **WHEN** 修改原文并保存，按现有规则确认和导出；或在确认前手动选择模板转换
- **THEN** 通用编辑/版本/确认/导出流程仍可用；模板转换以原始载荷为输入而非保底文字对象，保留既有模板转换失败和重试规则

## ADDED Requirements

### Requirement: FR-OCR-027 Google Document AI OCR 识别
Google Document AI OCR SHALL 由服务端以服务账号凭据，同步调用服务器配置的 Enterprise Document OCR 处理器（默认地区 `asia-southeast1`）。图片 SHALL 一次提交；PDF SHALL 按原页序分为每段不超过 15 页依次提交，任一段失败时整份单据按 FR-OCR-021 处理，SHALL NOT 保存部分结果。请求 SHALL 只取文字与版面字段，不取页面图片；各段响应 SHALL 按页序合并为一份原始结果原样保存（FR-OCR-018），任务记录引擎与实际识别页数。Document AI 不直接提供业务结构，通用结果按 FR-OCR-025/026 生成。

#### Scenario: AC-FR-OCR-027-01 Document AI 识别图片
- **GIVEN** 首选 Google Document AI OCR，一张 JPG 单据
- **WHEN** 任务被处理
- **THEN** 调用一次处理器，请求只含文字与版面字段；原始结果保存为该次响应，任务记录引擎 Google Document AI OCR、页数 1；大模型收到的是该页 OCR 文字，而不是完整版面 JSON

#### Scenario: AC-FR-OCR-027-02 长 PDF 分段
- **GIVEN** 一份 32 页的 PDF 由 Document AI 识别
- **WHEN** 任务被处理
- **THEN** 依次提交第 1–15、16–30、31–32 页三段；原始结果按段序合并，逐页原文得到 32 页且顺序不变；任务页数为 32
- **WHEN** 第二段返回服务错误
- **THEN** 整份单据按 FR-OCR-021 重试或改用备用引擎，不保存只含部分页的结果

#### Scenario: AC-FR-OCR-027-03 凭据与数据边界
- **GIVEN** Document AI 已配置
- **WHEN** 识别、读取配置或返回任何接口错误
- **THEN** 凭据文件内容、访问令牌与处理器编号不出现在接口响应、任务错误信息或日志中；浏览器不直接访问 Document AI

### Requirement: FR-OCR-028 按引擎的逐页原文视图
通用结果、模板匹配与转换（FR-OCR-019）以及后台样例生成 SHALL 按原始结果记录的引擎决定大模型输入：TextIn 原始结果原样使用；Google Document AI OCR 与历史 Google Cloud Vision 原始结果只取逐页文字（按页序，空页为空）。视图 SHALL NOT 改写或替换已保存的原始结果；视图超过模板匹配长度上限时仍按原规则失败。

#### Scenario: AC-FR-OCR-028-01 备用引擎结果套用模板
- **GIVEN** 有多个已发布模板，一份单据由 Document AI 识别，完整版面响应超过 60,000 字符而逐页文字不超过
- **WHEN** 自动模板匹配与转换运行
- **THEN** 匹配和转换的大模型输入为逐页文字，不报 RAW_TOO_LARGE，结果按模板结构保存；已保存的原始结果不变
- **WHEN** 对 TextIn 识别的单据运行同样的流程
- **THEN** 大模型输入仍为 TextIn 原始结果本身，行为与之前相同

#### Scenario: AC-FR-OCR-028-02 历史 Vision 结果
- **GIVEN** 升级前由 Google Cloud Vision 识别、尚未确认的任务
- **WHEN** 用户手动选择模板转换
- **THEN** 以该任务的 Vision 原始结果的逐页文字为输入完成转换；原始结果与引擎记录不变

#### Scenario: AC-FR-OCR-028-03 后台样例生成
- **GIVEN** 平台 admin 用一份由 Document AI 识别的样例生成模板
- **WHEN** 样例生成运行
- **THEN** 大模型读到的是逐页文字（带页号），而不是完整版面 JSON
