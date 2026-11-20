# 新增 Firestore Collection 同步到 BigQuery 操作步骤

本文用于在已经成功运行的 Firebase Function Kit 项目中，再增加一个 Firestore Collection 到 BigQuery 的持续同步任务。示例使用项目 saiflow-509205，在现有 users 同步实例之外，新增 orders 同步实例。

## 1. 已有配置与新增目标

| 项目 | 已有配置 | 新增示例 |
|---|---|---|
| GCP / Firebase 项目 | saiflow-509205 | 继续使用 saiflow-509205 |
| Function Kit 包 | @firebase-function-kits/firestore-bigquery-export | 继续使用同一个包 |
| Kit 名称 | firestore-bigquery-export | 仍填 firestore-bigquery-export |
| 实例 ID | firestore-bigquery-export | orders-sync |
| Firestore 数据库 | fb-saiflow | 继续使用 fb-saiflow |
| Firestore 区域 | asia-southeast1 | 继续使用 asia-southeast1 |
| Collection path | users | orders |
| BigQuery Dataset | firestore_dw | 继续使用 firestore_dw |
| BigQuery Dataset 区域 | asia-southeast1 | 继续使用 asia-southeast1 |
| BigQuery TABLE_ID | users | orders |
| BigQuery 表 | users_raw_changelog、users_raw_latest | orders_raw_changelog、orders_raw_latest |
| 备份集合（如已启用） | bg_users | bg_orders |

如果新 Collection 不是 orders，只需把本文中的 orders、orders-sync、bg_orders 替换为实际名称。实例 ID、TABLE_ID 和备份集合名必须保持唯一。

## 2. 新增实例的执行原则

1. 不要再次执行 firebase init functions。
2. 不要创建第二个 kit。
3. 在同一个 Firebase 项目根目录中，再次执行同一个 Function Kit 安装命令。
4. Kit 名称继续使用 firestore-bigquery-export。
5. 新实例 ID 使用唯一值，例如 orders-sync。
6. CLI 会在原有 firebase.json 的同一个 instances 对象中追加新实例。
7. 新实例必须使用独立的 .env 配置目录。
8. 只部署新实例时，部署目标必须写成 functions:orders-sync。
9. 生命周期命令必须使用 orders-sync，不能使用 default，也不能使用 kit 名称。
10. 同一个 Dataset 可以复用，但 TABLE_ID 必须不同。

## 3. 开始前检查

在已有 Function Kit 项目目录执行。下面的目录名以之前成功配置的目录为例。

~~~bash
cd ~/SaiFlow/firestore-bigquery-sync
~~~

检查当前 Firebase 项目：

~~~bash
firebase use
firebase projects:list
~~~

如果尚未设置当前项目：

~~~bash
firebase use saiflow-509205
~~~

检查 Firebase CLI 版本。Function Kit 要求 firebase-tools 至少为 15.32.0。

~~~bash
firebase --version
node --version
~~~

如果 CLI 版本低于 15.32.0，先升级：

~~~bash
npm install -g firebase-tools
firebase --version
~~~

当前已成功使用的 Node 版本为 24.21.0。升级或切换 Node 后，再确认 Firebase CLI 能正常运行。

检查 Firestore 数据库和区域：

~~~bash
gcloud firestore databases list --project=saiflow-509205
gcloud firestore databases describe fb-saiflow --project=saiflow-509205
~~~

本文按已成功配置的命名数据库 fb-saiflow 和区域 asia-southeast1 编写。如果上述命令显示的数据库 ID 或区域不同，以命令输出为准修改新实例的 DATABASE 和 DATABASE_REGION。不要把数据库名称拼到 COLLECTION_PATH 中。

备份现有配置：

~~~bash
cp firebase.json firebase.json.bak
~~~

安装前确认现有实例仍然存在：

~~~bash
firebase functions:kits:list --project=saiflow-509205
~~~

如果当前 CLI 不支持 functions:kits:list，直接查看 firebase.json 和现有 config-firestore-bigquery-export 目录。

## 4. 安装第二个 Function Kit 实例

在 Firebase 项目根目录执行同一个安装命令：

~~~bash
firebase functions:kits:install \
  --package @firebase-function-kits/firestore-bigquery-export \
  --project saiflow-509205
~~~

安装过程中的关键输入：

| 安装提示 | 输入 |
|---|---|
| Kit name | firestore-bigquery-export |
| Instance ID | orders-sync |
| Firebase project | saiflow-509205 |

注意：

- Kit name 继续填 firestore-bigquery-export。
- Instance ID 填新的唯一值 orders-sync。
- 不能再次使用已经存在的 firestore-bigquery-export 作为新实例 ID。
- 不要在安装过程中选择覆盖原有配置。
- 不要手工复制一个新的 kit source 对象。
- 不要再次执行 firebase init functions。

## 5. 检查 firebase.json

安装成功后，firebase.json 中应当仍保留原来的 default functions 配置，并在同一个 Function Kit 配置对象的 instances 中增加新实例。

关键结构应类似下面的内容：

~~~json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "disallowLegacyRuntimeConfig": true
    },
    {
      "kit": "firestore-bigquery-export",
      "sourcePackage": {
        "name": "@firebase-function-kits/firestore-bigquery-export"
      },
      "source": "function-kits/firestore-bigquery-export/source",
      "instances": {
        "firestore-bigquery-export": "function-kits/firestore-bigquery-export/config-firestore-bigquery-export",
        "orders-sync": "function-kits/firestore-bigquery-export/config-orders-sync"
      }
    }
  ]
}
~~~

保留原文件中已有的 ignore、predeploy 和其他配置。重点是 instances 中同时存在两个映射：

- firestore-bigquery-export 指向原有配置目录。
- orders-sync 指向新的 config-orders-sync 配置目录。

如果没有自动增加 orders-sync 映射，先停止部署，检查安装命令和 firebase.json 备份，不要手工删除原实例。

## 6. 新实例配置文件

新增实例的配置文件应位于：

~~~text
function-kits/firestore-bigquery-export/config-orders-sync/.env.saiflow-509205
~~~

先查看新目录和原目录：

~~~bash
find function-kits/firestore-bigquery-export -maxdepth 3 -type f -print
~~~

最稳妥的方法是以已经成功运行的原实例配置为模板，只复制配置内容，不复制原实例目录映射：

~~~bash
mkdir -p function-kits/firestore-bigquery-export/config-orders-sync
cp function-kits/firestore-bigquery-export/config-firestore-bigquery-export/.env.saiflow-509205 \
  function-kits/firestore-bigquery-export/config-orders-sync/.env.saiflow-509205
~~~

然后编辑新实例的 .env：

~~~bash
nano function-kits/firestore-bigquery-export/config-orders-sync/.env.saiflow-509205
~~~

新实例至少确认以下配置：

~~~env
DATABASE=fb-saiflow
DATABASE_REGION=asia-southeast1

COLLECTION_PATH=orders
WILDCARD_IDS=false

BIGQUERY_PROJECT_ID=saiflow-509205
DATASET_LOCATION=asia-southeast1
DATASET_ID=firestore_dw
TABLE_ID=orders

FUNCTION_DEFAULT_REGION=asia-southeast1
TRANSFORM_FUNCTION=
~~~

说明：

- DATABASE 使用已成功配置的 Firestore 命名数据库 fb-saiflow；如果 gcloud 查询显示其他数据库 ID，使用实际 ID。
- DATABASE_REGION 使用 Firestore 数据库所在区域 asia-southeast1。
- COLLECTION_PATH 只填写 orders，不要写成 fb-saiflow/orders，也不要写成完整的 projects 路径。
- BIGQUERY_PROJECT_ID 可以与 Firebase 项目相同，当前为 saiflow-509205。
- DATASET_ID 继续使用 firestore_dw 时，TABLE_ID 必须改为 orders。
- DATASET_LOCATION 和 FUNCTION_DEFAULT_REGION 按已成功配置的区域保持为 asia-southeast1。
- TRANSFORM_FUNCTION 保持为空，沿用当前成功配置。
- WILDCARD_IDS 按原实例保持为 false；只有确实要匹配通配符路径时才修改。
- 原实例中已经设置的限速、入队重试次数、备份开关等参数继续沿用。当前成功配置的参考值为每秒最多同步 100 个文档、最多入队尝试 3 次。
- 如果原配置启用了备份集合并使用 bg_users，新实例应改用唯一的 bg_orders，避免两个实例写入同一个备份集合。
- 不要把两个实例的 TABLE_ID 都保留为 users，也不要让两个实例同时使用同一个备份集合名。

## 7. 新实例的表名规则

使用同一个 Dataset 时，Function Kit 会根据 TABLE_ID 生成原始变更表和最新状态表：

| Collection | TABLE_ID | 预期 BigQuery 表 |
|---|---|---|
| users | users | users_raw_changelog、users_raw_latest |
| orders | orders | orders_raw_changelog、orders_raw_latest |

因此，新实例必须使用不同的 TABLE_ID。不要先手动创建与 Function Kit 不兼容的同名表；先让实例的初始化生命周期创建表结构。

## 8. 部署第二个实例

部署前检查目标映射：

~~~bash
firebase functions:kits:list --project=saiflow-509205
~~~

只部署新实例：

~~~bash
firebase deploy \
  --only functions:orders-sync \
  --project=saiflow-509205
~~~

这里的 orders-sync 是实例 ID，不是 kit 名称。

不要使用下面的目标来部署第二个 Collection：

~~~bash
firebase deploy --only functions:firestore-bigquery-export --project=saiflow-509205
~~~

这个目标对应的是原有实例，因为原有实例的 kit 名和实例 ID 恰好相同。

不要使用 default：

~~~bash
firebase deploy --only functions:default --project=saiflow-509205
~~~

default 是普通 Firebase Functions codebase，不是 Function Kit 实例。

首次部署新实例时，Firebase CLI 可能自动完成以下资源创建或更新：

- 新实例的 Firestore / Eventarc 触发器。
- 新实例的 Cloud Tasks 队列。
- 初始化 BigQuery 表的 taskQueue 函数。
- 持续写入 BigQuery 的 Firestore written 触发函数。
- Function Kit 所需的 API、服务账号授权和相关部署资源。

如果 CLI 提示启用 API、授予 IAM 角色或接受条款，按当前项目的管理员流程完成后重新执行同一个部署命令。

## 9. 生命周期初始化

正常情况下，首次部署会运行 afterFirstDeploy 并初始化 BigQuery 表。如果部署完成后没有出现 orders_raw_changelog 或 orders_raw_latest，可手动执行：

~~~bash
firebase functions:lifecycle:run \
  afterFirstDeploy \
  orders-sync \
  --project=saiflow-509205
~~~

生命周期命令中的第二个位置必须是实例 ID orders-sync。

错误示例：

~~~bash
firebase functions:lifecycle:run afterFirstDeploy default --project=saiflow-509205
firebase functions:lifecycle:run afterFirstDeploy firestore-bigquery-export --project=saiflow-509205
~~~

第一个命令把普通 functions codebase 当成 kit 实例，第二个命令会指向原有实例；新增实例应使用 orders-sync。

## 10. 检查部署结果

列出 Function Kit 实例：

~~~bash
firebase functions:kits:list --project=saiflow-509205
~~~

列出函数并筛选新实例：

~~~bash
firebase functions:list --project=saiflow-509205 | grep kit-orders-sync
~~~

新实例通常会出现类似以下函数：

~~~text
kit-orders-sync-fsexportbigquery
kit-orders-sync-initBigQuerySync
kit-orders-sync-setupBigQuerySync
~~~

其中：

- kit-orders-sync-fsexportbigquery 负责接收 Firestore 写入事件。
- kit-orders-sync-initBigQuerySync 负责初始化或检查 BigQuery 同步资源。
- kit-orders-sync-setupBigQuerySync 是 taskQueue 类型的配置函数。

查看新实例日志：

~~~bash
firebase functions:log \
  --only kit-orders-sync-fsexportbigquery \
  --project=saiflow-509205
~~~

如果需要查看初始化或 taskQueue 函数：

~~~bash
firebase functions:log \
  --only kit-orders-sync-initBigQuerySync,kit-orders-sync-setupBigQuerySync \
  --project=saiflow-509205
~~~

## 11. 写入测试数据

在 Firestore 的 orders Collection 中依次测试新增、修改和删除。

建议使用至少一个测试文档：

~~~text
orders/test-order-001
~~~

测试顺序：

1. 新增文档，写入 orderId、status、amount、updatedAt 等字段。
2. 修改 status 或 amount。
3. 删除该文档。
4. 等待事件处理和 Cloud Tasks 队列完成。
5. 分别查询 changelog 和 latest 表。

## 12. BigQuery 查询验证

新实例成功后，Dataset firestore_dw 中应出现：

~~~text
saiflow-509205.firestore_dw.orders_raw_changelog
saiflow-509205.firestore_dw.orders_raw_latest
~~~

查询最近的变更记录：

~~~sql
SELECT
  operation,
  document_name,
  timestamp,
  data
FROM
  `saiflow-509205.firestore_dw.orders_raw_changelog`
ORDER BY
  timestamp DESC
LIMIT 20;
~~~

查询当前每个文档的最新状态：

~~~sql
SELECT *
FROM
  `saiflow-509205.firestore_dw.orders_raw_latest`
LIMIT 20;
~~~

按文档名查看某个测试文档：

~~~sql
SELECT
  operation,
  document_name,
  timestamp,
  data
FROM
  `saiflow-509205.firestore_dw.orders_raw_changelog`
WHERE
  document_name LIKE '%test-order-001%'
ORDER BY
  timestamp ASC;
~~~

使用 bq 命令行查询时指定 Dataset 所在区域，并关闭 Legacy SQL：

~~~bash
bq query \
  --location=asia-southeast1 \
  --use_legacy_sql=false \
  'SELECT operation, document_name, timestamp, data
   FROM `saiflow-509205.firestore_dw.orders_raw_changelog`
   ORDER BY timestamp DESC
   LIMIT 20'
~~~

预期结果：

| Firestore 操作 | changelog 中的 operation | latest 表 |
|---|---|---|
| 新增 | CREATE | 出现该文档当前内容 |
| 修改 | UPDATE | 更新为修改后的内容 |
| 删除 | DELETE | 按 Function Kit 的最新状态规则处理，检查 changelog 中的删除事件 |

## 13. 权限配置

### 13.1 同项目、同 Dataset 的情况

如果新实例仍使用：

- Firebase 项目 saiflow-509205。
- BigQuery 项目 saiflow-509205。
- BigQuery Dataset firestore_dw。
- Firestore 数据库 fb-saiflow。
- 区域 asia-southeast1。

通常不需要为第二个实例重复配置 Firebase、BigQuery、Cloud Tasks、Eventarc 或 IAM。安装和首次部署会复用已有项目配置，并为新实例创建自己的触发器和队列。

仍需确认执行部署的账号有现有项目的部署权限。新增实例不会自动修复原账号缺失的权限。

### 13.2 BigQuery 权限

遇到 BigQuery 权限错误时，按报错账号分别检查：

| 报错或现象 | 重点检查 |
|---|---|
| 403 bigquery.jobs.create | 执行查询或运行任务的账号是否具有项目级 BigQuery Job User |
| 403 table denied / Access Denied | 运行账号或同步服务账号是否具有 Dataset 级读取或写入权限 |
| 无法创建 changelog/latest 表 | 同步运行身份是否具有 Dataset 级 BigQuery Data Editor 或等效写入权限 |
| Dataset 位于其他项目 | 在目标 BigQuery 项目和 Dataset 上分别授权，不要只给 Firebase 项目授权 |

已成功项目记录的查询权限包括：

- 项目级 roles/bigquery.jobUser。
- Dataset 级 roles/bigquery.dataViewer。

如果是 Function Kit 运行时创建或写入表，按错误中显示的运行服务账号补充 Dataset 写入权限。授权后重新运行初始化生命周期，再重新测试写入。

### 13.3 部署权限

如果部署账号发生变化，确认该账号仍具有当前项目所需的 Firebase / Google Cloud 部署权限，包括：

- Firebase Functions 或相应 Firebase 管理权限。
- Service Usage API 启用和服务使用权限。
- Cloud Build 构建权限。
- Artifact Registry 镜像读写权限。
- Cloud Run / Functions v2 部署权限。
- Service Account User。
- Eventarc、Cloud Tasks 和相关服务代理账号的必要权限。

不要直接修改 Google 管理的 service agent 角色。优先根据具体 403 报错确认缺失的主体和资源范围。

## 14. 常见问题和处理

### 14.1 实例 ID 重复

现象：安装时提示 instance already exists，或者 firebase.json 无法新增配置。

处理：

1. 查看现有 instances。
2. 为新任务换一个唯一 ID，例如 orders-sync。
3. 重新执行 functions:kits:install。
4. 不要删除原有 firestore-bigquery-export 实例。

### 14.2 firebase.json 没有新增 instances 映射

现象：安装命令结束后，部署时找不到 functions:orders-sync。

处理：

1. 确认命令是在 Firebase 项目根目录执行。
2. 确认当前目录使用的是正确的 firebase.json。
3. 确认新目录存在 config-orders-sync。
4. 先恢复或对比 firebase.json.bak。
5. 不要重复 firebase init functions。
6. 如果仍未生成映射，重新运行同一个 kit install 命令并检查 CLI 输出。

### 14.3 部署目标写错

现象：部署后只有 users 任务变化，orders 没有新函数。

正确命令：

~~~bash
firebase deploy --only functions:orders-sync --project=saiflow-509205
~~~

不要使用 functions:default 或 functions:firestore-bigquery-export 来代替新实例目标。

### 14.4 复制 .env 后仍写入 users 表

现象：orders 的事件出现在 users_raw_changelog，或者两个任务互相覆盖。

处理：确认新 .env 至少修改：

~~~env
COLLECTION_PATH=orders
TABLE_ID=orders
~~~

如果启用备份集合，同时确认备份名从 bg_users 改为 bg_orders。重新部署新实例。

### 14.5 两个实例使用同一个 TABLE_ID

现象：两条 Collection 的数据混在同一组 raw_changelog/raw_latest 表中。

处理：

- users 实例保留 TABLE_ID=users。
- orders 实例使用 TABLE_ID=orders。
- 其他 Collection 继续使用各自唯一的 TABLE_ID。
- 不要依赖表名后缀区分，直接从配置中确认 TABLE_ID。

### 14.6 Dataset 区域不一致

现象：部署或写入时报 location、multi-region、dataset region 不匹配。

处理：

确认以下值与现有成功配置一致：

~~~env
DATABASE_REGION=asia-southeast1
DATASET_LOCATION=asia-southeast1
FUNCTION_DEFAULT_REGION=asia-southeast1
~~~

BigQuery 查询时也使用：

~~~bash
bq query --location=asia-southeast1 --use_legacy_sql=false
~~~

### 14.7 403 projects:addfirebase 或 Firebase 条款错误

现象：安装或部署过程中提示 Firebase 项目未关联、403、条款未接受或没有权限。

处理：

1. 用项目管理员账号打开 Firebase Console。
2. 选择 saiflow-509205。
3. 确认项目已添加 Firebase。
4. 确认 Firebase Terms 已接受。
5. 确认部署账号对项目有 Firebase 管理权限。
6. 重新登录并重试：

~~~bash
firebase logout
firebase login
firebase use saiflow-509205
~~~

### 14.8 403 bigquery.jobs.create 或表权限错误

处理顺序：

1. 记录报错中的主体账号。
2. 对该主体检查项目级 BigQuery Job User。
3. 对 Dataset 检查 BigQuery Data Viewer 或写入所需的 Data Editor。
4. 重新运行 afterFirstDeploy。
5. 新增一条 orders 测试文档并查看日志。

不要只给自己的登录账号授权后就认为 Function Kit 运行账号也已经有权限。

### 14.9 Cloud Build / Artifact Registry / Storage 403

现象：Function Kit 配置正常，但构建或部署阶段被拒绝。

处理：

1. 确认部署账号是否为当前登录账号。
2. 确认 Cloud Build、Artifact Registry、Cloud Run 和 Service Account User 权限。
3. 如果报错明确指向构建产物存储桶，按报错主体和桶资源范围补充 Storage Object Viewer 或所需存储权限。
4. 重新执行只部署新实例的命令。

### 14.10 表已存在但 schema 不兼容

现象：初始化或写入时提示表已存在、字段类型不兼容或 schema 错误。

处理：

1. 确认 TABLE_ID 没有误用已有表名。
2. 确认没有手工创建同名但不兼容的表。
3. 使用新的唯一 TABLE_ID 进行验证。
4. 保留原 users 表，不要为排查问题直接删除生产数据。

### 14.11 新实例没有历史数据

现象：新实例部署后，orders 中已有的旧文档没有出现在 BigQuery。

原因：持续同步触发器默认处理部署后的新增、修改和删除事件，不会自动回填部署前的历史文档。

处理：

1. 先确认新增、修改、删除事件能够正常同步。
2. 如果需要历史回填，单独执行经过验证的 Firestore 到 BigQuery 回填流程。
3. 回填完成后再继续使用 Function Kit 处理增量事件。
4. 避免回填和增量任务同时写入同一目标表而没有去重策略。

## 15. 最短可执行命令清单

下面是新增 orders 任务的最短流程：

~~~bash
cd ~/SaiFlow/firestore-bigquery-sync

firebase --version
firebase use saiflow-509205

firebase functions:kits:install \
  --package @firebase-function-kits/firestore-bigquery-export \
  --project saiflow-509205

cp function-kits/firestore-bigquery-export/config-firestore-bigquery-export/.env.saiflow-509205 \
  function-kits/firestore-bigquery-export/config-orders-sync/.env.saiflow-509205

nano function-kits/firestore-bigquery-export/config-orders-sync/.env.saiflow-509205

firebase deploy \
  --only functions:orders-sync \
  --project=saiflow-509205

firebase functions:lifecycle:run \
  afterFirstDeploy \
  orders-sync \
  --project=saiflow-509205

firebase functions:list \
  --project=saiflow-509205 | grep kit-orders-sync

firebase functions:log \
  --only kit-orders-sync-fsexportbigquery \
  --project=saiflow-509205
~~~

编辑新 .env 时至少确认：

~~~env
DATABASE=fb-saiflow
DATABASE_REGION=asia-southeast1
COLLECTION_PATH=orders
BIGQUERY_PROJECT_ID=saiflow-509205
DATASET_LOCATION=asia-southeast1
DATASET_ID=firestore_dw
TABLE_ID=orders
FUNCTION_DEFAULT_REGION=asia-southeast1
TRANSFORM_FUNCTION=
~~~

## 16. 完成检查表

- [ ] Firebase CLI 版本至少为 15.32.0。
- [ ] 当前项目为 saiflow-509205。
- [ ] Kit name 为 firestore-bigquery-export。
- [ ] 新实例 ID 为唯一值 orders-sync。
- [ ] firebase.json 的同一个 instances 对象中同时存在原实例和新实例。
- [ ] 新配置路径为 config-orders-sync/.env.saiflow-509205。
- [ ] DATABASE 为实际 Firestore 数据库 ID fb-saiflow。
- [ ] COLLECTION_PATH 已改为 orders。
- [ ] TABLE_ID 已改为 orders。
- [ ] 备份集合（如启用）已从 bg_users 改为 bg_orders。
- [ ] DATASET_ID 为 firestore_dw。
- [ ] Firestore、BigQuery、Functions 区域一致为 asia-southeast1。
- [ ] 已使用 functions:orders-sync 部署。
- [ ] 如有需要，已使用 orders-sync 运行 afterFirstDeploy。
- [ ] 已看到 kit-orders-sync-fsexportbigquery、initBigQuerySync、setupBigQuerySync。
- [ ] 已确认 orders_raw_changelog 和 orders_raw_latest。
- [ ] 已验证新增、修改和删除事件。
- [ ] 已确认新增实例不会把历史文档自动回填到 BigQuery。

## 17. 参考资料

- Firebase Function Kit migration best practices：同一个 kit 可在同一项目中安装多个实例，实例使用独立的配置目录和部署目标。
- Firebase Function Kit firestore-bigquery-export 文档：环境变量、初始化生命周期、BigQuery changelog/latest 表和事件同步行为。
- Google Cloud IAM 文档：BigQuery Job User、Dataset Data Viewer、Dataset Data Editor，以及 Cloud Functions、Cloud Build、Artifact Registry 的部署权限。

