# template-report-management — 验证记录

## 授权与边界

负责人于 2026-11-10 书面授权完整实施模板管理、报表模块，部署至 `38.60.156.234`，逐功能与 UI 回归、修复后再发布，并允许为验证新增、修改、删除数据；随后明确授权本变更的 Git 提交、推送与部署（取代 plan.md §0/§9 D02 中“不提交”的边界）。

同日负责人决定：**报表部分暂停，先完成并测试模板部分**。下述 2026-11-10 记录仅包含模板相关 FR/AC；当时的报表 FR（FR-REPORT-*、FR-SYS-056 报表入口、FR-SYS-141/143）未验证、未交付。2026-11-11 负责人恢复报表开发，本轮状态与证据见文末“报表恢复实施”，不追溯改写历史结果。

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

## CI 与部署记录

| 步骤 | 证据 | 结果 |
|---|---|---|
| 提交 | `8ccff95`（模板功能，96 文件）、`14ae4e9`（测试脚本 shellcheck SC2016 抑制） | 已推送 `chore/ai-workflow-v2` |
| CI `8ccff95`（run 42759793076） | backend（ruff + 全量 pytest，含 PG18 集成）、frontend（`pnpm -r lint/test/build`）、contract（api-client 与后端一致）、stack 均 success；scripts 因 `remote-deploy.test.sh` 一处 shellcheck SC2016 info 失败 | 修复后重推 |
| CI `14ae4e9`（run 42760665348） | backend、frontend、contract、scripts、stack | **全部 success** |
| Deploy（run 42761578005，2026-11-10 05:25Z） | 分支与 CI 门禁通过；镜像推 GHCR；`remote-deploy.sh` 迁移前备份 `saiflow-20261110T052511Z.dump`（220,251 字节，本机 + `gs://saiflow-db-backup/`）；`alembic` 0013→0014→0015；重启；三站健康；数据库端口外部不可连 | **success** |
| 部署后只读复查 | `saiflow-app`、`saiflow-admin`、`saiflow-line2` 三站 `/api/v1/health` | `{"status":"ok","version":"14ae4e93…","database":"ok"}` |

回滚路径：`remote-deploy.sh` 本次起把上一 tag 写入服务器 `.env` 的 `PREVIOUS_IMAGE_TAG`（上一线上版本为 `4fa028e…`；未登录服务器核对该行）；0014/0015 只新增表与列（新增 schema 对旧应用前向兼容），应用回滚按旧 tag 重新部署即可，不执行生产 downgrade。

本机负载说明：本机 CPU 长时间 100%（其他程序占用）时，前端 vitest 在 line-mini、web-admin、web-pc 中各出现若干与模板无关的等待超时；单独重跑通过，CI 干净环境全部通过，判定为负载导致，不是回归。

## 线上功能回归

首次部署后会话内无管理员凭据，线上回归一度阻塞；负责人随后在浏览器中自行登录（PC 使用测试账号），并提出下述第二轮需求。线上结果见“第二轮部署与线上验证”。

## 第二轮：样例对照、批量确认与入口调整（2026-11-10）

负责人需求（附 web-pc 样例页截图）：①从样例生成时原件锚定在屏幕上始终可见；②样例建议增加“全部接受/全部拒绝”；③管理后台增加“从样例导入”入口，管理端与客户端都隐藏“导入 JSON”按钮。

| 位置 | 实现 / 选择 | 规格落点 |
|---|---|---|
| 原件对照 | web-pc `.pc-sample-original`、admin `.ad-sample-original`：宽屏（≥992px）`position: sticky; top: 88px`，查看区高 `calc(100dvh - 104px)`，内部滚动与翻页；窄屏恢复普通流 | FR-TEMPLATE-008、FR-SYS-140/142 |
| 全部接受/拒绝 | `TemplateEditor` 待确认摘要区两个按钮，均先弹二次确认；接受=采用建议值，拒绝=与建议相同的取值改为否/无角色，其余保持；两者都清空待确认 | FR-TEMPLATE-008（新增 AC-FR-TEMPLATE-008-04） |
| 导入 JSON | web-pc 与 admin 均移除按钮与前端导入流程；`/templates/new` 只做手动新建；后端接口 `source: "import"` 与导出保留 | FR-TEMPLATE-002/011、FR-SYS-140/142 |
| admin 从样例导入 | 列表页“从样例导入”→ 选目标（系统 / 客户租户）+ 上传 PDF/JPG/PNG → `/templates/samples/:id`（进度、取消、重试、删除）→ READY 后原件与候选并排，可改目标后“保存草稿”（`source: "sample"` + `sample_id` + 待确认项）；列表页显示本 admin 近 7 天样例 | FR-SYS-142（AC-FR-SYS-142-03 改写） |
| admin 样例后端 | 迁移 `0016_admin_template_samples`：`template_samples.tenant_id` 可空，新增 `created_by_admin_id`（FK admin_accounts）及“恰有一方归属”约束；路由 `/api/v1/admin/template-samples`（CSRF）；对象存 `samples/admin/<id>/`；同样文件头/20 MB/50 页校验、7 天保留与清理；**不预占、不扣任何客户配额**（平台承担）；仅创建者可见，其他 admin 404 并记失败审计；审计 actor=admin，只记 ID；不能用客户 OCR 结果建 admin 样例；保存后样例保留至删除/到期 | FR-TEMPLATE-014（新增 AC-FR-TEMPLATE-014-07） |
| 错误提示 | admin 新增 `err.storage_unavailable`、样例文件/重试/取消错误的中英文 | FR-SYS-142 |

以上默认值是负责人“中间不要询问”授权下的实施选择，已写入 delta spec；`openspec validate template-report-management --strict` 通过。

### 第二轮本地验证

| 检查 | 结果 |
|---|---|
| 后端 `tests/integration/test_admin_template_samples.py`（loopback `saiflow_test_full1`） | 4 passed：上传到 READY 不建预占、客户扫描数不变；坏文件/超页 422；他人 admin 全路由 404 + 失败审计；客户调用 admin 路由 401；CSRF 403；系统/租户草稿各一份并带待确认项，未确认生效 422 `template_unconfirmed`；他人或客户样例保存 404；取消幂等、重试 409、删除清对象、到期清理 |
| 后端 `test_template_samples`、`test_template_management`、`test_migrations` 与全部单元 | 501 passed；`ruff check` 通过 |
| `packages/ui` vitest | 30 passed（含批量接受/拒绝 2 项） |
| web-pc vitest（`--maxWorkers=2`） | 181 passed |
| web-admin vitest | `templates.test.tsx` 8 passed（新增：列表无 JSON 导入且列出本人样例；上传→样例页→保存为系统草稿的请求体）；并发全量时 6 个无关文件 11 项 15 s 超时，`--maxWorkers=2` 重跑 49/49 通过（本机 CPU 负载） |
| `pnpm -r lint`、web-pc/web-admin `tsc --noEmit` | 通过 |
| 本地浏览器 admin（5175，API 8010 已迁到 0016） | 列表只有“从样例导入”“新建模板”；对话框显示目标、文件与“平台承担、仅本人可见、7 天删除”说明；本地未配置 GCS，上传返回 503 `storage_unavailable` → 补充专门提示。READY 后的对照与保存在线上验证 |

### 第二轮部署与线上验证

| 步骤 | 证据 | 结果 |
|---|---|---|
| 提交 | `5be7f4c`（已推送 `chore/ai-workflow-v2`） | — |
| CI（run 42777000359） | backend、frontend、contract、scripts、stack | **全部 success** |
| Deploy（run 42777828784，2026-11-10 07:50Z） | 迁移前备份 `saiflow-20261110T075208Z.dump`（259,272 字节，本机 + `gs://saiflow-db-backup/`）；`alembic` 0015→0016 | **success** |
| 健康检查 | `saiflow-app`、`saiflow-admin`、`saiflow-line2` 三站 `/api/v1/health` | `{"status":"ok","version":"5be7f4c3…","database":"ok"}` |
| 新路由已注册（未登录只读探测） | `GET /api/v1/admin/template-samples`、`…/1` | 401（不是 404） |
| 线上 admin 前端包 | 含“从样例导入”、`ad-sample-viewer`（固定原件）、`storage_unavailable` 提示；不含“导入 JSON” | 符合 |
| 线上 web-pc 前端包 | 含“全部接受/全部拒绝”及其确认文案、`sample-original`（固定原件）；`tpl.importJson` 已移除 | 符合 |

**未执行（阻塞）：** 线上 admin 只能用平台管理员密码登录，web-pc 只能用 LINE 登录，本会话没有这两种凭据，所以没有在线上登录后操作。包括：真实 OCR/LLM 下样例到 READY、原件滚动时始终可见、批量接受/拒绝、admin 保存为系统/租户草稿、客户配额不变。这些项目只有本地 RTL/集成测试证据，需负责人登录管理员与测试 LINE 账号后补测。回滚：上一线上 tag `14ae4e9…`；0016 新增 `created_by_admin_id` 列、索引与两条检查约束，并把 `template_samples.tenant_id` 放宽为可空（只有 admin 样例为空）；旧应用不写 admin 样例，按旧 tag 重新部署即可，不执行生产 downgrade（downgrade 会删除 admin 样例行）。

## 后续小修：复核列表显式入口（2026-11-10）

负责人提供复核列表截图并要求修复入口，随后明确授权“提交并部署”。本小修映射 FR-SYS-123/124、FR-VERIFY-012：为既有详情导航增加固定右侧“复核”按钮；本人确认或本人已做一级复核时显示“查看详情”，中英泰文案明确需其他人复核，不改变自审限制、接口或数据库结构。

- 本地：新增入口键盘导航、本人确认及一级复核冲突三项回归；`reviews.test.tsx` 13/13、web-pc 全量 184/184 通过；eslint、tsc、Vite build、`git diff --check` 通过。浏览器截图因内置浏览器无可见视口未完成，RTL 不是线上账号验收。
- 提交 `16d0882`；[CI 42796782514](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/42796782514) 五项检查全部 success；[Deploy 42797734145](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/42797734145) success，目标 `38.60.156.234`。
- 部署前备份 `saiflow-20261110T102027Z.dump`（265,286 字节），服务器与 `gs://saiflow-db-backup/` 均完成；本次无新迁移。
- 部署后只读核验：三站健康均 `status=ok database=ok version=16d0882b3a769d40a132b631a0e9f557472638fe`；线上 PC bundle 含 `review.open`、“本人确认，需其他人复核”及对应英文、`action.viewDetail`。
- 线上登录后的点击与复核提交未执行（没有可用测试 LINE 会话）；没有修改业务数据。回滚应用可回到前一线上 `5be7f4c`，不执行数据库 downgrade。

## 报表恢复实施（2026-11-11，最终验证中）

### 本轮授权与隔离

负责人要求恢复报表、按推荐方式完成全部开发与全量测试后通知；断网暂停后明确“继续”。本轮授权仅包括实现、本地测试与证据同步，**未授权报表 Git 提交、推送、部署或归档**；模板/复核的历史发布授权不跨模块。本轮未操作生产、未调用付费 OCR，未改已部署迁移 0015/0016。

自动化 PostgreSQL 用 `127.0.0.1:25432/saiflow_test_*`，`REQUIRE_INTEGRATION=1 APP_ENV=test DEV_LOGIN_ENABLED=false DB_APP_USER=saiflow_v3_app`，禁用 OCR/reminders worker；fixtures 内再次验证 loopback 与库名前缀，运行角色与迁移角色分离。`saiflow_dev` 只用于已有独立合成演示数据的浏览器验证，不运行清表 fixtures。日志、脚本、截图、CSV 都在仓库 `temp/`，凭据不写证据。

### 已实现范围

- 后端：`report_service` 生命周期/独立权限/字段目录/精确卡片历史授权，`report_config` 完整静态校验，`report_query` 单 statement 参数化 JSONB/numeric 查询与同范围诊断，`report_query_service` 动态统计及 admin 合成预览，`report_csv_service` 聚合 CSV 与 60 秒会话绑定凭证；注册用户/admin 路由。
- 共享纯 UI：ReportDesigner、ReportGrid、ChartRenderer、ReportCardInfo/Details，完整 bar/line/pie/donut/metric/table；PC 设计/发布/只读网格，admin 组织配置与显式合成预览，LINE 已发布列表与单列卡片、期间/刷新/详情/CSV。无共享统计缓存、投影/预聚合、原始业务行导出或 admin 真实统计。
- 追加 `0017_report_card_refs`：report/kind/card/version 唯一引用；按当前草稿/当前发布配置回填，未匹配 NULL 旧引用仅保护删除，不能授权新图。不完整被拒绝的新绑定即使重复保存也不生成可用历史引用；模板锁内复查。降级先去重再恢复旧约束，配置与业务数据不变，未执行生产降级。
- 契约由脚本生成；实体/架构/术语同步 Data-Model、Architecture、Glossary；不在产品文档记测试或部署证据。

### 最终验证状态（CSV 发布版本与实际期间补修后全部通过）

最新完整结果为后端 **1,215/1,215**、前端 **787/787（81 文件）**、实际 API/三端构建浏览器 **1,225/1,225 检查（六阶段）**，均退出 0。以下 1,213 后端、781 前端及五阶段 1,157 浏览器属于补修前保留证据，不混入最新条数。完整前端旧日志保留为 `pre-csv-version-current-*.log` 与 `pre-csv-version-frontend-current-results.json`；旧浏览器 JSON/CSV/PNG 保留在 `browser-isolated/passed-before-csv-version/`；`current-*.log`、当前 JSON 与下表最新完整日志对应最终轮。

最新 `frontend-version-period-check.log` 的全工作区 lint/类型与三端生产构建已退出 0。完整前端 `frontend-version-period-full.log` 已退出0：七组任务全部成功，五包不重复用例 **787/787**、**81/81 文件**通过（UI162、api-client5、PC223、admin84、LINE313）；两项先跑报表专项 PC35/LINE38已包含在五包总数，不重复计数。后端前轮收集 1,215 项（`backend-version-collection.log`），在约35%出现两项失败，停止且保留 `backend-version-full.log`，确认仅本轮进程全部退出；只在 `127.0.0.1:25432/saiflow_test_full1` 用既有 guard 清理中断数据。未并行执行数据库测试。

`backend-test-boundaries-red.log` **2 failed，26.35 s**：提醒 CLI 测试继承 `REMINDERS_ENABLED=false`，实际输出 `reminders disabled; review mails 0` 而断言需1项；admin合成预览将全包做 `4321` 子串检查，固定合法微秒 `.432100Z` 可确定复现误判。旧全量未保存 traceback，不能证明旧时钟的具体微秒，但故障断言路径已被定向复现。修复测试显式启用自身 CLI（父 runner 仍禁用，禁用用例仍禁止创建）、固定仅预览时钟并独立断言 `generated_at`，其余全部响应字段继续检查无供应商/业务金额；不改变提醒或合成预览产品行为，不提高超时。`backend-test-boundaries-green.log` **3 passed，33.57 s**（含启用幂等及禁用检查），ruff 303文件通过。首次规范检查要求 datetime.UTC alias，已修正，未跳过规则。独立只读审查完整核对两个测试及直接实现：未发现业务值隔离弱化、CLI停用契约改变或预览时钟泄漏；审查未运行数据库/测试，不替代全量执行证据。

最新串行命令链已退出 0：完整后端 `backend-version-final-full.log` **1,215 passed，2,975.64 s（49:35）**，之后才执行 `browser-isolated/pytest-version-period.log`，**1 passed，328.61 s（5:28）**。两轮均无失败或跳过；浏览器保留 1 项既有 Alembic path_separator 弃用警告。仅两项测试环境/时钟断言修正，不改变产品行为或放宽测试超时；最终构建之后无业务代码修改。

| 检查 | 实际证据 | 状态 |
| --- | --- | --- |
| 当前后端全量 | `temp/report-run/backend-version-final-full.log`：`pytest tests -q -p no:cacheprovider --tb=short -rfE`，上述隔离环境；命令退出 0 | **1,215 passed，2,975.64 s**（49:35），无失败/跳过；包含全部单元及实际 PostgreSQL 集成。旧 `backend-current-full.log` 的 1,213 项仅为补修前历史 |
| 前轮单独单元 | `temp/report-run/unit-final4.log`：`pytest tests/unit -q` | **535 passed，29.49 s**；含下载访问日志脱敏，当前完整结果以上行为准 |
| 后端规范 | `ruff check app tests alembic`、`ruff format --check app tests alembic` | 通过，303 文件格式正确 |
| 安全/查询/迁移 | `security-final.log`：权限/CSV/查询/生命周期/0017往返/引用竞争 | **45 passed，633.37 s**；此前失败不计入通过证据 |
| 流水查询/撤权历史 | `query-stream-green.log`：全部查询及生命周期（含草稿/发布两种系统模板撤权、重复保存不能洗新卡权限） | **24 passed，199.81 s**；后端 SQL 单元 23 项通过 |
| 压力场景 | `temp/report-run/perf/perf-summary.json`、`perf-plans.txt`：20,000 正式合成单据、30 卡、两种粒度、全部六型，原 10 秒 statement 限制；明细中间转换 OFFSET 0 流水边界、终态共用 materialized CTE | **30 ok / 0 error**；两次整页串行查询 **42.09 / 40.42 s**，明细 EXPLAIN **3.461 s**，401 供应商分组。未降低数据量或提高超时；整页不是 10 秒承诺。此前 29 ok / 1 timeout 记录为失败，不计通过 |
| 最新三端规范/构建（含CSV版本/实际期间补修） | `frontend-version-period-check.log`：`pnpm -r lint` 与 `pnpm -r build`，命令退出 0 | **lint、全工作区类型检查、三端 tsc 与生产构建通过**（既有 chunk 大小警告）；较早 frontend-final/version/unpublication-check 为历史结果 |
| 最新完整前端（含CSV版本/实际期间补修） | `frontend-version-period-full.log`、`frontend-current-results.json`、`current-*.log`：受支持 Node 24.22.2，Vitest CLI `run --maxWorkers=1 --pool=vmThreads`，各包串行，七个任务均退出 0 | **787 个不重复用例全部通过**：UI 162、api-client 5、web-pc 223、web-admin 84、LINE 313；另先执行 PC reports 35、LINE reports 38（已包含在全包总数，不重复加总）。全部 **81 个测试文件**通过，无失败/跳过；未改全局 Node、测试配置或断言超时；此前781保留为补修前历史 |
| 当前独立真实 API/三端构建浏览器 | `browser-isolated/pytest-version-period.log`、`pytest-result.json`、`api-results.json`、`browser-results.json`；run_id `1b43e01065214d809087a6d7c9ac2273` | **pytest 1 passed，328.61 s；浏览器 1,225/1,225 检查，六阶段全部 completed/pass；父进程三项 API/DB 检查通过**。实际应用角色、RLS/认证/聚合/CSV/三个 dist；两端旧屏幕导出409、未到期旧票404、新票精确新口径、期间保持通过。两个主报表快照、业务行、生命周期与失败审计在 UI 删除后仍保留。外部 LINE/mail 为 fake；owned Chrome 正常关闭并 disconnected，1.074 s |
| 当前契约重复生成 | `contract-version-repeat.json`：placeholder OpenAPI 导出 + openapi-typescript 7.13.0，生成前后 SHA256 比较 | **repeatable=true**，JSON 与 TS 均完全一致；无数据库连接。当前文件 SHA256 见 CSV 补修段；旧 `contract-repeat-current.log` 仅为历史 |
| 前一版本构建浏览器 | `browser-built-version.log`：版本门禁与下载状态修复后的实际三端 dist + 本地已有合成报表；PC en/th/zh 1280/1440、admin en/zh 1280/1440、LINE en 320/360/390、th 320、zh 360；results.json 已由后续失败轮覆盖，不引用它证明旧通过 | **101/101 项通过，命令退出 0**（CSV、合成预览不请求客户统计、顺序、详情、无溢出/console errors）；真实 LIFF SDK，无 SDK mock。首轮 LINE 脚本遗漏 HashRouter 的 `#`，5 项导航超时属脚本错误，不计通过。实际 API 演示页含七卡、五种不同图型，不冒称真实六型或全部角色/异常浏览器 E2E |
| 前一版本六图型/长泰文浏览器补充 | `browser-six-types-version.log`、`temp/template-report-management/browser-built/six-types-results.json`：读取真实 API 形状后仅在浏览器克隆/拦截定义与结果，补 pie 和长泰文；LINE th 320/360/390、PC th 1280/1440 | **32/32 项通过，命令退出 0**；六种 renderer、四图形 canvas、键盘可聚焦完整表格、标题不翻译、无页面/canvas 溢出及 console errors。明确标记合成 fixture，无客户/报表写入，不作为真实六型数据 E2E |
| 仓库脚本与凭据扫描 | `scripts-current.log`：串行执行 `scripts/tests/*.test.sh`，TMPDIR 指向仓库 temp；`scripts/check-no-secrets.sh` | **12 套、212 passed / 0 failed**；tracked 凭据扫描通过，全部 CI shell 目标 `bash -n` 通过。部署/备份测试使用 fakes，并未部署生产或执行真实备份；本机 shellcheck 不可用 |
| CSV 异步边界回归 | `csv-race-red.log`、`pc-csv-race-red.log` → `csv-race-green.log`、`pc-csv-race-green.log`；Node 24.22.2、`--pool=vmThreads --maxWorkers=1` | **3 LINE + 2 PC 实际 RED → GREEN**：刷新交叠不吞 CSV 拒权；切租户后不保存迟到 Blob/不打开迟到 LINE 凭证。`csv-period-red.log`、`pc-csv-period-red.log` 两项实际 RED（重查期间误用导出时的旧值）已在 `before-version-line-reports.log`（27/27）、`before-version-pc-reports.log`（28/28）真实 GREEN |
| 版本门禁修复前前端已完成部分 | `frontend-before-version-results.json` 及 `before-version-*.log`，受支持 Node 24.22.2 单 vmThread、各包串行 | LINE reports **27/27**、PC reports **28/28**、共享 UI **162/162**、api-client **5/5**、PC 全量 **216/216**，各已完成命令退出 0。admin 运行期间独立审查发现“元数据先升版本”的旧统计混配及 PC 多卡 CSV loading 错位，主动停止本轮；停止后确认无本轮测试进程遗留。未完成 admin/LINE 全量，不称全工作区通过；新修复及新增回归需再次完整验证 |

补修前版本门禁截图采用最多 16 次连续渲染截图的稳定比较，不固定 sleep、不截取 ECharts 动画中间帧。该轮已人工打开 `line-mini-th-320-viewer.png`、`line-mini-en-390-viewer.png`、`web-pc-th-1280-viewer.png`、`web-admin-en-1440-synthetic-preview.png`，以及 LINE 320/PC 1280 的六型长泰文 fixture：饼/环完整，卡片无重叠；LINE 表格局部横向滚动而非页面溢出，长泰文可通过完整表格读取，admin 合成标记明确。业务英文标题保持原文是契约要求，不是遗漏翻译。此为历史截图；最新五张实际构建截图见后续最终六阶段记录。

以下补修前复查缺陷均已修复并纳入最终全量：下载凭证撤权/失效必须 404（直接鉴权导出仍 403）；坏表结构诊断须服从表头期间；历史授权精确到原卡片，重复保存不能洗权限；访问日志须脱敏凭证路径；PC/LINE 鉴权刷新失败必须清空旧统计和诊断，只有非鉴权失败可保留明确标记的旧数据。饼/环图负值判断使用同范围 SQL min_value，禁止同组正值遮盖负值（新增回归先失败、`pie-net-green.log` 1 passed，后续全查询回归亦通过）。复查另发现 PC/LINE 再发布版本匹配及 CSV 拒权的显示清理缺口，已补代码与回归：不同发布版本的统计不先绘制在旧定义上；CSV 401/403/404 清空统计，LINE 同时关闭详情，并独立重查查看权及配置，避免把 export-only 撤权误判为失去查看权。上述回归曾纳入补修前完整前端781/781，并已包含在当前787/787，最新结果见上表。PC/LINE worker 启动超时的尝试没有执行测试，不计为通过。本机 Node 25.8.1 不在 Vitest 5 的 engines（^22.12.0 / ^24.0.0 / >=26.0.0）范围内，fork 与 threads 均出现 60 秒启动超时。已在 temp 隔离 Node 24.22.2（镜像下载归档核对 nodejs.org 官方 SHA256：ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2），未改变全局运行时。兼容版本仍超时，进一步探针显示 jsdom 导入耗时 73.76 s，1,104 次同步读耗时 49.53 s、CPU 仅 6.84 s；本机高内存提交/分页，不能归因于已证明的杀毒软件问题。Vitest 的 threads/forks 在 jsdom 初始化后才答复 started，故触发固定 60 s 启动期限；受支持的 `vmThreads` 先完成启动再初始化环境，实测可执行真实断言，五项竞态回归已通过。完整套件采用这一 CLI pool、单 worker 串行运行，不修改依赖、配置、全局 Node 或放宽超时。

### 版本先更新与下载收尾补充回归

`metadata-first-pc-red.log` 的两项真实失败分别为新配置下仍残留旧 Bangkok 统计、两卡同时导出时第一卡不再禁用；`metadata-first-line-red2.log` 两项真实失败为 LINE 内/外新配置下仍残留旧 Bangkok。第一轮 LINE RED 的普通 heading 查询被旧详情 sheet 的 aria-hidden 遮挡，是测试定位问题，已改用 hidden heading 确认元数据更新，再得到上述统计断言失败，不将初轮定位失败当作行为 RED。

两端使用 render-time 发布版本门禁及 layout 清理，升版时清空旧统计、请求序列、下载，LINE 同时关闭旧详情；保持期间选择不重挂 Viewer。PC 逐卡 Map/controller 与 Set/loading 支持不同卡并发，同卡防重复；LINE 保持移动端单文件串行，并以 controller 身份核对 finally。保留快照 `metadata-version-line-green.log` 29/29、`metadata-version-pc-green.log` 30/30 包含上述四项真实 GREEN（`current-*.log` 用于新一轮执行，不以其覆盖后的内容引用旧条数）；同期共享 UI 162/162、api-client 5/5 通过。新增三项补充场景覆盖选期后升版、旧数据晚到、取消旧下载后新下载期间旧请求收尾，晚于前两份报告取文件时加入，须完整重跑最新两个报表测试文件。

随后 PC 全量为 218 passed / 1 failed（21 文件、219 用例），失败仅在新增补充用例读取刷新按钮时：`period-animation-full-pc-failed.log` 的 DOM 显示已退出 loading 状态的按钮仍有退场图标，可访问名称为 `loadingRefresh`，而测试同步查找精确 `Refresh`。改为 `findByRole` 等待仍失败（`period-animation-wait-pc-failed.log`：30 passed / 1 failed），不将该尝试计为 GREEN。Ant Design `DefaultLoadingIcon` 的 CSSMotion 使用 removeOnLeave，但此测试环境没有结束退场动画；为 PC 刷新按钮增加固定本地化 aria-label，使加载与退场状态的操作名称保持一致（FR-REPORT-013/FR-SYS-141），并保留同步精确 role 查询、新增 pending 状态名称断言。未放宽超时、改统计/下载逻辑或弱化期间/旧响应/新下载断言。

aria-label 小修的目标用例实际 GREEN：`period-lifecycle-pc-targeted.log` 为 1 passed / 30 skipped（34.30 s），包含 pending 状态名称断言，不将定向 skipped 称为完整测试通过。随后 `frontend-final-check.log` 的 lint/types/三端构建退出 0。此轮前端在独立审查发现下一项 409 缺口后主动停止：保留 `frontend-before-unpublication-results.json` 与 `before-unpublication-*.log`，LINE reports 31/31、PC reports 31/31、UI 162/162、api-client 5/5、PC 全量 219/219；admin 未完成、LINE 全量未执行，不称全工作区通过。

实际 aria-label 构建浏览器 `browser-built-final.log` 中四个 PC 场景挂起请求时操作名称均保持稳定，en1280 的真实刷新返回及设计器检查通过；en1440、th1280、zh1280 在释放请求后 waitForResponse 30 s 超时，整轮退出 1。后续 `browser-six-types-final.log` 未执行（前一脚本失败使 && 链停止），旧 32/32 不是此轮结果。

随后独立只读诊断实测：请求 gate 156 ms、route.continue 47 ms；未拦截首次查询 TTFB 30.177 s，同会话同参数 proxy 25.459 s、直连 27.423 s，全部 200/七卡无错误，因此不是刷新按钮名称或 gate 卡死。FR-REPORT-017 是**每条 SQL 10 秒**，run_page 串行查询各卡；整页 30 秒不是规格承诺。补充浏览器仅把整页响应预算按 `卡数×10 s+15 s` 推导（七卡 85 s），保留原 SQL 10 s 与请求发出 30 s，新增实际耗时、快照/卡数/全部卡无错误断言，不改变产品或 RTL 超时。随后 `browser-built-current-final.log` **109/109** 与 `browser-six-types-current-final.log` **32/32** 全部通过（&& 链退出0），日志 JSON 已核对无失败项；前者多出的8项为整页实测响应/快照卡数断言。此结果仍为后续 CSV 发布版本/实际期间补修前构建，不冒称最新代码通过。

OS 只读采样显示并行验收期间 CPU 79%→100%、可用内存 1.4→1.2 GB、提交率 91%，测试 node24 子进程约 1 GB；这只能支持资源竞争的可能性，不能证明单一根因。完整前端结束后的独立真实 API 最终轮，全部 HTTP 最大 0.663 s，无 ≥0.5 s SQL，亦不据此作生产性能承诺。

### 撤销发布与挂起下载补充回归

实际服务端对 owner 查询已撤销发布报告返回 409 `report_not_published`。新增挂起下载回归先得到真实 RED：`unpublished-csv-pc-red.log` 1 失败（仍创建 Blob），`unpublished-csv-line-red.log` 2 失败（LINE 外仍创建 Blob、LINE 内仍打开凭证）。随后两端 CSV 拒绝 409 回归各失败 1 项：旧 Bangkok 统计仍在，LINE 详情未清理，见 `unpublished-csv-refusal-*-red.log`。

刷新和 CSV catch 将特定 `report_not_published` 与 401/403/404 同样视为不可用，清空统计、递增序列并取消下载，LINE 同时关闭 sheet；不把全部 409 或普通查询错误视为权限撤销。`unpublished-csv-pc-green.log` **2 passed / 31 skipped，69.42 s**；`unpublished-csv-line-green.log` **3 passed / 31 skipped，35.52 s**，共 5 项真实 RED → GREEN。随后完整轮 `frontend-unpublication-full-run.log` 七项任务均退出 0，PC reports **33/33**、LINE reports **34/34**，五包不重复总数 **781/781**；撤销发布修复后的 `frontend-unpublication-check.log` lint/类型及三端生产 build 已退出 0。定向 skipped 不算完整轮 skipped。

### 独立真实 API 浏览器验收（补修前五阶段历史通过）

本节记录 CSV 发布版本补修前五阶段；历史 JSON/CSV/PNG 已保留在 `temp/report-run/browser-isolated/passed-before-csv-version/`，当前同名 JSON 属于后续六阶段，不能用来证明旧条数。主会话完整审阅 `temp/report-run/browser-isolated/` 的 pytest fixtures、真实 API 父进程与实际 dist 浏览器子进程。独立目标为 `127.0.0.1:25432/saiflow_test_browser`，API 8021、三端 6273/6274/6275，不借用开发 API 8010、不修改 saiflow_dev、不触及生产。准备阶段先检查空 schema、现有应用角色及登录/CONNECT，随后仅在该空测试库执行现有迁移到 0017；`preparation-result.json` 为 pass，五张业务表均 0 行、role_reset=false。未调用 shared fixture 的 cluster-wide ALTER ROLE。首次临时脚本因缺 PYTHONPATH 在导入前退出、未连接数据库；显式使用 services/api 后准备通过。pytest collect-only 实际收集 1 项（7.26 s），不称为测试通过。

首次实际 pytest 退出 1（`pytest-first.log`，8.48 s）：在业务 fixture 建立前绑定 8011 遇 OSError，api-results.json 无通过检查。只读确认 8011 是无关 node 服务，未停止它；8021 与 6273/6274/6275 独占绑定探测可用，临时工具改 API 为 8021，不再运行只允许空 schema 的准备脚本。

后续失败保留而非隐藏：`pytest-8021.log` 33.98 s 在初始发布前失败，安全源码栈定位及仅 card_id/path 的拒绝诊断显示五张多版本明细卡遗漏表路径 `lines.items` 的业务确认；修正临时 fixture 的 confirmed_paths，不弱化服务端校验。`pytest-confirmed-tables.log` 139.60 s 完成 PC 生命周期与 admin 英文合成，中文切换被 context 初始化重置为英文；修为独立 zh context，保留语言/合成隔离检查。`pytest-zh-context.log` 135.67 s 出现 admin 列表代理 25 s/502，未放宽 HTTP 超时，追加不含参数/原值/凭证的路由与 SQL 耗时观测。`pytest-http-sql-timing.log` 317.23 s 五个业务阶段全部通过，但 owned Chrome 关闭超过人为 4 s 清理预算，整轮仍记失败（分别保留 `*-admin-zh-init-failed.json`、`*-admin-list-502.json`、`*-chrome-close-4s-failed.json`）。正常 browser.close 清理预算改为有界 30 s，并新增 disconnected 与实测耗时断言，未修改任何业务请求/测试超时。

**最终 `pytest-final.log`：1 passed、219.73 s，1 项既有 Alembic path_separator 弃用警告**。`browser-results.json` 1,157/1,157 检查、五阶段全部 completed/pass，API/DB 三项检查全部通过；owned Chrome 实际正常关闭 1.286 s 且 disconnected，无 cleanup_error，无远程生产/非 SDK 请求。实际构建 SHA256：LINE `53e0c3408b3f6f7e158d9770877ce61d84521a1b55e6180f6fbbc935b7bb8d20`；PC `97034948edf3f14373bd7da99087a8b53bafa9bf227631c596d8549bbb0f1589`；admin `d49cbb06e79c187adc38257f24e4e5bd8ef4f2380ad67b1df69ec1e5f86107db`，父子进程对所有 dist 文件独立核对。

组织/订阅/角色/正式单据由既有隔离 DB helper 建立，注册/模板/报表/权限/统计/CSV/三个构建 UI 为真实接口；外部 LINE 验证与邮件送达为 fake，LIFF SDK 不 mock。12 卡、两个模板、显式多版本、两粒度、五聚合和多系列由独立有限 Decimal oracle 逐卡比对完整行、状态、实际期间及诊断；新增正式行后真实 UI 刷新改变统计而无需重发。PC 保存名称/标题/样式/键盘位移缩放、P1 不可变、P2 精确发布、不完整发布422保护、离页与409保留、六型 palette 创建/删除均通过。admin en/zh 只查合成预览且无客户 data/CSV 请求；PC/LINE 同 P2、期间/复位/刷新、6类权限身份、本人/全部范围、CSV 精确行和元信息、外组织404、撤销/删除入口与直链均通过。删除后两快照、原业务行及 create/save/publish/preview/view/refresh/csv/unpublish/delete 成功审计与失败发布审计完整保留。

稳定截图已人工打开 `line-mini-owner-th-320.png`、`web-pc-owner-zh-1280.png`、`admin-zh-synthetic-only.png`：六型实际渲染、长泰文可通过完整表格读取、LINE 单列/PC 原网格无重叠/页面溢出，admin 合成标记明确。CSV 使用完整 BOM/引号解析并独立 Decimal oracle 比对，不仅检查文件存在。初始主数据配置通过真实 API 辅助建立，六型 palette 确实由 UI 添加/保存，但不冒称全部字段都手工配置；未遍历六型×五聚合×两粒度/角色×语言×宽度完整笛卡尔积，也未以截图替代后端异常/额度/凭证到期等测试。

### CSV 发布版本一致性补修（最终全量及实际浏览器已通过）

独立收尾审查发现：页面仍显示 P2 而另一管理会话重发 P3、保留 card ID 但改变指标时，原 CSV 请求只带卡片/期间，可能导出 P3 口径。按 FR-REPORT-016 的“版本与查看一致”修复，不新增需求。两端下载始终携带屏幕 `report_version`；服务端对实际用于查询的不可变快照比较，直接 CSV/凭证签发错版返回 409 `revision_conflict`。凭证 HMAC 签名同时绑定发放快照版本，兑换时再用同一查询入口比较，跨版或撤销统一 404；同版本仍查询当前正式数据，不冻结业务行。前端特定版本冲突清空统计/下载并独立重查当前期间及发布元数据，不把普通 409 查询错误全部当作撤权。

后端 `csv-published-version-red2.log` **2 failed / 5 deselected，16.13 s**；首轮第二用例期望只含 March 但默认年补空桶，是 fixture 期间遗漏，补明确 March 期间后再得到该 RED。实现后 `csv-published-version-green.log` **7 passed，51.40 s**，包含旧屏幕直接 CSV/签发拒绝、同版本新增正式行后凭证精确导出、重发后旧凭证404。这七项已包含在最终完整后端 **1,215/1,215**；失败停止的 `backend-version-full.log` 保留作历史，最终依据为 `backend-version-final-full.log`。

前端真实 RED：`pc-csv-version-red.log` 1 failed / 33 skipped，请求缺版本；`line-csv-version-red.log` 2 failed / 34 skipped，外部 query/内部 ticket body 均缺版本。首轮完整 PC `pc-csv-version-green.log` **20 passed / 14 failed**，新增调用误用未定义 `published.version` 导致 CSV 请求未发出，并非机器负载或测试超时；已改两端既有本地 `version`，保留失败证据并重新执行两端专项及五包全量 `frontend-version-full.log`。未放宽断言/超时。最新契约 placeholder 导出与生成已退出0（`contract-csv-version.log`），类型、完整套件、构建及实际 dist 浏览器须全部复验后方可交付。

独立审查追加默认期间跨年边界：用户覆盖为 null 时，页面已有实际 2025 年统计，但导出在新年可能重新取默认 2026。新增 `web-pc-csv-actual-period-red.log` **1 failed / 34 skipped** 与 `line-mini-csv-actual-period-red.log` **2 failed / 36 skipped**，确认为 query 缺 from/to、ticket period 为 null 的真实 RED。两端改传匹配发布版本的 `result.period`，用户期间选择仍为 null，不改变打开/手刷默认规则；重查仍用当前用户选择。既有下载测试同步核对实际期间而非无过滤。旧前端轮只完成 LINE 36 项，后因新边界停止并保留 `before-actual-period-*`，不称完整通过。最新完整前端 `frontend-version-period-full.log` 已退出0，五包 **787/787**、81文件全部通过，PC报表35/35、LINE报表38/38（专项包含在全量，不重复计数）；类型/规范/三端构建 `frontend-version-period-check.log` 已退出0，全部包规范检查及三端 tsc/生产构建通过，既有第三方 chunk 警告未隐藏。仅当前 UI 下载固定实际期间，不宣称旧 API 的 null-period 调用新增服务端默认期间冻结。

六阶段实际浏览器已在完整后端通过后串行执行并通过：两个独立管理/查看会话、旧屏幕CSV409、期间保持、旧凭证404及新凭证精确新口径均有实际 API 和 UI 证据。运行前审阅发现临时清理 DELETE 将 revision 放 body，已按真实接口改为 query；旧票404后额外核对签名载荷的到期时间尚未到达，避免过期假阳性。该载荷仅内存读取到期时间，不记录凭证/用户/会话字段；JS/Python 票据路径均脱敏，临时 fixture 显式使用测试签名密钥。

补修契约再次自动导出与生成（`contract-version-repeat.json`），**repeatable=true**；当前 OpenAPI SHA256 `90b89261f14ef4324986187d33e43ec8ddee4767bb9cc0f010df2d1577d3385b`，生成 schema.ts SHA256 `ca0d48d3400e1aa649651f23d0fbf8edbf1356c936e8b7cb7685936051528b83`。placeholder 导出不连接数据库，无手工编辑生成物。

### 最新六阶段实际构建验收与收尾

最终 `browser-isolated/pytest-version-period.log`：**1 passed，328.61 s**；`pytest-result.json` 为 pass、退出 0、仅收集 1 个 pytest 用例，不能将浏览器内部检查数当成 pytest 数。`browser-results.json` 的 **1,225 项检查全部通过**、六阶段 completed/pass；`api-results.json` 三项独立 API/DB 检查均通过，run_id 均为 `1b43e01065214d809087a6d7c9ac2273`。实际目标只为 `127.0.0.1:25432/saiflow_test_browser`，外部 LINE 验证/邮件为 fake，未调用生产或付费 OCR。

两端真实竞态使用辅助报表 P1 平均值、同 card ID 重发 P2 求和：旧票重发前可用，重发后尚未到期即 opaque404；旧页面下载携带版本1得到409 revision_conflict、没有创建下载，随后自动取得 P2，March 期间保持、统计及新票 CSV 与独立 Decimal oracle 精确相符。P2 示例为 **285.98 THB**。辅助资源按真实 revision query 删除；主报表两个不可变快照、业务行和全部生命周期/失败审计在 UI 删除后保留。

当前三端 dist SHA256 由父子进程独立核对：LINE `3e1c33096eb8192874a6805da1231ce17d0abc029ac3c3f69e0d12d3b1a07355`；PC `eb0163b022e47c9dfe673fdc458efe95ffdcd37dc8d706abc6bdfc6c1ae0e3a4`；admin `d49cbb06e79c187adc38257f24e4e5bd8ef4f2380ad67b1df69ec1e5f86107db`。28 个浏览器上下文均无 pageerrors；console 错误条数逐上下文与刻意触发的失败 HTTP 预期完全一致，不宣称错误数组为空。无意外 network 记录；全部 HTTP 最大 1.115 s，仅作本轮观测，不承诺生产性能。owned Chrome 正常关闭且 disconnected，1.074 s。

最终已人工打开当前五张截图：`line-mini-owner-th-320.png`、`web-pc-owner-zh-1280.png`、`admin-zh-synthetic-only.png`、`web-pc-csv-version-conflict-recovered.png`、`line-mini-csv-version-conflict-recovered.png`。六型实际渲染、饼环完整、长泰文可通过表格读取；LINE 单列/PC 原网格无重叠或页面溢出，admin 明示合成数据；两端恢复后均为 P2、March 与精确新统计，未残留旧详情/旧统计。业务标题保持原文，不把测试中修改聚合后未改自定义标题当作翻译缺失。冲突 toast 是刻意触发的409反馈，不是未解释异常。

测试完成后仅同步实施计划与本验证记录，不修改业务代码，不重跑昂贵全量测试。自有 6173/6174/6175 构建预览已按确认的本轮进程树关闭；独立验收 8021/6273/6274/6275 未遗留监听，不停止无关开发服务。最终规范/安全/迁移及 OpenSpec 检查结果见后续收尾记录。

### FR/AC 对应实际用例

以下表格给出实际用例落点；执行状态以上表及后续最终记录为准，存在待复测时不宣称 AC 全通过。

| AC 范围 | 实际测试文件与关键用例 |
| --- | --- |
| REPORT-001-01/02、002-01、003-01/02/03 | integration `test_report_access`：`test_viewer_sees_published_reports_of_own_org`、`test_gate_and_rights_match_direct_requests`、`test_results_follow_the_callers_scope`、`test_admin_configures_with_synthetic_preview_only`；三端 reports RTL 的入口/范围/来源/实际期间 |
| REPORT-004-01/02 | `test_access_is_audited_without_values`、`test_a_slow_statement_times_out_and_is_audited`、生命周期审计；unit `test_report_ticket_is_redacted_in_access_logs` |
| REPORT-005-01/02、006-01/02/03 | unit `test_valid_cards_of_every_type`、`test_multi_version_needs_same_path_same_type_and_confirmation`、`test_catalog_compatibility`；integration `test_manage_and_view_are_separate`、`test_explicit_versions_and_confirmed_paths`、`test_incompatible_versions_are_refused`、`test_bound_versions_outlive_disabling_but_no_new_bindings`、`test_system_grant_revocation_preserves_only_the_bound_card`（草稿/发布两场景，撤 Starter 授权后历史卡可用、新卡/新报表/重复保存均不得洗权限）；UI model 六型/布局/切模板/版本确认 |
| REPORT-007-01/02、008-01/02 | `test_only_formal_results_of_the_job_itself`、`test_document_and_table_grain_do_not_double_count`、`test_broken_and_empty_tables_are_diagnosed`、`test_structure_diagnostics_follow_the_header_period`；unit SQL 精确关联/单表展开/参数绑定 |
| REPORT-009-01/02、010-01/02 | `test_aggregations_and_counts`、`test_series_by_one_category_and_type_checks`、`test_period_boundaries_default_year_and_override`；unit count/类型/泰国年/期间规则；PC/LINE 整页覆盖 RTL |
| REPORT-011-01/02/03/04 | `test_exact_amounts_and_historic_formats`、`test_excluded_values_and_valid_average`、`test_unknown_category_and_empty_buckets`、`test_forged_configuration_is_refused`；unit 安全类型/路径/数值日期 SQL 与 client_flags 不扩权 |
| REPORT-012-01/02、013-01/02 | `test_mixed_units_are_refused_unless_grouped`、`test_negative_values_in_pie_charts`；unit 配置规则；ChartRenderer 精确值/显示精度/样式；model 本地化默认名、三端语言资源与业务标题保持原文 |
| REPORT-014-01/02/03、015-01/02 | `test_incomplete_draft_keeps_the_published_page`、`test_publish_is_immutable_then_unpublish_and_delete`、`test_stale_revisions_conflict`、`test_published_pages_query_current_formal_data`；PC/admin 保存/先保存后发布/409 RTL，PC/LINE 手动刷新/失败旧标记/鉴权失败清空 |
| REPORT-016-01/02/03、017-01/02 | integration `test_report_csv` 全部七项（同范围/公式安全/60秒/篡改退出撤权套餐到期/无密钥，以及 `test_csv_and_ticket_refuse_a_different_screen_version`、`test_ticket_cannot_change_published_version_at_redemption`），`test_group_limit_is_exact`、`test_page_capacity_30_cards`、`test_a_slow_statement_times_out_and_is_audited`；UI 独立导出权/下载与失败提示；PC/LINE `honours a pending CSV denial even after an overlapping refresh starts`、`does not deliver a late CSV…after a tenant switch`、`rechecks export-only revocation using the currently selected period`、`does not deliver a pending CSV…after refresh reports unpublication` 及 CSV 409 `report_not_published` 清理回归 |
| REPORT-018-01/02、SYS-056-01..06、SYS-141-01/02/03 | ReportGrid 排序/尺寸/键盘，ChartRenderer 六型/长标签/空错误/ResizeObserver；LINE reports RTL 单列/四底栏/切租户/迟到响应、PC reports RTL 设计/只读/权限；前轮浏览器多宽度截图与 CSV |
| SYS-139-01/02、SYS-002 既有全部角色场景 | tenancy roles/access/members 与 `test_delegated_manage_and_immediate_revocation`：固定 permission 目录、旧默认角色保持、manage/view/export/browse 分离与即时撤权 |
| SYS-143-01/02 | admin reports RTL 与 integration `test_admin_configures_with_synthetic_preview_only`：组织配置 CRUD/CAS、只用合成预览，不注册真实统计/CSV 路由 |

### 最终收尾检查（2026-11-11）

`openspec validate template-report-management --strict` 实际通过；`git diff --check` 退出0，仅既有CRLF规范化提示。`git diff --exit-code HEAD --` 对已部署0015_reporting/0016_admin_template_samples无差异；AGENTS/AI-WORKFLOW、OpenSpec配置、pnpm workspace及后端pyproject无差异。未修改权限配置或跳过hooks。

`scripts/check-no-secrets.sh` 追踪文件凭据材料扫描通过；另对排除`temp/`、`.qoder/`、`docs/10-product/user-manuals/`后的71个未追踪正式文件做同类service-account/private-key材料扫描，无命中；这是限定模式扫描，不声称能证明任何未知格式秘密绝对不存在。当前OpenAPI及生成TS的实际SHA256与上文重复生成结果完全相符，五张当前PNG均存在且非空。主会话重新断言1225项检查全部pass、六阶段completed、三项父进程检查pass/同run_id、pytest退出0及console预期一致。

自有6173/6174/6175预览退出；8021/6273/6274/6275验收监听也为0，只清理本轮已确认的进程树，不操作无关开发服务。实施计划已标记报表本地完成，模板隐私/完整混合矩阵/部署与备份等未验证项保持未勾选。没有业务代码后续修改，不用旧结果替代新结果，也不再重复运行已完整通过的昂贵测试。

### 本地交付时未授权或未覆盖（发布授权前历史）

本地交付结束时未提交、推送、部署、生产迁移或线上 LINE 验收；随后新增的明确发布授权及执行结果以下一节为准。历史模板真实 OCR/LLM、GCS 历史副本/七天保留及线上登录验收缺口仍保留，报表完成不会自动解决这些模板缺口。实际浏览器未遍历每一种角色与全部异常数据组合，此类证据来自 RTL/隔离 PG 集成而非截图。语言扫描前轮的 6 项英文品牌 eyebrow 被人工判断为品牌文案，并非未翻译功能错误，不宣称原始扫描全绿。

### 报表正式发布（2026-11-11，已完成）

负责人在本地全量交付后明确回复 **“提交并发布”**，授权本轮报表实现及已验证配套修复的提交、推送与现有 GitHub Actions 正式发布；不沿用模板的旧授权。仅操作既有发布分支 `chore/ai-workflow-v2` 和生产 `38.60.156.234`，不直接 SSH 修改服务器，不使用生产测试 fixtures，不运行付费 OCR 或登录后业务写入，不归档含模板隐私/混合未覆盖项的整个 change。

代码提交 **`2a33b61179b27b13f377925a3bdbcbef4f76c218`** 已推送，121 文件；`.qoder/` 与 `docs/10-product/user-manuals/` 明确排除，提交后只剩这两类未追踪本地文件。暂存检查发现 PC ReportViewPage 多余 EOF 空行，已仅移除该空行，未改逻辑；随后云端 CI 重新执行完整门禁通过。

[CI 42983209132](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/42983209132) 对上述精确 SHA **completed/success**，backend、frontend、contract、scripts、stack 五项全部 success，2026-11-11 08:03:59Z 完成最后一项。触发前再次核实远端分支仍指向同 SHA。GitHub CLI 通过已有 Git credential manager 仅进程内取得认证，不输出或落盘凭据，不新增 auth 配置；临时 launcher 只允许审阅过的发布命令，禁止 auth token 等凭据输出命令。

GitHub Variables 已实际核实：VPS_HOST 为 `38.60.156.234`，APP_HOST=`saiflow-app.aibaba.asia`、ADMIN_HOST=`saiflow-admin.aibaba.asia`、LINE_HOST=`saiflow-line2.aibaba.asia`。发布前真实三端健康均为 status/database ok，原版本 `83feba5f0f29c74d240a52cabf7705aaccf98805`。现有 remote-deploy 脚本在迁移前执行本地 dump 与 GCS 上传，任一步备份失败即停止迁移；本轮未修改部署流程或已部署0015/0016，仅追加0017。

[Deploy 42984238639](https://github.com/aibaba-go/saiflow-monorepo/actions/runs/42984238639) 于 08:05:09Z 通过既有 workflow_dispatch 触发，headSha 为上述精确代码提交；**completed/success**，deploy job 于 **08:10:07Z** 完成。四个同 SHA 镜像构建/推送、迁移与重启、三站 smoke、外部数据库端口检查及 runner SSH key 清理全部 success。实际状态/日志保存于 `temp/report-run/deploy-report-release.json`、`deploy-report-release.log`，未手动 SSH 部署或重复触发。

已逐项核对生产日志：08:09:24Z 写入 **`saiflow-20261111T080924Z.dump`、274,534 bytes**，08:09:29Z 成功上传 `gs://saiflow-db-backup/`；上传成功后才开始 migration，08:09:32Z 实际 **0016 → 0017**，08:09:45Z remote-deploy done，精确 SHA 一致。08:09:59Z 三端 HTML 200 text/html、status/database ok、version 均为 `2a33b61179b27b13f377925a3bdbcbef4f76c218`；08:10:04Z 外部 **5432 closed**。只追加0017，未改已部署0015/0016，不执行生产 downgrade 或恢复演练。

云端精确提交的 CI 日志另存 `temp/report-run/ci-report-release.json`、`ci-report-release.log`：后端 **1,215 passed / 335.36 s**，Node24 正常 `pnpm -r test` 前端 **787/787、81文件**（api-client5/UI162/LINE313/admin84/PC223）；脚本 **212 passed、12 suites、0 failed**，shellcheck/凭据材料扫描、ruff、契约一致性、三端构建均成功。CI 临时 Docker stack 实际升级0001→0017并通过三站 smoke，独立 dump/restore 的 `restore-check OK` 验证恢复库中 saiflow_v3.alembic_version 一行；这是 **CI 可丢弃库恢复证据，不是上述生产备份的恢复演练**。未验证生产备份校验和、保留策略实效或完整可用回滚镜像摘要，混合 D04/D05 checkbox 保持未勾选。

08:18:53Z 开始的最终线上只读检查 `temp/report-run/production-readonly-results.json` **pass=true、34/34检查通过**，仅允许 GET/HEAD/OPTIONS，禁用 Service Worker，无已有 Cookie、不提交登录或业务表单。再次独立核实三站精确健康版本及 HTML/JS 200，生产入口分别为 PC `index-CkwG6Z0J.js`（1,892,199 bytes）、admin `index-tboSjV7b.js`（1,564,214 bytes）、LINE `index-ClXkUUz_.js`（785,885 bytes）；三个实际入口包含静态报表路由/API，客户端含 CSV report_version、admin 含合成预览调用。报表页直接静态导入，没有独立报表 lazy chunk；不把后端健康版本单独当作前端逐字节制品哈希证明。三站匿名报表 API 均401，无效 CSV 票均 opaque404，未生成真实 CSV、游客或业务记录。

最终三张截图均已实际打开：`production-web-pc-public.png`、`production-web-admin-public.png` 的匿名登录页可读、无重叠；`production-line-mini-public.png` 是 **刻意阻止游客创建后的启动错误页，不是正常 LINE 首页**。实际网络记录明确 GET `/api/v1/me`→401、唯一被阻止写请求为 POST `/api/v1/auth/guest`；源码 boot 在该游客创建之后才执行 LIFF init，阻止请求被 call 映射成网络错误并显示 Retry。因此仅验证受限错误状态渲染，不声称生产游客会话、真实 LINE 登录/LIFF 或登录后报表/CSV E2E 通过。三端均无 pageerror，自有 Chrome 正常关闭并 disconnected。

临时 checker 初轮错误假设生产存在报表 lazy chunk，查实际入口与静态 import 后修正；第二轮遇20秒入口下载超时，独立 curl 得到 admin JS 200 / 1,564,214 bytes / 4.863 s 后将只读下载窗口改为60秒，未修改产品或测试配置。两次失败结果保留为 `production-readonly-before-bundle-fix.json`、`production-readonly-before-network-window.json`。截图复核发现先前通用“有文本”判定不能证明 LINE 首页启动，追加真实401/被阻止游客POST与精确错误状态断言并重跑，前轮结果另存 `production-readonly-before-boot-boundary.json`，只以最终34项及上述限制为结论。

发布收尾仅同步本计划/验证证据并作新的文档提交，不 amend 代码提交、不再部署文档提交；生产继续明确记录为 **2a33b61**。`.qoder/` 与用户手册不纳入，未合并 main、未归档整个混合 change；报表发布不会自动补齐模板历史隐私与外部真实调用缺口。
