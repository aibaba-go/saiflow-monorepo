# review-flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add review (0/1/2 levels per template, approve and return), official business data, field change logs, and review notifications to the backend, the LINE mini app and web-pc (B-4).

**Owner notes (2026-11-07):** reviewers are any members whose role holds 一级复核 / 二级复核 (the owner holds both); only the review *levels* are owner-only. Migration 0013 changes the schema only (plus filling `official_at` for already-confirmed jobs); no data is moved from main (ADR-009). Change logs are stored as jsonb, like raw and structured results.

**Architecture:**
- **State:** a job's review state lives on `ocr_jobs.review_status`: `UNREVIEWED | EDITED | PENDING_L1 | PENDING_L2 | CONFIRMED`. `CONFIRMED` now means official business data, and `official_at` records when.
- **Rounds:** each confirm that needs review opens a `review_rounds` row. Every decision appends a `review_records` row.
- **Change log:** every save that makes a new result version writes one `result_changes` row whose `items` jsonb holds all field changes (a JSON leaf diff), and a template switch writes one row of kind TEMPLATE — the same "big JSON in jsonb" storage as raw and structured results.
- **Notifications:** entering a level writes an in-app notification plus a `review_notices` row per recipient. The existing reminders loop sends their pending emails once.
- **Front ends:** both read everything through new `/api/v1/reviews*`, `/api/v1/review-settings*` and `/api/v1/ocr/jobs/{id}/changes` endpoints, plus extra fields on the existing result and job payloads.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy async, Alembic (schema `saiflow_v3`), pytest.
- Mini app: React, React Query, antd-mobile, Vitest.
- web-pc: React, antd 5, React Query, Vitest.

**Spec:**
- `openspec/changes/review-flow/proposal.md`
- `openspec/changes/review-flow/specs/{reviews,results,exports,notifications,line-mini,web-pc}/spec.md`

## Global Constraints

- **Levels:** 0 = 无需复核, 1 = 一级复核, 2 = 二级复核. A level outside 0–2 → 422. An unset level is 0. Personal and guest tenants are always 0.
- **Settings:** only the organization owner reads or changes review settings; anyone else → 403. A setting change affects later confirms only.
- **Reviewer rules:**
  - The reviewer is not this round's confirmer. At level 2, the reviewer is also not this round's level-1 reviewer. The owner is not exempt. Breaking this → 403 `reviewer_conflict`.
  - A job no longer at the requested level → 409.
- **Comments:** at most 500 characters. A return needs a comment that is not blank; otherwise 422.
- **Queues:** level-1 holders (`review_l1`) see every PENDING_L1 job of the org, level-2 holders (`review_l2`) every PENDING_L2 job. Queues ignore 数据浏览. They are sorted newest first by the time the job entered the level, at most 100 per page.
- **Locking and export:**
  - PENDING_L1, PENDING_L2 and CONFIRMED results are locked: saving, confirming and switching templates → 409.
  - Exporting is allowed only when CONFIRMED; anything else → 409.
  - A return goes back to "to verify" and unlocks.
- **Notifications:**
  - Recipients are fixed when a job enters a level: the org members holding that level's permission (owner included), minus this round's confirmer, and for level 2 minus the level-1 reviewer.
  - In-app notifications are always sent. Email is only sent when the org switch `review_email_enabled` is on (default off) and the recipient is registered and has an email address.
  - Each email is attempted once; a failure is never retried. Notices are not written to the operation log.
- Jobs confirmed before this change stay CONFIRMED (official).
- **UI copy:** UI languages are en (default), th and zh; every new key goes into all three. Copy follows the spec wording: "待复核" "一级复核" "二级复核" "已确认" "通过" "退回" "已提交复核" "该单据已被他人处理" "没有修改记录" "本人确认" "本人已做一级复核" "复核设置" "通知方式" "已保存".
- No new npm or Python dependencies. P0 only: no Confirm all, batch correction, LINE or SMS notifications, or batch Excel export.

## Review Focus

1. A manual template conversion finishing while the job is PENDING_L1 must not replace the confirmed result or clear the lock (Task 4 test `test_late_conversion_does_not_replace_pending`).
2. A reviewer without 数据浏览 opening another member's pending job must be able to load the job, its result, its pages and its change log. The same reviewer must still not see that job in History (Task 4 test `test_reviewer_reads_pending_job_and_file`).
3. A member whose review permission is removed after loading the queue gets 403 on decision, and nothing changes (Task 5 test `test_permission_removed_before_decision`).
4. A returned job confirmed again after the owner set its template to level 0 goes straight to CONFIRMED, not into a new round (Task 5 test `test_reconfirm_rereads_level`).
5. An org where nobody but the confirmer can review (e.g. only the owner, who confirmed): nothing is sent, nothing fails, and the job still enters PENDING_L1 and waits (Task 6 test `test_no_recipient_still_pending`).

---

## File Structure

**Backend `services/api`**
- `alembic/versions/0013_review_flow.py`: new tables and columns, and the backfill.
- `app/ocr/states.py`: review statuses and stages.
- `app/models/review.py` (new): `ReviewLevel`, `ReviewRound`, `ReviewRecord`, `ResultChange`, `ReviewNotice`. Plus `Organization.review_email_enabled` and `OcrJob.official_at`. The notification type list gains `review_pending`.
- `app/services/change_log.py` (new): the diff and recording of `result_changes`.
- `app/services/review_settings_service.py` (new) and `app/routers/review_settings.py` (new).
- `app/services/review_service.py` (new): confirm hand-off, queue, summary, detail, decision, last-return lookup.
- `app/routers/reviews.py` (new).
- `app/services/review_notice_service.py` (new) and `app/review_mail.py` (new).
- Modified:
  - `result_service.py`, `mapping_service.py`, `job_service.py`, `export_service.py`, `upload_service.py`;
  - `routers/results.py`, `routers/ocr_jobs.py`, `schemas/job.py`;
  - `cli.py`, `main.py` (router registration).

**Mini app `apps/line-mini/src`**
- `features/reviews/` (new): `api.ts`, `ReviewEntry.tsx`, `ReviewQueuePage.tsx`, `ReviewDetailPage.tsx`, `ReviewSettingsPage.tsx`, `ReviewRecords.tsx`, `reviews.test.tsx`, plus `*.module.css` in the scan theme.
- `features/scan/components/ChangeLog.tsx` (new), with `changeLabel.ts`.
- Modified: `ScanHomePage.tsx`, `ResultPage.tsx`, `FinalResultPage.tsx`, `HistoryPage.tsx`, `StatusChip.tsx`, `confirm.ts`, `features/orgs/OrgPage.tsx`, `features/notifications/{render.ts,NotificationsPage.tsx}`, `App.tsx`, and i18n.

**web-pc `apps/web-pc/src`**
- `reviews/` (new): `api.ts`, `OriginalPages.tsx`, `ReadonlyResult.tsx`, `ChangeLogTable.tsx`, `ReviewRecordList.tsx`.
- `pages/` (new): `ReviewsPage.tsx`, `ReviewDetailPage.tsx`, `ReviewSettingsPage.tsx`, `reviews.test.tsx`.
- Modified: `layout/AppLayout.tsx` (menu), `notifications/render.ts`, `pages/NotificationsPage.tsx`, `App.tsx`, and i18n.

**Docs:** `docs/10-product/PRD-SaiFlow.md`, `Glossary.md`, EPIC-03, EPIC-04, `docs/30-design/Data-Model.md`, `API-Spec.md`, `docs/20-requirements/Requirements-Index.md`, the regenerated `openapi.json` and `packages/api-client`.

**Test command** (backend), referred to below as `PYTEST`:
`cd services/api && REQUIRE_INTEGRATION=1 TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55432 TEST_DB_NAME=saiflow_test TEST_DB_USER=saiflow_test TEST_DB_PASSWORD=local-throwaway-db .venv/Scripts/pytest.exe`

---

### Task 1: Schema, states and migration 0013

**Files:**
- Create: `services/api/alembic/versions/0013_review_flow.py`, `services/api/app/models/review.py`
- Modify:
  - `app/ocr/states.py`;
  - `app/models/document.py` (`OcrJob.official_at`);
  - `app/models/organization.py` (`Organization.review_email_enabled`, Boolean, server default false);
  - `app/models/notification.py` (KINDS gains `review_pending` for `Notification.type` only; the Reminder kind and stage checks stay as they are);
  - `app/models/__init__.py`.
- Test: `services/api/tests/integration/test_review_schema.py`

**Interfaces:**
- Produces:
  - `states.REVIEW_STATUSES = ("UNREVIEWED", "EDITED", "PENDING_L1", "PENDING_L2", "CONFIRMED")`
  - `states.PENDING_REVIEW = ("PENDING_L1", "PENDING_L2")`
  - `states.LOCKED = ("PENDING_L1", "PENDING_L2", "CONFIRMED")`
  - `states.STAGES = (..., "VERIFYING", "PENDING_REVIEW", "CONFIRMED")`
  - **Models:**
    - `ReviewLevel(tenant_id, template_id: int|None, level: int, updated_by_user_id, updated_at)`. Unique per (tenant_id, template_id), with two partial unique indexes: template_id null / not null. Check level in 0..2.
    - `ReviewRound(id identity, job_id, round_no, required_level, current_level, status, confirmed_by_user_id, confirmed_version_id, l1_reviewer_user_id, level_entered_at, created_at, closed_at)`. Status is `OPEN|APPROVED|RETURNED`. Unique (job_id, round_no); partial unique "one OPEN per job".
    - `ReviewRecord(id identity, round_id FK, job_id, level, reviewer_user_id, decision, comment, created_at)`. Decision is `APPROVE|RETURN`.
    - `ResultChange(id identity, job_id, version_id, kind, items JSONB, from_template, to_template, user_id, created_at)`. Kind is `SAVE|TEMPLATE`; for SAVE, `items` is `[{"path", "before", "after"}, ...]` sorted by path; for TEMPLATE, `items` is `[]`. Index (job_id, id).
    - `ReviewNotice(id identity, job_id, round_no, level, recipient_user_id, notification_id FK, email_status, email_error, created_at, email_at)`. Email status is `pending|sending|sent|failed|skipped`. Partial index on email_status='pending'.

- [ ] **Step 1: Write the failing test** `test_review_schema.py`:
  - `test_migration_backfills_official_at`: insert a CONFIRMED job at revision 0012, upgrade, and assert `official_at == confirmed_at`.
  - `test_review_status_check_accepts_pending`: an update to `PENDING_L2` succeeds; `PENDING_L3` raises IntegrityError.
  - `test_one_open_round_per_job`: a second OPEN round for the same job raises IntegrityError.
  - `test_level_range`: level 3 raises IntegrityError.
  - `test_notification_type_review_pending`: inserting a notification of type `review_pending` succeeds.
  - Follow the revision-switching pattern of `test_migrations.py`.
- [ ] **Step 2: Run** `PYTEST tests/integration/test_review_schema.py -q`. Expected: FAIL (no revision 0013).
- [ ] **Step 3: Implement** the models and migration 0013 (down_revision `"0012"`).
  - Replace the `ocr_jobs_review_status` and `notifications_type` checks.
  - Backfill: `update ocr_jobs set official_at = confirmed_at where review_status = 'CONFIRMED'`.
  - Grants follow migration 0012's tables. Tables without tenant_id are not tenant-scoped, so guest claim moves nothing.
  - Migrate the test DB: `DB_*` env plus `.venv/Scripts/alembic.exe upgrade head`.
- [ ] **Step 4: Run** the new test file, then `PYTEST tests/integration/test_migrations.py tests/integration/test_ocr_schema.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `[review-flow] schema: review levels, rounds, records, change log, notices`.

### Task 2: Review settings (FR-VERIFY-010)

**Files:**
- Create: `app/services/review_settings_service.py`, `app/routers/review_settings.py`
- Modify: `app/main.py` (include router)
- Test: `tests/integration/test_review_settings.py`

**Interfaces:**
- Consumes: Task 1 models; `mapping_service.available_versions(db, tenant_id)` for the published templates.
- Produces:
  - `async level_for(db, tenant_id: int, kind: str, template_id: int | None) -> int`: 0 for non-organization kinds and for unset levels.
  - `GET /api/v1/review-settings` (operation `getReviewSettings`) → `ReviewSettingsOut{email_enabled: bool, items: [ReviewLevelItem{template_id: int|null, name: str|null, level: int}]}`. Items are the published templates sorted by name, then one item with `template_id: null` for 通用结果.
  - `PUT /api/v1/review-settings/levels` (operation `setReviewLevel`), body `{template_id: int|null, level: int}` → `ReviewLevelItem`.
  - `PUT /api/v1/review-settings/email` (operation `setReviewEmail`), body `{enabled: bool}` → `ReviewSettingsOut`.
  - All three act on `X-Tenant-Id`. They require `ctx.kind == "organization" and ctx.is_owner`, else 403 `permission_denied`. A template_id that is not a published template → 404. A level that is not an int in 0..2, or is a bool → 422 `validation_error`.
  - Audit (no detail column, so details go into target_id):
    - `AuditEvent("user", uid, "review.level_set", "organization", f"{tenant}/{template_id or 'generic'}/{before}->{after}", "success")`;
    - `"review.email_set"` with `f"{tenant}/{before}->{after}"`.
  - Writing the same value again is a no-op without audit.

- [ ] **Step 1: Write failing tests:**
  - `test_owner_sets_level_and_lists` (AC-010-01 setup): the owner sets tax_invoice to 2; GET shows 2, generic shows 0, `email_enabled` is false.
  - `test_non_owner_403` (AC-010-02): a member with review_l1 gets 403 on PUT and GET; the level is unchanged.
  - `test_level_out_of_range_422`: levels 3, -1, `true` and `"1"` each give 422.
  - `test_personal_tenant_403`.
  - `test_unknown_template_404`.
  - `test_audit_written_once`: setting 2 twice writes one `review.level_set` row with target ending `/0->2`.
  - `test_level_for_defaults`: `level_for` is 0 for personal, guest and unset.
- [ ] **Step 2: Run** `PYTEST tests/integration/test_review_settings.py -q`. Expected: FAIL (404 route).
- [ ] **Step 3: Implement** the service and router. Lock the organization row (`select … for update` on organizations) while writing, so concurrent writes serialize.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `[review-flow] review settings API (FR-VERIFY-010)`.

### Task 3: Change log (FR-VERIFY-007)

**Files:**
- Create: `app/services/change_log.py`
- Modify:
  - `app/services/result_service.py` (`save`);
  - `app/services/mapping_service.py` (`switch_to` gains `actor_user_id: int | None = None`; `apply_template` and `use_generic` pass the user; `finalize_ready` passes `mapping.created_by_user_id` only when `mapping.source == MANUAL`);
  - `app/routers/templates.py` (pass the user id into `use_generic`);
  - `app/routers/results.py` (new GET).
- Test: `tests/unit/test_change_log.py`, `tests/integration/test_change_log_api.py`

**Interfaces:**
- Produces:
  - `leaves(value) -> dict[str, Any]`:
    - flattens JSON: dict keys join with `.`, list items with `[i]`;
    - a scalar is a leaf, and so is an empty dict or empty list (its value is `{}` or `[]`);
    - the top level must be a dict.
  - `diff(before: dict | None, after: dict | None) -> list[tuple[str, Any, Any]]`: over the union of both leaf maps, sorted by path, every path whose values differ. A missing side is `None`.
  - `async record_save(db, job_id: str, version_id: str, before: dict|None, after: dict|None, user_id: int|None) -> None`: one `ResultChange(kind="SAVE", items=diff as list of {path, before, after})`; nothing when the diff is empty.
  - `async record_switch(db, job_id, version_id, from_name: str|None, to_name: str|None, user_id) -> None`: one `ResultChange(kind="TEMPLATE", items=[])`. `None` names mean 通用结果.
  - `async list_changes(db, job_id) -> list[dict]`: rows ordered by id, each SAVE row flattened into one entry per item (kind `FIELD`), each TEMPLATE row one entry (kind `TEMPLATE`).
  - `GET /api/v1/ocr/jobs/{job_id}/changes` (operation `listOcrResultChanges`) → `list[ChangeOut{kind, path: str|null, before: Any, after: Any, from_template: str|null, to_template: str|null, user_name: str|null, created_at, version: int}]`. Access is `job_access(..., review=True)` from Task 4; until Task 4 lands, use plain `job_access`. `user_name` is `users.display_name`.
- `switch_to` records a TEMPLATE change only when `actor_user_id` is given and the old and new versions' template names differ. AUTO mappings never record.

- [ ] **Step 1: Write failing unit tests:**
  - `test_diff_scalar_change`: `{"g":{"total":"12000.00"}}` → `{"g":{"total":"12500.00"}}` gives `[("g.total","12000.00","12500.00")]` (AC-007-01).
  - `test_diff_row_delete_and_edit`: two rows with `qty` and `name`; row 2 deleted and row 1's qty changed gives `[("g.items[0].qty","1","2"),("g.items[1].name","B",None),("g.items[1].qty","3",None)]` (AC-007-02).
  - `test_diff_none_before` (initial creation) → every leaf with `None` before.
  - `test_diff_equal` → `[]`.
  - `test_empty_containers_are_leaves`.
- [ ] **Step 2: Write the failing integration test** `test_change_log_api.py`:
  - `test_save_records_field_change`: save with a changed total → one `result_changes` row whose `items` has one entry; GET changes returns one FIELD entry with before, after, user_name and version.
  - `test_unchanged_save_records_nothing`.
  - `test_switch_to_generic_records_template` (AC-007-03): use generic → one TEMPLATE entry `Tax Invoice → None`, no FIELD entries.
  - `test_auto_mapping_records_nothing`: after `tax_job`, the changes list is `[]`.
  - `test_changes_404_for_invisible_job`.
- [ ] **Step 3: Run** `PYTEST tests/unit/test_change_log.py tests/integration/test_change_log_api.py -q`. Expected: FAIL.
- [ ] **Step 4: Implement.** In `save`, after the new version is added, call `record_save(db, job.id, target.id, current.structured, content, ctx.user_id)`.
- [ ] **Step 5: Run** the same tests plus `tests/integration/test_results.py tests/integration/test_template_mapping.py`. Expected: PASS.
- [ ] **Step 6: Commit** `[review-flow] field change log (FR-VERIFY-007)`.

### Task 4: Confirm hand-off, lock, stages, export gate, reviewer read access

**Files:**
- Create: `app/services/review_service.py` (this task adds `on_confirm`, `review_state`, `last_return`; Task 5 adds the rest)
- Modify:
  - `result_service.py`: `save` uses `states.LOCKED`; the confirm branch calls `on_confirm`; `payload` gains `review`;
  - `mapping_service.py`: `finalize_ready` and `_check_open` use `states.LOCKED`;
  - `job_service.py`:
    - `stage`, `_stage_condition`, `delete_results` (also deletes `result_changes`, `review_records` and `review_rounds` for the job, and sets `official_at=None`);
    - `job_access(..., review: bool = False)`;
    - `JobOut.review_level`;
  - `export_service.py`: requires `CONFIRMED` (already the case; keep the 409 for PENDING_*);
  - `upload_service.file_access`: also allows the file of a job the caller may review;
  - `schemas/job.py`: `Stage` adds `PENDING_REVIEW`, and `review_level: int | None`;
  - `routers/results.py`: `ResultOut.review`;
  - `routers/ocr_jobs.py` and `routers/templates.py`: read endpoints pass `review=True`.
- Test: `tests/integration/test_review_confirm.py`

**Interfaces:**
- Consumes: `review_settings_service.level_for` (Task 2), `change_log` (Task 3).
- Produces:
  - `review_service.reviewable(ctx) -> ColumnElement`: `tenant == ctx.tenant_id and ctx.kind == 'organization' and ((review_status=='PENDING_L1' and has(review_l1)) or (review_status=='PENDING_L2' and has(review_l2)))`. It is `false()` when the caller has neither permission.
  - `job_access(db, ctx, job_id, *, for_update=False, review=False)`: with `review=True` the condition is `_visible(ctx) OR reviewable(ctx)`.
    - Used by: GET job, GET result, GET changes, GET template options, the file endpoints (through `file_access`), and the review decision (Task 5).
    - Not used by: list jobs, save, cancel, rerun, delete.
  - `async review_service.on_confirm(db, ctx, job, version) -> None`:
    - reads `level_for(db, ctx.tenant_id, ctx.kind, template_id of version's mapping or None)`;
    - level 0 → `review_status="CONFIRMED"`, `official_at=now`;
    - otherwise → `PENDING_L1` plus a new `ReviewRound(round_no = max+1, required_level=level, current_level=1, status OPEN, confirmed_by_user_id, confirmed_version_id, level_entered_at=now)`;
    - returns `None`. Task 6 hooks its notification call here.
  - `async review_service.review_state(db, job) -> dict`, where `stage` is one of `NONE|PENDING_L1|PENDING_L2|CONFIRMED`:
    ```
    {stage, required_level: int|None,
     records: [{round_no, level, decision, comment, reviewer_name, created_at}],
     last_return: same shape | None}
    ```
    - `records` cover all rounds, oldest first.
    - `last_return` is the RETURN record of the latest round, only when that round is RETURNED and the job is not locked.
  - `ResultOut.review: ReviewStateOut`; `ResultOut.confirmed` stays and means `review_status in LOCKED`.
  - `stage(job)` gives `PENDING_REVIEW` for PENDING_L1 and PENDING_L2, `CONFIRMED` for CONFIRMED, and `VERIFYING` or `TEMPLATE_MATCHING` otherwise. `JobOut.review_level` is 1 or 2 while pending, else null.

- [ ] **Step 1: Write failing tests** `test_review_confirm.py`. Org setup is a helper `review_org(api, line, mail, db)`, reused by Tasks 5 and 6:
  - an org with a starter subscription;
  - the owner U, clerk M (`upload_ocr`, `verify_own`, `export`), R1 (`review_l1`) and R2 (`review_l2`), all registered;
  - it returns their clients and ids.

  Tests:
  - `test_level0_confirm_is_official` (AC-010-01, AC-009-04): stage `CONFIRMED`, `official_at` set, export allowed (201).
  - `test_level1_confirm_pending` (AC-011-01, AC-009-06): stage `PENDING_REVIEW`, `review_level` 1, one OPEN round with `required_level` 1 and confirmer M; `result.review.stage == "PENDING_L1"`.
  - `test_personal_confirm_official` (AC-011-02).
  - `test_pending_locked_409` (AC-006-02): save, confirm and apply-template each return 409.
  - `test_pending_export_409` (AC-ENTRY-015-05).
  - `test_history_filter_pending` (AC-017-03): `stage=PENDING_REVIEW` returns only the pending job, with `review_level` 2.
  - `test_late_conversion_does_not_replace_pending` (Review Focus 1): start a manual conversion, confirm (L1), run `mapping_pass`; the current version is unchanged and the job is still PENDING_L1.
  - `test_reviewer_reads_pending_job_and_file` (Review Focus 2): R1 (no data_browse) can GET the job, the result, the changes and `/files/{id}/pages/1`, all 200. R1's job list does not include it. R2 gets 404 on the job (it is at L1).
  - `test_delete_results_while_pending`: M deletes the results; the round and records are gone; R1 gets 404 on the job.
- [ ] **Step 2: Run** `PYTEST tests/integration/test_review_confirm.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file plus `tests/integration/test_results.py tests/integration/test_exports.py tests/integration/test_ocr_jobs.py tests/integration/test_template_mapping.py tests/integration/test_uploads.py`. Expected: PASS. Update existing assertions only where `ResultOut` gained fields.
- [ ] **Step 5: Commit** `[review-flow] confirm into review, lock, stages, export gate (FR-VERIFY-011, 009, 006, 017; FR-ENTRY-015)`.

### Task 5: Queue, detail, decision (FR-VERIFY-019, 012, 013)

**Files:**
- Modify: `app/services/review_service.py`
- Create: `app/routers/reviews.py`
- Modify: `app/main.py`
- Test: `tests/integration/test_reviews.py`

**Interfaces:**
- Produces:
  - **Queue.** `GET /api/v1/reviews?level=1|2&page=1&page_size=20` (operation `listReviews`) → `ReviewPageOut{items: [ReviewItemOut], total, page, page_size}`.
    - `ReviewItemOut`: `job_id, file_id, file_name, page_count, template_name|null, confirmed_by_name, confirmed_at, level, required_level, level_entered_at, block_reason`. `block_reason` is `"own_confirmation" | "did_level1" | null`.
    - A level other than 1 or 2 → 422. Missing permission for that level, or a non-organization tenant → 403. `page_size` ≤ 100.
  - **Summary.** `GET /api/v1/reviews/summary` (operation `getReviewSummary`) → `{l1: int|null, l2: int|null}`.
    - Counts actionable jobs only (`block_reason` null). A level the caller does not hold → null.
    - In a non-organization tenant both are null (200, so the home page can call it unconditionally).
  - **Detail.** `GET /api/v1/reviews/{job_id}` (operation `getReview`) → `ReviewDetailOut{job: JobOut, level, required_level, confirmed_by_name, confirmed_at, block_reason}`. A job not pending at a level the caller holds → 404.
  - **Decision.** `POST /api/v1/reviews/{job_id}/decision` (operation `decideReview`), body `{level: 1|2, decision: "approve"|"return", comment: str|null}` → `ReviewDetailOut`, or 200 with `job.stage` when the job is no longer pending.
  - **`async decide(db, ctx, principal, job_id, level, decision, comment) -> OcrJob`**, order of checks:
    1. validation 422 (`level` not 1 or 2; `decision` unknown; comment longer than 500 → `validation_error`; return with blank comment → 422 `comment_required`);
    2. `job_access(review=True, for_update=True)` (404);
    3. the permission for `level` (403 `permission_denied`);
    4. state matches `PENDING_L{level}` with an OPEN round (else 409 `review_state_changed`);
    5. `reviewer_conflict` (403).
  - **Effects:**
    - approve at L1 with required 1, or at L2 → round APPROVED, `closed_at`; job CONFIRMED with `official_at`;
    - approve at L1 with required 2 → `current_level=2`, `l1_reviewer_user_id`, `level_entered_at=now`; job PENDING_L2;
    - return → round RETURNED, `closed_at`; job `review_status="EDITED"`; `confirmed_at`, `confirmed_by_user_id` and `confirmed_version_id` cleared.
    - Every decision appends a ReviewRecord and audits `review.approve` / `review.return` on the ocr_job.
    - The approve-to-L2 path calls the Task 6 hook.

- [ ] **Step 1: Write failing tests** `test_reviews.py`, using the `review_org` helper:
  - `test_queue_by_level` (AC-019-01): 2 at L1 and 1 at L2; R1 sees 2 including M's; R1 asking for L2 gets 403.
  - `test_detail_and_summary` (AC-019-02, FR-SYS-119 count): owner U confirmed one of three L1 jobs; U's summary `l1` is 2 (the job U confirmed is excluded). Its queue item has `block_reason="own_confirmation"`.
  - `test_level2_gate_then_official` (AC-012-01, 02): R1 approves (job PENDING_L2, export 409); R2 approves (CONFIRMED, `official_at` set, export 201).
  - `test_confirmer_cannot_review` (AC-012-03): U confirms, U approves → 403 `reviewer_conflict`.
  - `test_l1_reviewer_not_l2` (AC-012-04).
  - `test_concurrent_decisions` (AC-012-05): two `asyncio.gather` approvals at L1 → one 200 and one 409; exactly one record.
  - `test_record_fields` (AC-013-01).
  - `test_return_back_to_verify` (AC-013-02): the L2 reviewer returns with "税额不对"; the job is VERIFYING; `result.review.last_return.comment == "税额不对"`; M saves and confirms → PENDING_L1 with `round_no` 2; `last_return` is null.
  - `test_return_needs_comment` (AC-013-03): `"   "` → 422; no record.
  - `test_comment_too_long_422`.
  - `test_permission_removed_before_decision` (Review Focus 3).
  - `test_reconfirm_rereads_level` (Review Focus 4).
  - `test_settings_change_does_not_affect_pending` (AC-010-03).
- [ ] **Step 2: Run** `PYTEST tests/integration/test_reviews.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The queue joins `ocr_jobs` (tenant, status), the OPEN `review_rounds`, `files` for the name, and users for the confirmer's name. The template name comes from the confirmed version's mapping, as `job_service._template_names` does.
- [ ] **Step 4: Run** the file plus Task 4's file. Expected: PASS.
- [ ] **Step 5: Commit** `[review-flow] review queue, detail and decisions (FR-VERIFY-019, 012, 013)`.

### Task 6: Review notifications (FR-SYS-126)

**Files:**
- Create: `app/services/review_notice_service.py`, `app/review_mail.py`
- Modify: `review_service.py` (call `notify` after entering L1 in `on_confirm`, and after approve-to-L2), `app/cli.py` (`_reminders_pass` also runs the review mail pass, even when reminders are disabled)
- Test: `tests/integration/test_review_notices.py`

**Interfaces:**
- Produces:
  - `async notify(db, job: OcrJob, round: ReviewRound, level: int) -> int`.
    - **Recipients:** active memberships of `job.tenant_id` where `is_owner` or the role's permissions contain `review_l{level}`, minus `round.confirmed_by_user_id`, and at level 2 minus `round.l1_reviewer_user_id`.
    - **Per recipient:**
      - one `Notification(type="review_pending", tenant_id, data={"stage": f"l{level}", "job_id", "file_name", "template_name", "level", "confirmer_name", "round_no"})`;
      - one `ReviewNotice`, with email_status `pending` when the org's `review_email_enabled` is on, the user is registered and the user has an email; else `skipped`.
    - Returns the count. It runs in the caller's transaction.
  - `async send_pending(sessionmaker, sender, now) -> int`:
    - claims rows with `update … set email_status='sending' where email_status='pending' returning id`;
    - sends each once (sender None → `failed` with `not_configured`);
    - records `sent` or `failed` with `email_at`;
    - returns how many it attempted.
  - `review_mail.render(data: dict, org_name: str) -> tuple[str, str]`, in English like `reminder_mail`. Subject: `SaiFlow: a document is waiting for your review`. The body names the org, file, template, level and confirmer.
  - The `_reminders_pass` output line gains `review mails N`.

- [ ] **Step 1: Write failing tests:**
  - `test_confirm_notifies_l1` (AC-126-01): R1b (`review_l1`) and owner U each get one in-app notification with `level` 1; the confirmer (also `review_l1`) gets none.
  - `test_l1_approval_notifies_l2` (AC-126-02): excludes the confirmer and the L1 reviewer.
  - `test_email_off_by_default` (AC-126-03): notices are `skipped`; the fake mail outbox is empty after `send_pending`.
  - `test_email_on_failure_not_retried` (AC-126-04): with a failing sender → `failed`; a second `send_pending` sends nothing.
  - `test_email_on_sends_once`.
  - `test_no_recipient_still_pending` (Review Focus 5): the org has only owner U, who confirms → no notification; the job is PENDING_L1.
  - `test_return_and_reconfirm_notifies_again`.
  - `test_notifications_api_lists_review_pending`: GET /api/v1/notifications returns the item with its data.
- [ ] **Step 2: Run** `PYTEST tests/integration/test_review_notices.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse `tests/integration/fake_email.py` for the sender.
- [ ] **Step 4: Run** the file plus `test_reviews.py test_review_confirm.py test_notification_center.py test_reminder_cli.py`. Expected: PASS.
- [ ] **Step 5: Run the full backend suite** `PYTEST -q`. Run `ruff check app tests`, then `ruff format --check app tests`. Expected: all pass.
- [ ] **Step 6:** Regenerate `docs/30-design/openapi.json` and `packages/api-client/src/generated/schema.ts` with the regeneration command used in ocr-ui-parity.
- [ ] **Step 7: Commit** `[review-flow] review notifications (FR-SYS-126), API client`.

### Task 7: Mini app — review entry, queue, detail, settings (FR-SYS-119, 120, 121)

**Files:**
- Create:
  - `features/reviews/api.ts`;
  - `features/reviews/ReviewEntry.tsx`;
  - `features/reviews/ReviewQueuePage.tsx`;
  - `features/reviews/ReviewDetailPage.tsx`;
  - `features/reviews/ReviewSettingsPage.tsx`;
  - `features/reviews/ReviewRecords.tsx`;
  - `features/reviews/reviews.module.css`;
  - `features/reviews/reviews.test.tsx`.
- Modify: `features/scan/ScanHomePage.tsx` (render `<ReviewEntry />` under the quota banner), `features/orgs/OrgPage.tsx` (owner-only "复核设置" link), `App.tsx` (routes), i18n en/th/zh.

**Interfaces:**
- Consumes: the Task 2, 5 and 6 endpoints through `@saiflow/api-client`. Existing `OriginalPreview`, `StructuredDataView` (`editable={false}`), `PageHeader`, `useJob`, `useResult`, `useCurrentTenant`, `can`.
- Produces:
  - `useReviewSummary()`;
  - `useReviewQueue(level: 1|2)` (infinite, `page_size` 20);
  - `useReviewDetail(jobId)`;
  - `decide(jobId, level, decision, comment)`;
  - `useReviewSettings()`, `setLevel(templateId: number|null, level: 0|1|2)`, `setEmail(enabled)`;
  - `<ReviewRecords records={…} />`, reused in Task 8;
  - routes `/reviews`, `/reviews/:id`, `/org/review-settings`.
- **Behaviour:**
  - The entry shows only when the tenant is an org and `can(tenant,'review_l1') || can(tenant,'review_l2')`. It shows `l1 + l2` (nulls as 0) and refetches on mount and after a decision.
  - The queue has tabs per held level. Blocked items show the reason text and open the detail read-only.
  - The detail shows the original, the read-only result, `ReviewRecords`, the "修改记录" button (Task 8 component; placeholder until then) and the bottom bar.
  - "通过" opens a dialog with an optional comment. "退回" opens a dialog whose submit is disabled while the comment is blank. Each asks to confirm first.
  - After success: toast, invalidate summary and queue, navigate to `/reviews`.
  - On 409, or a 404 from the detail: show "该单据已被他人处理" and go back to `/reviews`.
  - Settings: one row per item with a 3-option selector. A change saves immediately; success toasts "已保存"; failure reverts the value and shows the error. Below it, "通知方式": in-app always on (disabled switch) and the email switch.
  - Styling uses `theme.module.css` tokens like the scan pages.

- [ ] **Step 1: Write failing tests** in `reviews.test.tsx`, using the mockApi pattern of `features/scan/result.test.tsx`:
  - `entry shows actionable count` (AC-119-01): summary `{l1:2,l2:null}` → "待复核" with 2.
  - `entry hidden without permission` (AC-119-02).
  - `approve returns to queue` (AC-120-01): POST body `{level:1, decision:"approve", comment:null}`.
  - `return requires comment` (AC-120-02): submit is disabled while blank; it posts "日期看不清".
  - `own confirmation is read-only` (AC-120-03): reason "本人确认" and no buttons.
  - `409 shows handled by others`.
  - `owner sets level` (AC-121-01): a PUT with `{template_id: X, level: 2}` → "已保存".
  - `non-owner has no settings link` (AC-121-02).
- [ ] **Step 2: Run** `pnpm --dir apps/line-mini test -- reviews`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --dir apps/line-mini test`, then `pnpm --dir apps/line-mini lint`, then `pnpm --dir apps/line-mini build`. Expected: all pass.
- [ ] **Step 5: Commit** `[review-flow] mini app: review entry, queue, detail, settings`.

### Task 8: Mini app — change log, existing pages, notifications (FR-SYS-122, 105–108, 054)

**Files:**
- Create: `features/scan/components/ChangeLog.tsx`, `features/scan/changeLabel.ts`
- Modify:
  - `features/scan/ResultPage.tsx` (return banner; "修改记录");
  - `features/scan/confirm.ts` (after a confirm that yields `review.stage` PENDING_L1, toast "已提交复核");
  - `FinalResultPage.tsx` (review status chip and text; `ReviewRecords`; "修改记录"; export button only when `job.stage === "CONFIRMED"`);
  - `HistoryPage.tsx` (filter "待复核" = `PENDING_REVIEW`; `jobTarget` sends PENDING_REVIEW to `/final`);
  - `components/StatusChip.tsx` (PENDING_REVIEW with level text);
  - `ReviewDetailPage.tsx` (wire `ChangeLog`);
  - `features/notifications/render.ts` and `NotificationsPage.tsx`;
  - i18n.
- Test: extend `features/scan/{result,final,history}.test.tsx`, `features/notifications/notifications.test.tsx`; add `features/scan/changelog.test.tsx`.

**Interfaces:**
- Produces:
  - `changeLabel(path: string, groups: Group[] | null, t) -> string`:
    - `"g.f"` → the field's display name in the current language (fallback: the template default name, then the raw key);
    - `"g.items[1].qty"` → `"<table name> · 第 2 行 · <column name>"` (an i18n template with row number n+1);
    - unknown paths → the raw path.
  - `<ChangeLog jobId groups />`: a sheet listing "修改前 → 修改后", user and time. TEMPLATE entries show "更换模板：A → B" (null → "通用结果"). An empty list shows "没有修改记录".
- **Notification click** (`review_pending`): mark read; if the current tenant differs, switch to `n.tenant_id` with the existing tenant switch action; navigate to `/reviews/{data.job_id}`. The detail page's 404 handling covers "已被他人处理".

- [ ] **Step 1: Write failing tests:**
  - `changelog.test.tsx`: `label for header field and row` (row index 1 → "第 2 行"); `template entry`; `empty`.
  - `result.test.tsx`: `shows last return banner` (AC-105-04: level, reviewer, comment).
  - `confirm` test: `submitted for review toast` (AC-106-03).
  - `final.test.tsx`:
    - `pending hides export and shows records` (AC-107-03);
    - `confirmed shows export` (existing behaviour kept).
  - `history.test.tsx`: `pending filter and opens final` (AC-108-03).
  - `notifications.test.tsx`: `review notification renders and navigates` (AC-054-05: the tenant switches to O, then the route goes to `/reviews/J`).
- [ ] **Step 2: Run** `pnpm --dir apps/line-mini test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --dir apps/line-mini test && pnpm --dir apps/line-mini lint && pnpm --dir apps/line-mini build`. Expected: pass.
- [ ] **Step 5: Commit** `[review-flow] mini app: change log, review state on result/final/history, review notifications`.

### Task 9: web-pc — menu, queue, detail, settings, notifications (FR-SYS-094, 103, 123–125)

**Files:**
- Create:
  - `reviews/api.ts`;
  - `reviews/OriginalPages.tsx` (page images via `/api/v1/files/{id}/pages/{n}`, with the blob-URL logic ported from the mini app's `usePageUrl`, prev/next and antd `Image` preview for zoom);
  - `reviews/ReadonlyResult.tsx` (template groups as antd `Descriptions` and tables as antd `Table`; generic results show their saved groups and tables; field names in the current language);
  - `reviews/ChangeLogTable.tsx` (port `changeLabel` from the mini app, copied, not shared, as web-pc-account did);
  - `reviews/ReviewRecordList.tsx`;
  - `pages/ReviewsPage.tsx`, `pages/ReviewDetailPage.tsx`, `pages/ReviewSettingsPage.tsx`;
  - `pages/reviews.test.tsx`.
- Modify:
  - `layout/AppLayout.tsx`: MENU order is home, org, roles, reviews (`/reviews`), reviewSettings (`/review-settings`), plans, notifications, profile, data. Hidden rules per FR-SYS-094.
  - `App.tsx` routes; `notifications/render.ts`; `pages/NotificationsPage.tsx` (click as in Task 8, navigating to `/reviews/{job_id}`); i18n en/th/zh.

**Interfaces:**
- Consumes: the same endpoints as Task 7.
- **Behaviour:**
  - The queue uses antd `Tabs` per held level and a `Table` with `pagination.pageSize` 20 (server pages).
  - The detail is a two-column layout: originals on the left, the read-only result on the right; records and change log below.
  - Approve and return use `Modal` with a `TextArea`; the return OK button is disabled while blank.
  - On 409 or a 404 detail: `message.warning("该单据已被他人处理")` and navigate to `/reviews`.
  - Settings: a `Table` with a `Select` per row and immediate save; "通知方式" below it.

- [ ] **Step 1: Write failing tests** `pages/reviews.test.tsx`:
  - `menu shows reviews not settings for reviewer` (AC-094-04);
  - `personal tenant hides review menus` (AC-094-02);
  - `queue paginates 20` (AC-123-01: total 25 → page 2 shows 5);
  - `return from detail` (AC-124-01);
  - `already handled` (AC-124-02);
  - `owner sets generic level` (AC-125-01);
  - `review notification opens detail or warns` (AC-103-03).
- [ ] **Step 2: Run** `pnpm --dir apps/web-pc test -- reviews`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --dir apps/web-pc test && pnpm --dir apps/web-pc lint && pnpm --dir apps/web-pc build`. Expected: pass.
- [ ] **Step 5: Commit** `[review-flow] web-pc: review menu, queue, detail, settings, notifications`.

### Task 10: Docs sync

**Files:**
- Modify:
  - `docs/10-product/PRD-SaiFlow.md`: version bump; record OQ-6 resolved (per-template, set by the owner, default 0); state that export starts at official business data; add the review notification decision (in-app always; email optional per org; LINE and SMS later);
  - `docs/10-product/Glossary.md`: 待复核, 复核轮次, 修改记录;
  - `docs/20-requirements/functional/EPIC-03-data-verification.md`: FR-VERIFY-007, 010–013 and the new 019 marked migrated to `openspec/specs/reviews` and `results` (deprecated, `review-flow`);
  - `EPIC-04`: the FR-ENTRY-015 note on export after review;
  - `docs/20-requirements/Requirements-Index.md`;
  - `docs/30-design/Data-Model.md`: DM-ReviewPolicy → `review_levels`, DM-ReviewRecord → `review_rounds` and `review_records`, DM-ChangeLog → `result_changes` (jsonb items), plus `review_notices` and the B-4 implemented note;
  - `docs/30-design/API-Spec.md`: the new endpoints.
- Bump each doc's version and changelog line, as the previous changes did.

- [ ] **Step 1:** Edit the docs.
- [ ] **Step 2:** Run `grep -rn "FR-VERIFY-01[0-3]\|FR-VERIFY-007" docs/20-requirements | head`. Expected: every hit carries the migrated marker.
- [ ] **Step 3: Commit** `[review-flow] doc sync`.
