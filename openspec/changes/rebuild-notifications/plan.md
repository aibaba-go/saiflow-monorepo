# rebuild-notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send subscription-expiry, usage and organization free-quota-expiry reminders as in-app notifications plus email. Add the notification center. Close the 7 Minors left by B-2c and sync the docs.

**Architecture:**
- Everything lives in `services/api` on the existing stack.
- A new long-running process, `python -m app.cli reminders-loop`, is a separate compose service built from the same image. Every 15 minutes it runs one pass, `reminder_service.run_once(sessionmaker, sender, now, enabled)`. Nothing runs inside the web process.
- Each pass computes, for every tenant, which reminders are due today (Bangkok date). Due-ness is computed by pure functions in `app/reminder_rules.py`.
- Each due reminder is claimed by `INSERT ... ON CONFLICT DO NOTHING RETURNING id` on `reminders`, keyed by (tenant, kind, cycle, stage). The claim and its notification are inserted and committed in the same transaction. Only after that commit is the one email attempt made, and the result is written back to the reminder row.
  - Concurrent passes therefore never double-send: the unique key decides.
  - A crash between commit and email leaves `email_status = 'pending'`, never retried (A6).

**Tech Stack:** FastAPI, async SQLAlchemy + asyncpg, Alembic, PostgreSQL 18, pytest on real PostgreSQL.

**Spec:**
- `openspec/changes/rebuild-notifications/specs/notifications/spec.md` (FR-SYS-018, 035, 038, 037, 036).
- `proposal.md`: decisions D1–D8, assumptions A1–A11, Minors 1–7.

## Global Constraints

- **Bangkok date:** `bangkok_date(dt) = dt.astimezone(BANGKOK).date()`, where `BANGKOK` comes from `app/billing_time.py`.
- **Reminder kinds, stages and cycles:**

  | kind | stages | cycle (string key) | days_left → stage |
  |---|---|---|---|
  | `subscription_expiry` | `d7`, `d3`, `d1`, `d0`, `after` | expiry time, ISO-8601 UTC (`end.astimezone(UTC).isoformat()`) | 7→d7, 3→d3, 1→d1, 0→d0, −1→after |
  | `usage` | `low`, `month_end` | Bangkok month key `YYYY-MM-01` | n/a |
  | `free_quota_expiry` | `d7`, `d3`, `d1`, `d0` | `free_quotas.expires_at`, ISO-8601 UTC | 7/3/1/0; `d0` only while `now < expires_at` |

  `days_left = (bangkok_date(end) - bangkok_date(now)).days`.
- **Expiry time (A1):**
  - Start from the subscriptions active at `now`. Take the largest `ends_at` among them. Then, while some subscription has `starts_at <= end < ends_at`, move `end` to that `ends_at`.
  - With none active, use the largest `ends_at <= now`. Never-subscribed → no expiry.
- **Usage:**
  - Applies only with an active subscription.
  - Monthly quota is the current plan's `monthly_quota`; used is the sum of unreleased `from_monthly` for the Bangkok month.
  - `remaining = max(quota - used, 0)`.
  - `low` when `remaining * 5 < quota`.
  - `month_end` when today (Bangkok) is the month's last day minus 3 and `remaining > 0` (A2).
- **Free-quota expiry:** organizations only; requires `remaining > 0` and `expires_at IS NOT NULL`.
- **Recipients:**
  - Organization: the membership with `is_owner`.
  - Personal tenant: `tenants.owner_user_id`.
  - Tenants of kind `guest`, or with status other than `active`, are skipped.
  - Email only when the user's `registered_at` and `email` are both set; otherwise `email_status = 'skipped'`.
- **Notification type** equals the reminder kind. `data` is JSON:
  - `stage`;
  - `plan_code`, plus `ends_at` (ISO) for expiry;
  - `quota`, `used`, `remaining` and `month` for usage;
  - `remaining` and `expires_at` for free quota.
- **Email:** English, subject and body from `app/reminder_mail.py` (table in Task 3). One `sender.send` call per reminder. The sender's own transient retries count as one attempt.
- **Settings:**
  - `REMINDERS_ENABLED` (bool, default `true`);
  - `REMINDER_INTERVAL_SECONDS` (int, default 900, allowed 60–1800, so that "at least every 30 minutes" holds).
- **Audit:** neither sending reminders nor marking read writes `audit_log` (A8).
- **Errors:** existing `AppError` codes only: 400 `validation_error` with `fields`, 401 `unauthenticated`, 404 `not_found`.
- **Commits:** start with `[rebuild-notifications]`.

## Review Focus

1. **Two passes running at the same time:** the owner still gets one notification and at most one email. Task 3 has a `gather` test with two sessionmakers.
2. **Expiry at 10:00 Bangkok, checked at 15:00 the same day:**
   - the subscription is no longer active, but the stage is still `d0`;
   - the next day it is `after`;
   - for free quota, the `d0` check at 15:00 sends nothing, because the quota has already expired.

   Task 2 unit-tests these.
3. **A renewal chained exactly at the old `ends_at`:** with `starts_at == end`, coverage continues. Overlapping upgrade periods also continue. Task 2 tests both.
4. **The SMTP sender raises, or is absent (None):**
   - the notification still exists;
   - `email_status` is `failed` or `skipped`;
   - a second pass sends nothing.

   Task 3 tests this.
5. **Mark-read bodies `{"ids": [true]}`, `{"ids": "1"}`, `{"ids": [2**63]}` and `{"ids": null}`:** the first three give 400 with `fields: ["ids"]`; `null` marks all. Query `limit=0`, `limit=101` and `before=abc` give 400. Task 5 tests these.

## Minors carried in (B-2c final review, `archive/2026-11-05-rebuild-plans-metering/verification.md` §4)

| # | Minor | Task |
|---|---|---|
| M1 | `release` does not check the reservation's tenant | 6 |
| M2 | Admin direct set of verification closes the pending application without audit, reason fixed to English | 6 |
| M3 | Dates near year 9999 give 500 | 6 |
| M4 | `add_months` computes in UTC, so it can be a day off from the Bangkok calendar near month end | 6 |
| M5 | Admin subscription and reservation lists give 200 `[]` for an unknown tenant | 6 |
| M6 | Usage can show a future period when nothing is active | 6 |
| M7 | Requirements-Index identity rows cite "PRD §4.9 v3.5" and are out of order; the PRD lacks the same-plan chaining rule | 7 |

(The backfill Minor is dropped by the owner: D6.)

## File Structure

- `app/models/notification.py`: `Notification`, `Reminder`.
- `alembic/versions/0006_notifications.py`.
- `app/reminder_rules.py`: pure functions, no I/O.
- `app/reminder_mail.py`: subject and body per kind and stage.
- `app/services/reminder_service.py`: one pass.
- `app/services/notification_service.py`: list and mark read.
- `app/routers/notifications.py` and `app/schemas/notification.py`.
- `app/cli.py`: `reminders-run-once` and `reminders-loop`.
- `scripts/deploy/compose.yaml`: service `saiflow-be-reminders`.
- Tests:
  - `tests/unit/test_reminder_rules.py`, `tests/unit/test_reminder_mail.py`;
  - `tests/integration/test_notifications_schema.py`, `test_reminders_expiry.py`, `test_reminders_usage.py`, `test_reminders_free_quota.py`, `test_reminders_delivery.py`, `test_notification_center.py`, `test_billing_minors_b2d.py`.

---

### Task 1: Schema 0006 and models

**Files:**
- Create: `app/models/notification.py`, `alembic/versions/0006_notifications.py`
- Modify: `app/models/__init__.py`, `tests/integration/db_fixtures.py` (the truncate list picks up new tables if it is explicit)
- Test: `tests/integration/test_notifications_schema.py`

**Interfaces:** tables in `saiflow_v3`, all timestamps `timestamptz`.

- `notifications`:
  - `id` (bigint identity), `user_id` (FK users), `tenant_id` (FK tenants), `type` (CHECK in the three kinds);
  - `data` (jsonb, NOT NULL), `created_at`, `read_at` (NULL);
  - index `(user_id, id DESC)`; partial index `(user_id) WHERE read_at IS NULL`; index `tenant_id`.
- `reminders`:
  - `id`, `tenant_id` (FK), `kind` (CHECK the three kinds), `cycle` (text), `stage` (text);
  - CHECK `(kind, stage)` pairs per the Global Constraints table;
  - `recipient_user_id` (FK users), `notification_id` (FK notifications, NOT NULL);
  - `email_status` (CHECK `pending|sent|failed|skipped`), `email_error` (text NULL), `created_at`, `email_at` (NULL);
  - UNIQUE `(tenant_id, kind, cycle, stage)`; index every FK.
- Neither table is `tenant_scoped`: guest claims move nothing, because guests get no reminders.
- The downgrade refuses while rows exist, as 0005 does.

- [ ] **Step 1: Write the failing tests.**
  - `test_notification_tables_exist`.
  - `test_reminder_unique_key`: the second insert of the same `(tenant, kind, cycle, stage)` raises `IntegrityError`.
  - `test_reminder_stage_check`: `('usage', 'd7')` raises `IntegrityError`.
  - `test_app_role_reads_and_writes_notifications`: through `app_role_db`, insert and update both tables.
  - `test_downgrade_0006_refuses_with_rows`.
- [ ] **Step 2: Run.** Expected: FAIL (tables missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite plus `alembic downgrade 0005 && alembic upgrade head` on an empty DB. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-notifications] schema: notifications and reminders`

### Task 2: Reminder rules (pure)

**Files:** create `app/reminder_rules.py`; modify `app/billing_time.py` (add `bangkok_date`). Test: `tests/unit/test_reminder_rules.py`.

**Interfaces:**
- `def bangkok_date(dt: datetime) -> date`.
- `def expiry_time(periods: list[tuple[datetime, datetime]], now: datetime) -> datetime | None`: implements A1 from Global Constraints.
- `def expiry_stage(end: datetime, now: datetime) -> str | None`: the days_left → stage map. Any other value gives None.
- `def usage_stages(quota: int, used: int, now: datetime) -> list[str]`: subset of `["low", "month_end"]`.
- `def free_quota_stage(expires_at: datetime, remaining: int, now: datetime) -> str | None`.
- `def month_cycle(now: datetime) -> str`: `month_key(now).isoformat()`.
- `def time_cycle(dt: datetime) -> str`: ISO-8601 UTC.

- [ ] **Step 1: Write the failing tests.** All times are Bangkok-aware literals.
  - `test_expiry_stage_nodes`: end 2026-12-10 10:00 BKK.
    - now 12-03 → d7; 12-07 → d3; 12-09 → d1;
    - 12-10 09:00 → d0; 12-10 15:00 → d0;
    - 12-11 → after; 12-12 → None; 12-05 → None.
  - `test_expiry_time_chained_and_overlapping`:
    - `[(a,b),(b,c)]` at now in `(a,b)` → c;
    - an overlapping upgrade `[(a,c),(m,d)]` with a<m<c<d → d;
    - a gap `[(a,b),(b+1h,c)]` → b.
  - `test_expiry_time_after_end`: none active → the latest `ends_at <= now`; no periods → None.
  - `test_usage_low_threshold`: quota 5000 — used 4001 → `low` included; used 4000 → not included.
  - `test_month_end_day`:
    - 2026-01-28 → `month_end` with remaining > 0; 2026-01-29 → no;
    - 2026-02-25 → yes (28-day February); 2028-02-26 → yes (leap year);
    - 2026-01-28 with remaining 0 → no.
  - `test_free_quota_stage`:
    - expires 12-10 10:00 BKK, remaining 60: 12-03 → d7;
    - 12-10 09:00 → d0; 12-10 15:00 → None;
    - remaining 0 → None;
    - 12-05 → None.
- [ ] **Step 2: Run.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `uv run pytest tests/unit/test_reminder_rules.py -q`. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-notifications] reminder rules`

### Task 3: Reminder pass and delivery (FR-SYS-018, 035, 038, 037)

**Files:**
- Create: `app/reminder_mail.py`, `app/services/reminder_service.py`
- Modify: `app/services/metering_service.py` (make `_used` public as `used_in_month(db, tenant_id, month) -> int`; keep the old call sites)
- Test: `tests/unit/test_reminder_mail.py`, `tests/integration/test_reminders_{expiry,usage,free_quota,delivery}.py`

**Interfaces:**
- `async def run_once(sessionmaker, sender: SmtpSender | None, now: datetime, enabled: bool = True) -> int`: the number of reminders created in this pass. With `enabled=False`, it returns 0 and touches nothing.
- Per tenant, it uses its own session and transaction:
  1. compute the due `(kind, cycle, stage, data)` list;
  2. resolve the recipient;
  3. for each due item, in one transaction:
     - insert the notification;
     - insert the reminder with `ON CONFLICT (tenant_id, kind, cycle, stage) DO NOTHING RETURNING id`;
     - if nothing was returned, roll back (another pass won);
     - otherwise commit.
  4. After the commit, if `email_status` is `pending`, call `sender.send` once and update the row to `sent` or `failed` (store `email_error` as `type(exc).__name__`), with `email_at`.
- A tenant whose processing raises is logged and skipped. The pass continues.
- `def render(kind: str, stage: str, data: dict, tenant_label: str) -> tuple[str, str]`: subject and body. `tenant_label` is the organization name, or `"your personal account"`.

  | kind / stage | subject |
  |---|---|
  | `subscription_expiry` d7/d3/d1 | `SaiFlow: your plan expires in {n} days` (`1 day` for d1) |
  | `subscription_expiry` d0 | `SaiFlow: your plan expires today` |
  | `subscription_expiry` after | `SaiFlow: your plan has expired` |
  | `usage` low | `SaiFlow: less than 20% of this month's scans left` |
  | `usage` month_end | `SaiFlow: unused scans reset at the end of this month` |
  | `free_quota_expiry` d7/d3/d1 | `SaiFlow: your organization's free scans expire in {n} days` (`1 day` for d1) |
  | `free_quota_expiry` d0 | `SaiFlow: your organization's free scans expire today` |

  The body names `tenant_label`, the plan, the time in Bangkok (`YYYY-MM-DD HH:MM (UTC+7)`) and the remaining count where present. It ends with `To renew or upgrade, open SaiFlow.` The body never contains the recipient's email address.

- [ ] **Step 1: Write the failing tests.**
  - Unit `test_render_subjects`: every row of the table; d1 says `1 day`.
  - `test_reminders_expiry.py`:
    - `test_d7_once` (018-01): two passes on the same day → 1 notification, 1 email.
    - `test_missed_node_not_sent` (018-02).
    - `test_d0_and_after` (018-03): three days.
    - `test_chained_renewal_no_old_reminder` (018-04): via `subscription_service.set_subscription` with the default chaining.
    - `test_renewal_restarts_nodes` (018-05).
    - `test_never_subscribed_org_silent` (018-06).
  - `test_reminders_usage.py`:
    - `test_low_once` (035-01): reserve so that 999 remain; the notification data has `remaining == 999`.
    - `test_exactly_twenty_percent_silent` (035-02).
    - `test_free_quota_not_counted` (035-03): `data.remaining == 150`.
    - `test_next_month_again` (035-04).
    - `test_month_end_once` (035-05).
    - `test_month_end_zero_or_wrong_day` (035-06).
    - `test_expired_no_usage_reminder` (035-07).
    - `test_plan_change_same_month_no_repeat` (A3).
  - `test_reminders_free_quota.py`: 038-01 to 038-05. 038-03 runs at 09:00 and at 15:00 on the expiry day: one at 09:00, none at 15:00 or on the next day.
  - `test_reminders_delivery.py`:
    - `test_org_reminder_to_owner_only` (037-01).
    - `test_after_transfer_new_owner` (037-02): uses the B-2b transfer service; the old notification stays with U.
    - `test_guest_silent` (037-03): no rows in either table.
    - `test_unregistered_in_app_only` (037-04): `email_status == 'skipped'`.
    - `test_email_failure_keeps_notification` (037-05): a FakeEmailSender that raises `EmailUnavailable` → `failed`; the second pass adds nothing.
    - `test_no_sender_skips_email`: `sender=None` → `skipped`.
    - `test_concurrent_passes_send_once` (037-06): `asyncio.gather` of two `run_once` on two sessionmakers → 1 notification, ≤ 1 email.
    - `test_disabled_then_enabled_no_backfill` (037-07).
    - `test_reminders_not_audited` (A8): no `audit_log` rows from a pass.
    - `test_one_failing_tenant_does_not_stop_pass`.
- [ ] **Step 2: Run.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-notifications] reminder pass: expiry, usage, free quota; in-app and email delivery`

### Task 4: Runner process and deployment

**Files:**
- Modify: `app/config.py` (`reminders_enabled: bool = True`, `reminder_interval_seconds: int = 900`, validated 60–1800), `app/cli.py`, `scripts/deploy/compose.yaml`, `scripts/deploy/env.example`, `scripts/tests/compose-config.test.sh`, `docs/deployment/README.md`
- Test: `tests/unit/test_config.py` (or the existing config test file), `tests/integration/test_reminder_cli.py`, the compose-config shell test

**Interfaces:**
- `python -m app.cli reminders-run-once`: one pass with `utcnow()`. It prints `reminders OK (<n> created)`, or `reminders disabled` when disabled. Exit 0.
- `python -m app.cli reminders-loop`:
  - repeats the pass, then sleeps `REMINDER_INTERVAL_SECONDS`;
  - an exception in a pass is logged and the loop continues;
  - SIGTERM stops it between passes.
- Compose service `saiflow-be-reminders`:
  - same image as `saiflow-be-api`, `<<: *common`, `command: ["python", "-m", "app.cli", "reminders-loop"]`;
  - runs as `saiflow_v3_app`, with the same DB and SMTP variables as the API;
  - `REMINDERS_ENABLED: ${REMINDERS_ENABLED:-true}`;
  - no ports; `depends_on` postgres healthy.
- Deploy: no change to `remote-deploy.sh` is needed, because `up -d --remove-orphans` starts the service. Confirm by reading the script. If the script lists services by name, add this one.

- [ ] **Step 1: Write the failing tests.**
  - `test_interval_bounds`: 59 and 1801 raise `ConfigError`; 900 is the default.
  - `test_run_once_cli_prints_count`.
  - `test_run_once_cli_disabled`.
  - Shell checks:
    - `reminders service runs the loop`;
    - `reminders service runs as the app role`;
    - `reminders service publishes no ports`;
    - `reminders service receives SMTP_HOST` (and the other SMTP variables);
    - `reminders service receives REMINDERS_ENABLED`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - README:
    - the new service;
    - how to stop reminders: set `REMINDERS_ENABLED=false` and run `docker compose up -d saiflow-be-reminders`;
    - running one pass by hand: `docker compose exec saiflow-be-reminders python -m app.cli reminders-run-once`;
    - the logs.
- [ ] **Step 4: Run** the whole suite, `bash scripts/tests/compose-config.test.sh`, shellcheck and actionlint. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-notifications] reminders process: cli loop, compose service, config`

### Task 5: Notification center (FR-SYS-036)

**Files:**
- Create: `app/services/notification_service.py`, `app/routers/notifications.py`, `app/schemas/notification.py`
- Modify: `app/main.py`; regenerate `docs/30-design/openapi.json` and `packages/api-client/src/generated` with `bash packages/api-client/scripts/generate.sh`
- Test: `tests/integration/test_notification_center.py`

**Interfaces** (`/api/v1/me/notifications`, `require_user`, so guests and anonymous callers get 401; CSRF on POST):

| Method + path | Body / query | Response |
|---|---|---|
| `GET /me/notifications` | `limit` (1–100, default 20), `before` (notification id, optional, 1..bigint) | `NotificationListOut {unread_count: int, items: [NotificationOut], next_before: int \| null}` |
| `POST /me/notifications/read` | `MarkReadIn(LooseRequest) {ids: list[int] \| None}` | `MarkReadOut {updated: int, unread_count: int}` |

- `NotificationOut`: `id`, `type`, `tenant_id`, `data` (object), `created_at`, `read` (bool).
- Ordering is `id DESC`. `next_before` is the last item's id when more rows exist, else null.
- Mark read:
  - `ids` absent or `null` → all of the caller's unread;
  - `[]` → nothing (`updated` 0);
  - other users' or unknown ids are ignored;
  - only `read_at IS NULL` rows are updated, so a repeat gives `updated` 0.
- Invalid query values → 400 `validation_error` with `fields` naming the parameter. The global handler maps query errors to 400; check that it does, and add the mapping if it maps them to 422.
- There is no delete endpoint (D7).

- [ ] **Step 1: Write the failing tests.**
  - `test_list_and_unread_count` (036-01).
  - `test_paging_no_overlap` (036-02): 25 rows.
  - `test_mark_some_idempotent` (036-03).
  - `test_mark_all` (036-04): also `{"ids": null}`.
  - `test_empty_list_marks_nothing`.
  - `test_only_own_notifications` (036-05).
  - `test_mark_read_validation` (036-06): the bodies listed in Review Focus 5.
  - `test_list_query_validation`.
  - `test_read_kept_no_delete` (036-07): `DELETE /me/notifications/{id}` gives 404 or 405, and the item is still listed.
  - `test_guest_and_anonymous_401` (036-08).
  - `test_csrf_required_on_mark_read`.
  - `test_openapi_has_notification_schemas`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite, then the generate script and `bash scripts/check-generated-clean.sh docs/30-design/openapi.json packages/api-client/src/generated` after committing. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-notifications] notification center (FR-SYS-036); contract`

### Task 6: B-2c Minors M1–M6

**Files:** `app/services/metering_service.py`, `app/services/verification_service.py`, `app/billing_time.py`, `app/services/subscription_service.py`, `app/routers/admin_billing.py`. Test: `tests/integration/test_billing_minors_b2d.py`, `tests/unit/test_billing_time.py`.

**Interfaces:**
- **M1:** `release(db, tenant_id: int, reservation_id: int) -> None`.
  - A reservation of another tenant, or an unknown one, gives 404 `not_found` and changes nothing.
  - Update the module docstring (the B-3 contract) and every caller.
- **M2:** when `set_verified` closes a pending application:
  - it writes audit `verification.reject` with actor admin and target the application;
  - `reject_reason` becomes the code `set_by_admin` (the frontend localizes it).
- **M3:** in `set_subscription`, an `OverflowError` or `ValueError` from `add_months` gives 400 `fields: ["starts_at"]`. `parse_time` rejects years above 9998 with the field.
- **M4:** `add_months(dt, n)` adds months on the Bangkok calendar and returns the result in `dt`'s tzinfo.
- **M5:**
  - `GET /admin/tenants/{id}/subscriptions` and `/reservations` give 404 for an unknown tenant;
  - `PUT .../subscription` keeps its current 404.
- **M6:** `usage` reports `plan` from the latest subscription with `starts_at <= now`. A subscription that only exists in the future is not shown, and `plan` is null. Add `subscription_service.latest_started(db, tenant_id, now)`; leave `current` unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `test_release_other_tenant_404` (M1).
  - `test_admin_set_closes_pending_with_audit` (M2): the audit row exists and the reason is `set_by_admin`.
  - `test_year_9999_start_400` (M3): PUT with `starts_at` `9999-12-15T00:00:00+07:00` → 400.
  - Unit `test_add_months_bangkok_calendar` (M4): `add_months(2026-01-30T20:00Z, 1) == 2026-02-27T20:00Z`; the UTC rule would give 02-28.
  - `test_admin_lists_unknown_tenant_404` (M5).
  - `test_usage_hides_future_period` (M6): a tenant whose only subscription starts next week shows `plan: null`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite. Expected: pass. Existing tests that call `release(db, id)` are updated as part of M1.
- [ ] **Step 5: Commit** `[rebuild-notifications] B-2c minors: release tenant check, verification close audit, year bound, Bangkok months, unknown tenant 404, no future period in usage (M1-M6)`

### Task 7: Doc sync and M7

**Files:**
- `docs/10-product/PRD-SaiFlow.md` §4.9, version bump:
  - the day after expiry; the month-end day; guests are not reminded;
  - checks at least every 30 minutes;
  - organization free-quota expiry reminders;
  - same-plan chaining (M7);
  - notifications are kept, read or unread only.
- `docs/10-product/Glossary.md`:
  - update 用量提醒 and 到期提醒;
  - add 免费额度到期提醒, 站内通知, 通知中心.
- `docs/30-design/Data-Model.md`: `DM-Notification`, `DM-Reminder`.
- `docs/20-requirements/functional/EPIC-06-system-base.md`: mark FR-SYS-018 as migrated to `openspec/specs/notifications/spec.md` (deprecated), in the existing style.
- `docs/20-requirements/Requirements-Index.md`:
  - FR-SYS-018 points to the notifications spec;
  - add FR-SYS-035 to 038;
  - M7: identity rows cite their EPIC-06 sources, and rows are in ID order;
  - version bump.
- `docs/30-design/adr/ADR-006-ai-native-workflow.md` §7: the B-2d row; version bump.
- Version tables: add a row in each changed doc.

- [ ] **Step 1:** Edit. Each changed fact cites the spec ID.
- [ ] **Step 2:** Run `openspec validate rebuild-notifications` and `grep -n "FR-SYS-03[5-8]" docs/20-requirements/Requirements-Index.md`. Expected: valid; 4 rows.
- [ ] **Step 3: Commit** `[rebuild-notifications] doc sync (PRD, glossary, data model, EPIC-06, index, ADR-006)`

### Task 8: Verification

- [ ] **Step 1:** Run the full backend suite with `REQUIRE_INTEGRATION=1`, the script tests, the generate check and CI on the pushed branch. Expected: all green.
- [ ] **Step 2:** Final whole-branch review (executing-plans). Then do the fix pass.
- [ ] **Step 3:** After the owner approves the deploy, ask the owner to run the server checks, then record them:
  - migration version `0006`;
  - `docker compose ps saiflow-be-reminders` shows it running;
  - `reminders-run-once` prints OK;
  - audit-verify OK;
  - restore-check OK.
- [ ] **Step 4:** Write `verification.md`, mapping each AC to its test, plus M1–M7, the server checks, the final review and the deferred minors. Commit, then archive.
