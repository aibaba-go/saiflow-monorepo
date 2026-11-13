# pc-report-view-polish — 验证记录

## 当前状态与边界

列表与只读仪表盘实现已完成；三个审查阻断经 TDD 修复并二次审查关闭。根前端 994 项通过；最后窄屏 CSS 后根 lint、报表/三语完整 78 项和三端 TypeScript/build 通过。最终隔离浏览器 40/40 场景通过，主代理已打开最终 dist 的六种宽度/语言组合及关键状态截图核对。专用隔离数据库上的后端完整第二轮 **1421 passed、无跳过**。最后只读范围审查无新 P0/P1，提交及部署尚未完成，不以浏览器合成数据代替真实集成或生产验收。

起点 `e2ce30e048de14e56b6055a68dc2001f0cfd0c1e`。用户书面授权本 change 与 ocr-primary-selection 开发、测试、提交和标准 CI→Deploy。保留组织/Starter+/report_view 与独立管理、导出权限，不新增菜单、统计接口、依赖、迁移或生产业务记录。不混入既有脏部署文件。

## AC → 测试 → 当前结果

测试：[报表页面](../../../../apps/web-pc/src/pages/reports.test.tsx)、[三语](../../../../apps/web-pc/src/i18n/i18n.test.ts)。

| AC | 验证内容 | 当前结果 |
|---|---|---|
| AC-FR-SYS-161-01 | 已发布 A/B 卡片、草稿隐藏、名称/版本/曼谷时间、返回路径 | 完整前端及合成浏览器通过；列表截图已核对 |
| AC-FR-SYS-161-02 | 整卡链接/长泰文 title、三语提示 | 前端/三语及浏览器通过；实际键盘焦点和长名称截图已核对 |
| AC-FR-SYS-161-03 | 个人/游客/Kinder/失效/无查看及 manage-only 门禁，不请求统计 | 前端及六类浏览器门禁通过 |
| AC-FR-SYS-163-01 | 复用六图型、发布 config/layout/row_height/precision、诊断与精确值 | 前端/共享组件及六组浏览器几何、实际拖动不可编辑检查通过；截图已核对 |
| AC-FR-SYS-163-02 | owner 查看已发布/未发布均无设计控件，管理路径保留授权入口 | 完整前端及 owner 浏览器场景通过 |
| AC-FR-SYS-163-03 | 日期覆盖/重置、无日期图不适用、CSV 固定版本/期间 | 前端竞态及浏览器通过；期间/成功来源/CSV 参数已核对 |
| AC-FR-SYS-163-04 | 三语完整性、工具栏与表格可换行/横向键盘读取 | 三语及 1024/1440 浏览器通过；六组截图和表格真实键盘滚动已核对 |
| AC-FR-SYS-164-01 | 列表与详情首次加载、空、错误互斥及重试、可见网格 fallback | 完整前端和加载/错误/空/重试浏览器场景通过 |
| AC-FR-SYS-164-02 | 普通刷新失败保留旧图并明示旧数据、重复刷新禁用、CSV 禁用 | 完整前端及浏览器通过；旧数据黄色提示、查询时间与禁用导出截图已核对 |
| AC-FR-SYS-164-03 | 租户/版本/权限/套餐/发布失效清理及下载中止 | 完整常规与追加竞态回归通过，二次审查关闭；浏览器门禁通过 |

## 已核对的首轮日志

临时记录均在根 `temp/pc-report-view-polish/`。

- `red.log` 为 Windows fork worker 启动失败，没有运行测试，不作为 TDD 红灯。
- `red-threads.log`：真实 **15 failed、49 passed（64 项）**；`--pool=threads --maxWorkers=1`，357.37s。
- 中间 `green.log`：**1 failed、67 passed（68 项）**，后续修正后重跑。
- `final-tests.log`：报表与三语 **68 passed、2 files**，224.69s。
- `shared-tests.log`：共享图表/网格 **31 passed、3 files**，26.78s。
- `line-tests.log`：LINE 报表相关 **71 passed、2 files**，76.55s。
- `final-lint.log`：web-pc eslint 成功。
- `final-build.log`：web-pc TypeScript 与 Vite 成功，2238 modules，1m29s；有 bundle 体积提示。该构建早于最终 OCR 前端与审查修正，不能用于最终浏览器/生产验证。

## 独立审查与待完成事项

完整只读审查两页及相关测试/依赖发现：

1. `load` catch 先按请求序号丢弃旧响应，会丢失并发旧请求的权限拒绝，允许较新迟到成功恢复无权统计。
2. 同版本 metadata 更新 `can_export=false` 未取消在途下载。
3. 成功覆盖期间后重置失败，保留旧结果却根据当前选择显示“按发布设置”。

修复只修改 Viewer 和报表测试：拒绝处理先于普通序号判断，以 active/publication 引用保护旧版本/离开组件；同版本 `can_export=false` 中止下载、入口读当前权限；`DataState.periodSource` 记录成功结果来源，失败/挂起保留原事实。

- `review-fix-red.log`：共享 Vitest cache 的 ENOTEMPTY 启动失败，不作为测试红灯；未删除共享缓存或改配置。
- `review-fix-red-tests.log`：完整 8 failed/70 passed，365.36s。七个业务失败暴露上述问题，另一个新增测试错误期待重开只请求一次 metadata；React Query 合法 refetch 两次，仅修正该新测试。
- 修改 Viewer 前再运行新增十个回归：`review-fix-red-regressions.log` **7 failed/3 passed/63 filtered out**，117.48s。
- 修复后 `review-fix-green.log`：完整 **78 passed/2 files（73 报表、5 三语）**，276.46s。命令 `pnpm --filter @saiflow/web-pc test -- src/pages/reports.test.tsx src/i18n/i18n.test.ts --pool=threads --maxWorkers=1 --fsModuleCache=false --cache=false --configLoader=runner`。
- `review-fix-lint.log`、`review-fix-tsc.log`、指定两文件 `git diff --check`：通过。
- 二次完整只读审查实际 Viewer、十个新增测试、增量 diff 与原始日志：三个阻断关闭，未发现新增 P0/P1。测试 render 没有 StrictMode；相关生命周期仅静态审查，不声称 StrictMode 动态验收。

合成浏览器统计不能代替真实后端统计验证或授权会话验收。真实生产报告、原生 LINE 身份和设备下载不在本轮自动验收范围。

## 最终根工作区回归

源代码稳定后，使用已缓存 pnpm 12.11.2 串行工作区执行：

```sh
npx --offline --yes pnpm@12.11.2 -r --workspace-concurrency=1 lint
npx --offline --yes pnpm@12.11.2 -r --workspace-concurrency=1 test --pool=threads --maxWorkers=1 --fsModuleCache=false --cache=false --configLoader=runner
npx --offline --yes pnpm@12.11.2 -r --workspace-concurrency=1 build
```

完整链 exit 0。根 `temp/ocr-primary-selection/frontend-full-{lint,test,build}.log` 已检查；API 客户端 **5/1 file**、共享 UI **162/10 files**、LINE **438/37 files**、admin **97/16 files**、PC **292/23 files**，合计 **994 passed/87 files**。PC 包含三修正和 OCR 最终补充。lint 与类型检查通过，LINE/admin/PC Vite 构建分别 51.51s/31.09s/8.20s；仅有 bundle 体积及插件耗时提示，未为了提示改打包配置。该运行早于下面的最终窄屏 CSS 修正；修正后另执行根 lint、报表完整定向、三端构建及完整浏览器矩阵。

## 隔离浏览器首轮与视觉修正

浏览器脚本仅使用 127.0.0.1 静态 dist 与合成 API/身份，无上游 API；未知请求、外网、WebSocket、真实 LINE 身份请求均拒绝。LINE 仅内存替换单个 LIFF init callback，不修改 dist 或权限；同源同资产同 SHA 的页面重载允许再次应用，多个目标或改变内容仍拒绝。

- 首轮 **40 场景、19 通过/21 失败、71 截图**，保存 `browser-first-{summary.json,run.log}`。RGL 类名不等于可拖动、Ant 下拉输入被可见 selector 遮挡、loading 图标改变按钮可访问名称、同一个 LIFF 资产重载误拒绝、空页零高度 div 被误要求 visible，均是脚本诊断问题，不当作业务通过。
- 脚本修正后第二轮 **40 场景、31 通过/9 失败、86 截图**，保存 `browser-second-{summary.json,run.log}`。14 个 PC/LINE OCR 场景均通过，包括四个实际 UI 确认/导出；剩余静态 RGL 隐藏 handle、未发布页没有 grid、后台 loading 保存按钮定位的脚本断言已继续修正，最终完整再跑尚在进行。
- 主代理实际打开长泰文 1024、中文 1440、英文卡片焦点、加载失败/旧数据、PC/LINE 原文和确认只读截图，发现实际窄表分类被长金额挤成竖排。增加表头宽/高检查后，在未修正 dist 上运行 `--report-table-regression`：**8 场景、6 失败/2 通过**（`table-red-{summary.json,browser.log}`）；1440 表头高度 52.5～132.5px、分类列仅 30.25px；1024 的全局 shell 实际宽 1200px，页面超出视口。发布位置、尺寸与 row_height 几何断言通过。
- 最小修正仅 PC CSS：查看路由 shell 支持 1024px；保持查看与管理仪表盘标题作用域，原选择器已覆盖查看标题；表格自身 max-content/min-width 100%、单元格最小 80px 并保持单行，由原 keyboard region 横向滚动。没有改变发布 layout、统计、共享组件或 LINE；非查看路由 shell 仍保持既有宽度。补充只读审查确认此 CSS 无新业务阻断。
- 修正后根 lint 已通过；首次定向重跑只有三语 5 项实际运行，报表文件的 threads worker 启动等待超时，进程 exit 1（`visual-worker-start-failed.log`），不是报表测试通过或业务红灯。没有修改超时、配置或清除共享缓存。随后相同完整集合 **78 passed/2 files，495.46s**；三端 TypeScript/Vite 构建通过，LINE/admin/PC 分别 1m10s/47.42s/12.37s，记录 `visual-final-{tests,build}.log`。
- 补充脚本审查发现后台 `ConfirmButton` 原有机制为可见 loading、Popconfirm pending 门禁与 `useSubmit` 同步 busy 引用，并非原生 disabled。主代理实际核对源码后，pending 检查改为 loading class/图标可见、重复点击不打开新确认且 PATCH 仍只一条；未修改业务按钮或降低防重复提交要求。
- 第三轮完整浏览器 **39 通过/1 失败，40 场景、101 截图、fatal=null、无安全边界违规**；证据保留 `browser-third-summary.json`、`browser-third-run.log`。20 个报表场景、14 个 OCR 场景及两次后台交换均通过；唯一失败 `admin-whole-form-400` 停在第二个下拉选项点击，尚未 PATCH。错误显示选项随后不可见，而截图中当前备用弹层仍正常打开；全局 visible 定位存在匹配前一个退出动画弹层的风险。脚本改为控件 `aria-controls` 对应的唯一 popup，保持真实可见点击与全部原子 400/草稿/双语断言。相同最终 dist 的第四轮结果见下文，未把第三轮当全部通过。

## 最终隔离浏览器与截图核对

第四轮 exit 0：**40/40 场景通过（20 报表、6 后台、14 OCR）、102 截图、fatal=null、无安全边界违规**，实际读取 `browser-run.log` 和 `browser-summary.json` 确认没有失败用例。三端 dist 的文件 SHA-256 随 JSON 记录，PC 最后源码时间早于构建时间；本轮只修临时脚本弹层定位，不再次修改业务源文件。

报表六组 1024/1440 × 英/泰/中文实际截图已打开：发布六图位置/尺寸保持，长泰文标题换行，日期/范围/版本可读，分类不再竖排。DOM 额外断言页面不超出验收视口、表格最小列宽和表头高度、原 keyboard region 实际 ArrowRight 滚动及鼠标拖动后布局不变。另打开卡片键盘焦点、日期覆盖、旧数据/Retry、中文诊断、列表错误和无统计截图核对互斥状态与提示。fullPage 图片拍摄时已滚动，sticky 顶栏/底栏可能出现在图片中段；不把这种捕获现象当业务遮挡，也不声称每张图证明所有滚动位置无重叠。

两个 change 的严格校验与 32 条本地文件链接检查通过。专用隔离库完整后端第二轮 **1421 passed in 3861.16s，无 skip，exit 0**（`temp/ocr-primary-selection/backend-full-rerun.log`），首轮连接超时用例及完整集合均重新通过。最后只读范围审查完整核对实际增量、三个 delta 和相关测试，无新 P0/P1；没有新增业务改动。提交、CI、Deploy 和三站只读发布核验尚未执行。

## 规格同步与归档

2026-11-14 使用已取得的 specs 规则 snapshot，在三份既有 main spec 的末尾智能追加两个 change 的纯 ADDED delta，共 **6 FR/23 AC**；未重复读取同一规则，未写 design 或重复任务内容。专用只读验证脚本确认三份原文件全部字节（含原标题/Purpose/48 条旧需求）保持不变，新增文本逐字匹配 delta，现共 54 条需求、无 delta 操作标题。`openspec validate --specs` **15 passed/0 failed**，其他既有能力的短 Purpose/长需求提示未顺便修改；两个 change strict 校验通过。

两个最小 tasks 链接均 **1/1、state=all_done**；design 缺失按 AI-WORKFLOW 是预期，不生成。仅将本 change 及 OCR change 移入 `archive/2026-11-14-*`，保留 `.openspec.yaml`，修正 23 条随目录移动的链接；归档后全部 **32 本地文件链接可达**，4 条外部设计参考未重写。其他 active change 未移动或修改。

发布前仅 unauthenticated GET：三站 health 均 `status=ok/database=ok/version=e2ce30e048de14e56b6055a68dc2001f0cfd0c1e`。此时仍未部署本次代码，不将旧版本健康当新版本上线证据。
