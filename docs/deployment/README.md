---
doc_id: OPS-001
title: "SaiFlow — 部署与运维说明（dev 环境）"
type: guide
status: active
version: 1.2.1
updated: 2026-11-05
owner: Product Engineering
related: [ADR-008, FR-PLAT-005, FR-PLAT-006]
doc_source: manual
---

# SaiFlow — 部署与运维说明（dev 环境）

> 运行环境见 [`ADR-008`](../30-design/adr/ADR-008-vps-docker-hosting.md)：一台 LightNode VPS（曼谷，Ubuntu 24.04）上用 Docker Compose 运行 PostgreSQL、后端、三个前端与 Caddy。脚本在 `scripts/`，Compose 与 Caddy 配置在 `scripts/deploy/`。部署记录写在对应 change 的 `verification.md`，不写在这里。

## 1. 地址

| 应用 | 地址 | Compose 服务 |
|------|------|--------------|
| web-pc 企业版 | https://saiflow-app.aibaba.asia | `saiflow-fe-web-pc` |
| admin 后台 | https://saiflow-admin.aibaba.asia | `saiflow-fe-web-admin` |
| LINE 小程序 | https://saiflow-line2.aibaba.asia | `saiflow-fe-line-mini` |
| 后端 | 以上每个地址下的 `/api`（健康检查 `/api/v1/health`） | `saiflow-be-api` |

公网只开放 80、443（Caddy）与 SSH 11022；数据库端口不对外。

## 2. 一次性配置（按顺序，只做一次）

### 2.1 DNS

在 `aibaba.asia` 的 DNS 中加三条 A 记录，都指向 VPS 的公网 IP：`saiflow-app`、`saiflow-admin`、`saiflow-line2`。生效后 Caddy 才能申请证书。

### 2.2 部署密钥（在你自己的电脑上）

```bash
ssh-keygen -t ed25519 -f saiflow_deploy_key -N "" -C "saiflow-deploy"
```

得到 `saiflow_deploy_key`（私钥，只放进 GitHub Secrets，之后从电脑删除）与 `saiflow_deploy_key.pub`（公钥，给服务器）。

### 2.3 GCP 备份桶（Cloud Shell，有项目管理权限的人）

```bash
GCP_PROJECT_ID=saiflow-509205 BACKUP_BUCKET=saiflow-db-backup bash scripts/gcp-backup-bootstrap.sh
```

建私有桶（30 天后自动删除）与服务账号 `saiflow-v3-backup`（只能在这个桶里新增和读取文件，不能删除或覆盖），并在当前目录生成密钥文件。若组织策略禁止创建服务账号密钥，脚本会在最后一步报错，需要先在 GCP 中放开该策略。

### 2.4 VPS 初始化（以 root 执行）

```bash
scp -P 11022 scripts/vps-bootstrap.sh saiflow_deploy_key.pub root@<VPS_IP>:/root/
ssh -p 11022 root@<VPS_IP> 'bash /root/vps-bootstrap.sh /root/saiflow_deploy_key.pub gs://saiflow-db-backup'
```

安装 Docker 与 Compose；建账号 `deploy`（只能用密钥登录，属于 `docker` 组）；建 `/opt/saiflow` 与只有 `deploy` 可读的 `.env`（数据库口令随机生成）；安装每天 03:00（曼谷时间）运行的备份定时器。不改防火墙与 SSH 配置。

然后把 2.3 生成的密钥放到服务器（并从 Cloud Shell 删除）：

```bash
scp -P 11022 saiflow-v3-backup-key.json root@<VPS_IP>:/opt/saiflow/secrets/gcs-backup.json
ssh -p 11022 root@<VPS_IP> 'chown deploy:deploy /opt/saiflow/secrets/gcs-backup.json && chmod 600 /opt/saiflow/secrets/gcs-backup.json'
```

### 2.5 GitHub 仓库设置（Settings → Secrets and variables → Actions）

| 类型 | 名称 | 值 |
|------|------|----|
| Secret | `VPS_SSH_KEY` | `saiflow_deploy_key` 私钥全文 |
| Secret | `VPS_KNOWN_HOSTS` | `ssh-keyscan -p 11022 <VPS_IP>` 的输出（固定主机指纹，防止中间人） |
| Variable | `VPS_HOST` | VPS 公网 IP |
| Variable | `APP_HOST` | `saiflow-app.aibaba.asia` |
| Variable | `ADMIN_HOST` | `saiflow-admin.aibaba.asia` |
| Variable | `LINE_HOST` | `saiflow-line2.aibaba.asia` |

镜像推送与服务器拉取都用工作流自带的临时令牌，不需要另建镜像仓库密码；服务器在每次部署结束时退出登录（FR-PLAT-005）。

### 2.6 LINE 登录与发信（B-2a 起；不填则对应功能返回 503）

1. **LINE Developers**（与 LINE OA、LIFF 同一个 Provider，NFR-COMPAT-008）：
   - LIFF 端点：`https://saiflow-line2.aibaba.asia/`；
   - LINE 登录回调地址（web-pc）：`https://saiflow-app.aibaba.asia/login`（B-5 页面上线时按实际地址核对）；
   - 记下 Channel ID 与 Channel secret。
2. 以 `deploy` 编辑 `/opt/saiflow/.env`（权限保持 600），填写：

   | 变量 | 值 |
   |------|----|
   | `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` | 上一步记下的值 |
   | `LINE_LOGIN_REDIRECT_URIS` | 上面登记的回调地址，多个用逗号分隔 |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURITY` | 如 Gmail：`smtp.gmail.com` / `587` / `starttls`（`465` 端口对应 `ssl`） |
   | `SMTP_USERNAME` / `SMTP_PASSWORD` | 发信账号与应用专用密码 |
   | `SMTP_FROM` | 发件人，如 `SaiFlow <账号地址>` |

   较早初始化的服务器没有这些行，手工追加即可。改完后重新运行一次 `Deploy`（或 `docker compose up -d`）使后端读到新值。
3. 验证发信：`docker compose exec -T saiflow-be-api python -m app.cli smtp-check <你的邮箱>` → `smtp OK`，并确认收到邮件。失败时会显示原因：`535` 表示账号或密码被拒（Gmail 须用 16 位应用专用密码；个人 Outlook.com / Hotmail 账号已不支持口令发信，不能使用），连接断开或超时则检查端口与 `SMTP_SECURITY` 是否对应。改 `.env` 后须 `docker compose up -d --force-recreate saiflow-be-api` 才会生效。

### 2.7 平台 admin 后台账号

只能在服务器上用命令管理（FR-SYS-019），口令从标准输入读取，不会出现在命令历史里：

```bash
cd /opt/saiflow
docker compose exec -T saiflow-be-api python -m app.cli admin-create <用户名>        # 然后输入口令（至少 12 个字符）回车
docker compose exec -T saiflow-be-api python -m app.cli admin-reset-password <用户名> # 重设口令并解除锁定
docker compose exec -T saiflow-be-api python -m app.cli admin-disable <用户名>        # 停用并结束其会话
```

连续 5 次输错口令锁定 15 分钟；后台 30 分钟无操作需重新登录。

## 3. 部署

1. 确认要部署的提交在 GitHub Actions 的 `CI` 中已通过。
2. Actions → `Deploy` → Run workflow，选择分支 `chore/ai-workflow-v2`（部署该分支最新提交）。
3. 工作流依次：检查分支（只允许 `chore/ai-workflow-v2`，选了别的分支即停止）→ 检查 CI 结果（未通过即停止）→ 构建并推送 4 个镜像 → 复制 Compose 与脚本到 `/opt/saiflow` → 在服务器上拉取镜像、数据库迁移、重启服务 → 检查三个地址的健康检查与版本 → 确认 5432 端口从外部不可连。
4. 结果见该次运行的 Summary；任何一步失败，工作流即为失败。

推送代码或合并 PR **不会**触发部署。

### 3.1 数据库账号

| 账号 | 用途 | 口令（`.env`） |
|------|------|------|
| `POSTGRES_USER`（`saiflow_admin`） | 数据库超级账号：建账号、备份 | `POSTGRES_PASSWORD` |
| `saiflow_v3_migrator` | 拥有 schema `saiflow_v3` 中的全部表，只用于执行数据库迁移 | `DB_MIGRATE_PASSWORD` |
| `saiflow_v3_app` | 后端运行时使用；只能读写数据，不能改表结构，操作日志只能读取与追加 | `DB_PASSWORD` |

每次部署在迁移前运行 `db-roles.sh`：建立或更新迁移账号，并把表的所有者转给它（可重复执行）。`.env` 缺少 `DB_MIGRATE_PASSWORD` 时部署在任何改动之前失败，正在运行的版本不受影响。

**2026-11-04 之前初始化的服务器**需在部署 `harden-identity` 之前补一行（以 root 执行一次）：

```bash
cd /opt/saiflow && echo "DB_MIGRATE_PASSWORD=$(openssl rand -hex 24)" >> .env
```

## 4. 回滚

- **推荐：** 用 `git revert` 提交一个撤销问题改动的新提交，等 CI 通过后再运行 `Deploy`（工作流总是部署所选分支的最新提交）。
- **紧急：** 在 VPS 上以 `deploy` 把 `/opt/saiflow/.env` 中的 `IMAGE_TAG` 改回上一个 sha，然后 `cd /opt/saiflow && docker compose up -d`。数据库迁移不会自动回退；含迁移的版本回滚前先确认迁移可逆。
- **0004、0005 的回退：** 已有组织（0004）或订阅、预占记录（0005）时，回退会因约束而失败并整体撤销，不会留下半回退的数据库；需要回到旧版本时同样只回滚镜像。
- **不要把数据库回退到 0003 之前：** `alembic downgrade` 到 0003 以下会收回应用账号的全部数据权限，而表仍属迁移账号，后端将无法读写，只能再用 `db-roles.sql` 与手工授权补救。需要回到旧版本时，只回滚镜像（上一条），数据库保持在当前版本；0003 之后的迁移只增加表与权限，旧镜像照常可用。

## 5. 备份与恢复

- **自动：** 每天 03:00（曼谷时间）运行；本地 `/opt/saiflow/backups/` 保留 7 天，同时复制到备份桶（30 天）。查看结果：`journalctl -u saiflow-backup.service`。
- **手动运行：** `sudo systemctl start saiflow-backup.service`。
- **恢复演练：** `bash /opt/saiflow/restore-check.sh /opt/saiflow/backups/<文件>.dump`（恢复到一个临时数据库并检查 schema，不影响正在运行的数据库）。
- **真正恢复（数据丢失时）：** 以 `deploy` 在 `/opt/saiflow` 中执行：

  ```bash
  docker compose stop saiflow-be-api
  # 用户名在容器内展开（单引号），文件从宿主机经标准输入传入
  docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d saiflow --clean --if-exists --exit-on-error' < backups/<文件>.dump
  docker compose start saiflow-be-api
  curl -s https://saiflow-app.aibaba.asia/api/v1/health
  ```

  本地没有可用备份时，先从备份桶下载到 `backups/`。

## 6. 常用检查

```bash
cd /opt/saiflow
docker compose ps
docker compose logs --tail 100 saiflow-be-api
curl -s https://saiflow-app.aibaba.asia/api/v1/health
docker compose exec -T saiflow-be-api python -m app.cli audit-verify   # 操作日志是否被改动
```

## 7. 已知风险

- **单台服务器：** 数据库与全部服务在同一台机器上，宕机即全部不可用；磁盘损坏时只能从备份桶恢复（ADR-008）。
- **`deploy` 账号权限接近 root：** 它属于 `docker` 组，能运行任意容器。只允许密钥登录，私钥只在 GitHub Secrets 中；dev 阶段接受（B-1 决定 D9）。
- **GCP 服务账号密钥是长期凭据：** 只授予备份桶的新增与读取（上传工具需要读取权限），不能删除或覆盖已有备份；放在服务器上只有 `deploy` 可读的位置；需要定期轮换。
- **备份桶在境外**（新加坡），见 OQ-7；集中日志与告警（OQ-29）、VPS 上的静态加密（OQ-30）在投产前决定。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.2.1 | 2026-11-05 | Product Engineering | §4 补充 0004、0005 回退的说明 |
| 1.2.0 | 2026-11-04 | Product Engineering | harden-identity：§3.1 数据库账号（迁移账号与应用账号分离，新增 `DB_MIGRATE_PASSWORD`） |
| 1.1.1 | 2026-11-04 | Product Engineering | §2.6 发信失败原因说明；改 `.env` 后须重建后端容器 |
| 1.1.0 | 2026-11-03 | Product Engineering | B-2a：§2.6 LINE 登录与发信配置、§2.7 平台 admin 账号命令；§6 加操作日志检查 |
| 1.0.2 | 2026-11-03 | Product Engineering | 备份服务账号增加备份桶读取权限（`gcloud storage cp` 需要 `storage.objects.get`，首次备份演练发现） |
| 1.0.1 | 2026-11-03 | Product Engineering | LINE 小程序子域名改为 `saiflow-line2`（原名与之前调试地址冲突，负责人 2026-11-03） |
| 1.0.0 | 2026-11-03 | Product Engineering | 初版（B-1 `rebuild-skeleton`）：地址、一次性配置、部署、回滚、备份与恢复、风险 |
