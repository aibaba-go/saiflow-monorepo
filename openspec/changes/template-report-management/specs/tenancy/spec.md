# tenancy Spec Delta

## MODIFIED Requirements

### Requirement: FR-SYS-002 角色与权限点
权限点 SHALL 为设计期固定的14项：上传与识别、核验与确认、核验他人单据、一级复核、二级复核、导出、数据浏览、成员管理、角色管理、套餐申请、企业认证申请、模板管理、报表查看、报表管理。组织 SHALL 有一名全权限 owner（不可分配其他角色）及不可删除默认角色，初始为上传与识别/核验与确认/导出，新成员获默认角色。角色管理者 SHALL 可增改删自定义角色、改默认权限及分配角色；名称本组织唯一且≤64字，权限可为空；每成员仅一角色，删除自定义角色后其成员回默认。SHALL 禁止修改 owner 角色、改变本人角色或编辑本人当前角色。后端 SHALL 按当前租户权限执行，无权403且不改数据；个人本人视同全权限，运行期不得增删权限点。

#### Scenario: AC-FR-SYS-002-01 权限点强制执行
- **GIVEN** 组织 O 中一名角色不含"导出"的成员
- **WHEN** 调用一个要求"导出"权限点的操作
- **THEN** 返回 HTTP 403，不产生任何数据

#### Scenario: AC-FR-SYS-002-02 默认角色
- **GIVEN** 一个刚成立的组织
- **WHEN** 查看其角色
- **THEN** 有一个默认角色，权限点为"上传与识别""核验与确认""导出"

#### Scenario: AC-FR-SYS-002-03 自定义角色
- **GIVEN** 组织 O 的 owner
- **WHEN** 新建一个名为"复核员"、权限点为"一级复核"与"数据浏览"的角色，并分配给成员 M
- **THEN** M 的权限点为"一级复核"与"数据浏览"，不再有默认角色的权限点

#### Scenario: AC-FR-SYS-002-04 角色名称与权限点校验
- **GIVEN** 组织 O 中已有角色"复核员"
- **WHEN** 再新建同名角色、新建名称超过 64 个字符的角色、或新建含有不存在的权限点的角色
- **THEN** 同名返回 HTTP 409；后两者返回 HTTP 400 并指出出错的字段；不产生角色

#### Scenario: AC-FR-SYS-002-05 修改默认角色影响持有者
- **GIVEN** 组织 O 中成员 M 持有默认角色
- **WHEN** owner 从默认角色中去掉"导出"
- **THEN** M 调用要求"导出"的操作返回 HTTP 403

#### Scenario: AC-FR-SYS-002-06 删除正在使用的角色
- **GIVEN** 组织 O 中成员 M 持有自定义角色 R
- **WHEN** owner 删除 R，以及尝试删除默认角色
- **THEN** R 被删除，M 改为默认角色；删除默认角色返回 HTTP 409

#### Scenario: AC-FR-SYS-002-07 owner 与本人角色受保护
- **GIVEN** 组织 O 中一名持有"角色管理"但不是 owner 的成员 A
- **WHEN** A 尝试修改 owner 的角色、把本人改为另一个角色、或修改本人当前角色的权限点
- **THEN** 三次都返回 HTTP 403，角色与权限点不变

#### Scenario: AC-FR-SYS-002-08 复核与报表权限可以授予
- **GIVEN** 组织 O 的 owner
- **WHEN** 把"一级复核""二级复核""报表查看"加入某个角色
- **THEN** 该角色的持有者拥有这三个权限点（原 AC-FR-SYS-009-01）

#### Scenario: AC-FR-SYS-002-09 没有权限的成员不能管理角色
- **GIVEN** 组织 O 中一名角色不含"角色管理"的成员
- **WHEN** 新建角色或为他人分配角色
- **THEN** 返回 HTTP 403，角色与分配不变

#### Scenario: AC-FR-SYS-002-10 新权限不改变旧授权
- **GIVEN** 现有组织、owner、默认角色及只含 report_view 的自定义角色
- **WHEN** 系统增加报表管理权限点
- **THEN** owner 获全部14项，默认及自定义角色保留原权限而不自动获得 report_manage；无 data_browse 的数据范围仍为本人

## ADDED Requirements

### Requirement: FR-SYS-139 报表管理权限点
系统 SHALL 增加可组合权限点“报表管理”（report_manage）：组织 owner 或持有者可设计/保存/预览/发布/撤销发布/删除本组织报表，仍服从 reporting 的有效 Starter+ 门槛与业务范围。report_manage SHALL 不隐含 report_view、data_browse、export 或 template_manage；平台 admin 配置管理 SHALL 不作为组织权限点，也不授予业务访问。

#### Scenario: AC-FR-SYS-139-01 可委派独立报表管理
- **GIVEN** owner 为 M 的角色加入 report_manage，但不含 report_view/data_browse/export/template_manage
- **WHEN** M 设计、预览、发布并尝试已发布查看、导出或模板修改
- **THEN** 在有效组织套餐下可管理报表，预览仅本人数据；其他请求仍按各权限被拒绝

#### Scenario: AC-FR-SYS-139-02 权限撤销即时生效
- **GIVEN** M 已打开报表设计器，owner 随后撤销其 report_manage
- **WHEN** M 再保存或发布
- **THEN** 服务端返回 403，不改变草稿或旧发布配置
