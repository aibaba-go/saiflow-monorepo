# Tasks（v2）

> 后端命令在 `services/api/` 内用 `.venv/Scripts/python` 执行；隔离测试不导入 `app.py`、不连接共享库，增量迁移测试只提取白名单常量/纯规划函数。临时产物放 `./temp/`。追溯：FR-TEMPLATE-001..005/007、FR-OCR-018..021、FR-VERIFY-018..020、FR-ENTRY-002。
>
> 2026-10-31：开发与隔离验证已完成；真实供应商/真机端到端、真实模型基线及发布仍待完成。勾选表示对应实现及注明的隔离验证完成，不表示已上线或通过真实 PostgreSQL 多实例验收。

## 1. 数据模型与迁移（D1、D3、D5、D7、D8）

- [x] 1.1 新增 `document_templates`、`document_template_versions`、`ocr_raw_results`、`template_mappings` 与表/列注释；作用域/code 部分唯一索引；隔离建表、作用域和仓储测试通过。
- [x] 1.2 新增任务 current/pending 指针、结果 mapping_id 及增量迁移规划。测试覆盖旧行三列均为空、列规划重复执行无副作用；纯规划 AST 白名单测试和 SQLite 可空列 DDL 不等于真实 PostgreSQL 迁移验证。
- [x] 1.3 共享库只读重复当前版本核查完成：`transaction_read_only=on` 下 SELECT，`duplicate_current_jobs=0`；索引缺失时规划创建，存在重复时跳过的两分支测试通过。共享库未执行 DDL，不能据此声称索引已创建。证据：`temp/template-current-check.json`。

## 2. 模板结构校验与版本（document-template）

- [x] 2.1 `doc_templates/schema.py` 覆盖四类型/缺省值、key/code、唯一性、上下限、多路径错误。
- [x] 2.2 仓储规范化 JSON/SHA-256、幂等导入与不可变升版、启停/软删除、系统/租户可见性及历史版本；隔离测试通过。

## 3. 后台维护脚本与种子（R1、D4）

- [x] 3.1 CLI `list / show / validate / import / export / enable / disable / delete / seed`、确认/`--yes`/`--dry-run`/审计；测试覆盖取消、dry-run、无变化不写库、非法输入和 validate 不访问数据库。
- [x] 3.2 两份系统模板已获业务批准（2026-10-30），正式离线 `validate` 均通过：`system.billing_note`（6 组/22 项）与 `system.tax_invoice`（7 组/34 项，含合并送货单）。Q1 首批种子已解决；其他类型待补样本。共享库 `seed` 尚未授权或执行，业务批准不等于已写入共享库。

## 4. OCR Worker：原始结果与开关（D5、D6）

- [x] 4.1 默认关闭开关、低分初始阈值 0.7、映射上限 5。
- [x] 4.2 整理前深拷贝 llm_json 与 v1 同事务持久化；开关关闭保留原整理路径，开启跳过整理并在存在候选时创建 AUTO；Worker 与 TextIn 重试回归通过。

## 5. 匹配与转换（D9、D10、D11）

- [x] 5.1 LLM 封装每阶段最多两次调用/2 秒退避/超时/错误码/用量；MockTransport 测试通过，无真实模型调用。
- [x] 5.2 单候选跳过匹配、多候选紧凑目录/白名单/得分/修复重试、60,000 字符上限；mock 测试通过。
- [x] 5.3 骨架转换、parse_float=str、按 schema 投影/补 null/丢弃额外模型键、500 行上限；mock 测试通过。
- [x] 5.4 四类型标准化、精度/类型警告及已有行必填检查；空表不虚造行，数值精度测试通过。

## 6. 映射 Worker（D7、D8、D12）

- [x] 6.1 条件认领、状态流转、阶段关联重读、READY 分支 max+1、pending/base/未确认自动生效门禁；重复认领、期间编辑/新请求/确认、保留 job 但关联已删除中止测试通过。多实例真实数据库并发未验收。
- [x] 6.2 启动及周期卡住恢复、开关关闭不启动；恢复测试通过；现有后端 README 明确本地必须保持开关关闭。

## 7. API 与导出（D13、D15、D16）

- [x] 7.1 只读版本/候选查询、会话与租户边界、历史版本、公开 description 裁剪；内部快照保留完整描述。
- [x] 7.2 apply 的 READY 200/处理中复用202/新建202/错误码/上限/关闭开关/乐观并发及通用切回；失败重试 force=true；对应接口测试通过。
- [x] 7.3 results 元数据/validation、max+1、归属/结构补齐、保留人工 extras、422 无写入、确认门禁与 match_feedback；原结果回归通过。
- [x] 7.4 模板摘要、同任务锁删除 results/raw/mappings 并清指针（保留 job）、关联重读中止；每次合法显式通用选择均审计，已通用不新增版本；测试通过。
- [x] 7.5 正式 XLSX/CSV/TXT/JSON 导出：绑定导出创建时的当前结果版本；模板 XLSX/CSV 顺序/名称/类型及 extras，JSON 原样 structured/application/json/.json，TXT 与通用旧行为保持；三类 JSON 下载与内容测试通过。
- [x] 7.6 OpenAPI YAML 与 JSON 镜像同步；四类型与 JSON 格式一致；321 本地引用、49 paths、63 schemas 校验通过。

## 8. 前端 line-mini（D14）

- [x] 8.1 API 类型/函数与 schema 分区/顺序；`pnpm --filter saiflow-line-mini-app build`（vue-tsc + Vite）通过。
- [x] 8.2 schema 顺序/名称/必填/模板字段保护/精度/数值键盘，人工 extras 与行增删；无 schema 兼容；35 离线断言及浏览器场景通过。
- [x] 8.3 选择/预览/推荐/得分/已生成、脏稿保存切换、pending/失败/上限/低分/必填/422 输入聚焦、有旧 READY 时 force 重试；浏览器场景通过。
- [x] 8.4 处理页 90 秒、结果页 10 分钟轮询、最终只读/历史模板名、en/th；浏览器与 14 双语后端错误文案检查通过。

## 9. 集成验证

- [x] 9.1 最终全后端隔离测试 **822 passed in 93.15s**（包含 JSON/显式通用审计/增量迁移补测）；新增模板模块及三个测试文件 Ruff py310 全通过。此前 816/819 为历史批次，不另加到 822。证据：`temp/template-verification.json`。
- [x] 9.2 前端 vue-tsc/Vite 构建通过；真实视图/状态/CSS 在全合成 API 下 **32/32 浏览器场景**通过；手机 320/375/430 与宽屏 430 iframe 已核对；无 unknown API/pageerror/未处理服务请求、源码漂移或真实数据库/供应商调用。证据：`temp/template-ui/report.json`。
- [ ] 9.3 真实供应商/真实账号/LINE WebView 端到端未运行。已完成的替代隔离覆盖：两种子各执行真实 MappingWorker+FakeLlm 的自动匹配→编辑→套用另一模板→切回保存版本→通用→必填422→确认→XLSX/CSV导出；JSON下载单测独立通过。浏览器 API 全合成且前端下载字节不是有效 XLSX 验证，后端 openpyxl 单独验证工作簿。不得将两层组合称为真实端到端。
- [ ] 9.4 真实 LLM 样本匹配/字段准确率、低分比例、耗时/token 基线未运行；0.7 保持初始阈值（Q3），不以合成数据的 score/单候选 UI score=1.0 充当质量指标。

## 10. 文档同步

- [x] 10.1 EPIC-08：CLI/结构/版本/作用域/审计 P0，管理 UI P1，本期无模板 REST 写接口。
- [x] 10.2 EPIC-02/03/04 同步新原始结果/映射/核验/导出契约；保留合法历史 Firestore 原文归档，不将其用于新模板执行状态。
- [x] 10.3 PRD 与 Glossary 同步 R2–R6 及术语。
- [x] 10.4 AC、Data-Model、OCR-Pipeline、API-Spec、ADR-006/007 与 delta specs 已同步；NFR/Architecture 已范围化旧目标，保留新路径真实基线与发布边界。
- [x] 10.5 最终 `openspec validate document-template-mapping --strict` 通过；独立审查15FR/50AC追溯，发现的导出当前版本措辞与 OCR-020-04 编号已修正。最终17文档共109本地链接/22锚点均有效；38份浏览器源码快照重新核对无漂移。

## 11. 发布（2026-10-31 用户授权「从第一步执行，功能都部署到正式环境」）

- [x] 11.1 本地无连接共享库的后端进程（8000 为 CLodop，5000 未监听；5173 仅前端 Vite），未终止任何用户进程。只读确认 `saiflow_api` 为表属主且有 schema CREATE、重复当前版本 0。发布前发现 Dockerfile 模块白名单漏拷 `doc_templates/`、`mapping_worker.py`、`manage_templates.py`、`templates_seed/`，已补 COPY 并新增 `test_capacity.py::test_image_contains_every_local_module_reachable_from_app`（旧 Dockerfile 下失败）；823 passed。`saiflow-api-00049-pux`（`sha256:84c12cff…12b4b`）以 `TEMPLATE_MAPPING_ENABLED=false`、`--no-traffic` 部署，启动迁移建出 4 表、3 列及 `uq_result_versions_job_current` 等索引，启动日志无 WARNING/ERROR；标签与线上匿名探针一致后手动切 100%。
- [x] 11.2 `seed --dry-run` 报告将创建 2 个版本 1；`seed --yes` 写入 `system.billing_note`（#1，6 组/22 项）与 `system.tax_invoice`（#2，7 组/34 项），系统作用域、ENABLED、审计 `template.created` 2 条；复跑 dry-run 均为 unchanged。
- [x] 11.3 前端 `index-B70dHnIx.js`（SHA-256 `1f290bc9…0eec`）从 `temp/` 白名单暂存目录（57 文件，不含 `.env*`/Cookie 罐）部署 `saiflow-line-mini-00043-wuh`（`sha256:d0b58a20…b5f2`），`--no-traffic` 标签核验后切 100%；登记区域域名、Cloud Run 别名与 `saiflow.zhpulan.cn` 7/7 静态文件一致，匿名 session 401 无 Set-Cookie，dev 400，无效 LINE token 401。
- [x] 11.4 同一镜像以 `TEMPLATE_MAPPING_ENABLED=true` 创建 `saiflow-api-00052-fal`（`--no-traffic`），核验后切 100%，临时标签均已移除；02:00Z–02:45Z 三个新 revision 的 ERROR 级日志与 Traceback 均为 0（不代表长期可用性）。回滚：`--update-env-vars TEMPLATE_MAPPING_ENABLED=false` 或切回 `00049-pux`。真实上传→映射→确认（9.3）与真实 LLM 基线（9.4）仍待用户真机验收。

## 验证复现与收尾备注（2026-10-31）

后端执行目录：`services/api/`。

```bash
.venv/Scripts/python -B -m pytest -p no:cacheprovider --basetemp=../../temp/pytest-template-final -q
.venv/Scripts/python -B manage_templates.py validate --file templates_seed/billing_note.json
.venv/Scripts/python -B manage_templates.py validate --file templates_seed/tax_invoice.json
uv run --no-project --with ruff ruff check --no-cache --target-version py310 doc_templates mapping_worker.py manage_templates.py test_document_templates.py test_template_mapping.py test_template_routes.py
```

前端执行目录：仓库根。测试均读取真实源码但使用合成数据，不触达真实后端。

```bash
pnpm --filter saiflow-line-mini-app build
node temp/template-structured-tests.cjs
node temp/template-ui/audit-i18n.cjs
node temp/template-ui/audit-template-ui.cjs
```

浏览器报告包含冻结构建及源码快照哈希；生产构建与隔离视图 harness 构建不同，不将二者工件混称。Vite 有已知 native-config/CommonJS 提示，不影响本次成功构建。本次历史真实解析缓存、一次性查询脚本、pytest目录及过期失败诊断已清理；保留合成复验脚本/最终报告/截图与只读核查摘要。

## Workflow follow-up

9.3/9.4 与第11节仍未完成，不归档、不声称全计划完成；后续完成后再同步主 specs 并归档。未提交、推送、部署、修改共享库 schema 或写入系统模板。
