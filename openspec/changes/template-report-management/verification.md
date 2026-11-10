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
