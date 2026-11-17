# pc-guest-upload — 验证记录

## 当前状态与边界

web-pc 支持游客：首页、上传、核验三页无需登录即可使用（自动建立游客会话），其余页面转登录页；游客在核验页点“确认”时先保存草稿并进入登录页，登录（及注册）后回到该任务、在个人租户下自动确认一次。后端未改。

同批发布的另一项修复（不属于本 change）：通用结果的字段与明细列顺序保持原单据顺序（FR-OCR-023、FR-ENTRY-015），见文末“同批发布：generic-key-order”。

尚未完成、不以其他检查替代：

- **新测试的红灯运行未单独记录**：测试写成时本机尚未装好 pnpm；实现后全部通过。
- **游客 → 确认 → 登录 → 自动确认的完整浏览器流程**：本地没有 GCS 与 OCR 凭据，无法产生真实的待核验任务；该流程只由组件测试覆盖（129-14/15/16）。生产环境的登录需要负责人自己的账号，未代为登录。
- **已登录用户的菜单与顶部栏未在浏览器中检查**：由已有的 web-pc 组件测试覆盖（全部通过）。

## AC → 测试 → 当前结果

| AC | 测试（`apps/web-pc/src/pages/guest.test.tsx`） | 当前结果 |
|---|---|---|
| AC-FR-SYS-090-08 | 无会话打开 `/`：建立一次游客会话，菜单只有首页/上传/核验，顶部有“登录”（`/login?next=%2F`），没有租户切换、通知与退出；不请求 `/me/tenants`、`/me/notifications` | 通过 |
| AC-FR-SYS-090-09 | 游客打开 `/library`：显示登录页，不再建立游客会话 | 通过 |
| AC-FR-SYS-090-10 | 游客 401：提示“游客试用已结束”，建立新游客会话，仍在上传页 | 通过 |
| AC-FR-SYS-090-11 | 用户会话失效：显示“登录已过期”与登录页，不建立游客会话 | 通过 |
| AC-FR-SYS-129-14 | 游客改总额后确认：先 PATCH 草稿（`confirm: false`），进入登录页；邮箱登录后自动确认一次，确认请求不带 `X-Tenant-Id`（个人租户），已存的组织选择保留 | 通过 |
| AC-FR-SYS-129-15 | 未注册用户：先看到注册引导，不确认；点“我已完成注册”后自动确认一次 | 通过 |
| AC-FR-SYS-129-16 | 自动确认被拒（`required_missing`）：标记清除，不再自动确认（重新打开仍只 1 次 PATCH） | 通过 |
| 回归 | 已登录用户确认：只有一次 `confirm: true`，不记标记、不去登录页 | 通过 |

## 已运行的检查（2026-11-18）

- `pnpm -r lint`：api-client、ui、line-mini、web-admin、web-pc 全部通过。
- `pnpm -r test`：api-client **5 passed**、ui **162 passed**、line-mini **37 files / 442 passed**、web-admin **16 files / 97 passed**、web-pc **24 files / 306 passed**。
- `pnpm -r build`：三端构建通过。
- 首次全量运行发现回归：游客页与用户页分在两个 `AppLayout` 下，从首页进入通知页时布局重新挂载（`billing.test.tsx` 103-01 失败）。已改为 `RequireVisitor` 包住唯一的 `AppLayout`，用户页再由 `RequireUser` 保护；重跑全部通过。
- `bash scripts/check-no-secrets.sh`：通过。
- `openspec validate pc-guest-upload --strict`：通过。

### 本地浏览器（vite 开发服务器 + 本地 API 与 PostgreSQL 18，2026-11-18）

- 无会话打开 `http://localhost:5173/`：首页正常，侧栏只有首页、上传、核验；顶部只有语言与“Log in”（`/login?next=%2F`）。控制台仅有首次 `/api/v1/me` 的预期 401。
- 打开 `/upload`：上传页正常，“Log in”带 `next=%2Fupload`。
- 打开 `/library`：转到登录页 `/login?next=%2Flibrary`。

## 同批发布：generic-key-order

问题：PostgreSQL `jsonb` 按键长排序对象键，通用结果的字段与明细列（如 ttb 对账单的 Transaction Date、Posting Date、Description、Amount）回读时顺序被打乱。修复：迁移 0021 把 `result_versions.structured` 由 `jsonb` 改为 `json`（保存原文顺序）；报表查询处显式 `CAST(... AS jsonb)`。已保存的结果保持 jsonb 给出的顺序，重新识别或再次保存后才按原单据顺序。

- `tests/integration/test_exports.py::test_generic_keys_keep_document_order`、`tests/integration/test_ocr_schema.py::test_0021_result_versions_keep_key_order`：本地隔离库（127.0.0.1:25432，`saiflow_test_local`）通过。
- 全量后端 `pytest tests`（`REQUIRE_INTEGRATION=1`，本地隔离库）：**1441 passed**（10 分 35 秒）。
- 首次运行时 `ruff check` 报 0021 迁移一行超过 100 字符（E501），已改正；`ruff check .`、`ruff format --check .` 复查通过，`test_ocr_schema.py` 与 `test_exports.py` 重跑 **30 passed**。
