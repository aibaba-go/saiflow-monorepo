# enterprise-ui-redesign 验证记录

验证日期：2026-11-09（两轮：第一轮外壳与配色；第二轮逐页高还原与 admin 品牌化，以下为第二轮最终状态）。视觉依据：负责人指定的原型 `temp/ui-redesign/saiflow-pc-precision.html`（PC）与 `temp/ui-redesign/saiflow-line-mini-aibaba.html`（小程序）。环境：本机；页面检查使用模拟 API，admin 检查使用隔离本地栈（127.0.0.1:25432 / API 8010）。未连接线上库或恢复库，未提交，未部署。

## 1. 自动化测试（全部前端，第二轮最终状态）

| 范围 | 命令 | 结果 |
|---|---|---|
| line-mini | `apps/line-mini`：`npx vitest run --no-file-parallelism` | **274 passed**（32 文件） |
| web-pc | `apps/web-pc`：同上 | **172 passed**（19 文件） |
| web-admin | `apps/web-admin`：同上 | **67 passed**（14 文件，含新增 `AdminLayout.test.tsx`）。与浏览器检查同时运行的一次中，`auth.test.tsx` 060-01 超时（15s）且 `AdminLayout.test.tsx` 的 worker 启动超时；无其他负载时串行重跑全部通过，见 §5 |
| packages/ui | `npx vitest run` | **8 passed** |
| packages/api-client | `npx vitest run` | **5 passed**（生成客户端未改） |
| lint / tsc | 三个 app 与两个 package：`eslint .`、`tsc --noEmit -p tsconfig.json` | 均为 0 错误 |
| 构建 | line-mini、web-pc、web-admin：`vite build` | 通过 |

第二轮中按 delta 调整的测试（未删除或放宽业务断言）：web-pc `ocr-home.test.tsx` 改为检查首页没有统计跳转链接（最近单据表的状态标签与统计名称同字，原 `queryByText` 断言会误中）；line-mini `review-state.test.tsx` 106-03 改为确认 `role=status` 的提示出现（最终结果页标题与提示同字）；`guards.test.ts` 曾拦下 `FinalResultPage.module.css` 中的颜色回退值，已改为只用令牌。

后端未受本变更影响（单元 415 passed，集成见 local-test-development 与 verify-template-custom-fields 的记录）。

## 2. 验收标准 → 证据

| 验收标准 | 证据 |
|---|---|
| AC-FR-SYS-132-01 三个前端主色 `#1A6FE8`、品牌区海军蓝；三语字体随应用提供 | `packages/ui/src/tokens.test.ts`（`brand.css` 与 `BRAND_COLORS` 一致；品牌文字对比度 ≥ 4.5:1；`pcTheme` 与 `adminTheme` 均为品牌主色与 PC 密度）；`apps/web-pc/src/AppConfig.test.tsx`、`apps/web-admin/src/AppConfig.test.tsx`（主色 `#1a6fe8`）；admin 浏览器实测主按钮 `rgb(26, 111, 232)`、侧栏 `rgb(10, 37, 64)`；截图见 §3 |
| AC-FR-SYS-132-02 字体不从外部加载 | `packages/ui/src/fonts.test.ts`（常驻字体只有拉丁与泰文，中文字体只加载一次）；PC 与小程序浏览器检查的 `external` 均为空数组（没有发往站外的资源请求，含字体） |
| AC-FR-SYS-132-03 系统深色时按浅色显示 | `apps/line-mini/src/test/guards.test.ts` “light only (FR-SYS-132-03)”；同文件还检查组件与样式中没有硬编码颜色 |
| AC-FR-SYS-135-01 单据库 1280px：筛选输入框与按钮高 36px、圆角 8px，表格行高 ≥ 44px，侧栏顶栏不遮挡 | `temp/ui-redesign/impl-check.cjs` 实测（结果 `temp/ui-redesign/impl/impl-check.json` 的 `controls`）：两个下拉框、日期范围、搜索框均为 36px/8px；搜索按钮 36px，是 `Input.Search` 与输入框相连的右半部分，左侧圆角为 0、右侧 8px（antd 组合控件）；表格行均为 53px；同一检查的几何项（侧栏、顶栏不遮挡，无横向溢出）通过 |
| AC-FR-SYS-135-02 admin 海军蓝侧栏、白色顶栏、主按钮 `#1A6FE8`/8px，选中菜单为主色调底色，菜单与路由不变 | `temp/ui-redesign/admin-check.cjs`（隔离本地栈，经界面登录后只读浏览）的 `brand` 结果：侧栏 `rgb(10, 37, 64)`、顶栏白色、主按钮 `rgb(26, 111, 232)`、圆角 8px、高 36px，输入框 36px，选中菜单为主色与海军蓝混合底色（与 web-pc、原型一致），侧栏 sticky、导航可滚动；菜单顺序 `/`、组织申请、组织、认证审核、套餐申请、套餐、系统设置、用户、操作日志、OCR 与 LLM 与原来一致；`AdminLayout.test.tsx` 与既有 67 个测试通过 |
| AC-FR-SYS-135-03 品牌导航保留菜单顺序与权限，AIbaba 链接安全打开新窗口，没有假指标 | `apps/web-pc/src/pages/shell.test.tsx` “branded shell”（菜单顺序、页面标题、AIbaba 链接 `https://www.aibaba.asia/`、`target=_blank`、`rel="noopener noreferrer"`）以及同文件既有权限用例（个人租户无 Roles 菜单等）；浏览器检查 `company` 字段结果相同；首页用量为真实接口数据（隔离环境实测首页显示开发账号 Kinder 套餐“1,000 / 1,000”） |
| AC-FR-SYS-138-01 已有验收标准仍成立 | §1：三个前端全部测试通过；只按本 delta 更新了品牌值期望，未删除或放宽业务断言 |
| AC-FR-SYS-138-03 逐页对照原型 | PC 1440 与小程序 390 截图和原型截图（`temp/ui-redesign/proto/`，由 `proto-shots.cjs` 生成）逐页并排人工对照：PC 首页、上传、核验、单据库、单据详情；小程序首页、历史、我的、复核、处理中、结果、确认、最终结果。区域顺序、页头（栏目标识/标题/说明/主要操作）、卡片/表格/统计条结构与主要操作位置一致；因缺少真实数据省略的元素见 §6 |
| AC-FR-SYS-138-02 隔离环境走一遍主流程 | **部分完成，待负责人验收**：隔离环境中两个客户端已实测登录、首页、核验页（额外字段）与首页刷新；没有独立 OCR/GCS 凭据，“上传 → 真实识别 → 核验 → 确认 → 导出”整条链路无法在实服跑通，识别部分只能用 mock，不宣称真实服务验收 |

## 3. 浏览器检查（模拟 API）

- **PC**：`temp/ui-redesign/impl-check.cjs`，headless Chrome 打开 web-pc 开发服务器，`/api/v1/*` 由 CDP Fetch 拦截返回模拟数据。首页、上传、核验、单据库、单据详情在 1280/1440/1920（英文），以及首页、上传、核验、单据库在泰文与中文下：**25/25 通过**（无横向溢出，侧栏与顶栏不遮挡内容，标志区与顶栏对齐，导航位于标志区与页脚之间，页脚可见，无元素被裁切）。1280×640 时导航最后一项可达、页脚可见。无未模拟的接口、无页面错误、无站外请求。截图在 `temp/ui-redesign/impl/`。
- **小程序**：`temp/ui-redesign/impl-mini-check.cjs`，Vite 开发服务器代理到本地模拟 API（`temp/mini-mock/server.cjs`）。首页、历史、我的、复核、处理中、结果、最终结果、确认 8 个页面 × en/th/zh × 320/360/390：**72/72 通过**（无横向溢出、无元素超出视口、无小于 12px 的文字）。`prefers-reduced-motion: reduce` 下底部导航、入口卡片、用量条、工作区箭头的动效均为 `0s/none`。无站外请求、无页面错误。截图在 `temp/ui-redesign/impl-mini/`。
- **隔离真实栈**：`scripts/dev/start-local-dev.sh` 启动后，PC 首页显示品牌侧栏、白色顶栏、AIbaba 链接及真实用量；小程序“我的”页显示开发账号。
- **admin（隔离真实栈）**：`temp/ui-redesign/admin-check.cjs`，经登录页用开发管理员登录后只读打开首页、组织申请、组织、认证审核、套餐申请、套餐、系统设置、用户、操作日志、OCR 与 LLM、修改密码，1440 与 1280 两种宽度，外加 `/health`：全部无横向溢出、内容区不溢出，页面标题与面包屑正确；登录页为海军蓝品牌区 + 白色登录卡。组织详情与租户计费两页因本地库没有组织数据未能打开（脚本记录为 `no organization to open`），其样式与其余页面共用同一 `Page` 组件，由 `OrganizationDetailPage`、`TenantBillingPage` 的既有测试覆盖。截图在 `temp/ui-redesign/admin/`。
- **第二轮复跑**：PC `impl-check.cjs` 25/25、小程序 `impl-mini-check.cjs` 72/72（含重做的处理中、结果、确认、最终结果页），首页刷新只发 GET 请求，按钮 44×44。

## 4. 实现中的修复

- `apps/web-pc/src/ocr/EditableResult.tsx`：额外字段与通用字段的行改用 `FIELD_ROW` flex 布局，输入框与模板字段等宽（原 `Space align="end"` 不撑满）。
- 首页刷新按钮可见尺寸 34×34，用 `::after { inset: -6px }` 把点击区域扩到 46×46，满足 44×44 的触控要求。

## 5. 未覆盖与限制

- AC-FR-SYS-138-02 的完整主流程需要真实 OCR/GCS，待负责人在具备凭据的隔离环境中走查确认。
- 并行负载下的测试时序：web-admin 测试与浏览器检查同时运行时，出现过 Testing Library 等待超时与 vitest worker 启动超时（第一轮并行模式 5/20 个，第二轮 1 个用例 + 1 个文件启动失败）；在无其他负载时 `--no-file-parallelism` 串行运行 67/67 通过。判断为本机 CPU 竞争导致的超时，不是回归。输出见 `temp/gate-web-admin-test.log`（负载下）与 `temp/gate-web-admin-test2.log`（串行通过）。
- 代码审查中的次要意见暂缓：开发脚本端口占用检查、seed 遇 429 的提示、上传页品牌块细节。它们不影响本 delta 的 AC，记录为后续项。
- 视觉比对基于原型与截图人工核对，没有像素级的自动比对。

## 6. 原型中省略的元素（AC-FR-SYS-138-03）

按 FR-SYS-138，接口没有真实数据的元素一律省略，不用演示值代替，也不新增接口：

| 端 / 页面 | 省略的原型元素 | 原因 |
|---|---|---|
| PC 全部页面 | 顶部“企业级视觉方案 · 交互设计稿 · 演示数据”说明条、页脚“设计预览 · 演示数据”、组织名旁“演示组织”字样 | 原型说明，不是产品内容 |
| PC 侧栏 | “核验工作台”旁的待核验数量徽标 | 需要在每个页面额外请求统计接口，属于新增行为；数量在首页统计条与单据库标签中显示 |
| PC 首页 / 单据库 | 文件名下方的供应商名称 | 单据列表接口不返回供应商 |
| PC 首页 | 最近单据表脚注中的“演示数据”说明与流程图例 | 原型说明 |
| PC 单据库 | 表格下方的操作说明提示 | 原型新增文案，未在需求中定义；三语文案需另行确认 |
| 小程序全部页面 | 模拟 LINE 标题栏（关闭、PREVIEW、更多）与手机外壳 | FR-SYS-138 明确不实现 |
| 小程序底部导航 | 对所有用户显示的“报表”标签 | 按 FR-SYS-056 原规则只对有权限的组织成员显示，个人账号不显示（`shell.test.tsx` 056-01） |
| 小程序最终结果页 | 总金额大字、单据编号/供应商/单据日期/小计税额等摘要行，标题栏右侧信息按钮 | 这些字段随模板不同，没有统一接口字段；完整的识别字段仍在下方结构化数据区显示。摘要卡改为显示模板、页数、创建与确认时间等真实数据 |
| 两端 | 原型中的示例单据、示例金额、示例计时与进度 | 演示数据 |
