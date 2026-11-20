# rebuild-plans-metering 验证记录

## 1. 自动化测试

- **后端：** 在 `services/api` 下运行 `uv run pytest -q`，连本机 Docker PostgreSQL 18（`REQUIRE_INTEGRATION=1`），**343 passed**。接口测试以应用账号 `saiflow_v3_app` 运行。
- **脚本与契约：** `scripts/tests/*.test.sh` 全部通过；接口契约重新生成后与提交一致。
- **CI：** 提交 `59d49e6` 的 CI 全部通过（backend、scripts、contract、frontend、stack）。

## 2. 验收标准 → 测试

下表的测试都在 `services/api/tests/integration/` 下。

| AC | 测试 | 结果 |
|---|---|---|
| AC-FR-SYS-030-01 查看套餐目录 | `test_billing_plans.py::test_admin_lists_catalog` | 通过 |
| AC-FR-SYS-030-02 修改配额立即生效 | `test_billing_metering.py::test_quota_change_applies_to_existing_subscription`、`test_billing_plans.py::test_admin_edits_quota_and_limit` | 通过 |
| AC-FR-SYS-030-03 Kinder 人数上限不可修改 | `test_billing_plans.py::test_kinder_member_limit_fixed` | 通过 |
| AC-FR-SYS-030-04 数值校验 | `test_billing_plans.py::test_plan_validation`、`test_billing_review_fixes.py::test_int4_bounds_on_plan_and_settings` | 通过 |
| AC-FR-SYS-030-05 只接受后台会话 | `test_billing_plans.py::test_plan_admin_only` | 通过 |
| AC-FR-SYS-012-01 个人与游客自动开通 Kinder | `test_billing_subscriptions.py::test_personal_and_guest_auto_kinder` | 通过 |
| AC-FR-SYS-012-02 组织成立时没有订阅 | `test_billing_subscriptions.py::test_org_has_no_subscription` | 通过 |
| AC-FR-SYS-012-03 admin 设定组织订阅 | `test_billing_subscriptions.py::test_admin_sets_org_subscription` | 通过 |
| AC-FR-SYS-012-04 同档续费顺延 | `test_billing_subscriptions.py::test_same_plan_renewal_extends`、`test_billing_review_fixes.py::test_two_same_plan_renewals_chain` | 通过 |
| AC-FR-SYS-012-05 档位规则 | `test_billing_subscriptions.py::test_plan_rules` | 通过 |
| AC-FR-SYS-012-06 结束时间晚于开始时间 | `test_billing_subscriptions.py::test_end_after_start`、`test_subscription_input_validation` | 通过 |
| AC-FR-SYS-012-07 到期即停但可读 | `test_billing_metering.py::test_personal_free_paused_when_expired`（预占返回 `plan_expired`）；读取已有数据的能力由 B-3、B-4 的接口提供 | 通过 |
| AC-FR-SYS-012-08 保留历史 | `test_billing_subscriptions.py::test_history_kept` | 通过 |
| AC-FR-SYS-031-01 注册时获赠 | `test_billing_metering.py::test_registration_grants_free_quota` | 通过 |
| AC-FR-SYS-031-02 只送一次 | `test_billing_metering.py::test_free_quota_once` | 通过 |
| AC-FR-SYS-031-03 组织获赠，1 个月后作废 | `test_billing_metering.py::test_org_free_quota_expires_after_month` | 通过 |
| AC-FR-SYS-031-04 个人租户到期时暂停 | `test_billing_metering.py::test_personal_free_paused_when_expired` | 通过 |
| AC-FR-SYS-031-05 游客没有免费额度 | `test_billing_metering.py::test_guest_has_no_free_quota` | 通过 |
| AC-FR-SYS-031-06 修改参数只影响之后 | `test_billing_metering.py::test_setting_change_affects_only_later_grants` | 通过 |
| AC-FR-SYS-013-01 先用免费额度 | `test_billing_metering.py::test_free_first_then_monthly` | 通过 |
| AC-FR-SYS-013-02 不足时整份拒绝 | `test_billing_metering.py::test_insufficient_rejects_whole` | 通过 |
| AC-FR-SYS-013-03 没有订阅也没有免费额度 | `test_billing_metering.py::test_no_plan_no_free_is_plan_expired` | 通过 |
| AC-FR-SYS-013-04 失败或取消时退还 | `test_billing_metering.py::test_release_returns_once` | 通过 |
| AC-FR-SYS-013-05 并发预占不超额 | `test_billing_metering.py::test_concurrent_reservations_do_not_overspend`、`test_concurrent_free_and_monthly_race` | 通过 |
| AC-FR-SYS-013-06 按泰国自然月重新计数 | `test_billing_metering.py::test_new_month_resets` | 通过 |
| AC-FR-SYS-013-07 跨月退还回到原月份 | `test_billing_metering.py::test_release_across_month_returns_to_old_month` | 通过 |
| AC-FR-SYS-013-08 年付每月按档位计算 | `test_billing_metering.py::test_yearly_plan_monthly_quota` | 通过 |
| AC-FR-SYS-033-01 查询用量 | `test_billing_metering.py::test_member_sees_usage` | 通过 |
| AC-FR-SYS-033-02 非成员不能查询 | `test_billing_metering.py::test_non_member_usage_404` | 通过 |
| AC-FR-SYS-032-01 提交并批准 | `test_billing_applications.py::test_apply_and_approve` | 通过 |
| AC-FR-SYS-032-02 档位规则 | `test_billing_applications.py::test_application_plan_rules` | 通过 |
| AC-FR-SYS-032-03 已有待审批申请 | `test_billing_applications.py::test_second_pending_409` | 通过 |
| AC-FR-SYS-032-04 驳回 | `test_billing_applications.py::test_reject_requires_reason_then_resubmit` | 通过 |
| AC-FR-SYS-032-05 没有权限不能申请 | `test_billing_applications.py::test_no_permission_403_guest_401`、`test_member_with_plan_apply_can_apply` | 通过 |
| AC-FR-SYS-032-06 同一申请只能处理一次 | `test_billing_applications.py::test_decide_twice_409` | 通过 |
| AC-FR-SYS-034-01 记录计费操作 | `test_billing_audit.py::test_billing_operations_audited`、`test_every_billing_action_is_logged` | 通过 |
| AC-FR-SYS-034-02 预占与退还可追溯 | `test_billing_metering.py::test_admin_sees_reservation_with_split` | 通过 |
| AC-FR-SYS-025-05 开通套餐后按档位计算 | `test_billing_subscriptions.py::test_member_limit_follows_plan` | 通过 |
| AC-FR-SYS-025-06 到期后回到开通套餐前上限 | `test_billing_subscriptions.py::test_member_limit_back_to_unpaid_after_expiry` | 通过 |
| AC-FR-SYS-027-07 已认证的组织不能再提交 | `test_tenancy_verification.py::test_verified_org_cannot_resubmit` | 通过 |

`tenancy` 中 FR-SYS-025、027 原有的验收标准，所用测试与 `archive/2026-11-04-rebuild-tenant-rbac/verification.md` 相同，在本次的 343 个测试中全部通过。

### B-2b 遗留的 Minor（N1–N10）

| # | 测试或文档 |
|---|---|
| N1 路径与请求体中的 ID | `test_tenancy_minors.py::test_non_numeric_and_huge_path_ids_404`、`test_huge_body_ids_400` |
| N2 拿锁后重新确认权限 | `test_tenancy_minors.py::test_demoted_manager_cannot_finish_removal`、`test_billing_review_fixes.py::test_refresh_sees_lost_ownership` |
| N3 删除角色与分配角色同时发生 | `test_tenancy_minors.py::test_assign_deleted_role_404`（另加行锁） |
| N4 企业认证的加锁顺序 | 代码：先锁组织，再锁申请（与提交时一致） |
| N5 admin 直接设定时关闭待审批申请 | `test_tenancy_minors.py::test_admin_set_closes_pending_application` |
| N6 没有改动的组织资料修改不写日志 | `test_tenancy_minors.py::test_empty_org_patch_not_audited` |
| N7 迁移回退说明 | `docs/deployment/README.md` §4；`test_billing_review_fixes.py::test_downgrade_0005_refuses_with_billing_data` |
| N8 设置类请求体的校验 | `test_tenancy_minors.py::test_settings_body_validation_400` |
| N9 接口响应类型 | `test_tenancy_minors.py::test_openapi_has_response_schemas` |
| N10 已认证组织再次提交返回 409 | AC-FR-SYS-027-07 |

## 3. 部署后的服务器检查（2026-11-05）

部署 `59d49e6`（Deploy run 41988445590），结果成功。

| 检查 | 结果 |
|---|---|
| 迁移版本 | `0005` |
| 套餐目录 | kinder 1000/1、starter 5000/2、intermediate 10000/5、advance 100000/不限 |
| 已有个人与游客租户的补开通（A2） | 64 个租户全部有订阅 |
| `audit-verify` | `audit log OK (73 entries)` |
| 当场备份后运行 `restore-check.sh` | OK |
| 外网：新游客查看用量 | Kinder 一个月；本月配额 1,000，已用 0；免费额度 0 |
| 外网：不带会话调用 admin 套餐接口 | 401 |
| 外网：组织 ID 为 `abc` | 404 |
| 外网：游客提交续费申请 | 401 |

## 4. 最终审查

独立审查员检查了整个分支：0 Critical、5 Important、10 Minor。其中 2 个 Minor 提为 Important：一个影响 B-3 将要使用的接口，另一个是本 change 自己加的 N2 修复还不完整。

### 已修复（每项都先复现失败，修复后通过）

1. 租户 ID 超出 int4 范围时，加锁报 500。锁改为单个 bigint 键（`app/locks.py`）。
2. 套餐与参数的整数超出 int4 范围时报 500，且可能导致之后所有注册失败。
3. 同档连续续费两次时，两段有效期重叠。
4. 0005 回退会删除计费数据，而文档写的是"安全失败"。现在有计费数据时拒绝回退，文档已改正。
5. 给 B-3 的接口说明补写加锁顺序：先预占或退还，再写操作日志。
6. 同一个编号换了页数或已退还后再次预占，返回 409 `reservation_conflict`。
7. 拿锁后重新确认权限时，重新读取 owner 身份。

### 暂不处理的 Minor（负责人决定是否另行处理）

- 退还接口不检查所属租户。
- 关闭待审批的认证申请时不写日志，原因文字固定为英文 "set by admin"。
- 开始日期在 9999 年时，计算月份会报 500。
- 月份按 UTC 计算，临近月底时可能与曼谷日历差一天。
- admin 查询不存在的租户的订阅或预占列表时，返回空列表。
- 上线前已注册的用户和已存在的组织没有补发免费额度；补开通的订阅没有写日志。
- 当前没有有效订阅时，用量查询可能显示一段未来的有效期。
- 需求索引里身份类需求的来源写成了"PRD §4.9 v3.5"，且行序不对；PRD 没有写同档续费顺延的规则。

### 实施中做出的判断

- 月中改档或续费后，本月已用的次数照计。"开通当月发放全额"理解为本月配额换成新档的全额。
- 免费额度参数不能设为 0。

## 5. 未覆盖

- 真实识别时的预占与退还：由 B-3 接入。
- 用量提醒、到期提醒、通知中心：B-2d。
- 真实用户的续费流程：需要 B-5 的页面。
