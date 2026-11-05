# rebuild-notifications 验证记录

## 1. 自动化测试

- **后端：** 在 `services/api` 下运行 `uv run pytest -q`，连本机 Docker PostgreSQL 18（`REQUIRE_INTEGRATION=1`），**443 passed**。接口测试以应用账号 `saiflow_v3_app` 运行。
- **脚本与契约：** `scripts/tests/*.test.sh` 全部通过（其中 compose-config 47 项），shellcheck 与 actionlint 无告警；接口契约重新生成后与提交一致。
- **CI：** 提交 `af531ab` 的 CI 全部通过（backend、scripts、contract、frontend、stack）。stack 检查会启动 `saiflow-be-reminders`，并确认它能完成一次检查。

## 2. 验收标准 → 测试

下表的测试都在 `services/api/tests/` 下。

| AC | 测试 |
|---|---|
| AC-FR-SYS-018-01 到期前 7 天提醒一次 | `integration/test_reminders_expiry.py::test_d7_once` |
| AC-FR-SYS-018-02 错过的节点不补发 | `test_reminders_expiry.py::test_missed_node_not_sent` |
| AC-FR-SYS-018-03 到期当天与到期后 | `test_reminders_expiry.py::test_d0_and_after`；`unit/test_reminder_rules.py::test_expiry_stage_nodes` |
| AC-FR-SYS-018-04 已续上的订阅不按旧结束时间提醒 | `test_reminders_expiry.py::test_chained_renewal_no_old_reminder`、`test_chained_renewal_through_admin_api`；`test_reminder_rules.py::test_expiry_time_chained_and_overlapping` |
| AC-FR-SYS-018-05 续费后重新提醒 | `test_reminders_expiry.py::test_renewal_restarts_nodes` |
| AC-FR-SYS-018-06 没有订阅的组织不提醒 | `test_reminders_expiry.py::test_never_subscribed_org_silent` |
| AC-FR-SYS-035-01 配额不足时提醒一次 | `integration/test_reminders_usage.py::test_low_once` |
| AC-FR-SYS-035-02 刚好 20% 时不提醒 | `test_reminders_usage.py::test_exactly_twenty_percent_silent`；`test_reminder_rules.py::test_usage_low_threshold` |
| AC-FR-SYS-035-03 免费额度不计入 | `test_reminders_usage.py::test_free_quota_not_counted` |
| AC-FR-SYS-035-04 下个月重新计算 | `test_reminders_usage.py::test_next_month_again` |
| AC-FR-SYS-035-05 月末前 3 天 | `test_reminders_usage.py::test_month_end_once`；`test_reminder_rules.py::test_month_end_day`、`test_month_end_uses_bangkok_calendar` |
| AC-FR-SYS-035-06 没有剩余或不是那一天 | `test_reminders_usage.py::test_month_end_zero_or_wrong_day` |
| AC-FR-SYS-035-07 没有有效订阅时不提醒 | `test_reminders_usage.py::test_expired_no_usage_reminder` |
| AC-FR-SYS-038-01 免费额度到期前 7 天 | `integration/test_reminders_free_quota.py::test_d7_once` |
| AC-FR-SYS-038-02 余量为 0 时不提醒 | `test_reminders_free_quota.py::test_zero_remaining_silent` |
| AC-FR-SYS-038-03 到期当天提醒，之后不再提醒 | `test_reminders_free_quota.py::test_d0_then_nothing`、`test_d0_after_expiry_time_not_sent`；`test_reminder_rules.py::test_free_quota_stage` |
| AC-FR-SYS-038-04 错过的节点不补发 | `test_reminders_free_quota.py::test_missed_node_not_sent` |
| AC-FR-SYS-038-05 个人租户不提醒 | `test_reminders_free_quota.py::test_personal_silent` |
| AC-FR-SYS-037-01 组织的提醒发给 owner | `integration/test_reminders_delivery.py::test_org_reminder_to_owner_only` |
| AC-FR-SYS-037-02 转让后发给新 owner | `test_reminders_delivery.py::test_after_transfer_new_owner` |
| AC-FR-SYS-037-03 游客不提醒 | `test_reminders_delivery.py::test_guest_silent` |
| AC-FR-SYS-037-04 未注册的用户只收站内通知 | `test_reminders_delivery.py::test_unregistered_in_app_only` |
| AC-FR-SYS-037-05 邮件失败不影响站内通知 | `test_reminders_delivery.py::test_email_failure_keeps_notification`、`test_no_sender_skips_email`、`test_render_error_is_failed_not_pending` |
| AC-FR-SYS-037-06 同时检查不重复发送 | `test_reminders_delivery.py::test_concurrent_passes_send_once` |
| AC-FR-SYS-037-07 停用提醒 | `test_reminders_delivery.py::test_disabled_then_enabled_no_backfill`；`integration/test_reminder_cli.py::test_run_once_cli_disabled` |
| AC-FR-SYS-036-01 查看通知与未读数 | `integration/test_notification_center.py::test_list_and_unread_count` |
| AC-FR-SYS-036-02 分页 | `test_notification_center.py::test_paging_no_overlap` |
| AC-FR-SYS-036-03 标记指定通知为已读 | `test_notification_center.py::test_mark_some_idempotent` |
| AC-FR-SYS-036-04 全部标记为已读 | `test_notification_center.py::test_mark_all` |
| AC-FR-SYS-036-05 只影响本人的通知 | `test_notification_center.py::test_only_own_notifications` |
| AC-FR-SYS-036-06 请求校验 | `test_notification_center.py::test_mark_read_validation`、`test_list_query_validation` |
| AC-FR-SYS-036-07 没有删除 | `test_notification_center.py::test_read_kept_no_delete` |
| AC-FR-SYS-036-08 游客与未登录 | `test_notification_center.py::test_guest_and_anonymous_401` |

假设 A3、A8、A10 分别由 `test_reminders_usage.py::test_plan_change_same_month_no_repeat`、`test_reminders_delivery.py::test_reminders_not_audited`、`test_reminders_free_quota.py::test_reminded_with_or_without_subscription` 覆盖；A11 与 AC-FR-SYS-037-07 相同。

### B-2c 遗留的 Minor（M1–M7）

| # | 测试或文档 |
|---|---|
| M1 退还时检查所属租户 | `integration/test_billing_minors_b2d.py::test_release_other_tenant_404`；接口改为 `release(db, tenant_id, reservation_id)` |
| M2 关闭待审批认证申请写日志，原因改为代码 | `test_billing_minors_b2d.py::test_admin_set_closes_pending_with_audit` |
| M3 接近 9999 年返回 400 | `test_billing_minors_b2d.py::test_year_9999_start_400` |
| M4 月份按泰国日历加减 | `unit/test_billing_time.py::test_add_months_bangkok_calendar` |
| M5 不存在的租户返回 404 | `test_billing_minors_b2d.py::test_admin_lists_unknown_tenant_404` |
| M6 用量不显示未开始的有效期 | `test_billing_minors_b2d.py::test_usage_hides_future_period` |
| M7 需求索引来源与行序、PRD 同档顺延 | `Requirements-Index.md` 1.7.0、PRD 3.6.0 |

## 3. 部署后的服务器检查（2026-11-05）

部署 `af531ab`（Deploy run 42006436210），结果成功。

| 检查 | 结果 |
|---|---|
| 迁移版本 | `0006` |
| `saiflow-be-reminders` | Up；日志 `reminders OK (0 created)` |
| `reminders-run-once` | `reminders OK (0 created)` |
| 通知与提醒记录 | 0 / 0（当天没有到发送日的提醒） |
| `audit-verify` | `audit log OK (75 entries)` |
| 当场备份后运行 `restore-check.sh` | OK |
| 外网：健康检查 | ok，版本 `af531ab`，数据库 ok |
| 外网：未登录或游客查看、标记通知 | 401 |

## 4. 最终审查

独立审查员检查了整个分支：0 Critical、1 Important、8 Minor。

### 已修复（先复现失败，修复后通过）

1. 邮件逐封发送且会自动重试，一次检查没有时间上限：邮件服务器卡住时，一次检查可能拖几个小时，期间当天该发的提醒会错过，超时重试还可能重复发邮件。现在先为所有租户生成站内通知，再统一发邮件：每封只发一次、不重试，同时最多 5 封，最多花 10 分钟，超时没发出的记为失败。
2. 同一处改写中，邮件文字生成出错也记为失败（原来会停在"待发送"）。

### 暂不处理的 Minor（负责人决定是否另行处理）

- 部署时正在发邮件的，未发出的那几封不会再发；站内通知保留。
- 一次标记超过约 3 万条通知时返回 500。
- 标记已读的请求内容不是对象时返回 422。
- 订阅已全部结束、但隔开一段时间排了未来的订阅时，仍会发"已到期"提醒。
- 每个租户检查时读两次订阅，目前规模没有影响。
- 认证驳回原因新旧两种写法（"set by admin" 与 `set_by_admin`）并存，B-5 需要都能识别。
- proposal 中有几处文字与 spec 不一致（没有有效订阅的组织、实体名称）；部署配置没有传入检查间隔参数。以 spec 为准。

### 实施中做出的判断

- 迁移脚本不引用程序代码，约束条件直接写在脚本里。
- 邮件因任何原因没发出都记为失败。
- 找不到收件人的租户不发提醒。
- 提醒循环本身没有自动化测试，由手动运行与 CI 的 stack 检查覆盖。
- 恢复数据时提醒服务与网站服务一起停止和启动。
- 通知中心的查询参数在接口内校验，错误返回 400。
- 标记已读时不带请求内容等于全部标记，空列表不标记。
- 关闭待审批认证申请的日志以组织为对象。
- 年份上限为 9998。
- 退还接口增加租户 ID（需通知 B-3）。
- 数据模型沿用 `DM-PlanReminder`。

## 5. 未覆盖

- LINE OA 消息：等 OA 准备好后接入。
- 短信：随短信平台接入。
- 通知中心与提醒的页面：B-5。
