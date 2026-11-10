# template-report-management — 验证记录

## 授权与边界

负责人于 2026-11-10 书面授权完整实施模板管理、报表模块，部署至 `38.60.156.234`，逐功能与 UI 回归、修复后再发布，并允许为验证新增、修改、删除数据；随后明确授权本变更的 Git 提交、推送与部署（取代 plan.md §0/§9 D02 中“不提交”的边界）。

同日负责人决定：**报表部分暂停，先完成并测试模板部分**。因此本记录只对模板相关 FR/AC 给出证据；报表 FR（FR-REPORT-*、FR-SYS-056 报表入口、FR-SYS-141/143）未验证、未交付。

测试只用独立验证数据；集成测试只连本机 loopback `saiflow_test_*` 库，不对生产、`saiflow_dev` 或 `81.68.72.120` 运行会清表的 fixture。模拟外部服务的测试不称为真实外部服务验证。

## 实施前基线（2026-11-10）

| 检查 | 结果 |
|---|---|
| 后端单元测试 `.venv/Scripts/python.exe -m pytest tests/unit -q` | 415 passed |
| `pnpm -r build` | 通过（既有大 chunk 警告） |
| `scripts/dev/check-local-dev.sh` | 通过；DB `127.0.0.1:25432/saiflow_dev`，API 8010 仅 loopback |
| 线上 | 三站点及健康检查 200，版本 `4fa028e` |

## 交付范围（模板）

- 后端：迁移 `0014_template_management`（草稿、修订号、授权、应用保护、样例元数据）与 `0015_reporting`（仅建空报表表，见下文“保留 0015”）；模型 `template_sample.py`、`report.py`；路由 `template_management.py`、`template_samples.py`、`admin_templates.py`；服务 `template_management_service.py`、`template_access.py`、`template_sample_service.py`；样例 worker `ocr/sample_worker.py`；`mapping_service` 候选/应用按授权重检。
- 前端：共享纯组件 `packages/ui/src/components/TemplateEditor/`；web-pc 模板列表/编辑/样例生成（`TemplatesPage`、`TemplateEditPage`、`TemplateSamplePage`、`templates/`）；web-admin 模板列表/编辑/授权（`TemplatesPage`、`TemplateEditPage`、`GrantsPanel`、`RemoteSelect`）；三语（PC en/th/zh）与两语（admin zh/en）资源。
- 契约：`bash packages/api-client/scripts/generate.sh` 重新生成 `docs/30-design/openapi.json` 与 `packages/api-client/src/generated/schema.ts`（未手改）。
- 部署脚本：`scripts/deploy/remote-deploy.sh` 记录 `PREVIOUS_IMAGE_TAG`（回滚目标），并在 `alembic upgrade head` 前执行 `backup.sh`（备份失败即不迁移）；`scripts/tests/remote-deploy.test.sh` 覆盖这两点。

### 保留 0015 的理由

报表暂停，但 `0015_reporting` 仍随本次发布：模板删除保护（FR-TEMPLATE-010）读取 `report_template_refs`，`test_template_reference_races` 依赖该表。0015 只建空表，无数据回填，对旧应用前向兼容。报表后续结构变化另写新迁移，不改 0015。报表的 router/service/前端半成品已移出构建，暂存 `temp/template-report-management/report-paused/`，未注册、未发布。

### 实施中确定的交互默认值（规格未逐项规定处）

| 位置 | 选择 | 理由 |
|---|---|---|
| web-pc「生效」 | 有未保存修改时先保存草稿再生效 | 生效只作用于已保存草稿；避免用户以为当前屏幕内容已生效 |
| admin「生效」 | 有未保存修改时禁用，提示先保存 | admin 配置影响多客户，要求显式保存 |
| admin「保存草稿」「保存授权」 | 内容/授权与已存值相同时禁用 | 避免无意义修订号递增与审计噪声 |
| 导出 JSON | 有生效版本导出生效版本，否则导出草稿 | 导出是给他人复用的定义，优先可用版本 |
| 离页 | 有未保存内容时路由切换与关闭页面均提醒 | FR-SYS-140 |
| 校验提示 | 未编辑过的新表单不显示错误；保存/生效失败后逐字段显示；code 冲突在 code 字段标红并保留输入 | 减少初始噪声，冲突可直接改 code 另存 |
| admin 列表/详情 | 显示归属名称（个人：昵称或邮箱；组织：组织名） | 跨租户管理时仅凭 ID 无法辨认 |
| 模板自身多语言名称 | 编辑器不提供 | 版本内容只含 name/description/groups，模板级 names 不入版本，编辑后生效会被丢弃；分组/字段/列的 names 保留 |
| 从既有 OCR 结果生成 | 需 template_manage 且该单据在调用者可见范围内；否则 404 | FR-TEMPLATE-008/014 双权限与不泄露 |

## 自动化测试结果（本地）

| 检查 | 命令 / 环境 | 结果 |
|---|---|---|
| 后端 lint/格式 | `services/api`：`ruff check .`、`ruff format --check .` | 通过 |
| 后端单元 | `.venv/Scripts/python.exe -m pytest tests/unit -q` | **469 passed** |
| 模板集成 | loopback `saiflow_test_full1`，`REQUIRE_INTEGRATION=1`，`DB_APP_USER=saiflow_v3_app`，`DEV_LOGIN_ENABLED=false APP_ENV=test`；`test_template_management.py`、`test_template_mapping_access.py`、`test_template_reference_races.py`、`test_template_samples.py`、`test_ocr_schema.py` 等 | **49 passed** |
| 全量集成 | 同上环境，`tests/integration` | 见下方“全量集成” |
| 共享 UI | `packages/ui` vitest（TemplateEditor 等） | 通过（含 TemplateEditor 20 项） |
| api-client | vitest | 5 passed |
| web-admin | vitest（含 `templates.test.tsx` 6 项） | 见下方“前端全量” |
| web-pc | vitest（含 `templates.test.tsx`） | 见下方“前端全量” |
| line-mini | vitest | 并发跑全工作区时 `shell.test.tsx`、`invite.test.tsx` 各 1 项超时失败（本变更未改 line-mini）；单独重跑 13/13 通过，判定为负载下超时 |
| 工作区 lint / build | `pnpm -r lint`、`pnpm -r build` | 通过（web-pc、web-admin、line-mini） |

## 本地浏览器 UI 验证（实际 API + 本地隔离开发库）

admin（5175）：列表显示「个人 · SaiFlow Dev」等归属；详情显示归属；未修改时「保存草稿」「保存授权」禁用；授权切换为点名用户后保存、再恢复为套餐精确多选（四档）；为个人租户新建模板 `admin_rcpt` → 保存 → 生效 v1 → 历史版本只读查看；导出 JSON 内容正确；导入到系统范围后显示“设定授权前，该系统模板不对任何客户可用。”；确认后删除未使用模板。

web-pc（5174）：列表区分系统/个人/组织并可见 `tax_invoice`、`billing_note`、`browser-po` v2、`admin_rcpt` v1。手动新建、分组/字段/明细列编辑、保存与生效、code 冲突标记、离页提醒由 `apps/web-pc/src/pages/templates.test.tsx`（RTL）覆盖，线上 UI 回归时再逐项浏览器复核。

发现并修复：模板级中文名修改后生效提示“无变化”（模板级 names 不入版本）→ 编辑器移除该输入；admin 列表仅显示租户 ID → 增加 owner_name；admin 未修改时可重复保存 → 禁用。

## 未验证 / 待线上验证

- 样例生成主流程的**真实 OCR 与 LLM 调用**、按页计量扣费、私有 GCS 对象写入与 7 天/主动删除清理：本地只以 mock/stub 覆盖（`test_template_samples.py`），需在 `38.60.156.234` 用测试账号实测。
- 生产对象存储的 versioning/软删除/保留策略是否会保留样例对象副本：需在线核验。
- 本机无 shellcheck，`remote-deploy.sh` 仅由 `scripts/tests/remote-deploy.test.sh` 验证。
- 报表全部功能：暂停，未验证。

## 部署记录

（待填写：提交、CI、Deploy 运行、备份、迁移、线上 smoke 与 UI 回归结果。）
