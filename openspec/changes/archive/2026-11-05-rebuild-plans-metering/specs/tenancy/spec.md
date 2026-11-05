## MODIFIED Requirements

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
