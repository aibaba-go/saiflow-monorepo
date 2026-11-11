## MODIFIED Requirements

### Requirement: FR-SYS-070 查询用户
admin 打开"用户"页时 SHALL 默认按注册时间从新到旧分页列出全部客户用户（FR-SYS-080，每页 50 条），显示当前页码，并 SHALL 提供"上一页""下一页"（第 1 页时"上一页"不可用，没有下一页时"下一页"不可用）。admin SHALL 可以按邮箱、昵称或用户 ID 查询用户，查询后列表只显示匹配结果并从第 1 页开始；清空输入后再查询 SHALL 回到全部用户的第 1 页。admin SHALL 可以查看结果中的昵称、邮箱、手机号、是否已注册、个人租户与注册时间，并 SHALL 可以进入该用户个人租户的订阅与预占（FR-SYS-066）。输入 1 个不是数字的字符时 SHALL 提示至少输入 2 个字符，不发起查询，列表保持不变。

#### Scenario: AC-FR-SYS-070-01 查询并进入个人租户
- **GIVEN** 已注册用户 Somchai，邮箱 somchai@example.com
- **WHEN** admin 输入"somchai"查询，并点击该用户的个人租户
- **THEN** 结果中有 Somchai 及其邮箱与注册时间；进入其个人租户的订阅与预占

#### Scenario: AC-FR-SYS-070-02 输入过短
- **GIVEN** 查询用户页
- **WHEN** 只输入 1 个字符
- **THEN** 提示至少输入 2 个字符，不发起查询

#### Scenario: AC-FR-SYS-070-03 默认分页列出全部用户
- **GIVEN** 共有 60 个客户用户
- **WHEN** admin 打开"用户"页，再点击"下一页"
- **THEN** 打开即显示最新的 50 个用户、第 1 页，"上一页"不可用；点击后显示其余 10 个、第 2 页，"下一页"不可用

#### Scenario: AC-FR-SYS-070-04 清空查询回到全部用户
- **GIVEN** admin 已查询"somchai"，列表只有 Somchai
- **WHEN** 清空输入后再查询
- **THEN** 列表回到全部用户的第 1 页
