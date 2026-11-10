# owner-review-ui-fixes 验证记录

验证日期：2026-11-10～11。环境：本机。前端测试用接口替身；后端集成测试只用本机回环地址上的测试库 `saiflow_test_full1`。未连接线上库或恢复库，未调用真实 OCR、GCS、SMTP，未提交，未部署。

## 1. 自动化测试

| 范围 | 命令 | 结果 |
|---|---|---|
| 后端复核与通知 | `pytest tests/integration -k "review or notification"`（`services/api`，测试库） | 97 passed |
| 后端复核 | `pytest tests/integration/test_reviews.py` | 14 passed |
| web-pc 全量 | `vitest run --maxWorkers=1` | 188 个测试中 186 个通过。与后端测试同时运行、机器负载很高（总耗时 1142s）时，`ocr-upload.test.tsx` 有 2 个等待超时；单独重跑 13/13 通过。另一轮在高负载下超时的 `billing.test.tsx`、`ocr-library.test.tsx` 单独重跑 15/15 通过 |
| web-admin 全量 | `vitest run --maxWorkers=1` | 15 个文件 75 passed |
| line-mini 全量 | `vitest run --maxWorkers=1` | 见 §1.1 |
| 静态检查 | `pnpm -r lint`；三端 `tsc --noEmit` | 0 错误 |
| 构建 | 三端 `vite build` | 全部通过 |

### 1.1 line-mini 全量

第一轮：32 个文件，275 个测试中 273 个通过。2 个失败都是预期过时：

- `review-fixes.test.tsx`："退出时遇到 401 不显示会话过期"原来断言 `notice` 为空。现在按 AC-FR-SYS-043-01 显示"已退出登录"，所以改为断言 `notice` 是 `my.loggedOut`，不是会话过期。
- `final.test.tsx` 106-01：模拟的 LIFF 默认是"LINE 内且未登录"，真实 LINE 中不会出现这种组合。按 AC-FR-SYS-043-04，LINE 内改为重新载入，所以测试改为 LINE 外的浏览器（`inClient: false`）。测试要验证的"跳转登录前先保存草稿"不变。

修改后重跑这两个文件与 `auth.test.tsx`：34/34 通过。line-mini 的 eslint 与 tsc 都是 0 错误。

## 2. 验收标准 → 证据

| 验收标准 | 证据 |
|---|---|
| AC-FR-VERIFY-012-03 非 owner 的确认人不能复核 | `test_reviews.py::test_confirmer_cannot_review`（ClerkRev 角色的成员） |
| AC-FR-VERIFY-012-04 非 owner 一级复核人不能做二级 | `test_reviews.py::test_l1_reviewer_not_l2` |
| AC-FR-VERIFY-012-06 owner 复核所有单据 | `test_reviews.py::test_owner_reviews_everything`；`test_detail_and_summary`（owner 可处理数量 `l1 = 3`，本人确认的单据没有原因） |
| AC-FR-SYS-120-03/06 小程序队列的原因 | 小程序界面只按接口返回的 `block_reason` 显示原因和按钮（`ReviewQueuePage.tsx`、`ReviewDetailPage.tsx`）；`reviews.test.tsx` 覆盖有原因与无原因两种情况；owner 时接口返回 `null`，见上一行 |
| AC-FR-SYS-129-11 展开明细表 | `ocr.test.tsx`："expands a line table into a movable dialog that edits the same draft"，以及 "read-only tables can still be expanded, without editing" |
| AC-FR-SYS-129-12 嵌套数据不显示为 JSON | `ocr.test.tsx`："shows nested objects as fields and lists of rows as tables"，以及 "a template group shows an extra list of rows as a table" |
| AC-FR-SYS-129-13、124-03、131-03 原件固定 | 三个页面的原件外层使用 `.pc-sticky-original`（`position: sticky; top: 88px`）。本地开发租户没有单据，没有在浏览器中实测滚动，见 §4 |
| AC-FR-SYS-102-02 不可用说明与当前档位 | `billing.test.tsx` 102-02：Starter 显示"当前空间不可用"，Intermediate 卡片有 `pc-plan--current`，Advance 没有 |
| AC-FR-SYS-102-04 卡片对齐 | 浏览器测量，见 §3 |
| AC-FR-SYS-043-01、04 退出提示与 LINE 内再登录 | `auth.test.tsx`："logs out to a guest home (043-01)"，以及 "inside LINE: says so, keeps the LINE account and can log in again with a tap" |
| AC-FR-SYS-053-01 免费额度优先说明 | 浏览器检查，见 §3 |

## 3. 浏览器检查（本地开发服务器，固定尺寸 iframe 测量）

浏览器窗口为 0×0，无法截图，因此在同源的固定尺寸 iframe 中用 `getBoundingClientRect` 测量。

- web-pc 套餐页（1440 宽）：四张卡片都是 309px 高；名称区、价格区、特性列表与操作区在四张卡片中的 top 值分别相同。
- web-pc 个人资料"更换邮箱"：输入框 x 484–850、发送验证码按钮 x 858–956，都是 36px 高，没有重叠；取消与确认右对齐。
- line-mini 首页（360 宽）：工作区 y 71–115、欢迎语 123–139、标语 143–211、副标题 217–235，没有重叠；配额区显示 "Free scans: 100 · used before monthly pages"。

## 4. 未验证或只有部分验证

- 核验工作台、单据详情、复核详情的原件固定，以及弹出框在真实页面中的拖动：本地开发租户没有单据，而上传会触发收费的 OCR，所以没有上传。这些只由组件测试与 CSS 覆盖，需要部署后在真实单据上检查。
- 管理端套餐申请的操作列：本地 admin 开发服务器的 Vite 依赖缓存已过期（504），没有在浏览器中查看，只由 web-admin 测试覆盖。
- LINE 内退出后再登录：无法在本机的 LINE 应用中复现，只由模拟 LIFF 的测试覆盖；需要部署后用隔离测试账号在 LINE 中复测。
