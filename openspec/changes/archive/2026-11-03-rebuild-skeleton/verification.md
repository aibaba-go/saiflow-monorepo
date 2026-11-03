# rebuild-skeleton — 验证记录

> 日期：2026-11-03。环境：dev（LightNode VPS，曼谷，Ubuntu 24.04），部署提交 `267c486`。
> 自动化测试在 GitHub Actions `CI` 中运行；部署与服务器上的检查由负责人与 AI 共同执行。

## 1. 运行记录

| 项目 | 链接 | 结果 |
|------|------|------|
| CI（部署的提交 `267c486`） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41614478353 | 5 个 job 全部成功（backend、frontend、contract、scripts、stack） |
| CI（本记录之前的最新提交 `47273fa`） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41617178251 | 成功 |
| 拒绝验证（`13a5fcd`，CI 未完成时触发） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41613725331 | 按预期失败于"CI must have passed"，后续步骤全部跳过 |
| 正式部署（`267c486`） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41615119033 | 全部步骤成功 |
| 追加部署（`1b1fe69`，去掉 `DB_SCHEMA`、部署超时 10 分钟、接口一致性检查覆盖新文件） | https://github.com/aibaba-go/saiflow-monorepo/actions/runs/41633182397 | 全部步骤成功（约 3 分钟），三个地址 smoke-check 通过 |

首次 CI（`94f2bf3`）与两次部署（41614091944、41614788877）失败，原因与修复见第 4 节。

## 2. 验收标准对照

| AC | 验证方式 | 结果 |
|----|---------|------|
| AC-FR-PLAT-001-01 数据库可用 | `services/api/tests/unit/test_health.py`、`tests/integration/test_health_db.py`（CI 中连真实 PostgreSQL）；部署后三个地址 `{"status":"ok","database":"ok"}` | 通过 |
| AC-FR-PLAT-001-02 数据库不可用 | 同上测试（含"接受连接但不响应"用例）；VPS 上停止 `postgres` 后健康检查 2.3 秒返回 503 `{"status":"degraded","database":"error"}` | 通过 |
| AC-FR-PLAT-001-03 不泄露敏感信息 | `tests/integration/test_health_db.py`、`test_secrets_not_logged.py` | 通过 |
| AC-FR-PLAT-002-01/02/03 错误格式 | `services/api/tests/unit/test_errors.py`（404、422、500 与请求 ID） | 通过 |
| AC-FR-PLAT-003-01 缺少必需配置 | `services/api/tests/unit/test_config.py` | 通过 |
| AC-FR-PLAT-003-02 凭据不出现在输出中 | `test_config.py`、`tests/integration/test_secrets_not_logged.py` | 通过 |
| AC-FR-PLAT-004-01 接口客户端过期 | CI `contract` job（重新导出 OpenAPI 并生成客户端，比较差异） | 通过 |
| AC-FR-PLAT-004-02 前端显示后端状态 | 三个应用的 `HealthPage.test.tsx`；负责人在浏览器打开三个地址，均显示 `Backend: OK` | 通过 |
| AC-FR-PLAT-004-03 后端不可达 | `HealthPage.test.tsx`、`packages/api-client/src/health.test.ts`（含非 JSON 的 502） | 通过 |
| AC-FR-PLAT-005-01 推送不触发部署 | `deploy.yml` 只有 `workflow_dispatch`；多次推送后 Deploy 只出现手动触发的运行 | 通过 |
| AC-FR-PLAT-005-02 拒绝未通过 CI 的提交 | `scripts/tests/require-ci-success.test.sh`；真实拒绝验证（第 1 节） | 通过 |
| AC-FR-PLAT-005-03 部署后健康检查失败 | `scripts/tests/smoke-check.test.sh`；停止数据库时对 `https://saiflow-app.aibaba.asia` 运行 `smoke-check.sh … --timeout-seconds 30` 退出 1（health 503，`database=error`），恢复后三个地址均通过 | 通过 |
| AC-FR-PLAT-005-04 仓库中没有凭据 | `scripts/check-no-secrets.sh`（CI `scripts` job） | 通过 |
| AC-FR-PLAT-005-05 镜像仓库凭据不留在服务器上 | `scripts/tests/remote-deploy.test.sh`（含迁移失败用例）；部署后 `deploy` 的 `~/.docker/config.json` 为 `{"auths": {}}` | 通过 |
| AC-FR-PLAT-005-06 数据库不对公网开放 | CI `stack` job（`docker port` 为空）；部署工作流从外部连接 5432 失败 | 通过 |
| AC-FR-PLAT-006-01 每日导出并复制 | `scripts/tests/backup.test.sh`；VPS 上手动运行 `saiflow-backup.service`：生成 `saiflow-20261103T101541Z.dump`（2203 字节）并上传到 `gs://saiflow-db-backup/`（桶中同名对象 2203 字节） | 通过 |
| AC-FR-PLAT-006-02 本地只保留 7 天 | `scripts/tests/backup.test.sh` | 通过（真实环境待 7 天后自然验证） |
| AC-FR-PLAT-006-03 复制失败 | `scripts/tests/backup.test.sh`；首次演练中上传 403 时服务失败、本地文件保留（第 4 节） | 通过 |
| AC-FR-PLAT-006-04 可以恢复 | CI `stack` job 恢复演练；VPS 上 `restore-check.sh saiflow-20261103T101541Z.dump` → `restore-check OK: saiflow_v3.alembic_version present (1 row)` | 通过 |

## 3. 部署后的环境

| 应用 | 地址 | 健康检查（`267c486`） |
|------|------|------|
| web-pc 企业版 | https://saiflow-app.aibaba.asia | `{"status":"ok","database":"ok"}`，页面 200 |
| admin 后台 | https://saiflow-admin.aibaba.asia | 同上 |
| LINE 小程序 | https://saiflow-line2.aibaba.asia | 同上 |

- 证书：Let's Encrypt，有效期至 2027-02-01，由 Caddy 自动续期。
- 数据库数据卷在数据盘（Docker data-root `/data/docker`）；本地备份在系统盘 `/opt/saiflow/backups/`（负责人决定，与数据库分盘）。

## 4. 过程中发现并修复的问题

| 发现 | 修复 | 提交 |
|------|------|------|
| CI 的 shellcheck 版本较旧，提示编号不同（SC2015、SC2317） | 改写判断语句、同时标注两个编号 | `81bb28f` |
| `docker compose port` 对未发布端口输出 `:0`，端口检查误报 | 改用 `docker port` | `81bb28f` |
| LINE 子域名与之前的调试地址冲突 | 改为 `saiflow-line2.aibaba.asia`（负责人决定） | `a13fb9f` |
| 新建服务账号后立刻创建密钥报 NOT_FOUND；失败留下空密钥文件被当成已完成 | 重试 6 次；改为检查文件非空 | `7175370`、`9db6cf3` |
| 组织策略 `iam.disableServiceAccountKeyCreation` 禁止创建密钥 | 负责人只对项目 `saiflow-509205` 关闭该策略 | —（GCP 设置） |
| 手动触发要求工作流存在于默认分支 | 负责人同意在 `main` 上只加 `deploy.yml`；运行时使用所选分支上的副本 | `431b888`（main） |
| `VPS_KNOWN_HOSTS` 在 Windows cmd 中生成为空值 | 重新扫描并核对 ED25519 指纹（与控制台一致）后设置；工作流去掉 CR、打印指纹、缺少主机时直接报错 | `267c486` |
| 备份账号只有 objectCreator，`gcloud storage cp` 需要 `storage.objects.get`（403） | 增加备份桶 objectViewer（仍不能删除或覆盖） | `47273fa` |
| VPS 上负责人自建的 `postgresql` 容器对公网开放 5432 | 负责人决定删除容器（数据卷保留） | —（服务器操作） |
| 审查遗留：`DB_SCHEMA` 配置项不起作用；接口一致性检查漏掉新文件；部署无超时（负责人要求修） | 去掉 `DB_SCHEMA`（schema 固定 `saiflow_v3`）；`scripts/check-generated-clean.sh`；`timeout-minutes: 10` | `a1c6c2c`、`1b1fe69` |
