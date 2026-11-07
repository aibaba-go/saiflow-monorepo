# minor-fixes-ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the deferred user-visible minors (group A) across the backend, line-mini, web-admin and web-pc. One spec change: FR-VERIFY-007 change-log readability.

**Architecture:**
- Each fix is local to the file that owns the behaviour; there are no new modules.
- The one behaviour change, the change-log diff, replaces the positional row diff in `app/services/change_log.py` with a row alignment (LCS on whole rows). It also drops empty-container leaves that did not exist before.

**Tech Stack:** FastAPI/pytest; React, antd and antd-mobile, Vitest.

**Spec:** `openspec/changes/minor-fixes-ui/proposal.md`, `openspec/changes/minor-fixes-ui/specs/results/spec.md`.

## Global Constraints

- **S-level items** must not change any SHALL/AC behaviour; existing tests stay green unchanged unless they asserted the bug.
- **New copy** goes into en, th and zh (each app's i18n files). Admin uses zh (default) and en.
- **Test-first:** every fix starts with a test that fails on the current code; ledger it if a test must be written after.
- **Commands:**
  - `PYTEST` = `cd services/api && REQUIRE_INTEGRATION=1 TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55432 TEST_DB_NAME=saiflow_test TEST_DB_USER=saiflow_test TEST_DB_PASSWORD=local-throwaway-db .venv/Scripts/pytest.exe`;
  - front: `pnpm --dir apps/<app> test`, `lint`, `build`;
  - all front ends: `pnpm -r build`.

## Review Focus

1. Change log: a row edited and another row deleted in the same save must log both correctly. The alignment must not pair the edited row with a different row (Task 1 test `test_edit_and_delete_rows`).
2. Change log: an empty table the user deliberately emptied (rows existed, now none) must still log the deleted rows (Task 1 test `test_emptied_table_logs_rows`).
3. "Generic" filter must still match finished generic results, including returned and confirmed ones (Task 1 test `test_generic_filter_keeps_finished`).
4. The one-request-only guard on confirm dialogs must re-enable after a failed request, so the user can try again (Task 2 test `failed action can be retried`).
5. web-pc upload queue: files dropped while uploading start after the running batch, and the 10-file limit counts the whole drop (Task 5 test `drop while busy appends; over 10 rejected`).

---

### Task 1: Backend (FR-VERIFY-007 change log; generic filter; retry target)

**Files:**
- Modify: `services/api/app/services/change_log.py`, `services/api/app/services/job_service.py` (`_template_condition`), `services/api/app/services/result_service.py` (`_mapping_state` adds `template_version_id`), `services/api/app/routers/results.py` (`MappingStateOut.template_version_id: int | None = None`)
- Test: `services/api/tests/unit/test_change_log.py`, `services/api/tests/integration/test_job_filters.py`, `services/api/tests/integration/test_results.py`

**Interfaces:**
- `diff(before, after)` keeps its signature. New rules:
  - Lists of dicts (tables) are aligned row by row with an LCS on row equality. Matched rows are diffed field by field, with paths using the after-index for kept or inserted rows and the before-index for deleted rows.
  - Inserted rows produce `(path[i].col, None, value)`; deleted rows produce `(path[i].col, value, None)`.
  - A table key that is absent before and an empty container after produces nothing.
  - Paths sort with numeric indices: the sort key splits on `[n]` and compares the numbers as ints.
- `ResultOut.mapping.template_version_id`: the target version of the mapping shown (pending or last failed), so the UI can retry an automatic failure.
- **Generic filter:** `current_mapping_id is null` AND the job is in `SUCCESS` AND it has a current result version.

- [ ] **Step 1: Write failing tests:**
  - unit `test_delete_middle_row_logs_only_that_row` (AC-007-04): 10 rows, delete row 0 → only `items[0].*` entries, with after None.
  - unit `test_filled_empty_table_not_logged` (AC-007-05): before has no `goods`, after has `goods: {line_items: []}` → [].
  - unit `test_numeric_row_order` (AC-007-06): rows 2 and 10 change; 2 sorts first.
  - unit `test_edit_and_delete_rows` (Review Focus 1): rows A, B, C; delete B and edit C's qty → B deleted at `[1]`, C's qty at after-index `[1]`.
  - unit `test_emptied_table_logs_rows` (Review Focus 2).
  - The existing `test_diff_row_delete_and_edit` must still pass. If the LCS gives a different but correct result, update it with a ruling.
  - integration `test_generic_filter_excludes_unfinished` (a recognising job not returned by `template=generic`).
  - integration `test_generic_filter_keeps_finished` (Review Focus 3).
  - integration `test_mapping_state_has_target` (a failed AUTO mapping: `result.mapping.template_version_id` equals the matched version).
- [ ] **Step 2: Run** `PYTEST tests/unit/test_change_log.py tests/integration/test_job_filters.py tests/integration/test_results.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Regenerate `openapi.json` and the client.
- [ ] **Step 4: Run** the same tests plus `tests/integration/test_change_log_api.py tests/integration/test_template_mapping.py`. Expected: PASS.
- [ ] **Step 5: Commit** `[minor-fixes-ui] change log alignment (FR-VERIFY-007), generic filter, mapping retry target`.

### Task 2: line-mini

**Files (found by `grep`):**
- `features/orgs/OrgPage.tsx`, `features/orgs/RolesPage.tsx`, the invite join button (`features/invite/InvitePage.tsx`);
- `features/auth/session.ts` (guest page and expiry messages), `features/profile/ProfilePage.tsx`, `features/orgs/ApplyOrgPage.tsx`;
- `features/notifications/{render.ts,NotificationsPage.tsx}`, `features/scan/uploadQueue.ts`, `features/reviews/{ReviewDetailPage.tsx,ReviewQueuePage.tsx,ReviewSettingsPage.tsx}`, i18n.
- Tests: the matching `*.test.tsx`, plus `features/review-fixes-b5.test.tsx` for the cross-cutting ones.

**Fixes and their tests:**
- **One request per confirmed action** (join, revoke, remove member, transfer, leave, delete role): a busy flag set before the request and cleared in `finally`; the action buttons are disabled while busy.
  - Test `double click sends one request` per action family.
  - Test `failed action can be retried` (Review Focus 4).
- **Guest messages:**
  - A guest opening a user-only page sees "Please log in first" (`err.unauthenticated`), not `err.session_expired`.
  - An expired guest session shows the new key `err.guest_expired`.
  - Tests `guest on user page says log in first`, `expired guest says trial ended`.
- **Profile refresh:** a 401 while refreshing after a profile update goes through the normal session-expired path, not a silent guest. The org-apply refresh failure shows `ErrorText`.
  - Tests `profile refresh 401 is session expired`, `apply refresh error shown`.
- **Left-organization notices:** a notification whose `tenant_id` is not in the tenant list renders "Left organization" (`tenant.left`). A review notice for such a tenant does not call `choose()`; it shows `review.handled`.
  - Test `left org notice label and no tenant switch`.
- **Cancel just after complete:** in `uploadQueue.run`, when the item was cancelled after `uploadFile` resolved, call `deletePending(ready.id)`.
  - Test `cancel after complete deletes the file`.
- **Review detail:** when the result query fails, treat 404 like the detail's 404 (back to the queue with "handled"). Other errors show `ErrorText`, not a spinner.
  - Test `result error does not spin`.
- **Review queue:** dedupe rows by `job_id` when flattening pages.
  - Test `no duplicate rows across pages`.
- **Review settings:** a failed save restores only that item (functional update on the item), not the whole snapshot.
  - Test `failed save keeps the other change`.

- [ ] **Step 1: Write all failing tests.** Run `pnpm --dir apps/line-mini test`. Expected: the new tests FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `pnpm --dir apps/line-mini test && pnpm --dir apps/line-mini lint && pnpm --dir apps/line-mini build`. Expected: PASS.
- [ ] **Step 4: Commit** `[minor-fixes-ui] line-mini: one request per action, guest messages, left-org notices, review page fixes`.

### Task 3: web-admin

**Files:** `apps/web-admin/src/pages/AuditLogPage.tsx`, `apps/web-admin/src/pages/OcrSettingsPage.tsx`, `apps/web-admin/src/pages/ApplicationPages.tsx`, i18n; tests in `people.test.tsx`, `applications.test.tsx`, `catalog.test.tsx` (wherever the page is tested).

**Fixes and their tests:**
- **Translated values:** the actor type and result columns show `actor.<type>` and the new `log.result.<success|failure>` labels. OCR "LLM" uses the new key `ocr.llm`.
  - Test `audit log shows translated actor and result`.
- **Until field:** an error on `until` shows under the range field (the merged help). `until` is sent as the end of the selected minute (`:59.999`).
  - Tests `until error under the field`, `until includes the selected minute`.
- **Previous page:** a cursor stack; "Previous" pops it and is disabled on the first page.
  - Test `previous page returns to the first page`.
- **Tab errors:** switching application tabs clears the error shown.
  - Test `tab switch clears the error`.

- [ ] **Step 1: Write the failing tests.** Run `pnpm --dir apps/web-admin test`. Expected: FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `pnpm --dir apps/web-admin test && pnpm --dir apps/web-admin lint && pnpm --dir apps/web-admin build`. Expected: PASS.
- [ ] **Step 4: Commit** `[minor-fixes-ui] web-admin: translated audit values, until minute and error, previous page, tab errors`.

### Task 4: web-pc account and review pages

**Files:** `pages/RolesPage.tsx`, the role permission error copy (`field.permissions`), `orgs/OrgCards.tsx` (the verification status colon), `pages/NotificationsPage.tsx`, `notifications/render.ts`, `pages/ReviewDetailPage.tsx`, `pages/ReviewSettingsPage.tsx`, i18n. Tests: `pages/orgs.test.tsx`, `pages/reviews.test.tsx`.

**Fixes and their tests:**
- `/roles` without `role_manage` shows "No permission" (`common.noPermission`). Test `roles page without permission`.
- A role save error on `permissions` shows `field.permissions`. Test `role permission error text`.
- The status label uses a translated `org.statusLabel` that includes punctuation per language. Test `verification status label translated`.
- Left-org notices: same as Task 2. Test `left org notice label and no tenant switch`.
- Review detail result error: same as Task 2. Test `result error does not spin`.
- Review settings revert: same as Task 2. Test `failed save keeps the other change`.

- [ ] **Step 1: Write the failing tests.** Run them. Expected: FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the full web-pc test, lint and build. Expected: PASS.
- [ ] **Step 4: Commit** `[minor-fixes-ui] web-pc account and review page fixes`.

### Task 5: web-pc OCR pages

**Files:** `pages/UploadPage.tsx`, `ocr/uploadQueue.ts`, `pages/VerifyPage.tsx`, `pages/DocumentPage.tsx`, `pages/HomePage.tsx`, i18n. Tests: `pages/ocr-upload.test.tsx`, `pages/ocr-verify.test.tsx`, `pages/ocr-library.test.tsx`, `pages/ocr-home.test.tsx`.

**Fixes and their tests:**
- **Recognition progress:** status rows show the job status step (`ocr.step.<STATUS>`) and the page count.
  - Test `status shows step and pages`.
- **Finished detection:** track ids from the jobs this page started (the ids returned by `createJob`) plus unfinished ids seen. A tracked id that is no longer unfinished and not failed counts as finished, wherever it is in the list. Use `getJob` for tracked ids missing from the top 20.
  - Tests `fast finish is announced`, `job beyond 20 is not falsely finished`.
- **Queue:**
  - `start()` while busy appends to the queue instead of being refused.
  - A drop of more than 10 files rejects the extra with `ocr.tooManyFiles` (the first 10 are kept).
  - The cancel-after-complete race deletes the file.
  - Tests `drop while busy appends; over 10 rejected` (Review Focus 5), `cancel after complete deletes the file`.
- **Delete pending:** failures show `message.error`. Test `delete failure shown`.
- **Verify:**
  - After a draft save, put the PATCH response into the result cache before clearing the draft (no flash);
  - missing marks clear for a path once its value is non-empty;
  - "Retry" uses `result.mapping.template_version_id` when there is no `lastApplied`.
  - Tests `saved values do not flash`, `missing mark clears when filled`, `auto conversion failure offers retry`.
- **Detail of unfinished job:** `/documents/:id` for OCR_PROCESSING, TEMPLATE_MATCHING or OCR_FAILED redirects to `/upload?job=id`. Test `unfinished job detail redirects`.
- **Home to-verify:** shown only with a verify permission; the count is the editable to-verify jobs (filter by `canEditJob` over `pageSize:100`).
  - Tests `to-verify hidden without permission`, `to-verify counts own editable`.

- [ ] **Step 1: Write the failing tests.** Run them. Expected: FAIL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** the full web-pc test, lint and build, then `pnpm -r build`. Expected: PASS.
- [ ] **Step 4: Commit** `[minor-fixes-ui] web-pc OCR page fixes`.
