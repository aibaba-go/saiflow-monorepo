# 任务清单：web-pc-frontend-prototype

> 依据：`proposal.md`（范围）、`specs/web-pc/*`（验收标准）、`design.md`（实现方式）。
> 约束：所有代码落在 `apps/web-pc/`，不改 `packages/*`、`services/*`。

## 1. 工程脚手架

- [x] 1.1 在 `apps/web-pc/` 创建 Vite + React + TypeScript 工程，包名 `@saiflow/web-pc`；验证：仓库根执行 `pnpm dev:web-pc` 能启动并显示占位首页
- [x] 1.2 添加依赖 antd 5、react-router、i18next、react-i18next、xlsx、vitest、@testing-library/react；验证：`pnpm install` 成功且 `pnpm --filter @saiflow/web-pc build` 通过
- [x] 1.3 配置 strict tsconfig 与 Vitest 运行环境；验证：一个空测试通过（`pnpm --filter @saiflow/web-pc test`）
- [x] 1.4 搭建应用外壳：布局（侧边导航 + 顶部栏）与路由骨架、各功能占位页、"Mock 模式"徽标；验证：`pnpm dev:web-pc` 中各路由可达

## 2. Mock 基础设施

- [x] 2.1 定义 `ApiClient` 接口与领域类型（对齐 `docs/30-design/Data-Model.md` 与 `API-Spec.md` 命名：Document、ExtractedField、LineItem、ChangeLog、ReviewRecord、ReviewPolicy 等）；验证：类型通过 tsc，接口方法覆盖 6 个能力页面所需调用
- [x] 2.2 实现内存 mock store（observer 模式）与 localStorage 持久化（会话/语言/设置），单据数据不持久化；验证：单测——订阅回调在状态变化时触发、刷新后设置保留
- [x] 2.3 实现核验状态机纯函数模块（EPIC-03 §3.1 全状态 + 0/1/2 级复核 + 拒绝打回 + 确认门控规则 §3.3）；验证：单测覆盖全部状态迁移与门控拒绝分支（缺失必填 / needs_review 未处理 / amount_mismatch）
- [x] 2.4 构建_mock 数据集：≥ 20 份单据覆盖 4 种类型与状态机全部状态，含低置信度（< 0.85）、缺失必填、金额不一致、上传失败负样例与泰/英/中混合字段；在 `public/samples/` 生成占位原图；验证：启动后各页面均有数据可展示
- [x] 2.5 实现 `MockApiClient`（300–800 ms 延迟、可触发失败用例）并接入 Provider 注入（`VITE_USE_MOCK` 开关）；验证：登录 → 工作台全链路以 Mock 数据可用

## 3. 登录、i18n 与 RBAC（web-pc/shell-auth）

- [x] 3.1 接入 i18next 资源包（th 默认 / en / zh），AntD `ConfigProvider` locale 联动，顶部语言切换即时生效并持久化；验证：spec `web-pc/shell-auth`「切换语言立即生效」「语言偏好在会话间保留」两场景走查通过
- [x] 3.2 实现 Mock 用户集（clerk/finance/reviewer/viewer/admin）、路由守卫与按角色菜单过滤（EPIC-06 §3 权限矩阵）；验证：viewer 登录不见上传/核验菜单，直接访问受保护路由被拦截
- [x] 3.3 实现登录页（Mock 凭据）、退出登录与未登录重定向（登录后回跳原页面）；验证：spec `web-pc/shell-auth` 登录/重定向/退出三场景走查通过

## 4. 上传工作台（web-pc/upload-queue）

- [x] 4.1 实现文件选择与校验：仅 JPG/PNG/PDF、单文件 ≤ 20 MB，越界以本地化错误提示且不入队；验证：RTL 测试覆盖 `.docx` 拒绝与超限拒绝两分支
- [x] 4.2 实现批量上传与状态队列（排队 → 上传中 → 预处理中 → OCR 处理中 → 已完成/失败，含 Mock 自动流转与失败重试入口）；验证：多选文件后队列逐一展示状态直至完成
- [x] 4.3 实现"已完成"单据跳转核验工作台；验证：spec `web-pc/upload-queue` 全部场景走查通过

## 5. 核验工作台（web-pc/verification-workbench）

- [x] 5.1 实现并排核验视图：原图 + 头部字段 + 行项目表 + 每字段置信度；验证：打开 Invoice/DN 样例视图完整渲染
- [x] 5.2 实现单字段编辑与变更日志（字段、前后值、用户、时间；界面可查列表）；验证：修改 total_price 后日志新增记录（spec 场景）
- [x] 5.3 实现低置信度/校验失败红色标记与必填缺失提醒；验证：负样例单据打开时红色标记与缺失提醒可见
- [x] 5.4 实现确认门控与锁定：门控阻止时显示原因，确认后字段只读；验证：RTL/状态机测试覆盖 AC-FR-VERIFY-006-01/02 两分支
- [x] 5.5 实现待复核列表、通过/拒绝（意见保留、重新提交生成新待复核记录）、复核日志展示，及 approved_for_business 业务录入门控；验证：0 级直批、2 级未过禁止录入、拒绝打回三场景走查通过
- [x] 5.6 实现跨文档批量更正（P1）：多选单据对同一字段批量赋值并逐单记录日志；验证：3 份单据批量改 enterprise 后各自日志新增记录
- [x] 5.7 为核验工作台补充集成测试（编辑 → 门控 → 确认 → 复核流转）；验证：`pnpm --filter @saiflow/web-pc test` 通过

## 6. 录入与归档（web-pc/entry-archiving）

- [x] 6.1 实现 Excel 导出：按类型模板 + 一键填充（xlsx 生成真实 .xlsx），非 approved_for_business 单据禁止导出并提示；验证：导出文件可打开且字段已填充、pending 状态单据被拦截
- [x] 6.2 实现批量导出（多单合并一个 .xlsx）与自定义保存路径设置回显；验证：勾选 5 份导出含 5 条记录，路径设置在导出对话框回显
- [x] 6.3 实现归档记录展示：双重存储两类工件、自动命名预览（`{DocType}_{DocNumber}_{YYYYMMDD}_{Enterprise}.{ext}`）、类型/年/月/企业前缀树；验证：命名规则单测 + 界面展示 "INVOICE_INV-2026-001_20260910_ACME.pdf"

## 7. 归档浏览（web-pc/archive-browser）

- [x] 7.1 实现归档列表：类型/企业/日期分类浏览、分页（默认 20）、关键列（类型/编号/企业/日期/状态）；验证：分类过滤与翻页场景走查通过
- [x] 7.2 实现文档预览：原图 + 提取数据并排，可切换查看变更/复核日志；验证：spec「打开预览」场景走查通过
- [x] 7.3 实现组合搜索（P1）：编号 / 日期范围 / 企业 / 类型 AND 组合 + 无结果提示；验证：单条件与多条件组合场景走查通过

## 8. 设置与操作日志（web-pc/settings-admin）

- [x] 8.1 实现设置页：导出路径、命名规则、归档前缀的查看/修改，保存即时生效并有记录提示，仅 admin 可访问；验证：clerk 访问被拒、admin 修改命名后导出页回显新规则
- [x] 8.2 实现按单据类型配置复核级别（0/1/2）并联动核验工作台；验证：Invoice 改为 2 级后确认进入 pending_review_level_1
- [x] 8.3 实现操作日志列表（用户/操作/目标/时间/结果，时间倒序）并让原型内状态变更操作写入日志；验证：完成一次核验确认后日志列表新增对应记录

## 9. 收尾验证

- [x] 9.1 全量质量门：`pnpm --filter @saiflow/web-pc build`、`lint`、`test` 全绿，且仓库根 `pnpm build` 不因本变更失败
- [x] 9.2 对照 6 个 delta spec 逐条场景手动走查，结果记录到变更目录（`walkthrough.md`），未通过项修复
- [x] 9.3 运行 `openspec validate --change "web-pc-frontend-prototype"` 通过，并确认未修改 `packages/*`、`services/*`
