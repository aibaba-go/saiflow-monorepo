## ADDED Requirements

### Requirement: FR-SYS-147 代登录入口与提示
web-pc SHALL 提供 `/impersonate` 页：票据放在地址的片段（`#` 之后），页面 SHALL 先从地址栏移除票据再兑换（FR-SYS-145）。兑换成功 SHALL 进入首页；失败 SHALL 说明链接无效或已过期，并提供前往登录页的链接。

代登录期间每个页面顶部 SHALL 显示醒目横幅"管理员代登录：正在以 {昵称} 的身份操作"以及"结束代登录"。点击"结束代登录" SHALL 退出该会话（FR-SYS-092）并回到登录页。非代登录会话 SHALL NOT 显示该横幅。

#### Scenario: AC-FR-SYS-147-01 打开链接进入
- **GIVEN** 一个有效的代登录链接
- **WHEN** 在 web-pc 打开
- **THEN** 地址栏不再含票据，进入首页，顶部显示代登录横幅与用户昵称

#### Scenario: AC-FR-SYS-147-02 链接失效
- **GIVEN** 一个已用过或过期的链接，或没有票据的 `/impersonate`
- **WHEN** 打开
- **THEN** 显示"链接无效或已过期"与前往登录页的链接，不进入系统

#### Scenario: AC-FR-SYS-147-03 结束代登录
- **GIVEN** 代登录中的页面，以及一个普通登录的页面
- **WHEN** 在前者点击"结束代登录"
- **THEN** 会话结束并回到登录页；普通登录的页面没有代登录横幅
