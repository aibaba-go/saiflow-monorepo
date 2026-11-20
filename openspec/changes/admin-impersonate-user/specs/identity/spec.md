## ADDED Requirements

### Requirement: FR-SYS-145 管理员代登录链接
平台管理员 SHALL 可以为一个已注册的客户用户签发一次性进入链接，用于以该用户身份进入 web-pc。票据 SHALL 是随机值，数据库 SHALL 只保存其 SHA-256；票据 SHALL 在签发后 60 秒内有效，且 SHALL 只能兑换一次。用户不存在 SHALL 返回 HTTP 404；用户未注册 SHALL 返回 HTTP 409；未配置 web-pc 地址时 SHALL 返回 HTTP 503；客户会话 SHALL NOT 能签发。无效、过期或已用过的票据 SHALL 返回 HTTP 401，且 SHALL NOT 改变浏览器原有的会话。签发与兑换 SHALL 各写一条操作日志，操作者为该管理员、对象为该用户，兑换失败记为失败；日志 SHALL NOT 包含票据或会话值。

#### Scenario: AC-FR-SYS-145-01 签发并进入
- **GIVEN** 已注册用户 Somchai 与平台管理员 ops
- **WHEN** ops 为 Somchai 签发链接，另一浏览器在 60 秒内兑换票据
- **THEN** 该浏览器得到 Somchai 的会话，`/me` 返回其用户 ID 与个人租户；数据库中没有票据明文；操作日志有签发与进入两条成功记录，操作者为 ops

#### Scenario: AC-FR-SYS-145-02 票据只能用一次且 60 秒过期
- **GIVEN** 一张已兑换的票据，以及一张签发已超过 60 秒的票据
- **WHEN** 再次兑换它们
- **THEN** 都返回 HTTP 401，浏览器原有会话不变，操作日志记失败

#### Scenario: AC-FR-SYS-145-03 只能代登录已注册用户
- **GIVEN** 一个未注册用户、一个不存在的用户 ID，以及一个客户会话
- **WHEN** 管理员为前两者签发；客户会话调用签发接口
- **THEN** 依次返回 HTTP 409、404；客户会话被拒绝（HTTP 401）

### Requirement: FR-SYS-148 代登录会话
兑换代登录票据（FR-SYS-145）SHALL 建立该用户的客户会话（租户为其个人租户），会话 SHALL 记录发起的管理员。代登录会话 SHALL 在闲置 30 分钟或建立 2 小时后结束；发起的管理员账号停用后 SHALL 立即失效。兑换 SHALL 替换同一浏览器上原有的客户会话，SHALL NOT 归集游客数据，SHALL NOT 影响该用户在其他设备上的会话。`GET /api/v1/me` SHALL 返回 `impersonated`：代登录会话为 true，其他会话为 false。

#### Scenario: AC-FR-SYS-148-01 标明代登录
- **GIVEN** 一个代登录会话与该用户本人的 LINE 会话
- **WHEN** 两者分别请求 `/me`
- **THEN** 前者 `impersonated` 为 true，后者为 false

#### Scenario: AC-FR-SYS-148-02 代登录会话的时限
- **GIVEN** 一个代登录会话
- **WHEN** 闲置超过 30 分钟；或建立超过 2 小时（期间一直在用）；或发起的管理员账号被停用
- **THEN** 每种情况下该会话都失效，请求返回 HTTP 401；用户本人的普通会话不受影响

#### Scenario: AC-FR-SYS-148-03 替换本浏览器会话、不归集游客
- **GIVEN** 浏览器上有一个游客会话（含游客数据），用户本人另有一个 LINE 会话
- **WHEN** 在该浏览器兑换票据
- **THEN** 游客会话被结束，游客数据不归入用户；用户本人的 LINE 会话仍有效
