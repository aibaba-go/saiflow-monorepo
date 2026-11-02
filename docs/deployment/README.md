---
doc_id: OPS-001
title: "SaiFlow — 部署与运维说明（dev 环境）"
type: guide
status: active
version: 1.0.0
updated: 2026-11-03
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
| LINE 小程序 | https://saiflow-line.aibaba.asia | `saiflow-fe-line-mini` |
| 后端 | 以上每个地址下的 `/api`（健康检查 `/api/v1/health`） | `saiflow-be-api` |

公网只开放 80、443（Caddy）与 SSH 11022；数据库端口不对外。

## 2. 一次性配置（按顺序，只做一次）

### 2.1 DNS

在 `aibaba.asia` 的 DNS 中加三条 A 记录，都指向 VPS 的公网 IP：`saiflow-app`、`saiflow-admin`、`saiflow-line`。生效后 Caddy 才能申请证书。

### 2.2 部署密钥（在你自己的电脑上）

```bash
ssh-keygen -t ed25519 -f saiflow_deploy_key -N "" -C "saiflow-deploy"
```

得到 `saiflow_deploy_key`（私钥，只放进 GitHub Secrets，之后从电脑删除）与 `saiflow_deploy_key.pub`（公钥，给服务器）。

### 2.3 GCP 备份桶（Cloud Shell，有项目管理权限的人）

```bash
GCP_PROJECT_ID=saiflow-509205 BACKUP_BUCKET=saiflow-db-backup bash scripts/gcp-backup-bootstrap.sh
```

建私有桶（30 天后自动删除）与服务账号 `saiflow-v3-backup`（只能往这个桶写入），并在当前目录生成密钥文件。若组织策略禁止创建服务账号密钥，脚本会在最后一步报错，需要先在 GCP 中放开该策略。

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
| Variable | `LINE_HOST` | `saiflow-line.aibaba.asia` |

镜像推送与服务器拉取都用工作流自带的临时令牌，不需要另建镜像仓库密码；服务器在每次部署结束时退出登录（FR-PLAT-005）。

## 3. 部署

1. 确认要部署的提交在 GitHub Actions 的 `CI` 中已通过。
2. Actions → `Deploy` → Run workflow，选择分支 `chore/ai-workflow-v2`（部署该分支最新提交）。
3. 工作流依次：检查 CI 结果（未通过即停止）→ 构建并推送 4 个镜像 → 复制 Compose 与脚本到 `/opt/saiflow` → 在服务器上拉取镜像、数据库迁移、重启服务 → 检查三个地址的健康检查与版本 → 确认 5432 端口从外部不可连。
4. 结果见该次运行的 Summary；任何一步失败，工作流即为失败。

推送代码或合并 PR **不会**触发部署。

## 4. 回滚

- **推荐：** 用 `git revert` 提交一个撤销问题改动的新提交，等 CI 通过后再运行 `Deploy`（工作流总是部署所选分支的最新提交）。
- **紧急：** 在 VPS 上以 `deploy` 把 `/opt/saiflow/.env` 中的 `IMAGE_TAG` 改回上一个 sha，然后 `cd /opt/saiflow && docker compose up -d`。数据库迁移不会自动回退；含迁移的版本回滚前先确认迁移可逆。

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
```

## 7. 已知风险

- **单台服务器：** 数据库与全部服务在同一台机器上，宕机即全部不可用；磁盘损坏时只能从备份桶恢复（ADR-008）。
- **`deploy` 账号权限接近 root：** 它属于 `docker` 组，能运行任意容器。只允许密钥登录，私钥只在 GitHub Secrets 中；dev 阶段接受（B-1 决定 D9）。
- **GCP 服务账号密钥是长期凭据：** 只授予备份桶写入；放在服务器上只有 `deploy` 可读的位置；需要定期轮换。
- **备份桶在境外**（新加坡），见 OQ-7；集中日志与告警（OQ-29）、VPS 上的静态加密（OQ-30）在投产前决定。

## 版本历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0.0 | 2026-11-03 | Product Engineering | 初版（B-1 `rebuild-skeleton`）：地址、一次性配置、部署、回滚、备份与恢复、风险 |
