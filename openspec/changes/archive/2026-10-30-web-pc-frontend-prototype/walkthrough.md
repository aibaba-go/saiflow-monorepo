# Walkthrough: web-pc-frontend-prototype

对照 6 个 delta spec 的全部场景逐条走查。原型采用 Mock 数据层（无真实后端），走查通过
`apps/web-pc` 的集成测试（vitest + jsdom + Testing Library，泰语默认语言）逐场景验证；
每条场景标注对应的测试与结果。可在 `apps/web-pc` 下运行 `pnpm dev` 用浏览器人工复核
（演示账号：clerk1 / reviewer1 / finance1 / viewer1 / admin，密码同用户名）。

**测试统计**：全部 12 个测试文件 / 85 个用例全绿（均为本变更新增）。

## 1. shell-auth（登录/RBAC/i18n 壳）

| 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 成功登录进入工作台 | auth.test.tsx「成功登录进入工作台并显示当前用户与角色」 | ✅ |
| 未登录访问受保护页面被重定向 | auth.test.tsx「未登录访问受保护页面被重定向到登录页，登录后回到原页面」 | ✅ |
| 退出登录 | auth.test.tsx「退出登录后访问受保护页面再次重定向」 | ✅ |
| clerk 角色看到核心菜单 | auth.test.tsx「clerk 可见上传/核验/录入归档/归档管理，不可见设置」 | ✅ |
| viewer 角色菜单受限 | auth.test.tsx「viewer 不可见上传与核验入口」+「viewer 直接访问受保护路由被拦截（403）」 | ✅ |
| 切换语言立即生效 | auth.test.tsx「切换语言立即生效（导航文案更新）」 | ✅ |
| 语言偏好在会话间保留 | auth.test.tsx「语言偏好在会话间保留（localStorage）」+「无存储时初始语言回落默认泰语」 | ✅ |

## 2. upload-queue（上传队列）

| 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 支持的文件入队 | UploadPage.test.tsx「支持的文件入队并进入上传流程」+ 纯函数「jpg/png/pdf 均放行」 | ✅ |
| 拒绝不支持的格式 | UploadPage.test.tsx「拒绝 .docx：显示本地化错误且不入队」+「无扩展名拒绝」 | ✅ |
| 拒绝超过大小限制的文件 | UploadPage.test.tsx「拒绝超过 20 MB 的文件：提示大小超限且不入队」 | ✅ |
| 一次选择多个文件全部入队 | UploadPage.test.tsx 多文件入队断言（含 jpg/png/pdf 混合） | ✅ |
| 队列状态实时更新 | UploadPage.test.tsx 状态流转断言（排队→上传中→预处理→OCR→完成，Mock 自动推进） | ✅ |
| 失败状态可见 | UploadPage.test.tsx「fail」文件名负样例 → 失败状态 + 重试 | ✅ |
| 完成后进入核验 | UploadPage.test.tsx 完成后「ตรวจสอบเอกสาร」链接指向 /verification?doc= | ✅ |

## 3. verification-workbench（核验工作台）

| 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 打开核验视图（并排原图/字段/行项目） | VerificationPage.test.tsx「列表展示待核验单据，打开详情可见原图/字段/行项目/置信度」 | ✅ |
| 编辑字段并记录日志 | VerificationPage.test.tsx「编辑 total_price 后变更日志新增记录（前后值/用户/时间）」 | ✅ |
| 低置信度字段标红 | VerificationPage.test.tsx「低置信度字段红色标记与必填缺失提醒（负样例）」（doc-ir-03 0.62 < 0.85） | ✅ |
| 缺失必填字段提醒 | 同上（doc-ir-02 缺 invoice_number） | ✅ |
| 缺失字段阻止确认 | VerificationPage.test.tsx「必填缺失阻止确认并显示原因」+ 状态机单测「必填字段为空 → 阻止确认并指明字段」 | ✅ |
| 确认后锁定只读 | VerificationPage.test.tsx「确认后按复核级别流转并锁定只读」+ 状态机单测「确认后（verified 起）字段只读」 | ✅ |
| 0 级复核直接通过 | VerificationPage.test.tsx「0 级复核（Delivery Note）确认后直接 approved_for_business」 | ✅ |
| 二级复核门控 | VerificationPage.test.tsx「一级通过后二级单据仍待复核，复核记录可见」+「二级通过 → approved_for_business」 | ✅ |
| 复核拒绝打回 | VerificationPage.test.tsx「拒绝打回：意见保留、字段恢复可编辑、重新提交生成新待复核记录」 | ✅ |
| 复核日志可见 | VerificationPage.test.tsx 复核记录 Drawer 断言（级别/复核人/决定/意见/时间） | ✅ |
| 批量修正字段值（P1） | VerificationPage.test.tsx「3 份单据批量改 supplier_name，字段更新且各新增变更日志」 | ✅ |

另：金额不一致阻止确认（doc-ir-04）与门控优先级由测试与 stateMachine.test.ts 覆盖。

## 4. entry-archiving（录入与归档）

| 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 一键填充导出（模板可打开且字段已填充） | exportWorkbook.test.ts（真实 .xlsx 序列化/读回 5 条 INVOICE 记录） | ✅ |
| 非批准状态单据不可录入 | EntryArchivingPage.test.tsx「pending 单据尝试导出被拦截并提示未通过复核」 | ✅ |
| 批量导出多份单据（合并一个 .xlsx） | EntryArchivingPage.test.tsx「批量导出多份已批准单据合并为一个 .xlsx」（3 份）+ exportWorkbook 多类型工作表 | ✅ |
| 自定义保存路径生效 | EntryArchivingPage.test.tsx「已批准单据导出成功，修改保存路径后再次导出回显新路径」 | ✅ |
| 双重存储归档记录可见 | EntryArchivingPage.test.tsx「归档已批准单据：双重存储工件与分类前缀可见，未批准选择被拦截」 | ✅ |
| 自动命名预览 | EntryArchivingPage.test.tsx 黄金场景：INV-2026-001 全链路后展示 `INVOICE_INV-2026-001_20260910_ACME.pdf` | ✅ |
| 分类前缀树展示 | 同上（`gs://saiflow-documents/INVOICE/2026/09/ACME/` 前缀树叶子含原图与 JSON 工件） | ✅ |

## 5. archive-browser（归档浏览）

| 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 按类型浏览归档单据 | ArchiveBrowserPage.test.tsx「按类型 Invoice 浏览：仅显示 Invoice 归档单据」 | ✅ |
| 翻页（默认每页 20） | ArchiveBrowserPage.test.tsx「默认列表展示第 1 页 20 条，翻页后展示第 2 页剩余记录」（种子 25 份归档） | ✅ |
| 打开预览（原图 + 提取数据并排，可切换日志） | ArchiveBrowserPage.test.tsx「打开预览：原图与提取数据并排，可查看变更/复核日志」 | ✅ |
| 按编号检索 | ArchiveBrowserPage.test.tsx「按编号检索：仅返回匹配单据」 | ✅ |
| 多条件组合检索（类型+企业+日期范围 AND） | ArchiveBrowserPage.test.tsx「多条件 AND 组合：类型 + 企业 + 日期范围」 | ✅ |
| 无结果提示 | ArchiveBrowserPage.test.tsx「无结果提示：搜索不存在的编号」（本地化文案） | ✅ |

## 6. settings-admin（设置与操作日志）

| 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 修改归档命名规则并保存（即时生效） | SettingsAdminPages.test.tsx「admin 修改命名规则保存成功，录入页按新规则回显命名预览」 | ✅ |
| 非 admin 无法访问设置 | SettingsAdminPages.test.tsx「非 admin 直接访问设置页被拒绝并提示权限不足」 | ✅ |
| 将 Invoice 配置为二级复核（联动核验） | SettingsAdminPages.test.tsx「Delivery Note 改为一级复核后，核验确认进入 pending_review_level_1」（INVOICE 默认即为 2 级，由核验工作台二级门控场景验证） | ✅ |
| 查看操作日志（时间倒序） | SettingsAdminPages.test.tsx「admin 完成一次核验确认后，日志列表新增对应记录（时间倒序）」 | ✅ |
| 原型内操作产生日志 | 同上（confirm_verification 操作写入日志并置顶展示） | ✅ |

## 结论

- 6 个 delta spec 的全部 33 个场景均通过验证（自动化走查，0 未通过项）。
- 质量门：`pnpm --filter @saiflow/web-pc build` ✅、`lint` ✅（eslint 10 + typescript-eslint + react-hooks，0 error/0 warning）、`test` ✅；仓库根 `pnpm build` ✅ 不因本变更失败。
- `openspec validate web-pc-frontend-prototype` ✅；未修改 `packages/*` 与 `services/*`。
- 例外记录：`pnpm-workspace.yaml` 追加 `onlyBuiltDependencies`（esbuild 等 Mock 工具链构建白名单），属开发环境配置，不影响运行时行为。
