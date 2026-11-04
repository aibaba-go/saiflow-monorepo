# rebuild-tenant-rbac 验证记录

## 1. 自动化测试

- **后端：** `cd services/api && uv run pytest -q`，在本机 Docker PostgreSQL 18 上运行（`REQUIRE_INTEGRATION=1`），结果 **261 passed**。接口测试以应用账号 `saiflow_v3_app` 运行（M6），`test_api_runs_as_app_role` 负责防止这一点被改回去。
- **脚本：** `scripts/tests/*.test.sh` 全部通过（compose-config 35、remote-deploy 26 等）；shellcheck、actionlint 通过；重新生成接口契约后与提交内容一致。
- **CI：** 提交 `74a9b2a` 的 CI 全部通过。其中 stack 任务的步骤是：
  1. 按旧服务器的状态，给应用账号 CREATE 权限并迁移到 0002；
  2. 运行 `db-roles.sh` 并检查应用账号仍能读表；
  3. 用迁移账号迁移到 head；
  4. 做健康检查，并演练备份恢复。

## 2. 验收标准 → 测试

所有测试都在 `services/api/tests/integration/` 下。

| AC | 测试（文件 :: 测试名） | 结果 |
|---|---|---|
| AC-FR-SYS-017-01 未指定租户时使用个人租户 | `test_tenancy_access.py::test_no_header_uses_personal_tenant` | 通过 |
| AC-FR-SYS-017-02 列出可使用的租户 | `test_tenancy_access.py::test_list_usable_tenants` | 通过 |
| AC-FR-SYS-017-03 个人数据不进入组织 | `test_tenancy_access.py::test_personal_data_not_in_org` | 通过 |
| AC-FR-SYS-017-04 非成员访问组织 | `test_tenancy_access.py::test_non_member_and_unknown_tenant_same_404` | 通过 |
| AC-FR-SYS-017-05 没有数据浏览权限只见本人提交 | `test_tenancy_access.py::test_without_data_browse_sees_own_only` | 通过 |
| AC-FR-SYS-017-06 停用的组织 | `test_tenancy_access.py::test_disabled_org_is_404` | 通过 |
| AC-FR-SYS-021-01 提交申请 | `test_tenancy_applications.py::test_apply_ok` | 通过 |
| AC-FR-SYS-021-02 必填与格式校验 | `test_tenancy_applications.py::test_apply_validation` | 通过 |
| AC-FR-SYS-021-03 已有待审批申请 | `test_tenancy_applications.py::test_second_pending_is_409` | 通过 |
| AC-FR-SYS-021-04 游客与未注册用户不能申请 | `test_tenancy_applications.py::test_guest_401_unregistered_403` | 通过 |
| AC-FR-SYS-021-05 批准后组织成立 | `test_tenancy_applications.py::test_approve_creates_org_owner_default_role` | 通过 |
| AC-FR-SYS-021-06 驳回与重新提交 | `test_tenancy_applications.py::test_reject_then_reapply` | 通过 |
| AC-FR-SYS-021-07 驳回必须写原因 | `test_tenancy_applications.py::test_reject_requires_reason` | 通过 |
| AC-FR-SYS-021-08 同一申请只能处理一次 | `test_tenancy_applications.py::test_decide_twice_409`、`test_concurrent_approve_once` | 通过 |
| AC-FR-SYS-021-09 一个用户拥有多个组织 | `test_tenancy_applications.py::test_user_owns_two_orgs_isolated` | 通过 |
| AC-FR-SYS-022-01 列出待审批申请 | `test_tenancy_applications.py::test_admin_lists_pending_only` | 通过 |
| AC-FR-SYS-022-02 停用与恢复 | `test_tenancy_admin.py::test_disable_and_enable` | 通过 |
| AC-FR-SYS-022-03 admin 修改组织资料 | `test_tenancy_admin.py::test_admin_edits_profile` | 通过 |
| AC-FR-SYS-022-04 只接受后台会话 | `test_tenancy_admin.py::test_admin_endpoints_reject_customer_session` | 通过 |
| AC-FR-SYS-023-01 owner 修改资料 | `test_tenancy_admin.py::test_owner_edits_profile` | 通过 |
| AC-FR-SYS-023-02 没有权限的成员不能修改 | `test_tenancy_admin.py::test_member_without_manage_cannot_edit` | 通过 |
| AC-FR-SYS-002-01 权限点强制执行 | `test_tenancy_roles.py::test_permission_enforced` | 通过 |
| AC-FR-SYS-002-02 默认角色 | `test_tenancy_roles.py::test_new_org_default_role` | 通过 |
| AC-FR-SYS-002-03 自定义角色 | `test_tenancy_roles.py::test_custom_role_assign` | 通过 |
| AC-FR-SYS-002-04 角色名称与权限点校验 | `test_tenancy_roles.py::test_role_validation` | 通过 |
| AC-FR-SYS-002-05 修改默认角色影响持有者 | `test_tenancy_roles.py::test_editing_default_role_takes_effect_next_request` | 通过 |
| AC-FR-SYS-002-06 删除正在使用的角色 | `test_tenancy_roles.py::test_delete_role_moves_holders_default_protected` | 通过 |
| AC-FR-SYS-002-07 owner 与本人角色受保护 | `test_tenancy_roles.py::test_owner_and_own_role_protected` | 通过 |
| AC-FR-SYS-002-08 复核与报表权限可以授予 | `test_tenancy_roles.py::test_review_and_report_grantable` | 通过 |
| AC-FR-SYS-002-09 没有权限的成员不能管理角色 | `test_tenancy_roles.py::test_without_role_manage_403`、`test_role_from_other_org_rejected` | 通过 |
| AC-FR-SYS-029-01 转让成功 | `test_tenancy_members.py::test_transfer_owner` | 通过 |
| AC-FR-SYS-029-02 转让后原 owner 可以退出 | `test_tenancy_members.py::test_old_owner_can_leave_after_transfer` | 通过 |
| AC-FR-SYS-029-03 只能转给本组织的其他成员 | `test_tenancy_members.py::test_transfer_target_must_be_other_member` | 通过 |
| AC-FR-SYS-029-04 只有 owner 能转让 | `test_tenancy_members.py::test_only_owner_transfers` | 通过 |
| AC-FR-SYS-024-01 邀请并接受 | `test_tenancy_invitations.py::test_invite_and_accept` | 通过 |
| AC-FR-SYS-024-02 邀请只能用一次 | `test_tenancy_invitations.py::test_invitation_single_use`、`test_concurrent_accept_same_invitation_once` | 通过 |
| AC-FR-SYS-024-03 过期与撤销 | `test_tenancy_invitations.py::test_expired_and_revoked_410` | 通过 |
| AC-FR-SYS-024-04 接受者须已注册 | `test_tenancy_invitations.py::test_guest_401_unregistered_403_invitation_still_valid` | 通过 |
| AC-FR-SYS-024-05 已是成员 | `test_tenancy_invitations.py::test_already_member_409` | 通过 |
| AC-FR-SYS-024-06 没有权限不能邀请 | `test_tenancy_invitations.py::test_no_manage_403_personal_400` | 通过 |
| AC-FR-SYS-024-07 邀请凭据不明文保存 | `test_tenancy_invitations.py::test_token_never_stored_or_logged` | 通过 |
| AC-FR-SYS-025-01 达到上限不能邀请 | `test_tenancy_invitations.py::test_limit_blocks_invite` | 通过 |
| AC-FR-SYS-025-02 撤销后名额释放 | `test_tenancy_invitations.py::test_revoke_frees_seat` | 通过 |
| AC-FR-SYS-025-03 调低上限保留现有成员 | `test_tenancy_invitations.py::test_lowering_limit_keeps_members`、`test_admin_sets_member_limit` | 通过 |
| AC-FR-SYS-025-04 并发接受不超限 | `test_tenancy_invitations.py::test_concurrent_accept_respects_limit` | 通过 |
| AC-FR-SYS-026-01 移除成员 | `test_tenancy_members.py::test_remove_member_keeps_data` | 通过 |
| AC-FR-SYS-026-02 自行退出 | `test_tenancy_members.py::test_leave` | 通过 |
| AC-FR-SYS-026-03 owner 不能被移除也不能退出 | `test_tenancy_members.py::test_owner_cannot_be_removed_or_leave`、`test_leave_with_stale_context_after_transfer_keeps_owner`、`test_concurrent_transfer_and_leave_one_owner`、`test_concurrent_transfers_one_owner` | 通过 |
| AC-FR-SYS-026-04 移除后可再被邀请 | `test_tenancy_members.py::test_reinvite_after_removal` | 通过 |
| AC-FR-SYS-027-01 提交并批准 | `test_tenancy_verification.py::test_submit_and_approve` | 通过 |
| AC-FR-SYS-027-02 资料校验 | `test_tenancy_verification.py::test_verification_validation` | 通过 |
| AC-FR-SYS-027-03 驳回与重新申请 | `test_tenancy_verification.py::test_reject_and_resubmit` | 通过 |
| AC-FR-SYS-027-04 已有待审批申请 | `test_tenancy_verification.py::test_second_pending_409` | 通过 |
| AC-FR-SYS-027-05 admin 直接设定 | `test_tenancy_verification.py::test_admin_direct_set_and_unset` | 通过 |
| AC-FR-SYS-027-06 没有权限不能申请 | `test_tenancy_verification.py::test_without_permission_403`、`test_member_with_verification_apply_can_submit` | 通过 |
| AC-FR-SYS-028-01 记录组织操作 | `test_tenancy_audit.py::test_org_operations_audited`、`test_every_tenancy_action_is_logged` | 通过 |

### Review Focus 与结构

| 项 | 测试 |
|---|---|
| 1 并发抢名额、转让 | 并发接受、并发转让、转让与退出同时发生（见上表） |
| 2 改角色后下一次请求立即生效 | `test_editing_default_role_takes_effect_next_request` |
| 3 异常的 `X-Tenant-Id` 一律 404 | `test_bad_tenant_header_is_404`：`abc`、`-1`、`0`、超出 bigint 的数、5000 位数字、他人个人租户、游客租户 |
| 4 游客与未注册用户 | AC-021-04、AC-024-04、`test_guest_own_tenant_and_list_tenants_401` |
| 5 应用账号权限 | 接口测试以应用账号运行；`test_tenancy_schema.py`（新表可写、迁移版本表不可写） |
| `X-Tenant-Id` 写入接口文档 | `test_tenant_header_declared_in_openapi` |

### 遗留 Minor（M1–M9）

| # | 测试 |
|---|---|
| M1 限频每个窗口最多清理一次；IPv6 按 /64 | `unit/test_rate_limit.py::test_sweep_at_most_once_per_window`、`test_ipv6_keyed_by_64` |
| M2 中继或策略类拒收不算 `email_rejected` | `unit/test_smtp_sender.py::test_relay_or_policy_refusal_is_not_rejected`、`test_550_511_is_rejected` |
| M3 收件阶段的 4xx 重试 | `unit/test_smtp_sender.py::test_rcpt_4xx_retried` |
| M4 初始化脚本不再授予 CREATE | `scripts/tests/compose-config.test.sh`（"01-app-user.sh grants no CREATE"） |
| M5 带引号的 `DB_MIGRATE_PASSWORD` | `scripts/tests/remote-deploy.test.sh`（双引号、单引号、空引号三种情况） |
| M6 接口测试用应用账号运行 | `test_tenancy_audit.py::test_api_runs_as_app_role` |
| M7 0003 回退说明 | `docs/deployment/README.md` §4（文档） |
| M8 用户名字符集 | `test_hardening.py::test_admin_username_charset` |
| M9 应用账号不能写迁移版本表 | `test_tenancy_schema.py::test_app_role_cannot_write_alembic_version` |

### 实施中发现并修复的原有缺陷

会话 Cookie 续期的数据原来放在 `request.state` 上。在测试环境（asgi-lifespan）中，这部分状态被多个请求共用，导致一个客户端的会话凭据被发到另一个客户端。

生产环境的 uvicorn 会为每个请求复制一份状态，所以线上不受影响。

现已改为保存在请求自己的 scope 中，回归测试为 `test_hardening.py::test_session_cookie_never_sent_to_another_client`（先失败，修复后通过）。

## 3. 部署后的服务器检查（2026-11-04）

部署 `74a9b2a`（Deploy run 41838490873，成功）。

| 检查 | 结果 |
|---|---|
| 迁移版本 | `0004` |
| organizations、memberships、roles、invitations、system_settings 的所有者 | 都是 `saiflow_v3_migrator` |
| `audit-verify` | `audit log OK (71 entries)` |
| 当场备份后运行 `restore-check.sh` | OK |
| 外网：游客 `GET /me/tenants` | 401 |
| 外网：游客提交建组织申请 | 401 |
| 外网：游客访问组织 | 404 |
| 外网：不带后台会话调用 admin 接口 | 401 |
| 游客限频（复查） | 第 31 次返回 429；同一时刻改用其他来源访问，返回 200 |

## 4. 最终审查

由独立审查员检查整个分支，结果为 1 Critical、1 Important、11 Minor。其中 1 项 Minor（`X-Tenant-Id` 未写入接口文档）因为影响 B-3 的接口客户端，上调为 Important。

**已修复：**
1. 成员退出与 owner 转让同时发生时，组织可能没有 owner（`test_leave_with_stale_context_after_transfer_keeps_owner` 先失败，修复后通过）；
2. 超出 bigint 的 `X-Tenant-Id` 返回 500；
3. `X-Tenant-Id` 未写入接口文档。

**暂不处理的 Minor：**
- 路径中的 ID 为非数字时返回 422；路径或请求体中的 ID 超出 bigint 时返回 500。
- 权限在拿组织锁之前检查：同一时刻被降权的管理者还能完成一次操作。
- 删除角色与分配角色同时发生时返回 500（数据不会出错）。
- 已认证组织中，持有"企业认证申请"权限的成员重新提交申请，会让组织的认证状态变成审核中（属于产品问题）。
- admin 直接取消认证后，原来待审批的申请仍然留着。
- 企业认证的提交与批准加锁顺序不同，极少数情况下可能死锁（返回 500）。
- 空的组织资料修改也会写一条操作日志。
- 组织存在时，0004 无法回退（文档未写明）。
- 设置接口与认证设定接口的请求体不是 LooseRequest，格式错误时返回 422。
- 部分接口没有声明响应类型。

**审查员未下结论、由实施者决定的两点：**
- 组织的任何成员都能看到组织资料与认证信息（含税号）。需求没有规定；同一组织的成员能看到本组织的资料是通常的预期。
- 已停用组织的邀请返回 410，与其他失效的链接一致。

## 5. 未覆盖

- 真实 LINE 账号下完整的建组织、邀请流程：需要 B-5 的页面。
- 组织的免费额度和按套餐计算的人数上限：属于 B-2c，扩展点为 `organization_service.on_organization_created` 与 `membership_service.member_limit`。
- 执照照片：等 B-3 的文件上传完成后补。
