# ocr-settings Spec Delta

## MODIFIED Requirements

### Requirement: FR-SYS-005 OCR 引擎与大模型配置
系统 SHALL 保存一组全系统共用的 OCR 与大模型配置，初始值如下（PRD §4.6）：

| 配置项 | 初始值 | 允许的值 |
|---|---|---|
| 首选引擎 | TextIn | TextIn、Google Document AI OCR |
| 备用引擎 | Google Document AI OCR | TextIn、Google Document AI OCR、不使用；不能与首选引擎相同 |
| 单据重试次数 | 3 | 1 至 10 的整数 |
| 全局切换阈值（首选引擎连续失败的次数） | 5 | 1 至 100 的整数 |
| 首选引擎试探间隔（秒） | 300 | 30 至 86,400 的整数 |
| 大模型地址 | `https://api.deepseek.com` | 以 `https://` 开头、不超过 500 个字符的地址 |
| 大模型名称 | `deepseek-flash` | 1 至 100 个字符 |

各引擎与大模型的密钥 SHALL 只存放在服务器的环境变量文件中，SHALL NOT 保存在数据库中，SHALL NOT 由任何接口返回或接收。Google Document AI OCR 使用服务器上挂载的服务账号凭据文件（与私有对象存储共用），以及环境变量中的项目、地区（默认 `asia-southeast1`）与处理器编号；凭据文件、项目与处理器三者齐备时，其密钥状态为已配置。

平台 admin SHALL 可以通过后台接口：
- 查看全部配置，以及每项密钥是否已配置（是或否）；
- 修改上述配置项，只提交需要改的项。

不符合允许值的修改 SHALL 被整体拒绝（HTTP 400 并指出出错的项），配置不变。修改 SHALL 写入操作日志（FR-SYS-003），记录改了哪些项，SHALL NOT 记录密钥。修改 SHALL 对之后开始的识别立即生效。

系统 SHALL 提供一个读取接口给识别流程使用，返回当前配置。客户会话 SHALL NOT 能查看或修改这些配置。

已停用的 Google Cloud Vision SHALL NOT 再作为允许的值；升级时已保存为 Google Cloud Vision 的首选或备用 SHALL 改为 Google Document AI OCR，其他配置不变。

#### Scenario: AC-FR-SYS-005-01 初始配置与密钥状态
- **GIVEN** 一个刚部署的系统，服务器上配置了 TextIn 的密钥，未配置 Google Document AI OCR 的凭据或处理器，也未配置大模型的密钥
- **WHEN** 平台 admin 查看 OCR 与大模型配置
- **THEN** 返回上表的初始值；TextIn 的密钥为已配置，Google Document AI OCR 与大模型的密钥为未配置；响应中不含任何密钥、凭据路径或处理器编号

#### Scenario: AC-FR-SYS-005-02 修改部分配置
- **GIVEN** 初始配置
- **WHEN** 平台 admin 只提交单据重试次数 2
- **THEN** 单据重试次数为 2，其他配置不变；操作日志有一条记录，注明修改的项

#### Scenario: AC-FR-SYS-005-03 校验
- **GIVEN** 初始配置
- **WHEN** 平台 admin 提交以下任一修改：首选与备用为同一引擎；不认识的引擎名称（包括已停用的 Google Cloud Vision）；重试次数 0 或 11 或非整数；大模型地址以 `http://` 开头
- **THEN** 返回 HTTP 400 并指出出错的项，配置不变

#### Scenario: AC-FR-SYS-005-04 识别流程读取
- **GIVEN** 平台 admin 把首选引擎改为 Google Document AI OCR、备用改为 TextIn
- **WHEN** 识别流程读取配置
- **THEN** 得到首选 Google Document AI OCR、备用 TextIn 与其余当前值

#### Scenario: AC-FR-SYS-005-05 只接受后台会话
- **GIVEN** 一个有效的客户会话
- **WHEN** 查看或修改 OCR 与大模型配置
- **THEN** 被拒绝（HTTP 401 或 403），配置不变

#### Scenario: AC-FR-SYS-005-06 升级替换旧引擎
- **GIVEN** 升级前已保存首选 TextIn、备用 Google Cloud Vision、重试次数 2；另有以 Google Cloud Vision 完成的历史任务
- **WHEN** 执行升级并读取配置
- **THEN** 首选 TextIn、备用 Google Document AI OCR、重试次数 2；历史任务与其原始结果仍记录为 Google Cloud Vision，内容不变
