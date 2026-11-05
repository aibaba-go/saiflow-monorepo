# tenancy Specification

## Purpose
租户与组织：业务数据按租户归属的访问规则（个人租户、游客临时租户、组织），组织的申请与平台 admin 审批、平台 admin 管理组织、组织资料修改，角色与权限点，成员邀请与成员人数上限，成员移除、退出与 owner 转让，企业认证，以及这些操作的操作日志。套餐、免费额度与计量不在本能力内（B-2c）；上传、识别、单据等业务能力遵守本能力的访问规则。

## Requirements

### Requirement: FR-SYS-017 租户访问规则
每个改变或读取业务数据的请求 SHALL 作用于一个确定的租户；请求未指定租户时 SHALL 作用于调用者本人的个人租户（游客为其临时租户）。

用户可以使用的租户 SHALL 为：本人的个人租户，以及本人为有效成员且处于启用状态的组织。系统 SHALL 提供接口列出这些租户及本人在每个组织中的角色。

个人租户中的数据：
- SHALL 只对本人可见；
- SHALL NOT 因本人加入、建立或离开组织而迁移到组织中。

组织中的数据：
- SHALL 只对该组织的有效成员开放；
- 成员能看到哪些数据 SHALL 由其权限点决定：没有"数据浏览"权限点的成员 SHALL 只能看到与处理本人提交的数据。

调用者访问一个不能使用的租户（不是其成员、组织已停用或不存在）时，系统 SHALL 返回 HTTP 404，SHALL NOT 透露该租户是否存在。

#### Scenario: AC-FR-SYS-017-01 未指定租户时使用个人租户
- **GIVEN** 一个已登录用户，同时是组织 O 的成员
- **WHEN** 发起一个未指定租户的业务请求
- **THEN** 请求作用于该用户的个人租户

#### Scenario: AC-FR-SYS-017-02 列出可使用的租户
- **GIVEN** 用户 U 是组织 O1 的成员、组织 O2 的 owner，曾是组织 O3 的成员但已被移除，组织 O4 已停用而 U 是其成员
- **WHEN** U 请求列出可使用的租户
- **THEN** 返回 U 的个人租户、O1 与 O2，并分别给出 U 在 O1 与 O2 中的角色；不返回 O3 与 O4

#### Scenario: AC-FR-SYS-017-03 个人数据不进入组织
- **GIVEN** 用户 U 的个人租户中有数据 D，U 随后建立了组织 O
- **WHEN** O 的另一名持有"数据浏览"的成员读取 O 的全部数据，U 读取本人个人租户的数据
- **THEN** 前者的结果中没有 D；后者的结果中有 D

#### Scenario: AC-FR-SYS-017-04 非成员访问组织
- **GIVEN** 组织 O 中有数据，用户 V 不是 O 的成员
- **WHEN** V 以 O 为租户读取数据，以及以一个不存在的租户读取数据
- **THEN** 两次都返回 HTTP 404，响应的错误码相同，不返回任何 O 的数据

#### Scenario: AC-FR-SYS-017-05 没有数据浏览权限只见本人提交
- **GIVEN** 组织 O 中有成员 A 与 B 各自提交的数据；A 的角色没有"数据浏览"，B 的角色有"数据浏览"
- **WHEN** A 与 B 分别读取 O 的数据
- **THEN** A 只得到本人提交的数据；B 得到 O 的全部数据

#### Scenario: AC-FR-SYS-017-06 停用的组织
- **GIVEN** 组织 O 已被平台 admin 停用，用户 U 是 O 的成员
- **WHEN** U 以 O 为租户读取或修改数据
- **THEN** 返回 HTTP 404，数据不变

### Requirement: FR-SYS-021 组织的申请与审批
已注册用户 SHALL 可以提交建组织申请。组织资料：
- 名称：必填，去掉首尾空格后为 1 到 128 个字符；
- 联系电话：必填，格式与 FR-SYS-015 的手机号相同；
- 地址：选填，不超过 512 个字符。

同一用户同一时间 SHALL 最多有一个待审批的建组织申请。申请人 SHALL 可以查看本人提交过的申请及其状态与驳回原因。

申请 SHALL 由平台 admin 批准或驳回：
- 批准时，系统 SHALL 在同一事务中建立组织，申请人成为该组织的 owner，并为组织建立默认角色（FR-SYS-002）；
- 驳回时，admin SHALL 填写原因，申请人随后 MAY 重新提交。

一个用户 MAY 拥有多个组织。游客与未注册用户 SHALL NOT 提交建组织申请。

#### Scenario: AC-FR-SYS-021-01 提交申请
- **GIVEN** 一个已注册用户，没有待审批的建组织申请
- **WHEN** 提交名称、联系电话与地址
- **THEN** 返回成功，产生一条待审批的申请，此时尚未建立组织

#### Scenario: AC-FR-SYS-021-02 必填与格式校验
- **GIVEN** 一个已注册用户
- **WHEN** 提交时缺少名称、名称超过 128 个字符、缺少联系电话或联系电话格式不正确
- **THEN** 返回 HTTP 400 并列出出错的字段，不产生申请

#### Scenario: AC-FR-SYS-021-03 已有待审批申请
- **GIVEN** 一个已注册用户已有一条待审批的建组织申请
- **WHEN** 再次提交
- **THEN** 返回 HTTP 409，不产生新的申请

#### Scenario: AC-FR-SYS-021-04 游客与未注册用户不能申请
- **GIVEN** 一个游客会话，以及一个已登录未注册的用户
- **WHEN** 分别提交建组织申请
- **THEN** 游客的请求返回 HTTP 401，未注册用户的请求返回 HTTP 403，都不产生申请

#### Scenario: AC-FR-SYS-021-05 批准后组织成立
- **GIVEN** 用户 U 的一条待审批申请
- **WHEN** 平台 admin 批准该申请
- **THEN** 建立一个组织，资料与申请一致，U 是其 owner，组织有一个默认角色；申请状态变为已批准；U 列出可使用的租户时包含该组织

#### Scenario: AC-FR-SYS-021-06 驳回与重新提交
- **GIVEN** 用户 U 的一条待审批申请
- **WHEN** 平台 admin 填写原因并驳回，随后 U 查看本人的申请并重新提交
- **THEN** 不建立组织；U 看到该申请为已驳回及驳回原因；重新提交成功，产生一条新的待审批申请

#### Scenario: AC-FR-SYS-021-07 驳回必须写原因
- **GIVEN** 一条待审批申请
- **WHEN** 平台 admin 不填写原因就驳回
- **THEN** 返回 HTTP 400，申请仍为待审批

#### Scenario: AC-FR-SYS-021-08 同一申请只能处理一次
- **GIVEN** 一条已批准或已驳回的申请
- **WHEN** 平台 admin 再次批准或驳回
- **THEN** 返回 HTTP 409，不重复建立组织

#### Scenario: AC-FR-SYS-021-09 一个用户拥有多个组织
- **GIVEN** 用户 U 已是组织 O1 的 owner
- **WHEN** U 再提交一条申请并获批准
- **THEN** U 同时是 O1 与新组织 O2 的 owner，两者的数据互不可见

### Requirement: FR-SYS-022 平台 admin 管理组织
平台 admin SHALL 通过后台接口管理组织，这些接口 SHALL 只接受后台会话（FR-SYS-019）。admin 可以：
- 按状态列出建组织申请，并批准或驳回（FR-SYS-021）；
- 列出组织并查看其资料、成员人数、启用状态与企业认证状态；
- 修改组织资料；
- 停用与恢复组织。

停用的组织 SHALL 保留全部数据，其成员 SHALL NOT 访问或操作该组织（FR-SYS-017）；恢复后 SHALL 一切照旧。平台 admin 的能力 SHALL NOT 作为权限点分配给组织内的角色。

#### Scenario: AC-FR-SYS-022-01 列出待审批申请
- **GIVEN** 有待审批、已批准与已驳回的建组织申请各若干
- **WHEN** 平台 admin 按"待审批"列出申请
- **THEN** 只返回待审批的申请，每条包含申请人与组织资料

#### Scenario: AC-FR-SYS-022-02 停用与恢复
- **GIVEN** 组织 O 有成员 M，O 中有数据
- **WHEN** 平台 admin 停用 O，M 访问 O；admin 随后恢复 O，M 再次访问 O
- **THEN** 停用期间 M 的访问返回 HTTP 404；恢复后 M 可以正常访问，数据与停用前一致

#### Scenario: AC-FR-SYS-022-03 admin 修改组织资料
- **GIVEN** 组织 O
- **WHEN** 平台 admin 修改 O 的名称、联系电话或地址
- **THEN** 修改按 FR-SYS-021 的规则校验，成功后 O 的资料为新值

#### Scenario: AC-FR-SYS-022-04 只接受后台会话
- **GIVEN** 一个有效的客户会话，其用户是组织 O 的 owner
- **WHEN** 用该客户会话调用审批、停用或修改组织的后台接口
- **THEN** 被拒绝（HTTP 401 或 403），数据不变

### Requirement: FR-SYS-023 组织资料修改
组织的 owner 与持有"成员管理"权限点的成员 SHALL 可以修改组织的名称、联系电话与地址，修改 SHALL 按 FR-SYS-021 的规则校验，SHALL NOT 需要重新审批。已通过企业认证的组织，其认证资料（FR-SYS-027）SHALL 只能由平台 admin 修改。

#### Scenario: AC-FR-SYS-023-01 owner 修改资料
- **GIVEN** 组织 O 的 owner
- **WHEN** 提交新的名称与联系电话
- **THEN** 返回成功，O 的资料为新值，组织仍处于启用状态

#### Scenario: AC-FR-SYS-023-02 没有权限的成员不能修改
- **GIVEN** 组织 O 中一名角色不含"成员管理"的成员
- **WHEN** 提交修改组织资料
- **THEN** 返回 HTTP 403，资料不变

### Requirement: FR-SYS-002 角色与权限点
权限点 SHALL 为以下 13 项，在设计期确定，运行期不能增删：
- 上传与识别、核验与确认、核验他人单据；
- 一级复核、二级复核；
- 导出、数据浏览；
- 成员管理、角色管理；
- 套餐申请、企业认证申请；
- 模板管理、报表查看。

每个组织：
- SHALL 有一名 owner，owner 拥有全部权限点，SHALL NOT 被修改或分配其他角色；
- SHALL 有一个默认角色，初始权限点为"上传与识别""核验与确认""导出"；
- 成员加入时 SHALL 获得默认角色。

持有"角色管理"权限点的成员 SHALL 可以：
- 新建、修改与删除自定义角色，角色名称在本组织内唯一、不超过 64 个字符，角色由零个或多个权限点组成；
- 修改默认角色的权限点；
- 为成员分配角色。

每个成员 SHALL 只有一个角色。默认角色 SHALL NOT 被删除；删除一个正在使用的自定义角色时，持有该角色的成员 SHALL 改为默认角色。持有"角色管理"的成员 SHALL NOT 修改 owner 的角色，SHALL NOT 把本人的角色改为另一个角色，也 SHALL NOT 编辑本人当前持有的角色。

后端 SHALL 在服务端按调用者在当前租户中的权限点判断每个受权限点约束的操作；不满足时 SHALL 返回 HTTP 403，不改变任何数据。个人租户的本人 SHALL 视同拥有全部权限点。

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

### Requirement: FR-SYS-024 成员邀请
组织中持有"成员管理"权限点的成员 SHALL 可以生成邀请。每个邀请：
- SHALL 对应一个链接，只能被一人接受一次；
- SHALL 自生成起 7 天内有效；
- 在被接受前 SHALL 可以撤销。

接受邀请的用户：
- SHALL 是已注册用户；
- SHALL NOT 已是该组织的成员；
- 接受后 SHALL 成为该组织的成员，并获得默认角色。

链接中的邀请凭据 SHALL NOT 以明文保存。已接受、已撤销或已过期的邀请 SHALL 被拒绝。个人租户与已停用的组织 SHALL NOT 生成邀请。持有"成员管理"的成员 SHALL 可以列出本组织未被接受的邀请及其到期时间。

#### Scenario: AC-FR-SYS-024-01 邀请并接受
- **GIVEN** 组织 O 的 owner 生成了一个邀请，已注册用户 U 不是 O 的成员
- **WHEN** U 用该邀请接受
- **THEN** U 成为 O 的成员并持有默认角色；U 列出可使用的租户时包含 O

#### Scenario: AC-FR-SYS-024-02 邀请只能用一次
- **GIVEN** 一个已被用户 U 接受的邀请
- **WHEN** 另一名已注册用户 V 用同一邀请接受
- **THEN** 返回 HTTP 410，V 不成为成员

#### Scenario: AC-FR-SYS-024-03 过期与撤销
- **GIVEN** 一个生成超过 7 天的邀请，以及一个已被撤销的邀请
- **WHEN** 已注册用户分别用它们接受
- **THEN** 都返回 HTTP 410，不产生成员

#### Scenario: AC-FR-SYS-024-04 接受者须已注册
- **GIVEN** 一个有效的邀请
- **WHEN** 游客用它接受，以及已登录未注册的用户用它接受
- **THEN** 游客的请求返回 HTTP 401，未注册用户的请求返回 HTTP 403；邀请仍然有效

#### Scenario: AC-FR-SYS-024-05 已是成员
- **GIVEN** 用户 U 已是组织 O 的成员，O 的一个有效邀请
- **WHEN** U 用该邀请接受
- **THEN** 返回 HTTP 409，邀请仍然有效，U 的角色不变

#### Scenario: AC-FR-SYS-024-06 没有权限不能邀请
- **GIVEN** 组织 O 中一名角色不含"成员管理"的成员，以及一个只有个人租户的用户
- **WHEN** 前者为 O 生成邀请，后者为本人的个人租户生成邀请
- **THEN** 前者返回 HTTP 403；后者返回 HTTP 400；都不产生邀请

#### Scenario: AC-FR-SYS-024-07 邀请凭据不明文保存
- **GIVEN** 一个刚生成的邀请
- **WHEN** 检查系统中保存的邀请记录与操作日志
- **THEN** 其中不出现链接中的邀请凭据

### Requirement: FR-SYS-025 成员人数上限
每个组织的成员人数（含 owner）与未被接受且未过期、未撤销的邀请数之和 SHALL NOT 超过该组织的成员人数上限。组织有有效订阅时，成员人数上限 SHALL 为其订阅档位的成员人数上限（FR-SYS-030）；没有有效订阅（未开通或已到期）时，SHALL 为一个由平台 admin 配置的参数，默认 2。达到上限时，生成邀请与接受邀请 SHALL 被拒绝。上限调低到现有人数以下时，现有成员 SHALL 保留，只是不能再邀请。

#### Scenario: AC-FR-SYS-025-01 达到上限不能邀请
- **GIVEN** 一个未开通套餐、上限为 2 的组织 O，只有 owner，且有一个未被接受的邀请
- **WHEN** owner 再生成一个邀请
- **THEN** 返回 HTTP 409，不产生邀请

#### Scenario: AC-FR-SYS-025-02 撤销后名额释放
- **GIVEN** 上一场景的组织 O
- **WHEN** owner 撤销那个未被接受的邀请，再生成一个邀请
- **THEN** 第二次生成成功

#### Scenario: AC-FR-SYS-025-03 调低上限保留现有成员
- **GIVEN** 平台 admin 配置的上限为 3，组织 O 有 3 名成员
- **WHEN** admin 把上限改为 2，随后 O 的 owner 生成邀请
- **THEN** O 的 3 名成员都保留；生成邀请返回 HTTP 409

#### Scenario: AC-FR-SYS-025-04 并发接受不超限
- **GIVEN** 上限为 2 的组织 O 只有 owner，有 2 个有效邀请（由上限调高后生成，随后上限调回 2）
- **WHEN** 两名已注册用户同时各自接受一个邀请
- **THEN** 最多一人成为成员，O 的成员人数不超过 2

#### Scenario: AC-FR-SYS-025-05 开通套餐后按档位计算
- **GIVEN** 组织 O 有 2 名成员，没有有效订阅，开通套餐前上限为 2；Intermediate 的成员人数上限为 5
- **WHEN** 平台 admin 为 O 开通 Intermediate，随后 owner 连续生成 3 个邀请，再生成第 4 个
- **THEN** 前 3 个成功，第 4 个返回 HTTP 409

#### Scenario: AC-FR-SYS-025-06 订阅到期后回到开通套餐前上限
- **GIVEN** 组织 O 的 Intermediate 订阅已到期，O 有 4 名成员，开通套餐前上限为 2
- **WHEN** owner 生成邀请
- **THEN** 返回 HTTP 409；O 的 4 名成员都保留

### Requirement: FR-SYS-026 成员移除与退出
组织中持有"成员管理"权限点的成员 SHALL 可以移除其他成员，但 SHALL NOT 移除 owner。成员 SHALL 可以自行退出组织；owner SHALL NOT 退出，须先转让 owner（FR-SYS-029）。被移除或退出的成员 SHALL 立即失去该组织的访问权，其在该组织中提交的数据 SHALL 仍属于该组织。

#### Scenario: AC-FR-SYS-026-01 移除成员
- **GIVEN** 组织 O 中成员 M 提交过数据
- **WHEN** owner 移除 M，随后 M 访问 O
- **THEN** M 的访问返回 HTTP 404；M 提交的数据仍在 O 中，持有"数据浏览"的成员可以看到

#### Scenario: AC-FR-SYS-026-02 自行退出
- **GIVEN** 组织 O 的成员 M（不是 owner）
- **WHEN** M 退出 O
- **THEN** M 不再是 O 的成员，O 的成员人数减一

#### Scenario: AC-FR-SYS-026-03 owner 不能被移除也不能退出
- **GIVEN** 组织 O 的 owner，以及一名持有"成员管理"的成员 A
- **WHEN** A 移除 owner，以及 owner 退出 O
- **THEN** 两次都返回 HTTP 409，owner 仍是 O 的 owner

#### Scenario: AC-FR-SYS-026-04 移除后可再被邀请
- **GIVEN** 已被移除的用户 M
- **WHEN** 组织 O 再次邀请 M，M 接受
- **THEN** M 重新成为 O 的成员并持有默认角色

### Requirement: FR-SYS-029 owner 转让
组织的 owner SHALL 可以把 owner 身份转让给本组织的另一名有效成员。转让 SHALL 在一次操作中完成：
- 受让人成为 owner；
- 原 owner 成为普通成员，并持有默认角色。

任何时刻每个组织 SHALL 恰好有一名 owner。只有 owner 本人 SHALL 可以发起转让；受让人 SHALL 是本组织的有效成员，且不是 owner 本人。转让后，原 owner MAY 按 FR-SYS-026 退出组织。

#### Scenario: AC-FR-SYS-029-01 转让成功
- **GIVEN** 组织 O 的 owner A 与成员 M
- **WHEN** A 把 owner 转让给 M
- **THEN** M 是 O 的 owner，拥有全部权限点；A 仍是 O 的成员，持有默认角色；O 只有一名 owner

#### Scenario: AC-FR-SYS-029-02 转让后原 owner 可以退出
- **GIVEN** 上一场景的组织 O
- **WHEN** A 退出 O
- **THEN** A 不再是 O 的成员，M 仍是 owner

#### Scenario: AC-FR-SYS-029-03 只能转给本组织的其他成员
- **GIVEN** 组织 O 的 owner A，用户 V 不是 O 的成员，用户 R 已被 O 移除
- **WHEN** A 把 owner 转让给 V、R 或本人
- **THEN** 三次都返回 HTTP 400 并指出受让人字段，O 的 owner 仍是 A

#### Scenario: AC-FR-SYS-029-04 只有 owner 能转让
- **GIVEN** 组织 O 中一名持有"成员管理"与"角色管理"但不是 owner 的成员 B
- **WHEN** B 把 owner 转让给本人或其他成员
- **THEN** 返回 HTTP 403，O 的 owner 不变

### Requirement: FR-SYS-027 企业认证
组织的 owner 与持有"企业认证申请"权限点的成员 SHALL 可以提交企业认证申请。认证资料：
- 法定名称：必填，不超过 255 个字符；
- 税号：必填，为 13 位数字；
- 注册地址：必填，不超过 512 个字符。

同一组织同一时间 SHALL 最多有一个待审批的认证申请；已认证的组织 SHALL NOT 再提交认证申请，修改认证资料由平台 admin 在后台进行，或由 admin 取消认证后重新申请。平台 admin SHALL 可以批准或填写原因驳回认证申请，也 SHALL 可以在后台直接把组织设为已认证或取消认证。

组织的企业认证状态 SHALL 为以下之一：未认证、审核中、已认证、已驳回，并对组织成员可见。企业认证 SHALL NOT 影响组织的成立、成员、权限点与任何现有业务功能。

#### Scenario: AC-FR-SYS-027-01 提交并批准
- **GIVEN** 一个未认证的组织 O 的 owner
- **WHEN** 提交法定名称、13 位数字的税号与注册地址，随后平台 admin 批准
- **THEN** 提交后 O 的认证状态为审核中；批准后为已认证，认证资料与申请一致

#### Scenario: AC-FR-SYS-027-02 资料校验
- **GIVEN** 组织 O 的 owner
- **WHEN** 提交时缺少法定名称、税号不是 13 位数字或缺少注册地址
- **THEN** 返回 HTTP 400 并列出出错的字段，认证状态不变

#### Scenario: AC-FR-SYS-027-03 驳回与重新申请
- **GIVEN** 组织 O 的一条待审批认证申请
- **WHEN** 平台 admin 填写原因驳回，随后 owner 重新提交
- **THEN** 驳回后 O 的认证状态为已驳回，成员可以看到原因；重新提交后为审核中

#### Scenario: AC-FR-SYS-027-04 已有待审批申请
- **GIVEN** 组织 O 已有一条待审批认证申请
- **WHEN** 再次提交
- **THEN** 返回 HTTP 409

#### Scenario: AC-FR-SYS-027-05 admin 直接设定
- **GIVEN** 一个未认证的组织 O
- **WHEN** 平台 admin 在后台直接把 O 设为已认证，随后又取消认证
- **THEN** O 的认证状态先为已认证，后为未认证

#### Scenario: AC-FR-SYS-027-06 没有权限不能申请
- **GIVEN** 组织 O 中一名角色不含"企业认证申请"的成员
- **WHEN** 提交企业认证申请
- **THEN** 返回 HTTP 403，认证状态不变

#### Scenario: AC-FR-SYS-027-07 已认证的组织不能再提交
- **GIVEN** 一个已认证的组织 O
- **WHEN** O 的 owner 或持有"企业认证申请"的成员提交认证申请
- **THEN** 返回 HTTP 409，O 的认证状态与认证资料不变

### Requirement: FR-SYS-028 组织操作写入操作日志
以下每个改变状态的操作 SHALL 按 FR-SYS-003 写入操作日志，记录操作者、时间、操作类型、操作对象与结果：
- 建组织申请的提交、批准与驳回；
- 组织资料修改，组织的停用与恢复；
- 角色的新建、修改与删除，角色分配；
- 邀请的生成、撤销与接受；
- 成员的移除与退出，owner 转让；
- 企业认证的提交、批准、驳回、直接设定与取消；
- 成员人数上限参数的修改。

操作日志 SHALL NOT 包含邀请凭据。

#### Scenario: AC-FR-SYS-028-01 记录组织操作
- **GIVEN** 一个用户提交建组织申请，平台 admin 批准，owner 生成邀请，另一名用户接受，owner 移除该成员
- **WHEN** 查询操作日志
- **THEN** 按时间顺序有这 5 个操作的记录，每条都有操作者、时间、操作类型、操作对象与结果，其中不出现邀请凭据
