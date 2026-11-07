# web-pc-ocr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web-pc gets the full OCR flow (upload, recognition status, verify and confirm, document library, detail and export) on the existing B-3/B-4 backend (B-5d).

**Architecture:**
- **Backend:** one change. The job list gains template and Thai-date-range filters.
- **web-pc (`apps/web-pc/src/ocr/`):**
  - Ports the mini app's framework-free helpers (upload, upload queue, structured-data paths, change labels), copied, not shared, as earlier web-pc work did.
  - Adds antd page components on top: Upload, Verify (three columns), Library, Detail.
  - Reuses B-4's `reviews/` read-only result, original pages, change log and review records.
  - The layout is modelled on saiflow-demo.aibaba.asia.

**Tech Stack:**
- FastAPI and pytest.
- React 18, antd 5, React Query 5, react-router 7, Vitest.

**Spec:**
- `openspec/changes/web-pc-ocr/proposal.md`
- `openspec/changes/web-pc-ocr/specs/{web-pc,results}/spec.md`

## Global Constraints

- **UI languages:** en (default), th and zh. Every new key goes in all three files (`apps/web-pc/src/i18n/{en,th,zh}.ts`).
- **Upload rules (same as FR-UPLOAD-003 and the mini app):** JPG/PNG/PDF, at most 20 MB each. Rejected files are told apart before upload.
- **Amounts and numbers** stay decimal text end to end; no precision loss.
- **Polling:** the recognition status refreshes every 3 s while any task is unfinished.
- **Library:** 20 rows per page.
- **Home:** the latest 5 tasks.
- **Dates:** the date range is Thai dates (UTC+7), both ends inclusive, as `YYYY-MM-DD` query values `created_from` / `created_to`.
- **Template filter:** query value `template` is a template id or the literal `generic`.
- **Permissions (owner and personal tenant hold all):**
  - Upload menu: `upload_ocr`;
  - Verify menu: `verify_own` or `verify_others`;
  - Export button: `export`.
- No new npm or Python dependencies. P0 only: no confidence, Confirm all, field flags, local archive, batch export, duplicate check, link import, or admin pages.
- **Backend test command** (`PYTEST`): `cd services/api && REQUIRE_INTEGRATION=1 TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=55432 TEST_DB_NAME=saiflow_test TEST_DB_USER=saiflow_test TEST_DB_PASSWORD=local-throwaway-db .venv/Scripts/pytest.exe`
- **Front test command:** `pnpm --dir apps/web-pc test`. Lint and build: `pnpm --dir apps/web-pc lint`, `pnpm --dir apps/web-pc build`.

## Review Focus

1. Leaving the Verify page, or switching tasks, with unsaved edits must ask first. A route change through the menu must ask too, not only clicks in the left column (Task 4 test `asks before leaving with unsaved edits`).
2. After confirm, the next task opens with its own result. Edits from the previous task must not leak into it (stale draft keyed by job id) (Task 4 test `next task starts clean`).
3. Switching tenant on the Library or Verify page shows the new tenant's data. Filters reset, and no job from the old tenant stays open (Task 5 test `tenant switch resets filters`; Task 4 test `tenant switch clears the open task`).
4. The date filter at the Thai midnight boundary (23:30 vs 00:30 Thai time) puts each job on the right day (Task 1 test `test_date_range_thai_boundary`).
5. A user who cannot verify opens a to-verify job from the Library. They land on the read-only detail, not on a Verify page that 403s on save (Task 5 test `no verify permission opens detail`).

---

## File Structure

**Backend `services/api`**
- Modify: `app/services/job_service.py` (`list_jobs` gains `template` and `created_from`/`created_to`), `app/routers/ocr_jobs.py` (query params).
- Test: `tests/integration/test_job_filters.py`.

**web-pc `apps/web-pc/src`**
- **`ocr/` (new), ports from line-mini:**
  - `api.ts`: job, file, upload, result, template, export calls and hooks;
  - `upload.ts`, `uploadQueue.ts`: ported as is (`ApiError` from web-pc `services/errors`);
  - `structured.ts`: ported;
  - `download.ts`: browser only, no LIFF;
  - `stage.ts`: stage label and `jobTarget`.
- **`ocr/` (new), antd components:**
  - `EditableResult.tsx`: editable header fields and line items, with marks for missing, type warning and amount issue;
  - `TemplateSwitch.tsx`: the template choice modal;
  - `StageTag.tsx`.
- **`pages/` (new):** `UploadPage.tsx`, `VerifyPage.tsx`, `LibraryPage.tsx`, `DocumentPage.tsx`; tests `ocr-upload.test.tsx`, `ocr-verify.test.tsx`, `ocr-library.test.tsx`.
- **Modify:**
  - `layout/AppLayout.tsx` (menu);
  - `pages/HomePage.tsx` (to-verify count and recent tasks);
  - `App.tsx` (routes; `/data` removed, redirected to `/library`);
  - i18n;
  - remove `pages/DataBrowsePage.tsx` and its test;
  - update `pages/shell.test.tsx` (094-03).

**Docs:** `docs/10-product/PRD-SaiFlow.md` (§4.9 web-pc role), `docs/20-requirements/functional/EPIC-05-doc-management.md`, `docs/20-requirements/Requirements-Index.md`.

---

### Task 1: Job list filters (FR-VERIFY-017)

**Files:**
- Modify: `services/api/app/services/job_service.py` (`list_jobs`), `services/api/app/routers/ocr_jobs.py`
- Test: `services/api/tests/integration/test_job_filters.py`

**Interfaces:**
- Produces: `GET /api/v1/ocr/jobs?stage&q&template&created_from&created_to&page&page_size`.
  - `template`: digits = template id (matched through the current mapping's `template_id`), or `generic` = `current_mapping_id is null`. Anything else → 400 naming `template`.
  - `created_from` / `created_to`: `YYYY-MM-DD` Thai dates. The range is `[from 00:00+07, to+1 00:00+07)`. Bad format → 400 naming the field. `from > to` → 400 naming `created_from`.
  - The filters combine with AND, together with the existing `stage` and `q`.

- [ ] **Step 1: Write failing tests** `test_job_filters.py`. Reuse `tax_job` and the `recognised` helpers; set `created_at` and `current_mapping_id` by SQL where needed.
  - `test_filter_by_template` (AC-017-04): 2 Tax Invoice, 1 Billing Note and 1 generic; `template=<tax id>` → 2; `template=generic` → 1.
  - `test_date_range_thai_boundary` (AC-017-05): A at 2026-11-01 16:30Z (23:30 Thai), B at 2026-11-01 17:30Z (00:30 Thai on the 2nd). `created_from=2026-11-02` → [B]; `created_to=2026-11-01` → [A].
  - `test_bad_range_400`: `created_from=2026-11-03&created_to=2026-11-01` → 400 with `created_from`; `created_from=11/02/2026` → 400; `template=abc` → 400.
  - `test_filters_combine`: stage, template and date together.
- [ ] **Step 2: Run** `PYTEST tests/integration/test_job_filters.py -q`. Expected: FAIL (filters ignored).
- [ ] **Step 3: Implement.** Reuse `billing_time` / `app.clock` for the Bangkok zone if a helper exists, else `ZoneInfo("Asia/Bangkok")`.
- [ ] **Step 4: Run** the file plus `tests/integration/test_ocr_jobs.py`. Expected: PASS. Then regenerate `openapi.json` and the client with the regeneration command from earlier changes.
- [ ] **Step 5: Commit** `[web-pc-ocr] job list filters by template and Thai date range (FR-VERIFY-017)`.

### Task 2: web-pc OCR foundations

**Files:**
- Create: `apps/web-pc/src/ocr/{api.ts,upload.ts,uploadQueue.ts,structured.ts,download.ts,stage.ts,StageTag.tsx,EditableResult.tsx}`, `apps/web-pc/src/ocr/ocr.test.tsx`
- Modify: i18n (error codes `err.unsupported_format`, `err.file_too_large`, `err.quota_exceeded`, `err.plan_expired`, `err.version_conflict`, `err.result_confirmed`, `err.required_missing`, if missing; stage labels).

**Interfaces:**
- Produces:
  - `ocr/api.ts`:
    - functions `listJobs({page, pageSize, stage?, q?, template?, createdFrom?, createdTo?})`, `getJob`, `cancelJob`, `rerunJob`, `getResult`, `saveResult(jobId, version, structured, confirm)`, `templateOptions`, `applyTemplate`, `chooseGeneric`, `listPending`, `deleteFile`, `createJob(fileId, key)`;
    - hooks `useJob(id, poll)`, `useResult(id)`, `useJobs(filters)`. Query keys carry `tenant?.tenant_id`.
  - `uploadQueue.ts`: `useUploadQueue(onUploaded)`, same API as the mini app (items, add(files), cancel(id), cancelAll(), retry(id), clearFinished()).
  - `download.ts`: `exportAndDownload(jobId, language, fileName): Promise<void>`. Browser only: create the export, then fetch the blob, then click an object-URL link.
  - `stage.ts`:
    - `stageKey(stage, level)` → i18n key: `review.pending1`/`review.pending2` for PENDING_REVIEW, else `stage.<STAGE>`;
    - `jobTarget(job, canVerify)` → `/upload?job=<id>` (processing, matching, failed), `/verify/<id>` (VERIFYING with canVerify), else `/documents/<id>`.
  - `StageTag({stage, level})`: an antd Tag coloured by stage.
  - `EditableResult({value, groups, missing: Set<string>, warnings: Set<string>, amountIssues: Map<string,string>, editable, onChange})`:
    - template results: antd form rows per field and an antd Table per line-item table, with "Add row" and "Delete row";
    - generic results: groups and tables, plus "Add field" (name required, unique in the group) and "Delete field";
    - every input carries `data-path` and `aria-label` = the field label;
    - marked rows get `className` `required-missing` / `type-warning` / `amount-issue` and a red border.

- [ ] **Step 1: Write failing tests** `ocr/ocr.test.tsx`:
  - `jobTarget routes by stage and permission`: VERIFYING and canVerify → `/verify/j1`; VERIFYING without → `/documents/j1`; OCR_FAILED → `/upload?job=j1`; CONFIRMED → `/documents/j1`.
  - `stageKey adds the review level`.
  - `EditableResult edits a field and a row`: changing "Invoice No." calls onChange with the new value; "Add row" adds an empty row; "Delete row" removes it.
  - `EditableResult marks missing and keeps decimal text`: typing "1,234.50" in an amount field yields "1234.50" through `cleanValue`; a missing path has the `required-missing` class.
  - `generic result add field requires a unique name`.
  - `useUploadQueue rejects a txt before upload`: `add([txt])` gives an item failed with `unsupported_format` and no POST.
- [ ] **Step 2: Run** `pnpm --dir apps/web-pc exec vitest run src/ocr`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** (port the helpers; write `EditableResult` with antd `Input`, `Table`, `Button`).
- [ ] **Step 4: Run** the same command, then the full web-pc test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[web-pc-ocr] web-pc OCR foundations: api, upload queue, editable result`.

### Task 3: Upload page and recognition status (FR-SYS-127, 128)

**Files:**
- Create: `apps/web-pc/src/pages/UploadPage.tsx`, `apps/web-pc/src/pages/ocr-upload.test.tsx`
- Modify: `App.tsx` (route `/upload`), i18n

**Interfaces:**
- Consumes: Task 2 `useUploadQueue`, `listPending`, `deleteFile`, `createJob`, `listJobs`, `cancelJob`, `rerunJob`, `jobTarget`.
- **Behaviour:**
  - **Drop zone:** antd `Upload.Dragger` with `beforeUpload` returning false; files go to the queue. The queue table shows name, size, progress and status, with Cancel, Retry, "Cancel all" (confirm modal) and "Clear finished".
  - **Pending:** a Table with row selection, "Start recognition (n files)" and "Delete selected" (confirm). Start creates jobs one by one with idempotency key `pc-<fileId>`. It stops at the first 402 and shows the message: `quota_exceeded` with the remaining count, or `plan_expired` with a link to `/plans`.
  - **Recognition status:** `listJobs` for stages OCR_PROCESSING, TEMPLATE_MATCHING and OCR_FAILED (three calls, merged, newest first, at most 20). Refetch every 3 s while any is unfinished. Each row shows Cancel (confirm) or the failure reason and Rerun.
  - **Finished jobs:** a job that was listed and now is not shows `message.success` "Recognition finished" with a "Go to verify" link (`/verify/<id>`).
  - **`?job=<id>`:** highlights that row (scrolls into view).
  - **No permission:** without `upload_ocr` the page shows "You have no upload permission."

- [ ] **Step 1: Write failing tests** (full app render as in `pages/reviews.test.tsx`):
  - `drop rejects txt and uploads pngs` (127-01): the upload endpoints are mocked as in the mini app tests; the TXT shows the format error; the PNGs land in Pending.
  - `cancel and retry` (127-02).
  - `start recognition creates jobs and leaves pending` (127-03).
  - `quota exceeded keeps the file` (127-04).
  - `finished job offers go to verify` (128-01).
  - `failed job shows reason and rerun` (128-02).
  - `no upload permission`.
- [ ] **Step 2: Run** `pnpm --dir apps/web-pc exec vitest run src/pages/ocr-upload`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full web-pc test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[web-pc-ocr] web-pc upload page and recognition status`.

### Task 4: Verify page (FR-SYS-129)

**Files:**
- Create: `apps/web-pc/src/pages/VerifyPage.tsx`, `apps/web-pc/src/ocr/TemplateSwitch.tsx`, `apps/web-pc/src/pages/ocr-verify.test.tsx`
- Modify: `App.tsx` (routes `/verify` and `/verify/:id`), i18n

**Interfaces:**
- Consumes:
  - Task 2 `EditableResult`, `useResult`, `saveResult`, `templateOptions`, `applyTemplate`, `chooseGeneric`;
  - B-4 `reviews/OriginalPages`, `reviews/ChangeLogTable` (in a Drawer).
- **Behaviour:**
  - **Left column:** `listJobs({stage:"VERIFYING", pageSize:100})`. The selected id is the route param, defaulting to the first. Every row of a returned task shows a "Returned" tag. For this, `JobOut` gains `returned: bool` (the latest round of the job is RETURNED and it is not locked), set in `job_service.summaries` from one query over `review_rounds`. The test `test_returned_flag` goes in `tests/integration/test_job_filters.py` and belongs to this task; regenerate the client.
  - **Middle column:** `OriginalPages`.
  - **Right column:** the return banner, the notices (mapping failure with Retry and "Change template", type warnings, amount issues), `EditableResult`, and the buttons Save draft, Change template, Change log and Confirm.
  - **Draft:** `{jobId, base: version, value}` in state. It is dirty when the value differs from the loaded result. A draft whose jobId differs from the open id is discarded (Review Focus 2).
  - **Leaving with edits:** react-router `useBlocker(dirty)` shows a confirm modal before any navigation (left column, menu, browser back). `beforeunload` covers closing the tab.
  - **Confirm:** save, then confirm, with the same outcome handling as the mini app's `confirmResult`, minus the guest branch. On success, show `message.success` ("Confirmed", or "Submitted for review" when `review.stage` is PENDING_L*), invalidate the jobs queries, and navigate to the next VERIFYING id or `/verify` (empty state "No documents to verify").
  - **Errors:** 422 marks and scrolls the first `[data-path]`; 402 shows the plans link; 409 `version_conflict` shows "Changed by someone else" and refetches.
  - **Not to verify:** `/verify/:id` for a job not in VERIFYING redirects through `jobTarget`.
  - **Tenant switch:** the route resets to `/verify`.

- [ ] **Step 1: Write failing tests:**
  - `edit and confirm opens the next` (129-01): A and B to verify; edit A's total to "1,234.50"; Confirm → PATCH body `{expected_version, structured with "1234.50", confirm:true}`; then "Confirmed" shows and B is open.
  - `asks before switching or leaving with unsaved edits` (129-02, Review Focus 1): edit A, click B → modal; Cancel keeps A and the edit; then the menu "Library" → modal.
  - `missing required marks and scrolls` (129-03).
  - `change to generic saves draft first` (129-04): PATCH (draft) then POST generic.
  - `returned task shows the banner` (129-05).
  - `next task starts clean` (Review Focus 2).
  - `tenant switch clears the open task` (Review Focus 3).
  - `plan expired shows plans link`; `version conflict reloads`.
- [ ] **Step 2: Run** `pnpm --dir apps/web-pc exec vitest run src/pages/ocr-verify`. Expected: FAIL.
- [ ] **Step 3: Implement.** A route-level data router is needed for `useBlocker`. If `AppRoutes` uses `<BrowserRouter>`, switch to `createBrowserRouter`/`RouterProvider` keeping the same routes. The test render helper must then use `createMemoryRouter`. Record a ruling if this changes `test/render.tsx`.
- [ ] **Step 4: Run** the full web-pc test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[web-pc-ocr] web-pc verify page`.

### Task 5: Library and document detail (FR-SYS-130, 131)

**Files:**
- Create: `apps/web-pc/src/pages/LibraryPage.tsx`, `apps/web-pc/src/pages/DocumentPage.tsx`, `apps/web-pc/src/pages/ocr-library.test.tsx`
- Modify: `App.tsx` (routes `/library` and `/documents/:id`; `/data` redirects to `/library`), remove `pages/DataBrowsePage.tsx`, i18n

**Interfaces:**
- Consumes: Task 1 filters through `listJobs`; Task 2 `jobTarget`, `StageTag`, `exportAndDownload`; B-4 `ReadonlyResult`, `OriginalPages`, `ReviewRecordList`, `ChangeLogTable`.
- **Library behaviour:**
  - Filters: stage Select; template Select (options from the new `GET /api/v1/templates`, see Step 3, plus "Generic result" = `generic`); antd `DatePicker.RangePicker` (Thai date strings); and a search Input (debounced 300 ms).
  - Table: page size 20, server pagination. Clicking a row navigates to `jobTarget(job, canVerify)`.
  - A tenant change resets filters and the page.
- **Detail behaviour:**
  - Header: file name, `StageTag`, template, created and confirmed times.
  - Two columns: original and read-only result; then review records and change log.
  - "Export Excel" when the stage is CONFIRMED and the user has `export`; it calls `exportAndDownload` with the current language.
  - "Go to verify" when VERIFYING and the user can verify.

- [ ] **Step 1: Write failing tests:**
  - `combined filters and paging` (130-01): the query has `stage=CONFIRMED&template=7`, 25 results; page 2 shows 5.
  - `open by stage` (130-02).
  - `member without data browse sees own` (130-03): passes through the backend scope; the test asserts the request carries no user filter and renders what the API returns.
  - `tenant switch resets filters` (Review Focus 3).
  - `no verify permission opens detail` (Review Focus 5).
  - `export downloads xlsx` (131-01): POST export then GET download (blob); an object URL is created with `.xlsx`.
  - `pending review hides export` (131-02).
  - `menu has no data browse` (094-03, moved here from shell.test).
- [ ] **Step 2: Run** `pnpm --dir apps/web-pc exec vitest run src/pages/ocr-library`. Expected: FAIL.
- [ ] **Step 3: Implement.** For the template filter options, add `GET /api/v1/templates` (published templates of the current tenant: `[{template_id, name}]`) to `app/routers/templates.py`, backed by `mapping_service.available_versions`. Add an integration test `test_list_templates` in `tests/integration/test_job_filters.py` and regenerate the client. This is the smallest honest source.
- [ ] **Step 4: Run** `PYTEST tests/integration/test_job_filters.py -q`, then the full web-pc test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[web-pc-ocr] web-pc library and document detail`.

### Task 6: Menu and home (FR-SYS-094)

**Files:**
- Modify: `apps/web-pc/src/layout/AppLayout.tsx`, `apps/web-pc/src/pages/HomePage.tsx`, `apps/web-pc/src/pages/shell.test.tsx`, i18n
- Test: `apps/web-pc/src/pages/ocr-home.test.tsx`

**Interfaces:**
- **Menu order:** home, upload (`/upload`), verify (`/verify`), library (`/library`), reviews, reviewSettings, org, roles, plans, notifications, profile.
  - Hide upload without `upload_ocr`.
  - Hide verify without `verify_own` and `verify_others`.
  - The existing rules for the review items stay.
- **Home:** below the usage card, a "To verify: n" card linking to `/verify` (`listJobs({stage:"VERIFYING", pageSize:1}).total`), and "Recent tasks", the latest 5 (`listJobs({pageSize:5})`), each opening `jobTarget`. With none, show "No tasks yet" and an Upload button.

- [ ] **Step 1: Write failing tests:**
  - `personal tenant menu` (094-02): Upload, Verify and Library shown; Roles and Reviews hidden.
  - `data browse only member` (094-05).
  - `home shows to-verify and recent five` (094-06): total 3 and 8 jobs, 5 rows shown; clicking the count goes to `/verify`.
  - `home empty state`.
  - Update the old 094-03 test in `shell.test.tsx`; remove it if moved to Task 5.
- [ ] **Step 2: Run** `pnpm --dir apps/web-pc exec vitest run src/pages/ocr-home src/pages/shell`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full web-pc test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[web-pc-ocr] web-pc menu and home`.

### Task 7: Docs sync

**Files:** `docs/10-product/PRD-SaiFlow.md` (§4.9 entry table and the line "V1.0 的 web-pc 企业版只做结构化数据浏览与管理操作" → full OCR flow per the owner 2026-11-07; version and changelog), `docs/20-requirements/functional/EPIC-05-doc-management.md` (note: FR-MGMT-001 and 006 are covered by the web-pc Library and Detail, `openspec/specs/web-pc`), `docs/20-requirements/Requirements-Index.md` (FR-SYS-127…131; FR-VERIFY-017 note).

- [ ] **Step 1:** Edit the docs.
- [ ] **Step 2:** Run `grep -n "只做结构化数据浏览" docs/10-product/PRD-SaiFlow.md`. Expected: no match outside the changelog.
- [ ] **Step 3: Commit** `[web-pc-ocr] doc sync`.
