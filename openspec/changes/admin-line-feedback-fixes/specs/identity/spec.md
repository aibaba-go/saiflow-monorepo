## MODIFIED Requirements

### Requirement: FR-SYS-080 后台查询用户
平台管理员 SHALL 可以通过后台接口查询客户用户：按邮箱或昵称部分匹配（不区分大小写，至少 2 个字符）；输入纯数字时还 SHALL 按用户 ID 精确匹配，纯数字不受 2 个字符的限制。查询词为空（或只有空白）时 SHALL 返回全部客户用户。结果 SHALL 按注册时间从新到旧，每页最多 50 条，每条包括用户 ID、昵称、邮箱、手机号、是否已注册、注册时间与个人租户 ID，并 SHALL 说明是否还有下一页。结果 SHALL NOT 包含 LINE 身份 ID、会话或任何凭据。游客 SHALL NOT 出现在结果中。查询 SHALL 只读，SHALL NOT 写入操作日志。非空、不是纯数字且少于 2 个字符的查询 SHALL 返回 HTTP 400。客户会话 SHALL NOT 能查询。

#### Scenario: AC-FR-SYS-080-01 按邮箱或昵称查询
- **GIVEN** 已注册用户 Somchai（somchai@example.com）与 Malee（malee@example.com），以及若干游客
- **WHEN** 平台管理员查询 "SOMCHAI"，以及查询 "example.com"
- **THEN** 前者只返回 Somchai；后者返回两人，不含游客；每条有个人租户 ID，没有 LINE 身份 ID

#### Scenario: AC-FR-SYS-080-02 按用户 ID 查询
- **GIVEN** 用户 ID 为 7 的用户
- **WHEN** 平台管理员查询 "7"
- **THEN** 返回该用户；只有 1 个字符的数字查询不做邮箱与昵称匹配

#### Scenario: AC-FR-SYS-080-03 输入过短与会话
- **GIVEN** 平台管理员，以及一个客户会话
- **WHEN** 平台管理员查询 "s"（1 个字符，不是数字）；客户会话调用该接口
- **THEN** 前者返回 HTTP 400；后者被拒绝（HTTP 401 或 403）

#### Scenario: AC-FR-SYS-080-04 不带查询词列出全部用户
- **GIVEN** 52 个客户用户（含未注册但不是游客的用户）与若干游客
- **WHEN** 平台管理员不带查询词（或查询词只有空白）查询第 1 页，再查询第 2 页
- **THEN** 第 1 页为最新的 50 个用户并标明还有下一页；第 2 页为其余 2 个且没有下一页；两页没有重复，都不含游客；操作日志条数不变
