# 通过 PowerShell 连接 BigQuery 并生成本地凭证

## 1. 适用范围

本文用于在 Windows PowerShell 中完成以下工作：

- 安装并检查 Google Cloud CLI；
- 登录 Google Cloud；
- 设置 BigQuery 项目；
- 通过 Application Default Credentials（ADC）生成本地凭证；
- 配置代理或排查 Google API 网络连接；
- 使用 `bq` 命令查询 BigQuery；
- 为后续 Python 程序或支持 ADC 的客户端准备认证环境。

本文使用的项目配置如下：

```text
Google Cloud 项目：saiflow-509205
BigQuery 数据集：firestore_dw
数据集区域：asia-southeast1
数据表：users_raw_latest、users_raw_changelog
```

ADC 是用户在本地开发环境中使用 Google Cloud 客户端库的推荐认证方式之一。它不需要创建服务账号 JSON 私钥，也不会受到组织策略 `iam.disableServiceAccountKeyCreation` 禁止创建服务账号密钥的影响。

---

## 2. 前置权限

执行查询的 Google 账号至少需要以下权限：

| 作用范围 | IAM 角色 | 用途 |
|---|---|---|
| 项目 `saiflow-509205` | `BigQuery Job User` (`roles/bigquery.jobUser`) | 创建和执行查询任务 |
| 数据集 `firestore_dw` | `BigQuery Data Viewer` (`roles/bigquery.dataViewer`) | 读取数据集中的表 |

如果还需要创建或修改表，需另外配置相应的数据编辑权限。本文只涉及查询，因此使用最小读取权限即可。

---

## 3. 安装和检查 Google Cloud CLI

### 3.1 检查是否已经安装

打开新的 Windows PowerShell，执行：

```powershell
gcloud --version
bq version
```

如果可以正常显示版本号，说明 Google Cloud CLI 和 BigQuery 命令行工具已经安装。

### 3.2 安装 Google Cloud CLI

如果 PowerShell 提示 `gcloud` 或 `bq` 不是命令，请从 Google 官方页面下载安装：

[安装 Google Cloud CLI for Windows](https://cloud.google.com/sdk/docs/install)

安装完成后：

1. 关闭当前 PowerShell；
2. 重新打开 PowerShell；
3. 再次执行：

```powershell
gcloud --version
bq version
```

---

## 4. 登录 Google Cloud

### 4.1 登录 gcloud CLI

执行：

```powershell
gcloud auth login
```

浏览器会打开 Google 登录页面。使用拥有 BigQuery 权限的账号登录。

查看当前已登录账号：

```powershell
gcloud auth list
```

如果有多个账号，可以指定当前账号：

```powershell
gcloud config set account your-account@gmail.com
```

将 `your-account@gmail.com` 替换成实际账号。

### 4.2 设置默认项目

执行：

```powershell
gcloud config set project saiflow-509205
```

验证项目：

```powershell
gcloud config get-value project
```

预期输出：

```text
saiflow-509205
```

查看完整配置：

```powershell
gcloud config list
```

其中应该可以看到：

```text
[core]
account = your-account@gmail.com
project = saiflow-509205
```

区域和可用区配置不是 BigQuery 认证的关键项。查询 BigQuery 时，应使用数据集实际所在位置 `asia-southeast1`。

---

## 5. 生成 Application Default Credentials（ADC）

### 5.1 创建本地 ADC 凭证

执行：

```powershell
gcloud auth application-default login
```

浏览器会再次打开 Google 授权页面。使用同一个 Google 账号完成授权。

`gcloud auth login` 和 `gcloud auth application-default login` 作用不同：

| 命令 | 用途 |
|---|---|
| `gcloud auth login` | 登录 `gcloud`、`bq` 等命令行工具 |
| `gcloud auth application-default login` | 为 Python、Java、Node.js 等本地程序生成 ADC 凭证 |

在 Windows 上，ADC 文件通常位于：

```text
%APPDATA%\gcloud\application_default_credentials.json
```

后续 Python 程序使用 Google Cloud 客户端库时，通常不需要在代码中指定这个文件路径，客户端会自动读取 ADC。

### 5.2 不打开浏览器时登录

如果浏览器没有自动打开，可以执行：

```powershell
gcloud auth application-default login --no-launch-browser
```

命令会输出授权地址。将地址复制到浏览器中访问，完成授权后，根据 PowerShell 提示输入授权结果。

### 5.3 不显示令牌地验证 ADC

不要把访问令牌打印到屏幕或截图中。可以通过丢弃输出的方式验证：

```powershell
gcloud auth application-default print-access-token | Out-Null
```

如果命令没有报错，说明 ADC 可以正常读取。

### 5.4 撤销本地 ADC

如果需要重新授权，或者曾经不小心公开过访问令牌，执行：

```powershell
gcloud auth application-default revoke
```

然后重新生成：

```powershell
gcloud auth application-default login
```

不要把 access token 写进 Python 代码、配置文件或提交到 Git 仓库。

---

## 6. 配置代理

如果 `gcloud` 登录成功，但 `bq` 连接 BigQuery 时出现以下错误：

```text
TimeoutError(10060)
Could not connect with BigQuery server
```

通常表示当前 Windows 网络无法访问 Google API，需要检查代理、防火墙或 VPN。

### 6.1 查看当前 PowerShell 是否存在代理环境变量

执行：

```powershell
Get-ChildItem Env: | Where-Object {
    $_.Name -match "proxy"
}
```

### 6.2 测试 Google API 网络

执行：

```powershell
Test-NetConnection bigquery.googleapis.com -Port 443
```

再执行：

```powershell
Test-NetConnection www.googleapis.com -Port 443
```

重点查看：

```text
TcpTestSucceeded : True
```

或者：

```text
TcpTestSucceeded : False
```

检查 DNS：

```powershell
nslookup bigquery.googleapis.com
```

检查 HTTPS 是否可以连通：

```powershell
curl.exe -I --connect-timeout 10 https://bigquery.googleapis.com/
```

只要 `curl.exe` 返回 HTTP 响应，例如 `401` 或 `404`，就说明网络已经到达 Google API；如果直接超时，则仍然是网络或代理问题。

### 6.3 临时配置本机代理

如果本机代理监听地址为 `127.0.0.1:7890`，可以在当前 PowerShell 会话中执行：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:NO_PROXY="localhost,127.0.0.1"
```

请将 `127.0.0.1:7890` 替换成实际代理地址和端口。

然后重新测试：

```powershell
Test-NetConnection bigquery.googleapis.com -Port 443
```

以及：

```powershell
bq ls --project_id=saiflow-509205
```

这种环境变量配置只对当前 PowerShell 窗口有效，关闭窗口后需要重新设置。

### 6.4 将代理写入 gcloud 配置

如果临时环境变量测试成功，也可以将代理保存到 gcloud 当前配置：

```powershell
gcloud config set proxy/type http
gcloud config set proxy/address 127.0.0.1
gcloud config set proxy/port 7890
```

查看配置：

```powershell
gcloud config list
```

Google Cloud CLI 支持以下代理类型：

```text
http
http_no_tunnel
socks4
socks5
```

### 6.5 代理需要账号密码时

可以使用 gcloud 配置项：

```powershell
gcloud config set proxy/username YOUR_PROXY_USERNAME
gcloud config set proxy/password YOUR_PROXY_PASSWORD
```

更安全的方式是只在当前 PowerShell 会话中设置环境变量，避免把密码写入 gcloud 配置：

```powershell
$env:CLOUDSDK_PROXY_USERNAME="YOUR_PROXY_USERNAME"
$env:CLOUDSDK_PROXY_PASSWORD="YOUR_PROXY_PASSWORD"
```

不要把真实代理密码写入本文档、脚本或聊天消息。

### 6.6 清除错误代理配置

如果当前没有使用代理，但 gcloud 中残留了错误配置，可以执行：

```powershell
gcloud config unset proxy/type
gcloud config unset proxy/address
gcloud config unset proxy/port
gcloud config unset proxy/username
gcloud config unset proxy/password
```

清除后关闭 PowerShell，重新打开，再进行测试。

---

## 7. 确认 BigQuery 数据集和表

列出项目中的数据集：

```powershell
bq ls --project_id=saiflow-509205
```

列出 `firestore_dw` 中的表：

```powershell
bq ls --project_id=saiflow-509205 firestore_dw
```

检查最新数据表：

```powershell
bq show --format=prettyjson saiflow-509205:firestore_dw.users_raw_latest
```

检查原始变更表：

```powershell
bq show --format=prettyjson saiflow-509205:firestore_dw.users_raw_changelog
```

`bq` 命令中的表名格式是：

```text
项目ID:数据集.表名
```

例如：

```text
saiflow-509205:firestore_dw.users_raw_latest
```

---

## 8. 使用 PowerShell 查询 BigQuery

### 8.1 查询最新数据

在 PowerShell 中执行：

```powershell
bq --location=asia-southeast1 query --project_id=saiflow-509205 --use_legacy_sql=false 'SELECT * FROM `saiflow-509205.firestore_dw.users_raw_latest` LIMIT 10'
```

### 8.2 查询原始变更记录

```powershell
bq --location=asia-southeast1 query --project_id=saiflow-509205 --use_legacy_sql=false 'SELECT * FROM `saiflow-509205.firestore_dw.users_raw_changelog` LIMIT 10'
```

### 8.3 统计最新表数据量

```powershell
bq --location=asia-southeast1 query --project_id=saiflow-509205 --use_legacy_sql=false 'SELECT COUNT(*) AS total FROM `saiflow-509205.firestore_dw.users_raw_latest`'
```

### 8.4 统计原始变更记录数量

```powershell
bq --location=asia-southeast1 query --project_id=saiflow-509205 --use_legacy_sql=false 'SELECT COUNT(*) AS total FROM `saiflow-509205.firestore_dw.users_raw_changelog`'
```

查询中必须使用：

```text
--use_legacy_sql=false
```

这样使用的是 GoogleSQL，而不是旧版 Legacy SQL。

查询区域使用：

```text
--location=asia-southeast1
```

因为数据集所在区域是 `asia-southeast1`。查询任务的区域需要与被查询数据集的位置匹配。

---

## 9. 一次性执行流程

如果 Google Cloud CLI 已经安装，可以按照下面顺序执行：

```powershell
gcloud auth login
gcloud config set project saiflow-509205
gcloud auth application-default login
bq ls --project_id=saiflow-509205 firestore_dw
bq --location=asia-southeast1 query --project_id=saiflow-509205 --use_legacy_sql=false 'SELECT * FROM `saiflow-509205.firestore_dw.users_raw_latest` LIMIT 10'
```

如果所在网络需要代理，可以先设置：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
```

然后再执行查询命令。

---

## 10. 为 Python 程序准备凭证

完成 ADC 登录后，Python 可以直接使用本机凭证：

```powershell
python -m pip install --upgrade google-cloud-bigquery
```

Python 代码中不需要写服务账号 JSON 路径：

```python
from google.cloud import bigquery

client = bigquery.Client(
    project="saiflow-509205",
    location="asia-southeast1",
)

sql = """
SELECT *
FROM `saiflow-509205.firestore_dw.users_raw_latest`
LIMIT 10
"""

query_job = client.query(sql, location="asia-southeast1")

for row in query_job.result():
    print(dict(row.items()))
```

Python 程序必须使用执行过 `gcloud auth application-default login` 的同一个 Windows 用户账户。

如果 Python 报 `DefaultCredentialsError`，先重新执行：

```powershell
gcloud auth application-default login
```

并检查是否存在错误的 `GOOGLE_APPLICATION_CREDENTIALS` 环境变量：

```powershell
Get-ChildItem Env: | Where-Object {
    $_.Name -match "GOOGLE_APPLICATION_CREDENTIALS"
}
```

如果该变量指向不存在或错误的服务账号 JSON 文件，可以在当前会话中清除：

```powershell
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
```

使用 ADC 登录生成的本地凭证时，不需要手动设置这个环境变量。

---

## 11. 常见错误和处理方法

| 错误 | 原因 | 处理方法 |
|---|---|---|
| `TimeoutError(10060)` | 网络、代理或防火墙无法访问 Google API | 测试 `bigquery.googleapis.com:443`，配置代理或改用 Cloud Shell |
| `Could not connect with BigQuery server` | BigQuery API 请求没有建立连接 | 检查 `HTTP_PROXY`、`HTTPS_PROXY` 和 VPN |
| `DefaultCredentialsError` | ADC 未生成，或环境变量指向错误文件 | 重新执行 `gcloud auth application-default login` |
| `403 bigquery.jobs.create` | 没有项目级查询权限 | 授予 `roles/bigquery.jobUser` |
| `403 table denied` | 没有读取数据集或表的权限 | 授予数据集级 `roles/bigquery.dataViewer` |
| `Dataset ... was not found in location` | 查询区域和数据集区域不一致 | 使用 `--location=asia-southeast1` |
| `API has not been used` | BigQuery API 未启用 | 让项目管理员启用 `bigquery.googleapis.com` |
| 浏览器无法打开授权页 | 本地浏览器或网络限制 | 使用 `gcloud auth application-default login --no-launch-browser` |

---

## 12. 无法访问本机网络时使用 Cloud Shell

如果本机始终无法连接 `bigquery.googleapis.com:443`，可以在 Google Cloud Console 中打开 Cloud Shell。

Cloud Shell 中执行：

```bash
gcloud config set project saiflow-509205
bq ls --project_id=saiflow-509205 firestore_dw
bq --location=asia-southeast1 query \
  --project_id=saiflow-509205 \
  --use_legacy_sql=false \
  'SELECT * FROM `saiflow-509205.firestore_dw.users_raw_latest` LIMIT 10'
```

Cloud Shell 通常已经安装并配置好 Google Cloud CLI，适合在本机代理或防火墙无法调整时进行验证。

---

## 13. 安全注意事项

- 不要把 access token 复制到聊天、日志、截图或 Git 仓库。
- 不要把 `application_default_credentials.json` 提交到 Git。
- 不要把服务账号 JSON 私钥提交到代码仓库。
- 不要把代理密码写入脚本或公开配置文件。
- 本地开发使用 ADC；生产环境建议给 Cloud Run 绑定运行时服务账号。
- 不要为了连接 DBeaver 或 Python 而关闭组织策略 `iam.disableServiceAccountKeyCreation`。

---

## 14. 官方参考

- [Google Cloud CLI 安装](https://cloud.google.com/sdk/docs/install)
- [本地开发环境设置 ADC](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)
- [gcloud auth application-default login](https://cloud.google.com/sdk/gcloud/reference/auth/application-default/login)
- [配置 gcloud CLI 代理和防火墙](https://cloud.google.com/sdk/docs/proxy-settings)
- [BigQuery bq 命令行工具参考](https://cloud.google.com/bigquery/docs/reference/bq-cli-reference)
- [使用 bq 运行 BigQuery 查询](https://cloud.google.com/bigquery/docs/running-queries)
- [BigQuery Python 客户端库](https://cloud.google.com/python/docs/reference/bigquery/latest)
