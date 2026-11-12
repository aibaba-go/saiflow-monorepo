## ADDED Requirements

### Requirement: FR-SYS-159 报表查看菜单
web-pc SHALL 提供独立的"报表查看"菜单，供只需阅读报表的成员直接打开已发布的报表。

- "报表查看"位于"工作区"分组末尾；仅当当前租户为有效 Starter 及以上套餐的组织，且用户持有 `report_view` 或为 owner 时显示（与 FR-SYS-141 的展示条件相同）。
- 原"报表"菜单改名"报表管理"，仅对同一套餐条件下持有 `report_manage` 的成员或 owner 显示，用于设计、发布与管理。
- 只持有 `report_view` 的成员直接打开 `/reports` 时 SHALL 转到 `/report-view`。
- 菜单隐藏不代替校验：路由与后端的检查与 FR-SYS-141 相同。

#### Scenario: AC-FR-SYS-159-01 按权限显示两个菜单
- **GIVEN** 组织 O 为 Starter 套餐；成员 V 只持有 `report_view`；owner 或持有 `report_manage` 与 `report_view` 的成员 M
- **WHEN** V 与 M 分别登录 web-pc 查看菜单
- **THEN** V 只看到"报表查看"；M 同时看到"报表查看"与"报表管理"

#### Scenario: AC-FR-SYS-159-02 只读成员打开管理地址时转向
- **GIVEN** 成员 V 只持有 `report_view`
- **WHEN** V 在地址栏打开 `/reports`
- **THEN** 转到 `/report-view`，菜单选中"报表查看"

#### Scenario: AC-FR-SYS-159-03 不满足条件时隐藏并拒绝
- **GIVEN** 个人空间、Kinder 套餐的组织，或没有 `report_view` 的组织成员
- **WHEN** 查看菜单，或直接打开 `/report-view`
- **THEN** 不显示"报表查看"；页面显示与 FR-SYS-141 相同的说明，不请求报表列表

### Requirement: FR-SYS-160 报表查看列表与展示页
`/report-view` SHALL 以卡片列出当前组织已发布的报表（发布名称、发布版本、曼谷时间的发布时间），未发布的草稿 SHALL NOT 出现，SHALL NOT 提供新建、设计、发布、撤回或删除；没有已发布报表时显示空状态说明。点击卡片 SHALL 进入 `/report-view/{id}`，其展示与 FR-SYS-141 的只读展示相同；"返回列表"与"报表已撤回"的返回 SHALL 回到 `/report-view`，菜单保持"报表查看"选中。切换租户 SHALL 只显示新租户的报表。

#### Scenario: AC-FR-SYS-160-01 从列表打开并返回
- **GIVEN** 组织 O 有已发布报表 R（v2）与一份未发布草稿 D；成员 V 持有 `report_view`
- **WHEN** V 打开"报表查看"
- **THEN** 卡片显示 R 的名称、v2 与发布时间，不显示 D，也没有新建或设计按钮
- **WHEN** V 打开 R，再点击"返回列表"
- **THEN** 显示 R 的只读展示且菜单选中"报表查看"；返回后回到"报表查看"列表

#### Scenario: AC-FR-SYS-160-02 没有已发布的报表
- **GIVEN** 组织 O 只有草稿或没有报表
- **WHEN** 成员 V 打开"报表查看"
- **THEN** 显示"暂无已发布的报表"的空状态
