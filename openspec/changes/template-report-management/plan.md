# 文档格式模板与组织报表实施计划

## 0. 状态、范围与实施门禁

> **2026-11-10 实施期更新**：负责人授权本变更提交、推送与部署（取代下文“不提交 Git”的规划期边界）；随后决定**报表暂停、先完成模板**。已勾选项仅为模板部分且有本地证据，证据见 `verification.md`；报表项（R*/Q*/F03/F08/F09/F11/F12/B03）保持未勾选。

- 变更：`template-report-management`；仓库根：`D:/work/qoder/saiflow-monorepo`。
- 本轮只交付 `proposal.md`、七个能力的 `specs/**/spec.md` 与本计划，不写业务代码、不启动服务、不调用外部付费服务、不操作生产、不提交 Git。
- D8 确定样例 PDF/图片生成是模板主流程；手动新建与结构 JSON 导入是辅助入口。D9 已授权后续 P1 完整实现、指定 `38.60.156.234` 部署及全功能/UI 循环修复，不再把核心功能列为待用户选定项。
- 实施必须在正式规格与本计划校验完成后开始。以下 checkbox 全是后续待执行工作，不能视为测试、部署或负责人验收已通过。
- 行为正本为本变更的 OpenSpec 增量；遵守 `AI-WORKFLOW.md` 的 specs → plan → 实现 → verification。不得生成 `design.md`/`tasks.md`，不得用 `opsx apply` 绕过该流程。
- 本轮唯一写入边界为本变更的 proposal、specs 与 plan。后续代码、生成契约、设计文档同步及 verification 由主会话在实施范围内执行；本轮不写这些产物。
- 不扩展公开共享、跨图联动/钻取、任意公式、多指标/多轴、跨模板 JOIN、自动刷新、共享统计缓存、投影、预聚合、物化视图或 BI/ERP 集成。
- 无凭据、访问被拒、PDPA/保留策略不满足或基础设施不安全时记录阻塞，不询问业务默认值，也不绕过权限、不修改许可配置。没有 Git 提交/推送授权，不以发布需要为由自行提交。

## 1. 实施基线与责任边界

- [ ] **G01 基线复核**：核对实际分支、依赖、Alembic head、服务启动方式和生产 PostgreSQL 版本。当前迁移 head 为 `0013`，Compose 声明 PostgreSQL 18；proposal D7 的 SQL 是方案示意，不是已运行的生产 SQL。后续迁移若遇并行 head，先协调依赖，不修改既有迁移历史。
- [x] **G02 工作目录与安全**：所有正规 Python 命令在 `D:/work/qoder/saiflow-monorepo/services/api` 执行；测试、截图、导出样例及分析临时文件仅放仓库根 `temp/template-report-management/`。`legacy/` 只读；不手改 OpenAPI/API-client 和 OpenSpec 生成物；凭据仅服务端环境文件及已有 Secrets，不入日志、浏览器或仓库。
- [x] **G03 结构约束**：按 Python 后端标准划分薄 router、DTO schema、事务编排 service、受控 SQL repository 和 ORM model；按 React 标准由 apps 承担路由、鉴权、租户上下文与 API 编排，`packages/ui` 只提供纯展示/受控编辑组件。
- [x] **G04 主会话集成责任**：模板、样例、报表实现完成后，由主会话统一处理 `services/api/app/main.py`、`services/api/app/models/__init__.py`、实际 router 注册入口及必要的 `services/api/app/cli.py` 注册；协调权限枚举、迁移顺序、包依赖和契约生成，避免各工作块重叠修改注册文件。
- [x] **G05 测试先行**：各工作块先写失败用例，再实现并执行对应单元/集成/UI 验收；所有 AC 在第 8 节建立证据，不把 mock 成功冒充数据库、真实 OCR 或部署成功。

## 2. 后端：模板模型、管理与授权

### 2.1 持久化与迁移

- [x] **T01 模板数据结构**：扩展 `services/api/app/models/template.py`，增加可保存不完整内容的草稿、统一修订号、系统授权模式/明细和永久应用保护记录；保留现有不可变 `DocumentTemplateVersion`、当前生效版本指针及同 scope 的 live code 唯一性。草稿与生效定义分离，授权/状态更新不成为内容版本。
- [x] **T02 内容版本算法**：复用 `services/api/app/ocr/templates/schema.py` 的校验和有序规范化，明确内容哈希包含名称、描述与结构，保持 groups/items/columns 的业务顺序；首次生效 v1，规范化内容变化才递增，相同内容重复生效幂等。授权、修订号、状态及审计元信息不进入内容哈希。失败事务不改变旧生效版本或丢失草稿。
- [x] **T03 使用与引用保护**：实际 AUTO/MANUAL 转换开始前在同一事务永久登记“曾应用”；候选评分/仅创建评分记录不登记。失败尝试、结果或 mapping 后来删除也不清除此事实。报表草稿/发布快照、复核配置建立版本引用；模板删除、应用和引用建立采用一致的模板锁/外键策略，事务内重查，不能先检查后无锁删除。统一 job/template/report 锁顺序并测试死锁重试。
- [x] **T04 样例专用模型**：新增 `services/api/app/models/template_sample.py`，数据库只保存非敏感用途、状态、归属、对象引用、计量关联、时间戳等元数据。新样例原件、OCR 载荷、候选样例值及敏感副本进入专用私有短期对象存储，不写正式 `ocr_jobs`/`OcrRawResult`/`ResultVersion` 业务链，也不混入长期 PostgreSQL 备份。候选结构不能夹带样例金额、供应商等敏感值；仅明确保存才创建模板草稿。
- [x] **T05 迁移 0014**：新增 `services/api/alembic/versions/00014_template_management.py`，预期 `revision=0014`、`down_revision=0013`。包含模板草稿/授权/修订/应用保护及样例元数据；迁移使用冻结定义，不 import 可变业务逻辑。系统 Tax Invoice/Billing Note 显式授权全部四档，保留原预置行为，seed 幂等；从已有实际转换关联回填应用保护，不把 candidates JSON 当应用。旧模板的初始草稿/哈希兼容策略不得改变历史版本内容、版本号或正式结果。
- [ ] **T06 迁移验证**：在隔离新库及含合成旧数据的库执行升级、schema/外键/唯一约束检查及可支持的降级恢复测试，验证运行账户只能业务读写、migrator 承担 DDL，已有角色和数据可继续使用。生产回滚优先旧应用兼容新增 schema，不据此执行生产 downgrade。

### 2.2 服务、路由与权限

- [x] **T07 管理 API**：新增对应 `services/api/app/schemas/template_management.py`、`services/api/app/services/template_management_service.py`、`services/api/app/repositories/template_management.py` 与管理路由。实现范围列表、详情、草稿创建/保存、独立生效、版本历史、停用/启用、删除及结构 JSON 导入/导出；生效调用完整服务端 schema/语义校验，错误携带字段路径。
- [x] **T08 并发与失败保护**：保存、生效、授权及状态修改均要求客户端修订号，锁内 CAS 检查，过期返回 409 且不覆盖；live code 冲突返回 409。JSON 输入只接收结构，归属、授权、状态和版本由有权操作者/服务端决定，禁止静默覆盖原模板；允许改 code 后另存副本。
- [x] **T09 统一模板授权策略**：实现个人本人、组织有效 owner/template_manage 成员、平台 admin 配置权限的独立判断。系统授权只能选择“套餐精确多选”或“点名用户/组织”；四档不递归，点名用户只作用于其个人租户，点名组织只作用于有效成员。游客/过期套餐按规格限制新使用，不能因个人/guest 的现有 `ALL` 集合获得模板管理。
- [x] **T10 历史读取与新使用分离**：新候选、新应用和新报表版本绑定重新检查当前授权/状态；历史定义及既有报表版本引用按业务可见范围读取，撤权/停用不破坏历史统计，报表仍检查当前组织启用、有效 Starter+ 与对应权限。已有报表的保留引用不能借修改配置新增已撤权版本，也不能被复制到其他组织绕过授权。
- [x] **T11 admin 路由隔离**：新增配置管理专用 `services/api/app/routers/admin_templates.py`，使用已有 admin 认证/CSRF 与显式目标 scope，不借 `TenantContext` 伪造客户身份。允许跨 scope 管理配置，不因此读客户 OCR 原件、载荷或业务结果；样例上传/已有 OCR 来源仍按独立的业务权限检查。
- [x] **T12 兼容现识别接口**：保留 `services/api/app/routers/templates.py` 中已有 job 选模板/切自由格式及版本 operation IDs。历史版本读取不能仅依赖当前 `available_versions`；对历史 job 校验可见范围与精确关联，再读对应不可变定义，不开放任意跨租户版本枚举。
- [x] **T13 候选及应用重检**：修改 `services/api/app/services/mapping_service.py` 的 `available_versions` 和自动/手动应用流程，查询只返回有权生效候选，避免候选 ID/名称/评分泄露；模型响应选择后和实际应用锁内再检查，撤权竞争禁止新应用。保留 70% 阈值、主要字段不足及模型不可用的通用结果回退、手动切换和原结果版本语义。
- [x] **T14 模板审计**：复用现审计设施记录创建、保存、生效、版本变化、授权、状态、删除和拒绝/失败，包含主体、scope、资源、修订/版本及结果，不记录原件/原值、prompt 全文或凭据。

### 2.3 样例 OCR 与定义生成

- [x] **S01 样例 API 与编排**：新增 `services/api/app/routers/template_samples.py`、`services/api/app/schemas/template_sample.py` 和 `services/api/app/services/template_sample_service.py`，支持上传、查询进度/对照、重试定义生成、取消、主动删除及从有权既有 OCR 结果生成候选。来源无权统一 404，不修改原 job/结果/载荷。
- [x] **S02 文件与双权限**：按内容检测 JPEG/JPG、PNG、PDF，20 MB 与 PDF 1–50 页边界在服务端落实；上传先检查 template_manage、upload_ocr 和当前扫描配额，不能靠 admin 配置身份免除。检查真实页数、伪扩展名、非法文件、超限和禁用/撤权后的直接请求。
- [ ] **S03 计量及终态**：复用扫描按页预占/结算、失败/取消一次性退还规则及现服务端 OCR/LLM 配置，LLM 不另收费。已有样例 OCR 成功后仅重试定义生成不再次扣扫描；明确 OCR 成功但 LLM 失败的状态和已结算费用。幂等请求、重复 worker、取消竞争、崩溃恢复不得重复扣费或重复退款。
- [ ] **S04 worker 接入**：在 `services/api/app/ocr/worker.py` 周边抽取或复用 engine/计量/重试能力，增加专用样例队列处理而非伪造正式业务 job；主会话注册现 worker loop/CLI 所需入口。进度、模型未配置、超时/失败/取消可区分；cancel wins、终态不覆写、异常文件/临时对象可清理，不影响正式 OCR 队列与不可变原载荷规则。
- [x] **S05 候选定义安全**：LLM 输入把单据文本作为不可信数据，使用受限结构化输出、schema 校验与去敏候选，不执行任意网络请求、代码或单据中的工具指令。原件/样例值与字段定义分栏对照；required、primary、role 初始为待人工确认状态，确认后方可生效，不将示例供应商/金额变成字段固定值。
- [ ] **S06 七天隐私**：新样例敏感内容自创建起最长 7 天；主动删除立即禁止访问并清理原件、载荷、候选值、派生/临时副本。定时清理可重试、可观测，短时私有访问地址不能绕过删除/到期；验证对象 versioning、软删除、备份、保留锁及 OCR/LLM 提供商适用的保留设置，不能让“逻辑过期”代替实际删除。短期存储不可满足时阻塞样例上线。
- [ ] **S07 备份隔离**：现 `scripts/deploy/backup.sh` 将 DB custom dump 留本地 7 天、GCS 30 天，因此样例敏感载荷/值不得存入该 dump，样例对象不得进入正式文件长期备份。日志、审计、错误追踪不带原值；只保留非敏感计量/删除证据。既有正式 OCR 原载荷仍遵守不可变规则，不能借七天样例政策删除业务原载荷。
- [x] **S08 隔离验收**：失败、取消、未点保存、过期和删除均不产生正式模板/业务单据，不进入历史、复核正式集合或报表；明确保存后仅生成草稿，生效仍经过 T02/T07 校验。

## 3. 后端：组织报表配置、正式查询与 CSV

### 3.1 权限、模型与生命周期

- [ ] **R01 权限扩展**：在 `services/api/app/permissions.py` 增加 `REPORT_MANAGE=report_manage`，维护角色 API 的固定权限目录和展示。owner 保持全部权限，默认角色仍只有原三项；report_manage 不隐含 report_view、export 或 data_browse，旧角色不自动获新权限。复用 `services/api/app/services/tenant_access.py` 的服务端范围计算，不能信客户端 `can_browse_all`。
- [ ] **R02 报表模型**：新增 `services/api/app/models/report.py`，存组织报表草稿、统一修订号、不可变发布配置快照、发布指针及版本引用。配置包含稳定 card ID、网格坐标、单模板显式版本集合、grain、字段路径/类型、聚合、系列、期间、币种单位及样式；不存统计结果、共享缓存或原始业务数据。
- [ ] **R03 迁移 0015**：新增 `services/api/alembic/versions/0015_reporting.py`，预期 `revision=0015`、`down_revision=0014`；建立组织归属、快照和模板版本引用约束及必要索引。与 T03 共用引用/锁机制；在隔离库升级并验证旧应用兼容，不改 `0013_review_flow.py`、历史正式结果或当前 mapping 指针。
- [ ] **R04 配置服务与路由**：新增 `services/api/app/schemas/report.py`、`services/api/app/routers/reports.py`、`services/api/app/services/report_service.py` 及 repository。实现列表、设计草稿创建/保存、预览、发布、撤销发布、删除和已发布查看/刷新。组织启用+有效 Starter/Intermediate/Advance 是共同门槛，管理/预览用 owner/report_manage，查看用 report_view，CSV 额外用 export。
- [ ] **R05 发布事务**：允许不完整草稿保存；保存/发布/状态修改用修订号 409，发布锁内完整静态校验全部卡片，任一卡无效整页拒绝并保留旧发布。发布生成不可变配置快照，新草稿不修改旧发布；不自动加入新模板版本。新绑定须有权，原历史引用按 T10 延续。
- [ ] **R06 字段目录与配置校验**：从选定不可变版本派生可选目录，同稳定路径且同类型才兼容多版本，要求设计者显式确认业务含义；不按同名跨路径映射、不纳入模板未定义的额外字段。单图一个模板一个指标，单据或一张明细表 grain；明细指标限该表列，表头只可用于分组/日期筛选。校验六图型、聚合类型、一个分类字段多系列、合法布局/30 卡上限、期间和 0–6 显示精度。
- [ ] **R07 admin 配置专用入口**：新增 `services/api/app/routers/admin_reports.py`，允许管理组织配置生命周期和合成效果预览，完全不调用客户真实查询服务；真实统计/CSV 请求拒绝。发布执行配置合法性检查，不为了检查混合单位/负值授予 admin 真实数据权；这些数据问题由有权业务预览/查询检测。

### 3.2 PostgreSQL JSONB 受控统计

- [ ] **Q01 正式数据基集**：新增 `services/api/app/services/report_query_service.py` 和 `services/api/app/repositories/report_query.py` 等受控 SQL 模块。统一基集严格要求 `j.review_status='CONFIRMED'`、`j.official_at IS NOT NULL`、`r.id=j.confirmed_version_id AND r.job_id=j.id`、`m.id=r.mapping_id AND m.job_id=j.id`，按该 mapping 的 `template_version_id` 选定版本；叠加 tenant、服务端 submitter_scope 及过滤条件。无精确正式结果不回退 current/is_current/current_mapping_id；排除样例、原载荷、通用结果和其他版本。
- [ ] **Q02 参数化与白名单**：客户端只提交受 DTO 校验的配置/覆盖期间；模板版本与字段来自服务端目录，聚合、grain、图型和时间桶由枚举映射到受控 SQL。JSON 路径作为 text array 参数，tenant/user/version/date/分类过滤值全部绑定，不拼接任意 SQL、标识符或表达式。
- [ ] **Q03 两种 grain**：单据基集不展开数组；明细只对选定数组使用带 `jsonb_typeof` 防护的 lateral 展开，非对象/全空对象不计有效行，不同时展开两表，不跨模板 JOIN，不用 `SUM(DISTINCT)` 修补表头重复。明细可读取表头分类/日期，不能对表头金额在每行重复求和。
- [ ] **Q04 安全数值和日期转换**：对照 `services/api/app/ocr/templates/normalize.py` 建立 SQL 安全转换表达式/函数与共享合成 fixture，处理千分位、空白、THB/฿/บาท、负号、佛历及 DMY/ISO。在实际 PG 版本验证 `pg_input_is_valid` 和 guarded cast；非法类型、非法日历日期、超两位 amount 排除而非抛整页错误或舍入。日期转换不能容忍 `to_date` 自动滚动非法日期；保持现 integer/decimal/amount 各类型约束，不改历史 JSON。
- [ ] **Q05 精确计算和返回契约**：SQL 用 numeric 执行 sum/avg/min/max，count 明确为正式单据或非全空有效明细行；avg 仅有效数值作分母，空值不当 0。通过 DTO 将精确统计值以 decimal 字符串等无浮点损失形式返回；显示舍入不改统计/导出值。未知分类独立项，空时间桶用 null，不补假 0。
- [ ] **Q06 期间与多系列**：以泰国当前日期计算默认本年，两端包含；支持固定期间和整页覆盖各图 date 字段、day/month/year 桶，无 date 图标记“不适用”。一个模板分类字段形成多系列，分组上限包含时间/分类/系列组合，不引入多指标/多轴。
- [ ] **Q07 单位与负值验证**：配置必须明示币种/单位，可绑定模板分类币种/单位字段并分组；在同受权/期间/版本范围检测未分离混合值并拒绝不正确汇总，不换汇、不取绝对值。pie/donut 在配置可判定时及有权预览/查询发现负值时拒绝，其余类型保留负值。
- [ ] **Q08 诊断一致性**：排除数量/reasons 与统计共享同一受权基集、过滤及一致读快照，不能泄露他人/其他租户计数；区分非法数值、超精度、非法日期、空/异常明细及不适用数据，不返回敏感原值。原值只用于受控转换，不回传原始行。
- [ ] **Q09 限额与失败原子性**：每 statement 在查询事务内 `SET LOCAL statement_timeout` 为 10 秒，超时后 rollback，不污染连接池。最多 1000 分组，允许内部探测第 1001 个以报超限，但不得把前 1000 个作为完整结果；最多 30 卡服务端校验。超时/超限/混合单位/负饼环明确错误，页面不能将局部结果冒充整页刷新成功。
- [ ] **Q10 动态查询及无共享缓存**：打开和手动刷新按当前正式数据查询已发布配置；不自动刷新，不将 owner 结果分享给成员，不缓存跨用户/租户/范围统计。权限/套餐/租户切换清理旧结果；刷新失败若仍显示旧数据，明确旧时间和错误，不更新成功时间。
- [ ] **Q11 查询性能验证**：仅在隔离合成库做实际 PG 的执行计划、10 秒超时、1000 分组与 30 卡负载测试；按 tenant/正式状态/关联版本的基集访问选择必要索引，确认 JSONB 提取仍在数据库，不把所有单据拉回 Python 聚合。不承诺 GIN 自动解决全部聚合，不借性能扩大为投影/预聚合。

### 3.3 导出与审计

- [ ] **R08 聚合 CSV**：新增 `services/api/app/services/report_csv_service.py`，复用受权查询配置、期间、版本、范围和诊断；要求 report_view+export，即使有 report_manage 也不能隐含导出。只导出聚合，不含原始业务行；对文本单元格处理 CSV quoting 和公式注入，对正常数值负号不错误加文本转义。精确值与单位/期间/排除诊断可核对；超时/超限/失败拒绝完整文件下载，不提前流出伪完整 CSV。
- [ ] **R09 报表审计**：记录创建/保存/发布/撤销/删除，以及预览、查看、刷新、CSV、拒绝与失败的主体、组织、配置版本、期间/范围摘要和结果；不记录聚合敏感值、原始文本、文件或凭据。

## 4. 前端：纯共享组件与三端完整功能

### 4.1 共享组件及依赖

- [ ] **F01 依赖验证**：核对当前 React、Ant Design、构建/测试环境，验证 React-Grid-Layout/ECharts 等候选的兼容性、许可、包体积与窄屏渲染。采用原生网格看板设计，不搬入外部 BI；六种图型都实现，依赖不兼容时使用等价实现，不降级成占位。依赖变更由主会话统一处理，避免未经测试锁版本。
- [x] **F02 TemplateEditor**：在 `packages/ui/src/components/TemplateEditor/` 实现 props 驱动的纯结构编辑器，受控 value/errors/change 回调；分组和普通字段逐行、明细列逐列，支持排序、名称与三语 names、类型/描述/required/primary/role 及路径错误。primary 不出现在明细列，展示容量边界和人工确认状态。不得 import app auth、tenant context、业务 services 或直接请求 API。
- [ ] **F03 ChartRenderer**：在 `packages/ui/src/components/ChartRenderer/` 实现纯发布配置+聚合结果+翻译标签输入的六图型 renderer，支持标题/颜色/图例/轴/标签/0–6 精度/币种单位，精确值保留供 tooltip/table/CSV 核对。图形坐标确需 Number 时仅作绘制，不承担业务聚合或替换精确值，范围/溢出有明确显示策略。共享组件无业务权限、统计 SQL 或租户状态。
- [ ] **F04 品牌与可读性**：复用现 UI tokens、字体与 STD-008 品牌/密度/主操作原则，业务状态均有文字；长泰文、空/加载/错误、键盘焦点、表单标签及小屏横向内容均可读取，不用颜色作为唯一含义。LINE 保持现移动端风格，不复制整个 PC/admin 业务布局。

### 4.2 PC 模板与报表

- [x] **F05 PC 模板列表/入口**：在 `apps/web-pc/src/` 增加模板管理 feature/pages 与 app services，列表区分个人/组织/有权系统模板，样例生成为主按钮，手动/JSON 为辅助。按 owner/template_manage 及有效 context 控制入口，后端拒绝仍有明确反馈。
- [ ] **F06 PC 样例完整流程**：上传/已有 OCR 来源 → 进度/计量提示 → 原件/候选值与定义对照 → 人工确认 → 保存草稿 → 独立生效。覆盖取消、定义重试不重复计费、配额不足、模型未配置、文件错误、主动删除/到期；未保存离开不创建模板。三个入口进入同一编辑器，不保留并行旧 JSONPath 编辑模式。
- [x] **F07 PC 模板生命周期**：实现保存/生效区分、旧生效版本提示、不可变历史只读、停用/删除保护、JSON 导出和 code 冲突另存副本。409 保留本地未保存内容并提供重新加载/比较入口，不自动覆盖；路由切换/关闭存在未保存内容时提醒。切租户立即清理样例及旧 scope 数据。
- [ ] **F08 PC 报表设计器**：顶部生命周期操作、左组件栏、中网格、右数据/样式面板；六类型添加/删除/拖动/缩放，稳定 card ID。实现显式模板版本、兼容字段选择及业务含义确认、grain/指标/聚合/分类系列、期间/整页覆盖、单位币种与样式。管理角色有设计/预览，查看角色只有发布只读原网格。
- [ ] **F09 PC 报表发布/查看**：不完整 draft 可存，发布全部卡片静态校验，失败保留旧发布；离页提醒、409、撤销发布/删除明确反馈。发布页打开/手动刷新、实际期间/范围/排除诊断、不适用日期、无数据/超时/超限/混合单位/负饼环清晰；刷新失败标旧数据，CSV 权限独立。

### 4.3 admin 配置与 LINE 展示

- [x] **F10 admin 模板页面**：在 `apps/web-admin/src/` 复用纯 TemplateEditor，支持系统/个人/组织目标范围、生命周期、两种系统授权模式、精确套餐多选与点名列表、JSON 导入导出/冲突。不得把配置管理资格用作读取客户 OCR/样例或绕过扫描双权限的入口。
- [ ] **F11 admin 报表配置页面**：支持组织配置管理及完整生命周期；复用设计/renderer 能力，但 preview 只用合成数据并显著标记，不发送客户真实统计/CSV 请求。静态错误/409/旧发布保护与 PC 一致，不能用“无数据”隐藏权限隔离。
- [ ] **F12 LINE 发布报表**：替换 `apps/line-mini/src/App.tsx` 及相关 ReportPage 占位，保留 FR-SYS-056 的首页、历史及底栏条件；组织有效 Starter+ 且 report_view 才展示。列表/详情只读，发布 cards 按 y、x、稳定 card ID 全宽单列，支持期间覆盖、手动刷新、诊断和有 export 时聚合 CSV，不出现设计操作。
- [ ] **F13 各端鉴权与 i18n**：在三端实际路由、services、权限 helper 与语言资源实现独立守卫；PC/LINE en/th/zh，admin zh/en。owner/template_manage/report_manage/report_view/export/data_browse 不相互冒认；会员失效/撤权/切租户后清理结果、取消过期请求，迟到响应不能覆盖新 scope。names 缺省 fallback name；用户报表标题不自动翻译。

## 5. 主会话契约与整体集成

- [x] **I01 统一注册**：完成 G04 所列 model/router/worker/CLI 注册，并检查现 OCR job routes、CSRF、admin 登录、角色目录、租户刷新和 worker/reminders 行为不回归；新增路径不与现 `/api/v1/templates` 和 job template routes 冲突，operation ID 唯一稳定。
- [x] **I02 OpenAPI 生成**：后端 DTO/路由确认后，在仓库根执行 `pnpm generate:api-client`；脚本从 `services/api` 导出 OpenAPI，再生成 `packages/api-client/src/generated/schema.ts`。不手改 `docs/30-design/openapi.json`/生成 TS；检查精确 numeric、revision、字段路径错误、诊断/限额错误与 admin/业务接口隔离契约。
- [ ] **I03 三端接入**：apps 使用生成类型及已有请求封装，统一处理认证/403/404/409、取消、超时和下载；测试契约生成可重复、无无意旧 operation ID 破坏，随后执行 workspace test/lint/build。
- [ ] **I04 实施后文档同步**：主会话按工作流只补实体/架构与术语变化，更新 `Data-Model.md` 中模板归属/报表实体和过时“未来报表”说明、相关 Architecture/Glossary，并按归档流程让旧 EPIC 指向 OpenSpec 正本；不再在 docs 维护第二份 FR/AC。本轮不进行这些写入，不提前归档或提交。

## 6. 本地隔离验证环境与命令门禁

- [ ] **V01 隔离 PostgreSQL**：使用 `127.0.0.1:25432`、数据库名 `saiflow_test_*` 的可丢弃库，与生产实际 PG 主版本一致；使用专用 test app/migrator 账户。复用 `services/api/tests/conftest.py`、`tests.db_target_guard` 与现 integration fixtures，在任何连接、migration、fixture 清理前检查目标。禁止使用 `81.68.72.120`、`38.60.156.234`、共享 `saiflow` 或生产库做自动测试/清表。
- [ ] **V02 环境绑定**：显式配置 `TEST_DB_HOST/PORT/NAME/USER/PASSWORD`，integration 用 `REQUIRE_INTEGRATION=1`，缺配置必须失败而不是跳过。Alembic/服务运行的实际 DB DSN 也须指向通过 guard 的同一隔离目标，不能只设置 TEST_DB 变量却让迁移连接默认生产 DSN。
- [ ] **V03 外部服务 mock**：单元/集成/UI 的 OCR、LLM、GCS、LINE、SMTP 使用可控 mock/stub；默认禁止外网，禁共享 OCR/reminders worker。用合成票据/图片和独立对象空间，不提交客户数据、真实凭据或临时样例。启动本地 UI 时复用回环开发环境规则，不放开开发登录到公网。
- [ ] **V04 Python 检查**：在 `D:/work/qoder/saiflow-monorepo/services/api` 执行 `uv run ruff check .`、`uv run ruff format --check .`、`uv run pytest -m "not integration"`；隔离环境确认后执行 `REQUIRE_INTEGRATION=1 uv run pytest -m integration`。Alembic heads/upgrade/downgrade 只在已绑定的隔离 DB 上执行，保存实际目标及结果摘要，不保存密码。
- [ ] **V05 前端检查**：在仓库根执行 `pnpm generate:api-client`、`pnpm -r test`、`pnpm -r lint`、`pnpm -r build`，按现脚本细分失败包；Vitest/RTL 覆盖共享纯组件和 app 业务编排，不能仅靠截图检查。
- [ ] **V06 数据/权限 adversarial 集**：合成多个租户、不同提交人、owner/独立权限角色、四档/过期订阅、离职成员、撤权模板、不同不可变版本、draft/current/正式结果不一致及损坏 mapping。包含金额/日期边界、异常数组、未知分类、空桶、多币种、负饼环、1001 分组、31 卡和 SQL/CSV/LLM 注入；所有诊断都检查不跨范围泄露。

## 7. 浏览器全功能与 UI 循环

- [ ] **B01 UI 环境与证据**：对实际构建后的 PC/admin 桌面（至少 1280、1440 宽）和 LINE（至少 320、360、390 宽）执行浏览器验收；PC/LINE 三语、admin 两语，长泰文标签/标题完整可读取，检查 console、network、键盘/焦点及无障碍名称。截图、录屏和下载样例仅存 `D:/work/qoder/saiflow-monorepo/temp/template-report-management/`。
- [ ] **B02 模板端到端**：PC 与 admin 覆盖三入口、分组/field/columns 全属性与排序、容量/字段路径错误、不完整 draft、人工确认、生效版本和重复幂等、JSON 往返/冲突、并发 409、离页提醒、删除保护/停用历史，以及双权限/配额/重试/取消/删除/七天模拟清理。用实际 API 与隔离 DB，不只组件 mock。
- [ ] **B03 报表端到端**：设计并展示全部 bar/line/pie/donut/metric/table，page 多模板、单图多版本、单据/单明细、多系列及所有聚合；核对金额精度、期间边界/默认本年/覆盖、单位币种/负值、诊断、样式和用户标题切语不变。验证保存/发布/撤销/删除、旧发布保护、动态刷新及 CSV，六图型不留占位。
- [ ] **B04 权限与跨端**：同一发布快照在 PC 原网格、LINE y/x/card-ID 单列一致，admin 仅合成预览；覆盖仅 manage、仅 view、仅 export、无 data_browse 本人范围、owner 全范围、Starter+ 与过期/个人/游客。直接 URL/API、切租户、撤权和迟到请求均不能绕过；CSV 不泄露其他提交人。
- [ ] **B05 故障循环**：模拟网络失败、服务错误、超时/超限、无数据、非法配置、混合单位、负饼环和 refresh 错误，检查旧数据标签及恢复行为。每个缺陷先补回归用例，再修复 → 单元/DB → build → 浏览器复验，循环到本次全部 FR/AC 无未解释失败；未覆盖项标未验证/阻塞，不能写通过。

## 8. FR/AC → 实施任务 → 测试映射

以下测试文件为后续实现建议位置；已有等价测试文件时优先扩展，不为保持名称机械新增。AC 范围均指对应 FR 的完整 Scenario ID，例如 `001:01` 表示 `AC-FR-TEMPLATE-001-01`，闭区间不得漏项。

| 验收范围 | 实施任务 | 自动化测试与浏览器验收 |
| --- | --- | --- |
| FR-TEMPLATE-001:01、002:01–02 | T01/T07，F02/F05–F07 | `services/api/tests/unit/test_template_management.py`、`tests/integration/test_template_management.py`；PC 列表/三入口/草稿，B02 |
| FR-TEMPLATE-003:01、004:01、005:01–02 | T02/T07，F02 | `services/api/tests/unit/test_template_schema.py`、`test_template_management.py`；`packages/ui/src/components/TemplateEditor/TemplateEditor.test.tsx`；20/21 组、200/201 字段列、10/11 表、primary 与排序，B02 |
| FR-TEMPLATE-006:01–04 | T02/T05/T10/T12/T13 | 扩现 seed/mapping 测试、`services/api/tests/integration/test_template_mapping_access.py`；预置幂等、精确版本、旧生效保护、应用重检，B02 |
| FR-OCR-019:01–06（保留原 01–04） | T12/T13 | 扩现 mapping unit/integration；70%/低分/缺主要字段/无模板/模型不可用及授权候选、撤权竞争，B02/B04 |
| FR-TEMPLATE-007:01 | T14 | `services/api/tests/unit/test_template_audit.py`；对所有变化与拒绝检查审计去敏 |
| FR-TEMPLATE-008:01–03 | S01/S05/S08，F06 | `services/api/tests/unit/test_template_samples.py`、`tests/integration/test_template_samples.py`；PC 对照/人工确认、不固化值/无权来源 404，B02 |
| FR-TEMPLATE-009:01–05 | T09/T11，S02，F05/F10/F13 | `services/api/tests/unit/test_template_acl.py`、`tests/integration/test_template_mapping_access.py`；四档精确组合/点名 scope/成员失效/游客/admin隔离，B04 |
| FR-TEMPLATE-010:01–04 | T03/T10，R02/R03 | `services/api/tests/integration/test_template_reference_races.py`；评分可删、实际失败尝试永久保护、草稿/发布/复核引用、删除与建引用竞争、撤权后历史，B02/B04 |
| FR-TEMPLATE-011:01–03 | T07/T08，F07/F10 | `services/api/tests/unit/test_template_import_export.py`、integration 唯一冲突；JSON 控制字段忽略、另存副本、有序往返，B02 |
| FR-TEMPLATE-012:01–02、013:01–02 | T01/T02/T08 | `services/api/tests/integration/test_template_management.py`；CAS 保存/生效/授权竞争，首次 v1/相同不增/名称结构增/授权不增、旧版本保留，B02 |
| FR-TEMPLATE-014:01–06 | S01–S08 | `services/api/tests/unit/test_template_samples.py`、`tests/integration/test_template_samples.py`；格式/20MB/50页、双权限、按页预占结算/重复重试、配额/无模型、取消竞态、主动删除/七天所有副本、prompt 注入，B02；保留策略另有环境证据 |
| FR-SYS-002:01–10、139:01–02 | R01，F13，I01 | 扩现角色/tenant_access unit+integration；固定权限点、默认/owner/本人保护、独立 manage/view/export/browse、撤销立即拒绝，B04 |
| FR-REPORT-001:01–02、002:01、003:01–03 | R01/R04/R07，Q01/Q10 | `services/api/tests/integration/test_report_access.py`；组织/套餐/角色、本人范围、owner结果不共享、admin配置不取统计，B03/B04 |
| FR-REPORT-004:01–02 | R09 | `services/api/tests/unit/test_report_audit.py`；状态、预览/查看/刷新/CSV/拒绝/失败审计去敏 |
| FR-REPORT-005:01–02、006:01–03 | R02/R05/R06，F08/F09 | `services/api/tests/unit/test_report_config.py`、`tests/integration/test_reporting.py`；六图型/权限分离、稳定路径类型/显式版本/历史引用，B03 |
| FR-REPORT-007:01–02、008:01–02 | Q01–Q03 | `services/api/tests/integration/test_report_query.py`；精确正式关联、无回退、错误 job/mapping 排除、两明细防重复、异常/全空行 |
| FR-REPORT-009:01–02、010:01–02 | Q05/Q06，R06 | `services/api/tests/integration/test_report_aggregation.py`；五聚合/count/有效 avg/单分类多系列、泰国本年/含边界/固定/覆盖与不适用，B03 |
| FR-REPORT-011:01–04 | Q02/Q04/Q05/Q08 | `services/api/tests/unit/test_report_sql.py`、`tests/integration/test_report_normalization.py`；与 normalize.py 同 fixture 比对，`.10+.20+1234.50+2000+10=3244.80`、`01/10/2569=2026-10-01`，非法值/日期/超精度、未知/null桶、SQL/权限参数伪造 |
| FR-REPORT-012:01–02、013:01–02 | Q07，R06，F03/F08 | `test_report_config.py`、`tests/integration/test_report_query.py`、`packages/ui/src/components/ChartRenderer/ChartRenderer.test.tsx`；混合币种/单位/负饼环拒绝、其他负值保留、显示精度不改统计、标题不翻译，B03 |
| FR-REPORT-014:01–03、015:01–02 | R02/R05/R07，Q10，F09/F11 | `services/api/tests/integration/test_report_lifecycle.py`；不完整草稿/整页静态发布/旧快照/409、admin无真实检查权、打开/手刷动态与失败旧标记，B03/B05 |
| FR-REPORT-016:01–02、017:01–02 | R08，Q09/Q11 | `services/api/tests/unit/test_report_csv.py`、`tests/integration/test_report_limits.py`；同范围诊断/文本公式安全/数值负号、1000与1001组、30与31卡、真实 statement timeout/连接池恢复、失败不产完整CSV，B03/B05 |
| FR-REPORT-018:01–02、FR-SYS-056:01–06（保留原01/03–05） | F03/F12/F13 | LINE ReportPage 与导航测试、ChartRenderer 测试；PC 原网格/LINE y-x-ID 单列、长泰文/窄屏、导航套餐角色/个人游客/切租户，B01/B04 |
| FR-SYS-140:01–03、141:01–03 | F05–F09/F13，I02/I03 | PC 模板/报表 feature 同目录 Vitest/RTL；实际 API 浏览器三入口、错误/409/离页、设计与只读/切租户，B01–B05 |
| FR-SYS-142:01–03、143:01–02 | T11/R07，F10/F11/F13 | admin 页面 Vitest/RTL + `test_report_access.py`；两授权/跨scope配置/JSON冲突/双权限不可绕过，合成预览与真实统计CSV拒绝/发布409，B01/B04 |

- [ ] **V07 映射闭环**：将以上每个 AC 对应到实际用例名称、执行命令/环境、结果和 UI 证据；遗留原场景同样回归，不仅测试新增场景。审查实际变更清单与七能力规格一致，不能以某个 FR 有一条测试代替其全部 AC。

## 9. 后续指定服务器部署、备份与回滚

本节只规划后续已获 D9 授权的操作，本轮不连接服务器、不执行脚本、不获取或输出凭据。只操作 `38.60.156.234`，不能因旧文档/脚本默认值而改用其他地址。

### 9.1 部署前门禁

- [ ] **D01 环境核验**：通过已有授权连接核验实际 SSH 参数（不得猜测历史端口）、主机身份、部署目录、域名/Caddy、Compose 服务、DB/schema/角色、当前 tags/digests、健康状态、磁盘和备份恢复路径。数据库仍仅内部网络，无公网端口；不把生产凭据拉入本地测试。
- [ ] **D02 发布制品**：本地全部测试和 B01–B05 通过后，使用现有可授权、不要求 Git 提交/推送的制品构建/上传方式，固定版本 tag/digest；若现 CI 强制提交且没有可用替代发布通路，记录发布阻塞，不擅自 commit/push 或改 Secrets/权限。记录三前端、API/worker 制品与迁移对应关系。
- [ ] **D03 样例隐私 preflight**：验证样例专用短期对象空间与本地临时清理、无长期备份/对象历史副本，最大保留 7 天及主动删除；核验服务端 OCR/LLM/存储配置符合现 NFR-SEC/PDPA。真实扫描测试需要已有授权凭据和合法测试样例，不能绕过计量；本轮不进行付费调用。
- [ ] **D04 备份与可恢复性**：变更前用既有 `scripts/deploy/backup.sh` 路径生成带时间/version 记录的 DB custom dump，检查退出码、文件大小/校验和、本地7天/GCS30天实际策略及迁移前配置/私有对象恢复边界；凭据文件只服务器安全留存，不复制进报告。将备份恢复到独立隔离库验证 schema、旧应用读取和正式关联，不在生产库做恢复演练。
- [ ] **D05 回滚制品保留**：记录旧 IMAGE_TAG、完整服务镜像摘要和必要配置，确保旧镜像/制品可重新拉取。审查 `scripts/deploy/remote-deploy.sh` 会先改 `.env` tag、运行迁移并末尾 prune，且无自动预备份/健康回滚；在实际发布安排中保护旧镜像，不直接将该脚本等同已具备安全回滚。
- [ ] **D06 迁移/兼容复核**：在同版本隔离 PG 验证 0014→0015、运行账户权限和旧 app+新增 schema 兼容，再安排生产迁移写入窗口及恢复触发条件。没有验证的 destructive downgrade、drop/truncate 或旧 dump 覆盖新业务数据不得作为自动回滚动作。

### 9.2 部署、smoke 与修复循环

- [ ] **D07 受控部署**：使用现 Compose/服务流程，以 migrator 执行新增迁移，更新 API、OCR worker 和三个前端，核验 worker 样例处理/清理入口、现 reminders 不回归、Caddy 同源路由与健康检查。先确认备份、回滚制品及迁移成功，失败停止扩大变更；不修改生产权限设置规避错误。
- [ ] **D08 全功能 smoke**：在指定服务器检查登录/会话/CSRF、组织切换/角色/套餐、模板三入口/草稿生效/识别候选、报表管理/六图型/发布/PC与LINE/合成admin/CSV，以及旧正式业务读取。生产只使用既有授权测试身份与合法隔离测试资源，不运行 integration fixtures、不改客户真实单据以凑验收；无法安全执行项须说明未验证。
- [ ] **D09 全 UI 复验**：复用 B01–B05 的三端语言/尺寸/权限/错误矩阵，核对浏览器实际部署制品而非本地页面；检查 API/worker/Caddy 日志和健康，不记录敏感原值。真实 OCR 成本与扫描计量单列证据，不能用 mock 结果替代。
- [ ] **D10 循环修复**：发现失败 → 收集去敏证据 → 本地补回归测试/修复 → 单元/隔离DB/契约/build/浏览器 → 新制品受控部署 → D08/D09 复验。持续到授权范围全部功能/UI 验收通过或明确基础设施/权限阻塞，不省略模板主流程、图型或安全边界来宣称完成。

### 9.3 回滚策略与交付证据

- [ ] **D11 触发与应用回滚**：迁移失败、健康/认证/权限回归、正式数据关联不符或高风险错误触发停止发布；按已记录旧 tags/digests 恢复应用/worker/前端，在已验证前向兼容 schema 上核验服务与旧业务。记录故障点、回滚时间、制品和实际复验结果。
- [ ] **D12 数据恢复边界**：若新增 schema 与旧应用不兼容或需恢复 DB，先停止扩大写入、保存故障现场及新增业务写入，评估一致性与数据损失；只在明确允许的数据恢复/维护范围执行受控恢复。不能自动执行生产 downgrade/drop/清表或用迁移前 dump 覆盖迁移后新单据；阻塞时保留服务与证据，不以“不询问”为由破坏数据。
- [ ] **D13 最终 verification**：由主会话在本变更的 verification 产物记录 AC→测试→证据、代码/制品版本、测试环境、DB迁移、备份恢复演练、部署/回滚结果、真实调用/费用验证和未覆盖项；不包含客户原件/值或凭据。所有 checkbox 只在有证据后勾选；未执行保持未验证，最终报告不声称业务/UI/部署通过。

## 10. 完成标准

- [ ] 七能力全部正式要求及保留的原 FR/AC 有实现、对应测试和证据；模板样例主入口、独立生效/不可变历史、精确 ACL/引用保护及七天隐私全部闭环。
- [ ] 报表六图型、显式版本/grain、严格正式数据 SQL、numeric/诊断/单位负值/限额、权限隔离、不可变发布/动态刷新与聚合 CSV 完整；PC、LINE、admin 行为与规格一致。
- [ ] 单元、隔离 PostgreSQL 集成、契约生成、lint/build 和三端全功能/UI 修复循环实际完成；指定服务器部署、备份恢复验证和可用回滚制品均有证据，任何阻塞明确列出。
- [ ] 最终再执行 `openspec validate template-report-management --strict` 并记录结果；遵守不提交边界，后续归档/提交只能按另行明确授权和仓库工作流进行。
