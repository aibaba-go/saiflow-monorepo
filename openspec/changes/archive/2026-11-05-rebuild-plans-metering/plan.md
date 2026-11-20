# rebuild-plans-metering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the plan catalog, subscriptions with history, free quotas, the scan-count reservation interface that B-3 calls, usage queries and plan applications. Make the organization member limit follow the plan. Close the 10 Minors left by B-2b and sync the docs.

**Architecture:**
- Everything lives in `services/api` on the existing stack.
- Reservations are rows, not a running total:
  - monthly usage is the sum of unreleased `from_monthly` for the tenant and Bangkok month;
  - free-quota balance is one row per tenant.
- A per-tenant transaction-scoped advisory lock serialises every reservation and release for that tenant. The same pattern as email codes, it works for guests too, who have no free-quota row.
- `metering_service.reserve` and `metering_service.release` never commit. The caller (B-3's job creation and job failure paths) commits them together with its own rows, so a job and its reservation appear or disappear together.

**Tech Stack:** FastAPI, async SQLAlchemy + asyncpg, Alembic, PostgreSQL 18, pytest on real PostgreSQL.

**Spec:**
- `openspec/changes/rebuild-plans-metering/specs/billing/spec.md` (FR-SYS-030, 012, 031, 013, 033, 032, 034).
- `specs/tenancy/spec.md` (modified FR-SYS-025, FR-SYS-027).
- `proposal.md` (D1–D10, A1–A9).

## Global Constraints

- **Plan codes:** `kinder`, `starter`, `intermediate`, `advance`.
  - Initial monthly quota: 1000 / 5000 / 10000 / 100000.
  - Initial member limit: 1 / 2 / 5 / unlimited (NULL).
  - Kinder is for `personal` and `guest` tenants; the other three are for `organization`.
  - Kinder's member limit is fixed at 1.
- **Period:** `month` or `year`; one month is a calendar month (`+1 month`, clamped to the end of the month), one year is 12 months.
- **Subscription active:** `starts_at <= now < ends_at`. The current subscription is the active one; if none is active, the most recent by `starts_at`.
- **Source:** `auto`, `admin` or `application`.
- **Free quota:**
  - Personal: granted at registration, default 100 (setting `free_quota_personal`), no expiry, paused while the tenant has no active subscription.
  - Organization: granted at approval, default 100 (setting `free_quota_organization`), expires 1 calendar month after approval.
  - Guests: none.
- **Month key:** the first day of the month in UTC+7 (Thailand has no DST: `timezone(timedelta(hours=7))`; no tzdata dependency).
- **Reservation errors:**
  - 402 `quota_exceeded` with `details: {"available": n}`.
  - 402 `plan_expired` when there is no active subscription and no usable free quota.
- **Errors:** `ErrorResponse` gains an optional `details: dict | None` (additive; `fields` unchanged). `AppError` gains `details=None`.
- **Audit:** every state-changing billing operation writes `audit_log` through `audit_service.record`. Reservations and releases are recorded in `quota_reservations`, not in `audit_log`.
- **No new table is `tenant_scoped`:** guest claiming moves none of it (A8).
- **Requests:** bodies use `LooseRequest` plus `ensure_text`. Tenant-scoped customer endpoints use `get_tenant_context` (header `X-Tenant-Id`).
- **Commits:** start with `[rebuild-plans-metering]`.

## Review Focus

1. **Two jobs for the same tenant submitted at the same moment** never reserve more than is available, including one free-quota page plus one monthly page racing. Task 4 has the gather test.
2. **A reservation made at 23:59 on the last day of the month (Bangkok) and released after midnight** goes back to the old month, and the new month starts full. Task 4 tests this with a patched clock.
3. **An organization whose free quota expires between reserve and release** must not get the expired pages back as usable quota. Task 4 tests this.
4. **An admin who edits the Kinder member limit, sets an end date before the start date, or sets a plan for a tenant ID that does not exist** gets 400 or 404, never 500 and never a half-written subscription. Tasks 2 and 3 test these.
5. **The app DB role** can read and write every new table, and cannot write `plans` rows except through the migration (seed). Admin updates go through the API as the app role. Task 1 tests the grants as the app role.

## Minors carried in (B-2b final review, `archive/2026-11-04-rebuild-tenant-rbac/verification.md` §4)

| # | Minor | Task |
|---|---|---|
| N1 | Path IDs that are not digits give 422; IDs beyond bigint in path or body give 500 | 7 |
| N2 | The caller's permission is checked before the organization lock | 7 |
| N3 | `delete_role` racing `assign_role` gives 500 | 7 |
| N4 | Verification submit and approve lock in different orders (deadlock) | 7 |
| N5 | Admin direct set or unset of verification leaves a pending application | 7 |
| N6 | An empty organization PATCH still writes `org.update` | 7 |
| N7 | The 0004 downgrade fails once organizations exist; not documented | 8 |
| N8 | `IntSettingIn` and `SetVerifiedIn` are plain BaseModel (422, coerced values) | 7 |
| N9 | Some endpoints return untyped dicts | 7 |
| N10 | A verified organization can be flipped back by resubmitting — now spec AC-FR-SYS-027-07 | 6 |

## File Structure

- `app/models/billing.py`: `Plan`, `Subscription`, `FreeQuota`, `QuotaReservation`, `PlanApplication`.
- `alembic/versions/0005_billing.py`: tables, plan seed, settings seed, backfill (A2).
- `app/services/plan_service.py`: catalog read and admin edit.
- `app/services/subscription_service.py`: auto start, admin set, current and active, history, rules.
- `app/services/free_quota_service.py`: grant, usable balance.
- `app/services/metering_service.py`: **`reserve`, `release`, `usage`** — the B-3 interface.
- `app/services/plan_application_service.py`: apply, approve, reject, list.
- `app/routers/billing.py` (customer) and `app/routers/admin_billing.py` (admin).
- `app/schemas/billing.py`.
- `app/billing_time.py`: `BANGKOK`, `month_key(dt) -> date`, `add_months(dt, n) -> datetime`.
- Tests: `tests/integration/test_billing_*.py`; `tests/unit/test_billing_time.py`.

## Endpoints

**Customer** (`/api/v1`, CSRF on unsafe methods, tenant from `get_tenant_context`):

| Method + path | Who | Purpose |
|---|---|---|
| `GET /billing/usage` | any member, guest included | FR-SYS-033 |
| `GET /billing/applications` | any member | the tenant's applications |
| `POST /billing/applications` | personal: self; organization: owner or `plan_apply`; guest → 401 | FR-SYS-032 |

**Admin** (`/api/v1/admin`, `get_admin`, CSRF):

| Method + path | Purpose |
|---|---|
| `GET /plans`, `PATCH /plans/{code}` | FR-SYS-030 |
| `GET /tenants/{tenant_id}/subscriptions`, `PUT /tenants/{tenant_id}/subscription` | FR-SYS-012 history and set |
| `GET /tenants/{tenant_id}/reservations` | FR-SYS-034-02 |
| `GET /plan-applications?status=`, `POST /plan-applications/{id}/approve`, `POST /plan-applications/{id}/reject` | FR-SYS-032 |
| `GET` and `PUT /settings/free-quota-personal`, `GET` and `PUT /settings/free-quota-organization` | FR-SYS-031 |

The approve body is optional: `{starts_at?, ends_at?}`, the same as the PUT subscription defaults.

---

### Task 1: Schema 0005, models, error `details`

**Files:**
- Create: `app/models/billing.py`, `alembic/versions/0005_billing.py`
- Modify: `app/models/__init__.py`, `app/schemas/common.py`, `app/errors.py`, `tests/integration/db_fixtures.py` (re-seed `plans` and the two settings after TRUNCATE, like `org_member_limit_unpaid`)
- Test: `tests/integration/test_billing_schema.py`, `tests/unit/test_errors.py` (details)

**Interfaces:** tables in `saiflow_v3`, all with `timestamptz`.

- `plans`:
  - `code` (text PK), `monthly_quota` (int, CHECK > 0), `member_limit` (int NULL = unlimited, CHECK > 0), `tenant_kind` (CHECK `personal|organization`), `sort_order`, `updated_at`;
  - CHECK `code <> 'kinder' OR member_limit = 1`.
- `subscriptions`:
  - `id`, `tenant_id` (FK tenants), `plan_code` (FK plans), `period` (CHECK `month|year`), `starts_at`, `ends_at` (CHECK `ends_at > starts_at`);
  - `source` (CHECK `auto|admin|application`), `application_id` (FK plan_applications, NULL), `set_by_admin_id` (FK admin_accounts, NULL), `created_at`;
  - index `(tenant_id, starts_at)`.
- `free_quotas`: `tenant_id` (PK, FK tenants), `granted`, `remaining` (CHECK `remaining >= 0`), `expires_at` (NULL), `granted_at`.
- `quota_reservations`:
  - `id`, `tenant_id`, `reference` (text — B-3 job ID), `pages` (CHECK > 0), `from_free`, `from_monthly` (CHECK both `>= 0` and `from_free + from_monthly = pages`);
  - `month` (date), `reserved_at`, `released_at`;
  - index `(tenant_id, month)`; unique `(tenant_id, reference)`.
- `plan_applications`:
  - `id`, `tenant_id`, `applicant_user_id`, `plan_code`, `period`, `note`;
  - `status` (CHECK `pending|approved|rejected`), `reject_reason`, `decided_by_admin_id`, `decided_at`, `subscription_id` (FK subscriptions, NULL), `created_at`;
  - partial unique `(tenant_id) WHERE status = 'pending'`.
- The circular FK between `subscriptions.application_id` and `plan_applications.subscription_id` is created with `use_alter`.
- Index every FK column.

Seeds:
- `plans`: the 4 rows from Global Constraints.
- `system_settings`: `free_quota_personal` = 100, `free_quota_organization` = 100.

**Backfill (A2):** for every `tenants` row of kind `personal` or `guest`, insert a `kinder`/`month` subscription from `now()` to `now() + 1 month`, with source `auto`.

Error shape:
- `ErrorResponse.details: dict | None = None`.
- `AppError(..., details: dict | None = None)`, passed through by `_respond`.

- [ ] **Step 1: Write the failing tests.**
  - `test_billing_tables_exist`.
  - `test_plan_seed`: 4 rows with the exact values above.
  - `test_kinder_member_limit_check`: updating Kinder's `member_limit` to 3 raises `IntegrityError`.
  - `test_reservation_split_check`: `from_free + from_monthly != pages` raises `IntegrityError`.
  - `test_one_pending_plan_application_per_tenant`.
  - `test_app_role_reads_and_writes_billing_tables`: through `app_role_db`, insert into `subscriptions`, `quota_reservations` and `free_quotas`, and update `plans.monthly_quota`.
  - `test_backfill_gives_existing_personal_tenants_kinder`: covered by migrating a fresh DB that has one personal tenant created at 0004.
  - Unit `test_app_error_details_in_body`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite plus `alembic downgrade 0004 && alembic upgrade head`. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] schema: plans, subscriptions, free quotas, reservations, plan applications; error details`

### Task 2: Plan catalog (FR-SYS-030)

**Files:** create `app/services/plan_service.py`, `app/routers/admin_billing.py`, `app/schemas/billing.py`; modify `app/main.py`. Test: `tests/integration/test_billing_plans.py`.

**Interfaces:**
- `async def list_plans(db) -> list[Plan]`, ordered by `sort_order`.
- `async def get_plan(db, code) -> Plan`: unknown code → 404.
- `async def update_plan(db, admin_id, code, monthly_quota: int | None, member_limit: int | None | Unset) -> Plan`:
  - the `member_limit` JSON value `null` means unlimited; an absent field means unchanged;
  - Kinder with any `member_limit` → 400 `fields: ["member_limit"]`;
  - values < 1 → 400 with the field;
  - audits `plan.update`.
- Request model `PlanUpdateIn(LooseRequest)` with `monthly_quota: int | None` and `member_limit: int | None`. Use `model_fields_set` to tell "absent" from `null`.

- [ ] **Step 1: Write the failing tests.**
  - `test_admin_lists_catalog` (030-01).
  - `test_quota_change_applies_to_existing_subscription` (030-02): uses `metering_service.usage` from Task 4. Write this test in Task 4 and mark it there. Here, assert `GET /admin/plans` shows 4500 after the PATCH.
  - `test_kinder_member_limit_fixed` (030-03).
  - `test_plan_validation` (030-04): 0, -1, `"5"`, 1.5 and member limit 0 each → 400 with the field.
  - `test_plan_admin_only` (030-05).
  - `test_unknown_plan_404`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] plan catalog and admin edit (FR-SYS-030)`

### Task 3: Subscriptions and the plan-based member limit (FR-SYS-012, FR-SYS-025 modified)

**Files:** create `app/billing_time.py` and `app/services/subscription_service.py`; modify:
- `app/services/auth_service.py`: after the personal tenant is created, call `start_default`;
- `app/services/session_service.py`: `create_guest` does the same;
- `app/services/membership_service.py`: `member_limit`;
- `app/routers/admin_billing.py`.

Test: `tests/unit/test_billing_time.py`, `tests/integration/test_billing_subscriptions.py`.

**Interfaces:**
- `BANGKOK = timezone(timedelta(hours=7))`.
- `month_key(dt: datetime) -> date`.
- `add_months(dt: datetime, n: int) -> datetime`: day clamped, so Jan 31 + 1 gives Feb 28/29.
- `async def start_default(db, tenant_id, now) -> Subscription`: Kinder, `month`, source `auto`, audits `subscription.auto`. It never commits; it rides the caller's transaction.
- `async def current(db, tenant_id, now) -> Subscription | None` and `def is_active(sub, now) -> bool`.
- `async def set_subscription(db, *, tenant_id, plan_code, period, starts_at=None, ends_at=None, source, admin_id, application_id=None, now) -> Subscription`. It:
  1. locks the tenant (`pg_advisory_xact_lock(4207004, tenant_id)`);
  2. checks the tenant exists (404) and that the tenant kind matches `plan.tenant_kind`, with guests counting as `personal` (400 `fields: ["plan_code"]`);
  3. refuses a downgrade while a subscription is active, comparing `sort_order` (400 `["plan_code"]`);
  4. applies the defaults: same plan and active → starts at `current.ends_at`; otherwise starts at `now`; ends at `add_months(start, 1 or 12)`;
  5. rejects `ends_at <= starts_at` (400 `["ends_at"]`);
  6. inserts a row (history, A1) and audits `subscription.set`.
- `async def history(db, tenant_id) -> list[Subscription]`.
- `membership_service.member_limit(db, tenant_id)`: an active subscription → that plan's `member_limit` (`None` = unlimited); otherwise the unpaid setting (A9).

- [ ] **Step 1: Write the failing tests.**
  - Unit:
    - `test_month_key_bangkok`: 2026-01-31T17:00Z falls in February.
    - `test_add_months_clamps`.
  - Integration:
    - `test_personal_and_guest_auto_kinder` (012-01).
    - `test_org_has_no_subscription` (012-02).
    - `test_admin_sets_org_subscription` (012-03).
    - `test_same_plan_renewal_extends` (012-04).
    - `test_plan_rules` (012-05).
    - `test_end_after_start` (012-06).
    - `test_history_kept` (012-08).
    - `test_set_for_unknown_tenant_404` (Review Focus 4).
    - `test_member_limit_follows_plan` (025-05).
    - `test_member_limit_back_to_unpaid_after_expiry` (025-06): use clock patching through `app.services.subscription_service.utcnow`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the whole suite. Expected: pass; the B-2b tests that rely on limit 2 still pass, since organizations have no subscription.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] subscriptions with history, auto Kinder, plan-based member limit (FR-SYS-012, 025)`

### Task 4: Free quota, reservation and release, usage (FR-SYS-031, 013, 033, 034-02)

**Files:** create `app/services/free_quota_service.py` and `app/services/metering_service.py`; modify:
- `app/services/user_service.py`: `register` calls `grant_personal`;
- `app/services/organization_service.py`: `on_organization_created` calls `grant_organization`;
- `app/routers/billing.py`, `app/routers/admin_billing.py`, `app/main.py`.

Test: `tests/integration/test_billing_metering.py`.

**Interfaces:**
- `async def grant_personal(db, tenant_id, now) -> None` and `async def grant_organization(db, tenant_id, now) -> None`:
  - insert with `ON CONFLICT (tenant_id) DO NOTHING`, so a tenant is granted once;
  - the amount comes from the settings;
  - the organization grant has `expires_at = add_months(now, 1)`;
  - audit `free_quota.grant`.
- `async def usable_free(db, tenant_id, kind, active: bool, now) -> int`:
  - organization: `remaining` if `expires_at > now`, else 0;
  - personal: `remaining` if `active`, else 0;
  - guest: 0.
- **`async def reserve(db, tenant_id: int, pages: int, reference: str) -> QuotaReservation`** in `metering_service`:
  1. advisory lock `(4207003, tenant_id)`;
  2. if `(tenant_id, reference)` already exists, return that reservation (B-3 retries are safe);
  3. compute `free = usable_free(...)` and `monthly_left = plan.monthly_quota − sum(unreleased from_monthly for this month)` (0 when no active subscription);
  4. if there is no active subscription and `free == 0` → 402 `plan_expired`;
  5. if `free + monthly_left < pages` → 402 `quota_exceeded`, `details={"available": free + monthly_left}`;
  6. otherwise take `min(free, pages)` from free and the rest from monthly, decrement `free_quotas.remaining`, insert the row with `month = month_key(now)`.

  **It does not commit.** `pages < 1` → 400 `["pages"]`.
- **`async def release(db, reservation_id: int) -> None`**:
  - lock the tenant;
  - if `released_at` is already set → no-op;
  - set `released_at`;
  - give `from_free` back to `free_quotas.remaining` only if the free quota has not expired (organizations), A4 and Review Focus 3;
  - `from_monthly` goes back simply by the row being released, which keeps it in its original month.

  **It does not commit.**
- `async def usage(db, ctx: TenantContext, now) -> UsageOut`: `{plan: {code, period, starts_at, ends_at} | None, active, month: {quota, used, remaining}, free: {remaining, expires_at, paused}}`.
- `async def reservations(db, tenant_id) -> list[QuotaReservation]` (admin view).
- **B-3 contract:**
  - call `reserve(db, ctx.tenant_id, page_count, job_id)` in the same transaction that inserts the job;
  - call `release(db, reservation.id)` in the transaction that marks the job FAILED or CANCELLED;
  - never call `release` on SUCCEEDED.

  Write this contract into the module docstring.

- [ ] **Step 1: Write the failing tests.** Use the service directly with `db`, plus HTTP for usage and the 402 shapes through a test-only route `POST /api/v1/_test/reserve` mounted in the test.
  - 031: `test_registration_grants_free_quota` (01), `test_free_quota_once` (02), `test_org_free_quota_expires_after_month` (03), `test_personal_free_paused_when_expired` (04), `test_guest_has_no_free_quota` (05), `test_setting_change_affects_only_later_grants` (06).
  - 013: `test_free_first_then_monthly` (01), `test_insufficient_rejects_whole` (02, body `details.available == 5`), `test_no_plan_no_free_is_plan_expired` (03), `test_release_returns_once` (04), `test_concurrent_reservations_do_not_overspend` (05, Review Focus 1), `test_new_month_resets` (06), `test_release_across_month_returns_to_old_month` (07, Review Focus 2), `test_yearly_plan_monthly_quota` (08), `test_release_after_org_free_expiry_does_not_restore` (Review Focus 3), `test_same_reference_returns_same_reservation`.
  - 033: `test_member_sees_usage` (01), `test_non_member_usage_404` (02).
  - 030-02: `test_quota_change_applies_to_existing_subscription`.
  - 034-02: `test_admin_sees_reservation_with_split`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] free quotas, scan reservation and release, usage (FR-SYS-031, 013, 033)`

### Task 5: Plan applications (FR-SYS-032)

**Files:** create `app/services/plan_application_service.py`; modify both routers. Test: `tests/integration/test_billing_applications.py`.

**Interfaces:**
- `async def apply(db, ctx: TenantContext, plan_code, period, note) -> PlanApplication`:
  - guest → 401 through `require_user` on the route;
  - organization → the owner or `require(ctx, Permission.PLAN_APPLY)`;
  - personal → the user themself;
  - the plan rules are checked as in `set_subscription` (reuse a `check_plan_rules(db, tenant_id, plan_code, now)` extracted from Task 3);
  - a note over 512 characters → 400;
  - a second pending application → 409 `application_pending`;
  - audits `plan_application.submit`.
- `async def approve(db, admin_id, application_id, starts_at=None, ends_at=None) -> Subscription`:
  - lock the application; if it is not pending → 409 `already_decided`;
  - call `set_subscription(..., source="application", application_id=...)`;
  - set the status and `subscription_id`;
  - audits `plan_application.approve`.
- `async def reject(db, admin_id, application_id, reason)`: the reason is required (400 `["reason"]`); audits `plan_application.reject`.
- `async def list_for_tenant(db, ctx)` and `async def list_all(db, status)`.

- [ ] **Step 1: Write the failing tests.**
  - `test_apply_and_approve` (032-01).
  - `test_application_plan_rules` (032-02).
  - `test_second_pending_409` (032-03).
  - `test_reject_requires_reason_then_resubmit` (032-04).
  - `test_no_permission_403_guest_401` (032-05).
  - `test_decide_twice_409` (032-06).
  - `test_approve_with_custom_dates`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] renewal and opening applications (FR-SYS-032)`

### Task 6: Audit coverage; verified organizations cannot resubmit (FR-SYS-034-01, FR-SYS-027-07, N10)

**Files:** modify `app/services/verification_service.py`. Test: `tests/integration/test_billing_audit.py` and `tests/integration/test_tenancy_verification.py`.

- [ ] **Step 1: Write the failing tests.**
  - `test_billing_operations_audited` (034-01): after a plan update, an application and an approval, the actions `plan.update`, `plan_application.submit` and `plan_application.approve` appear in that order, with actor, target and result.
  - `test_every_billing_action_is_logged`: the set includes `subscription.auto`, `subscription.set`, `free_quota.grant`, `plan_application.reject` and `setting.update`.
  - `test_verified_org_cannot_resubmit` (027-07): 409 `already_verified`; status and data unchanged.
- [ ] **Step 2: Run.** Expected: the 027-07 test FAILs; the audit tests may already pass (record that in the ledger).
- [ ] **Step 3: Implement.** In `submit`, after locking the organization, `verification_status == "verified"` → 409 `already_verified`.
- [ ] **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] audit coverage; verified organizations cannot resubmit (FR-SYS-034, 027)`

### Task 7: B-2b code Minors (N1–N6, N8, N9)

**Files:**
- `app/routers/organizations.py`, `app/routers/admin_organizations.py` (path IDs, response models);
- `app/schemas/organization.py`;
- `app/services/membership_service.py`, `role_service.py`, `organization_service.py`, `verification_service.py`.

Test: `tests/integration/test_tenancy_minors.py`.

**Interfaces:**
- **N1:**
  - A shared `PathId = Annotated[str, Path(...)]` is parsed by `parse_id(raw, *, not_found=True) -> int`. A value that is not digits, has more than 19 digits, or is ≤ 0 or > 2^63−1 → 404 for path IDs.
  - `org_context` and `path_tenant` take the tenant ID as a string and use it.
  - Body IDs (`role_id`, `user_id`) out of range → 400 with the field.
- **N2:** after `_lock_organization`, `remove_member`, `create_invitation`, `revoke_invitation` and `update_profile` re-resolve the caller through `tenant_access.resolve_tenant` and re-check the permission.
- **N3:** `assign_role` and `delete_role` lock the role row (`with_for_update`). A role that is gone at assign time → 404.
- **N4:** `verification_service.approve` and `reject` lock the organization first, then the application.
- **N5:** `set_verified` marks any pending verification application `rejected`, with reason `"set by admin"` when verifying or unsetting.
- **N6:** `update_profile` writes no audit row and returns unchanged when no value changes.
- **N8:** `IntSettingIn` and `SetVerifiedIn` become `LooseRequest` plus `ensure_text`, with a missing field → 400.
- **N9:** response models for `assignRole`, `transferOwner`, disable/enable, verification approve/reject/set, and organization application reject.

- [ ] **Step 1: Write the failing tests.**
  - `test_non_numeric_and_huge_path_ids_404`: `/organizations/abc`, `/organizations/99999999999999999999`, `/roles/abc`.
  - `test_huge_body_ids_400`.
  - `test_demoted_manager_cannot_finish_removal`: simulated with a stale context, the way the leave test does it.
  - `test_assign_deleted_role_404`: stale role.
  - `test_admin_set_closes_pending_application`.
  - `test_empty_org_patch_not_audited`.
  - `test_settings_body_validation_400`: `{"value": "5"}`, `{}`, `{"verified": "yes"}`.
  - `test_openapi_has_response_schemas`: every operation in `/api/v1/organizations*` and `/api/v1/admin/organizations*` has a 2xx response with a JSON schema.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-plans-metering] B-2b minors: path and body IDs, re-check under lock, role race, verification lock order and pending cleanup, no-op audit, settings bodies, response models (N1-N6, N8, N9)`

### Task 8: Doc sync, N7, contract

**Files:**
- `docs/10-product/PRD-SaiFlow.md` §4.9: the B-2c/B-2d split; LINE OA postponed; reservation semantics (reserve at submission, released on failure or cancel, whole document refused when short); personal tenants Kinder only.
- `docs/10-product/Glossary.md`: 预占 (reservation); the organization free quota is already there.
- `docs/30-design/Data-Model.md`: `DM-Plan`, `DM-Subscription` (history), `DM-FreeQuota`, `DM-Application` (plan applications), a note on reservations, and the B-2c implemented note.
- `docs/30-design/adr/ADR-006-ai-native-workflow.md` §7: the B-2c row narrowed; a new B-2d `rebuild-notifications` row.
- `docs/20-requirements/functional/EPIC-06-system-base.md`: FR-SYS-012 and 013 marked migrated to billing. **D10:** mark FR-SYS-001, 003, 010, 014, 015, 016, 019 and 020 migrated to `openspec/specs/identity/spec.md`.
- `docs/20-requirements/Requirements-Index.md`: the same rows, plus FR-SYS-030…034.
- `docs/deployment/README.md` §4 (**N7**): a 0004 downgrade with organizations present fails on its constraint; the 0005 downgrade refuses while any billing rows exist (final review); use image rollback only.
- Contract: regenerate `openapi.json` and the api-client.

- [ ] **Step 1:** Apply the edits, from script files and never Python heredocs. Each doc gets a version bump and a history row.
- [ ] **Step 2:** Run `grep` for leftovers ("团队租户", "原地升级", "B-2c … 提醒" in the ADR row), the contract check, and all `scripts/tests`. Expected: clean.
- [ ] **Step 3: Commit** `[rebuild-plans-metering] doc sync (plans, metering, migration marks for identity and billing), contract`

### Task 9: Verification and rollout (owner checkpoints)

- [ ] **Step 1:** Run the full suite and push; CI must be green.
- [ ] **Step 2 (owner):** Confirm the deploy. Migration 0005 backfills a Kinder month for existing personal and guest tenants.
- [ ] **Step 3:** After the deploy:
  - `GET /billing/usage` as a guest shows Kinder and free 0;
  - admin `GET /admin/plans` without a session → 401;
  - the owner runs `audit-verify`, checks the migration version `0005`, and runs `restore-check`.
- [ ] **Step 4:** Write `verification.md` (each AC → test; N1–N10), then `/opsx:archive rebuild-plans-metering`.

## Owner checkpoints

1. Review this plan.
2. Confirm the deploy.
3. Confirm the archive.
