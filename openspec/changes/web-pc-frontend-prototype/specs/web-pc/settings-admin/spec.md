# Delta Spec: web-pc/settings-admin

## Purpose

为 Web PC 前端原型提供管理员设置页：单据参数与归档设置、按单据类型的复核级别（0/1/2）配置，以及操作日志查看。配置在原型中以 Mock 存储，保存后立即影响相关页面表现。

## ADDED Requirements

### Requirement: 参数与归档设置

系统 SHALL 提供设置页，包含：导出保存路径、归档命名规则、归档分类前缀等参数的查看与修改；修改保存后 SHALL 立即生效（Mock 存储），并 SHALL 在保存时提示变更已被记录。（来源：FR-SYS-005/006）

#### Scenario: 修改归档命名规则

- **WHEN** admin 修改归档命名规则并保存
- **THEN** 界面提示保存成功，且归档/导出相关页面使用新规则回显命名预览

#### Scenario: 非 admin 无法访问设置

- **WHEN** 以 `clerk` 角色登录的用户直接访问设置页路由
- **THEN** 系统拒绝访问并提示权限不足

### Requirement: 复核级别配置

系统 SHALL 提供按单据类型配置复核级别（无需复核 0 / 一级 1 / 二级 2）的界面；保存后核验工作台的复核流程 SHALL 按新级别运行。（来源：FR-VERIFY-010）

#### Scenario: 将 Invoice 配置为二级复核

- **WHEN** admin 将 Invoice 的复核级别设为 2 并保存
- **THEN** 核验工作台中 Invoice 单据确认后进入 pending_review_level_1，一级通过后进入 pending_review_level_2

### Requirement: 操作日志查看

系统 SHALL 提供操作日志列表（Mock 数据），每条 SHALL 包含用户、操作、目标、时间与结果；日志 SHALL 可按时间倒序查看。该页面 SHALL 仅对 admin 角色可见。（来源：FR-SYS-003）

#### Scenario: 查看操作日志

- **WHEN** admin 打开操作日志页面
- **THEN** 系统按时间倒序展示日志列表，每条含用户、操作、目标、时间与结果

#### Scenario: 原型内操作产生日志

- **WHEN** 用户在原型中完成一次核验确认
- **THEN** 操作日志列表新增一条对应记录
