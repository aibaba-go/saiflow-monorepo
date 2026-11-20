# line-mini-home-refresh 验证记录

验证日期：2026-11-09。环境：本机；单元/组件测试用 MSW 风格的接口替身，浏览器检查用本地模拟 API（`temp/mini-mock/server.cjs`，端口 8011）。未连接线上库或恢复库，未提交，未部署。

## 1. 自动化测试

| 范围 | 命令（`apps/line-mini`） | 结果 |
|---|---|---|
| 全量 | `npx vitest run --no-file-parallelism` | **32 个文件 270 passed** |
| 本变更 | `src/features/scan/home.test.tsx`、`src/features/scan/useHomeRefresh.test.tsx` | 包含在上面的全量中，全部通过 |
| 静态检查 | `eslint .`；`tsc --noEmit -p tsconfig.json` | 0 错误 |
| 构建 | `vite build` | 通过 |

## 2. 验收标准 → 证据

| 验收标准 | 证据 |
|---|---|
| AC-FR-SYS-109-01 用量横幅与最近任务（原有） | `home.test.tsx` “quota banner and recent tasks (109-01)” |
| AC-FR-SYS-109-02 即将到期/已到期提示（原有） | `home.test.tsx` 109-02 |
| AC-FR-SYS-109-03 原地重新读取用量、待处理、最近任务、未读和复核数；刷新更新套餐日期参照 | `home.test.tsx` 第 308、348 行；`useHomeRefresh.test.tsx` “reads exactly the current tenant's home keys”“refetches every read once” |
| AC-FR-SYS-109-04 刷新进行中重复点击不发起第二轮 | `home.test.tsx` 第 367 行；`useHomeRefresh.test.tsx` “one round at a time” |
| AC-FR-SYS-109-05 部分读取失败保留旧数据并提示，下次刷新可恢复 | `home.test.tsx` 第 403 行；`useHomeRefresh.test.tsx` “a failed read keeps its old data” |
| AC-FR-SYS-109-06 上传、URL 输入、工作区与仍待处理的选择在刷新后保留；离开 Pending 的选择被去掉且回来后不再勾选 | `home.test.tsx` 第 500、540 行 |
| AC-FR-SYS-109-07 访客只刷新试用租户，无通知/复核汇总；无复核权限的成员不刷新汇总 | `home.test.tsx` 第 459、474 行；`useHomeRefresh.test.tsx` “guest and no-review scopes” |
| AC-FR-SYS-109-08 切换工作区后旧租户的迟到结果不产生影响 | `home.test.tsx` 第 561 行；`useHomeRefresh.test.tsx` “a round that outlives its tenant is ignored” |
| AC-FR-SYS-109-09 三语刷新、进行中、失败文案；按钮可访问名称随状态变化 | `home.test.tsx` 第 607 行（en/th/zh） |

## 3. 浏览器检查（模拟 API）

脚本 `temp/ui-redesign/impl-mini-check.cjs`（headless Chrome，CDP 记录网络请求），结果 `temp/ui-redesign/impl-mini/impl-mini-check.json` 的 `refresh` 字段。320px 宽，en/th/zh 各点击一次刷新：

- 发出的请求只有 4 个 GET：`/api/v1/billing/usage`、`/api/v1/files/pending`、`/api/v1/ocr/jobs?page=1&page_size=10`、`/api/v1/me/notifications?limit=1`，**没有任何写请求**、没有页面重载（个人租户无复核权限，因此不读复核汇总，与 109-07 一致）。
- 完成提示：en “Home is up to date.”，th “อัปเดตหน้าแรกแล้ว”，zh “首页已更新”。截图 `temp/ui-redesign/impl-mini/home-refreshed-{en,th,zh}-320.png`。
- 按钮可见尺寸 34×34，`::after { inset: -6px }` 把点击区域扩到 46×46；同一脚本的点击区域检查在首页 9 种语言×宽度组合中都没有小于 44×44 的目标。
- `prefers-reduced-motion: reduce` 下转圈动画关闭（CSS 规则 `.refresh-btn[aria-busy="true"] .refresh-icon { animation: none }`）；页面其他动效检查为 `0s/none`。
- 首页 320/360/390 × 三语无横向溢出、无小于 12px 的文字（属于该脚本 72/72 通过的一部分）。

## 4. 未覆盖与限制

- 浏览器检查使用模拟 API，不代表线上数据量或网络延迟下的表现；部分失败（109-05）与租户切换（109-08）只在组件测试中用替身制造，未在浏览器中人为制造网络故障。
- 未在 LINE 客户端（LIFF）内验证；本地浏览器 `isInClient()` 为 false。
- 代码审查中的次要意见未在本变更处理：刷新只重取当前处于激活状态的查询（未挂载的查询在下次挂载时按默认策略读取），记录为后续优化。
