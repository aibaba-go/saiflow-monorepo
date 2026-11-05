## MODIFIED Requirements

### Requirement: FR-SYS-030 套餐目录
系统 SHALL 有四档套餐：Kinder、Starter、Intermediate、Advance。每档 SHALL 有每月扫描配额、成员人数上限、按月价与按年价（泰铢），初始值如下：

| 档位 | 每月扫描配额 | 成员人数上限 | 按月价 | 按年价 | 适用的租户 |
|---|---:|---|---:|---:|---|
| Kinder | 1,000 | 1 | 未设定 | 888 | 个人租户、游客临时租户 |
| Starter | 5,000 | 2 | 599 | 5,990 | 组织 |
| Intermediate | 10,000 | 5 | 未设定 | 未设定 | 组织 |
| Advance | 100,000 | 不限 | 未设定 | 未设定 | 组织 |

价格"未设定"表示联系销售询价。价格只用于展示；付款一律线下进行，系统 SHALL NOT 按价格收费或计算金额。

平台 admin SHALL 可以通过后台接口查看套餐目录，并修改每档的每月扫描配额（不小于 1 的整数）、Starter、Intermediate、Advance 的成员人数上限（不小于 1 的整数，或不限），以及每档的按月价与按年价（不小于 0、最多两位小数的金额，或未设定）。Kinder 的成员人数上限 SHALL 固定为 1，不可修改。

客户（含游客）SHALL 可以查看套餐目录：每档的档位、每月扫描配额、成员人数上限、按月价、按年价与适用的租户类型。

修改 SHALL 对已有订阅立即生效。档位的增减与适用的租户类型 SHALL NOT 能在运行期修改。

#### Scenario: AC-FR-SYS-030-01 查看套餐目录
- **GIVEN** 一个刚部署的系统
- **WHEN** 平台 admin 查看套餐目录
- **THEN** 返回四档套餐及上表中的每月扫描配额、成员人数上限、价格与适用的租户

#### Scenario: AC-FR-SYS-030-02 修改配额对已有订阅立即生效
- **GIVEN** 组织 O 订阅了 Starter，本月已用 4,000 次
- **WHEN** 平台 admin 把 Starter 的每月扫描配额改为 4,500，随后 O 查询用量
- **THEN** O 本月的配额为 4,500，剩余 500

#### Scenario: AC-FR-SYS-030-03 Kinder 的成员人数上限不可修改
- **GIVEN** 平台 admin
- **WHEN** 把 Kinder 的成员人数上限改为 3
- **THEN** 返回 HTTP 400 并指出成员人数上限字段，Kinder 不变

#### Scenario: AC-FR-SYS-030-04 数值校验
- **GIVEN** 平台 admin
- **WHEN** 把某档的每月扫描配额改为 0、负数或非整数，或把成员人数上限改为 0
- **THEN** 返回 HTTP 400 并指出出错的字段，套餐不变

#### Scenario: AC-FR-SYS-030-05 只接受后台会话
- **GIVEN** 一个有效的客户会话
- **WHEN** 调用修改套餐的后台接口
- **THEN** 被拒绝（HTTP 401 或 403），套餐不变

#### Scenario: AC-FR-SYS-030-06 修改价格
- **GIVEN** 平台 admin
- **WHEN** 把 Intermediate 的按月价设为 1,290，随后把它清除为未设定
- **THEN** 套餐目录中 Intermediate 的按月价先为 1,290，之后为未设定；其他档位不变

#### Scenario: AC-FR-SYS-030-07 价格校验
- **GIVEN** 平台 admin
- **WHEN** 把某档价格设为负数、超过两位小数的金额或非数字
- **THEN** 返回 HTTP 400 并指出出错的字段，套餐不变

#### Scenario: AC-FR-SYS-030-08 客户查看套餐目录
- **GIVEN** 一个游客会话或已登录用户
- **WHEN** 查看套餐目录
- **THEN** 返回四档套餐的档位、每月扫描配额、成员人数上限、按月价、按年价与适用的租户类型，不需要后台会话
