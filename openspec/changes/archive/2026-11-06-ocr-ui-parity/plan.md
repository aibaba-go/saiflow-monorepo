# ocr-ui-parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LINE mini app's OCR pages a React copy of main's Vue pages. Behind them, the backend gets the matching rule "free-form when no template fits", URL import, amount checks, standardisation, matching info and main's "Reset" (discard unsaved edits).

**Architecture:** The backend changes are small additions to `services/api`. A new router covers file imports; template versions get a read route; the mapping worker learns the 70% rule and quiet AUTO failures; a pure module `app/ocr/amounts.py` does the amount checks. The front end replaces `apps/line-mini/src/features/scan/*` with ports of main's views and components. Each port is one `.tsx` and one `.module.css`: the CSS is copied from the Vue `<style scoped>` block, the markup from `<template>`. Data comes from our existing API types; main's own `api.ts` and `store.ts` are not ported.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy async, Alembic, httpx, pytest.
- Front end: React 18, react-router 7, React Query 5, zustand, Vite CSS Modules, Vitest + Testing Library.

**Spec:**
- `openspec/changes/ocr-ui-parity/proposal.md`;
- `specs/{documents,recognition,results,line-mini}/spec.md`;
- base behaviour in `openspec/changes/ocr-scan-flow/specs/*`.

## Global Constraints

- Requirements and AC IDs exactly as in the specs: FR-UPLOAD-014, FR-OCR-013/016/019/023/024, FR-SYS-109…118.
- Auto-match threshold **70%** (score ≥ 0.70 converts; below, free-form). The manual low-score hint is also below 70%.
- Amount tolerance **±0.01 THB**. Decimal arithmetic only, never float. Never change recognised values.
- URL import:
  - `http`/`https` only; public addresses only;
  - at most **3** redirects, each re-checked;
  - **20 MB**, **20 s** total;
  - name taken from the last path segment, else `import.<ext>`;
  - the same file rules as upload (20 MB, 50 pages, content sniffing).
- UI text in en (default), th and zh. en/th are copied from main's `i18n.ts` where main has them; zh is translated here. Key parity is enforced by `i18n.test.ts`.
- Rules win over main's UI where they differ (A5): permissions (`can(tenant, …)`), the plan gate (`may_confirm`), download tickets, language.
- main code is read-only reference (`temp/main-api`); no file is copied from it except markup and CSS ported by hand. Never copy credentials or `config.py` defaults.
- Commit messages start with `[ocr-ui-parity]`. Tests run as in `ocr-scan-flow`:
  - backend: `.venv/Scripts/pytest.exe` with `REQUIRE_INTEGRATION=1 TEST_DB_*`;
  - front end: `pnpm --filter @saiflow/line-mini test|lint|build`;
  - client: regenerate the api-client after every backend API change (CI checks it).
- Archive order: after `ocr-scan-flow`.

## Review Focus

1. **URL import address tricks.** None of these may be fetched; each gives 400 `import_address_not_allowed`:
   - `http://2130706433/` (decimal IP);
   - `http://[::ffff:127.0.0.1]/`;
   - a public host whose DNS answer is `10.0.0.5`;
   - a redirect to `http://localhost/`.

   The connected peer address is checked again after connect, so DNS rebinding also fails. Task 5 tests each.
2. **Quiet AUTO failures vs. manual failures.** A failed AUTO mapping never shows as an error. A later manual failure must show. After a manual success, the old manual failure must not resurface. Task 1 tests the sequence auto-fail → manual-fail → manual-ok.
3. **Messy amounts.** These are skipped, not errors and not issues: `"1,234.50"`, `" 100 "`, `"-"`, `""`, `None`, `"฿ 70"`, a negative discount, a row without quantity. Task 3 tests a table of these.
4. **Reset and unsaved edits.**
   - "Reset" is disabled with no unsaved edits.
   - After added and removed rows and fields, Reset brings back exactly the last saved structure.
   - Reset never sends a request and never changes the version.
   - A draft started before a background conversion finished is not resurrected by Reset; the editor was read-only then.

   Task 10 tests each.
5. **Cancelling an upload mid-transfer.** A cancelled file never appears in Pending, and its half-made upload is deleted. "Cancel all" keeps the files already uploaded. A cancel during the PUT aborts the request. Task 8 tests with a held PUT.

---

## File Structure

**Backend (`services/api`):**
- `app/ocr/amounts.py` (new): `check(groups, structured) -> list[AmountIssue]`.
- `app/ocr/fetch.py` (new): `fetch_public(url, *, max_bytes, timeout, max_redirects, resolver, transport) -> FetchResult`, `AddressNotAllowed`, `FetchFailed`.
- `app/routers/imports.py` (new): `POST /api/v1/file-imports`.
- `app/routers/templates.py` (modified): `GET /api/v1/templates/versions/{id}`; options gain `score` and `recommended`.
- `app/routers/uploads.py` (modified): `GET /api/v1/files/{id}`.
- `app/routers/exports.py` (modified): `GET /api/v1/exports/{id}`.
- `app/routers/results.py` (modified): `ResultOut` gains `match`, `warnings`, `amount_issues`, `updated_at`.
- `app/services/mapping_service.py`, `app/ocr/mapping_worker.py`, `app/ocr/templates/matcher.py`, `app/services/result_service.py`, `app/services/upload_service.py` (modified).
- `app/ocr/templates/schema.py` (modified): optional `role` on fields and columns.
- `app/ocr/templates/normalize.py` (modified): date forms and text trimming.
- `app/ocr/seed/{tax_invoice,billing_note}.json` (roles); `alembic/versions/0011_template_roles.py` (re-seed).

**Front end (`apps/line-mini/src`)**, where `features/scan/` keeps the route names from `ocr-scan-flow`:
- `features/scan/theme.module.css` (new): main's `:root` tokens and shared rules from `App.vue` `<style>`, scoped under `.scan`.
- `features/scan/api.ts` (new): typed calls over our API (listed in Task 7).
- `features/scan/components/`:
  - `PageHeader.tsx`, `StatusChip.tsx`, `JobListItem.tsx`, `NotificationDialog.tsx`;
  - `OriginalPreview.tsx`, `ImageViewer.tsx`;
  - `StructuredDataView.tsx`, `TemplatePanel.tsx`;
  - each with its `.module.css`.
- `features/scan/structured.ts` (rewritten from main's `structured.ts`).
- `features/scan/{ScanHomePage,ConfirmPage,ProcessingPage,ResultPage,FinalResultPage,HistoryPage}.tsx` and `.module.css`. They replace `ScanEntry`, `PendingList`, the old pages and `pages/HistoryPage.tsx`.
- `features/scan/uploadQueue.ts` (new): a queue with per-file `AbortController`.
- `i18n/{en,th,zh}.ts`: main's keys for these pages.

---

### Task 1: Matching — 70% rule, free-form when nothing fits, scores and template details (FR-OCR-019, 023, 024)

**Files:**
- Modify:
  - `app/ocr/templates/matcher.py` (single candidate: still ask the model);
  - `app/ocr/mapping_worker.py`;
  - `app/services/mapping_service.py`;
  - `app/services/result_service.py`;
  - `app/routers/templates.py`;
  - `app/routers/results.py`.
- Test: `tests/integration/test_template_mapping.py`, `tests/unit/ocr/test_templates_mapping.py`.

**Interfaces:**
- Produces:
  - `MATCH_THRESHOLD = 0.70` in `mapping_service`;
  - error code `NO_TEMPLATE_FIT` (an AUTO mapping whose best score < 0.70);
  - `mapping_service.quiet(mapping) -> bool`: True when `mapping.source == AUTO` and `status == FAILED`;
  - `ResultOut.mapping` returns only non-quiet states;
  - `ResultOut.match: MatchOut | None`, with `MatchOut{template_version_id:int, score:float|None, low_score:bool}`, for the current mapping;
  - `TemplateOption` gains `score: float|None` and `recommended: bool`; options are sorted by score desc, with `None` last;
  - `GET /api/v1/templates/versions/{version_id}` → `TemplateVersionOut{template_version_id, template_id, code, name, names, groups}`. It answers 404 unless the version is the current published version of a template available to the tenant.
- Scores come from the latest AUTO mapping's `candidates`. A template absent from them has `score=None`.

- [ ] **Step 1: Write the failing tests.**
  - `test_low_score_stays_free_form` (AC-019-02):
    - ranking `[{billing 0.55}, {tax 0.30}]`;
    - after `mapping_pass`, the stage is VERIFYING and `result.template is None`;
    - `result.mapping is None` (no error);
    - options ordered billing (0.55, recommended) then tax.
  - `test_auto_primary_missing_is_quiet` (AC-019-03): AUTO conversion lacks `net_total` → `result.mapping is None`, `result.template is None`.
  - `test_no_templates_no_llm_call` (AC-019-04): disable both templates (`update document_templates set status='DISABLED'`) → no mapping row, the fake LLM saw 0 calls.
  - `test_single_candidate_still_scored`:
    - one template enabled; ranking `[{tax 0.40}]`;
    - free-form, and `llm.calls["match"] == 1`.
  - `test_manual_failure_shows_after_quiet_auto` (Review Focus 2):
    - auto low score → quiet;
    - manual apply billing with `NO_PRIMARY` → `result.mapping.status == "FAILED"` and the error is PRIMARY_MISSING;
    - manual apply tax OK → `result.mapping is None`, template Tax Invoice.
  - `test_manual_low_score_hint` (AC-024-02): auto ranking has billing 0.45; manual apply billing OK → `result.match == {"template_version_id": billing, "score": 0.45, "low_score": True}`.
  - `test_template_version_details` (AC-024-03):
    - GET for the tax version: 200, with `groups[0]["key"] == "document"` and `names` present;
    - an unknown id: 404;
    - a disabled template's version: 404.
  - Update `test_no_fit_offers_options` and `test_wrong_template_primary_missing`: AUTO failures are now quiet, manual ones are not.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The matcher asks the model even for one candidate.
  - The mapping worker, after MATCHING: if `score is None or score < MATCH_THRESHOLD`, call `_fail(..., NO_TEMPLATE_FIT, ...)`; keep `candidates` and `match_score` on the row.
  - `result_service._mapping_state` skips quiet mappings.
  - Add `match` and options sorting; add the template version route.
- [ ] **Step 4: Run** `pytest tests/integration/test_template_mapping.py tests/integration/test_results.py tests/unit/ocr -q`. Expected: PASS.
- [ ] **Step 5: Regenerate the client, ruff, commit** `[ocr-ui-parity] free-form when no template fits; scores, recommendation and template details`.

### Task 2: Standardisation (FR-OCR-016) and type warnings on the result

**Files:**
- Modify: `app/ocr/templates/normalize.py`, `app/routers/results.py`, `app/services/result_service.py`.
- Test: `tests/unit/ocr/test_ocr_rules.py`, `tests/integration/test_results.py`.

**Interfaces:**
- Produces: `ResultOut.warnings: list[WarningOut]`, with `WarningOut{path:str, code:str}`. `code` ∈ {`type_mismatch`, `amount_precision`}. Warnings are taken from the mapping that produced the current version; a saved version keeps its mapping's warnings only for paths whose value is unchanged.

- [ ] **Step 1: Failing tests.**
  - `test_dates_all_forms`: `"01.10.2569"`, `"01-10-2569"`, `"01/10/2026"`, `"2026-10-01"` → `"2026-10-01"`.
  - `test_amount_currency_and_padding` (AC-016-01): `"฿ 16,050.4"` → `"16050.40"`; `"16,050.40 บาท"` → `"16050.40"`.
  - `test_text_trimmed`: `"  ACME  "` → `"ACME"`.
  - `test_unparseable_kept_with_warning` (AC-016-02):
    - `"约一万"` in an amount field is kept as written;
    - `result.warnings` contains `{"path": "summary.net_total", "code": "type_mismatch"}`;
    - after the user edits that field to `"10000.00"` and saves, the warning is gone.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Extend `_normalize_date` to `.` and `-` separators; trim string fields; expose warnings.
- [ ] **Step 4: Run** the unit tests and `test_results.py`. Expected: PASS.
- [ ] **Step 5: Regenerate the client and commit** `[ocr-ui-parity] standardisation forms and type warnings on the result`.

### Task 3: Amount checks (FR-OCR-013)

**Files:**
- Create: `app/ocr/amounts.py`, `alembic/versions/0011_template_roles.py` (calls 0009's `seed_templates`, like 0010).
- Modify:
  - `app/ocr/templates/schema.py`: `role: Literal[...] | None = None` on `FieldItem` and `Column`;
  - seeds;
  - `result_service.payload`;
  - `ResultOut`.
- Test: `tests/unit/ocr/test_amounts.py`, `tests/integration/test_results.py`, `tests/integration/test_ocr_schema.py`.

**Interfaces:**
- Roles:
  - columns: `quantity`, `unit_price`, `line_discount`, `line_base`, `line_tax`, `line_total`;
  - header fields: `lines_total`, `discount`, `base`, `tax`, `grand_total`.
- Seeds:
  - tax_invoice `goods.line_items`: quantity / unit_price / discount→line_discount / amount→line_total;
  - tax_invoice summary: sub_total→lines_total, discount_amount→discount, total_before_vat→base, vat_amount→tax, net_total→grand_total;
  - billing_note `invoices.items`: amount_before_vat→line_base, vat_amount→line_tax, total_amount→line_total;
  - billing_note summary: total_amount→grand_total.
- `AmountIssue{path:str, computed:str, recognised:str}`; `ResultOut.amount_issues: list[AmountIssue]`, computed on every read from the current version.
- Checks, each only when all its inputs parse (Decimal after removing `,`, spaces and currency marks):
  - **row:** quantity × unit_price = line_total, skipped when line_discount is non-empty; and line_base + line_tax = line_total;
  - **lines_total** = Σ line_total;
  - **base** = (lines_total or Σ line_total) − discount;
  - **grand_total** = (base, else (lines_total or Σ) − discount) + tax.

  Missing discount/tax counts as 0. Σ needs at least one parsed line_total. Tolerance 0.01.
- Issue paths: `goods.line_items[0].amount`, `summary.net_total`.

- [ ] **Step 1: Failing tests.**
  - `test_row_mismatch` (AC-013-01): qty "3", price "100.00", amount "310.00" → `[{"path": "goods.line_items[0].amount", "computed": "300.00", "recognised": "310.00"}]`.
  - `test_total_mismatch` (AC-013-02): lines sum "1000.00", vat "70.00", net "1075.00" → net computed "1070.00".
  - `test_messy_values_skipped` (Review Focus 3): parametrised over `"1,234.50"` (parses), `" 100 "`, `"-"`, `""`, `None`, `"฿ 70"`, negative discount `"-10"`, a row without quantity. None raises; only real mismatches are reported.
  - `test_within_tolerance`: 300.01 vs 300.00 → no issue.
  - `test_recheck_after_save` (AC-013-03):
    - save net "1070.00" → `amount_issues == []`;
    - saving with an issue still works, and confirm still works.
  - `test_0011_reseeds_roles`: the current versions carry `role` on `net_total`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `amounts.check`, the schema roles, the seeds, migration 0011 and the payload field.
- [ ] **Step 4: Run** the unit and integration tests above. Expected: PASS.
- [ ] **Step 5: Regenerate the client and commit** `[ocr-ui-parity] amount checks from template roles`.

### Task 4: Reads for files and exports (used by main's confirm and final pages)

**Files:** modify `app/routers/uploads.py`, `app/routers/exports.py`, `app/services/export_service.py`. Test: `tests/integration/test_uploads.py`, `tests/integration/test_exports.py`.

**Interfaces:**
- `GET /api/v1/files/{id}` → `FileOut` (via `file_access`).
- `GET /api/v1/exports/{id}` → `ExportOut{id, status, expires_at}` (`_visible_export`; 404 when expired).

- [ ] **Step 1: Failing tests.** `test_get_file` and `test_get_export`: own → 200; another tenant → 404; an expired export → 404.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Regenerate the client and commit** `[ocr-ui-parity] file and export reads`.

### Task 5: URL import (FR-UPLOAD-014)

**Files:**
- Create: `app/ocr/fetch.py`, `app/routers/imports.py`.
- Modify: `app/services/upload_service.py` (`import_bytes(db, store, ctx, principal, name, data) -> File`: the complete-step rules on given bytes), `app/main.py`.
- Test: `tests/unit/test_fetch.py`, `tests/integration/test_imports.py`.

**Interfaces:**
- `fetch_public(url:str, *, max_bytes=20*1024*1024, timeout=20.0, max_redirects=3, resolver=..., transport=None) -> FetchResult{data:bytes, final_url:str}`. It raises:
  - `InvalidUrl`: not http/https, or no host;
  - `AddressNotAllowed`: any resolved or connected address not `ipaddress.ip_address(x).is_global`, IPv4-mapped IPv6 unwrapped first;
  - `FetchFailed`: non-200, timeout, too many redirects, transport error;
  - `TooLarge`.

  Redirects are followed by hand. The peer address is read from the response's network stream after connect and checked again (anti-rebinding).
- `POST /api/v1/file-imports {url}` → 201 `FileOut`. Error codes, 400 unless noted:
  - `import_invalid_url`;
  - `import_address_not_allowed`;
  - `import_fetch_failed`;
  - `file_too_large`, `unsupported_format`, `too_many_pages`, `file_corrupt`;
  - 403 `permission_denied` without `upload_ocr`.
- The file name: the last path segment, unsafe characters → `_`, at most 255 characters; the right extension is added, else `import.<ext>`.

- [ ] **Step 1: Failing tests.** Unit tests use a fake resolver and `httpx.MockTransport`.
  - `test_rejects_private_forms` (Review Focus 1): parametrised over `http://127.0.0.1/`, `http://2130706433/`, `http://[::ffff:127.0.0.1]/`, `http://10.0.0.5/`, `http://169.254.169.254/`, `http://localhost/`, and a host resolving to `10.0.0.5` → `AddressNotAllowed`.
  - `test_redirect_rechecked`: 302 to `http://169.254.169.254/` → `AddressNotAllowed`; the second request is never sent.
  - `test_too_many_redirects`: 4 hops → `FetchFailed`.
  - `test_size_cap_streams`: 21 MB → `TooLarge`; no more than 20 MB + one chunk read.
  - `test_non_http_scheme`: `ftp://…`, `file:///etc/passwd` → `InvalidUrl`.
  - Integration, with `fetch_public` replaced by a fake:
    - `test_import_pdf` (AC-014-01): `inv.pdf` in pending, 2 pages, no job.
    - `test_import_errors` (AC-014-03): 404 → `import_fetch_failed`; HTML → `unsupported_format`; 21 MB → `file_too_large`; nothing stored.
    - `test_import_needs_upload_ocr` (AC-014-04).
    - `test_import_name`: `https://x/a/b%20c.pdf?x=1` → `b_c.pdf`; `https://x/` with a PNG → `import.png`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Regenerate the client and commit** `[ocr-ui-parity] URL import with public-address checks`.

### Task 6: Front-end foundation — theme, i18n, shared parts, scan API

**Files:**
- Create:
  - `features/scan/theme.module.css`;
  - `features/scan/api.ts`;
  - `features/scan/components/{PageHeader,StatusChip,JobListItem}.tsx` with their `.module.css`.
- Modify: `i18n/{en,th,zh}.ts`.
- Test: `features/scan/parts.test.tsx`, `i18n/i18n.test.ts` (existing parity test).

**Interfaces:**
- `api.ts` exports thin typed wrappers around `call(api.X(...))`, with types from `@saiflow/api-client`:
  - files and uploads: `listPending`, `getFile`, `deleteFile`, `importUrl(url)`;
  - jobs: `listJobs({page, pageSize, stage?, q?})`, `getJob`, `createJob(fileId, key)`, `cancelJob`, `rerunJob`;
  - results: `getResult`, `saveResult(id, expectedVersion, structured, confirm)`;
  - templates: `templateOptions`, `templateVersion`, `applyTemplate`, `useGeneric`;
  - exports: `createExport(id, lang)`, `getExport`, `exportTicket`.
- `StatusChip({stage})` uses main's colours: success, processing, danger and neutral from `theme`.
- `JobListItem({job, onOpen})`: main's layout. `PageHeader({title, onBack, right?})`.
- i18n: every key that main's six pages and these components use is added, with main's en and th text and a new zh text. Existing keys with the same meaning are reused; old scan keys no longer used are removed.

- [ ] **Step 1: Failing tests.**
  - `status chip colours per stage`: render each stage; the class is the expected one.
  - `job list item shows name, stage, template and Bangkok time`.
  - `page header back`: calls `onBack`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Port** the markup and CSS from `temp/main-api/apps/line-mini/src/{App.vue <style>,components/StatusChip.vue,JobListItem.vue,PageHeader.vue}` and add the i18n keys.
- [ ] **Step 4: Run** `pnpm --filter @saiflow/line-mini test`, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[ocr-ui-parity] mini app: main's theme, shared parts and scan API`.

### Task 7: Scan home (FR-SYS-056 home part, 057, 058 list, 109, 110, 111)

**Files:**
- Create:
  - `features/scan/ScanHomePage.tsx` and `.module.css` (port of `views/ScanHomePage.vue`);
  - `features/scan/uploadQueue.ts`;
  - `features/scan/components/NotificationDialog.tsx` and `.module.css`.
- Delete: `features/scan/ScanEntry.tsx`, `PendingList.tsx`.
- Modify: `pages/HomePage.tsx` renders only `ScanHomePage`; main's quota banner replaces `UsageCard` on the home page. `UsageCard` stays for other pages.
- Modify the test `features/shell.test.tsx` "home shows the usage card (053-01)": it now asserts the same numbers in the banner ("Starter · 4,880 / 5,000", validity date, free scans).
- Test: `features/scan/home.test.tsx`, which replaces `scan.test.tsx`'s home tests.

**Interfaces:**
- `useUploadQueue()` returns `{items, start(files), cancel(key), cancelAll(), retryFailed()}`.
  - Items: `{key, name, size, format, image, status: 'waiting'|'uploading'|'uploaded'|'failed', percent, error, retryable}`.
  - One file at a time, with an `AbortController` per file. A cancel aborts the current request and deletes the half-made upload (best effort).
  - A 401 fails the rest.
  - Local rejection (type or size) is not retryable.
- The home page uses `useCurrentTenant`, `useUsage`, `listPending`, `listJobs({page:1,pageSize:10})` and `can(tenant, 'upload_ocr')`.
- The quota banner: `"{plan} · {left} / {total}"` and a Plans link. Banners:
  - expired when `usage.active` is false;
  - expiring when days left ≤ 7, from `plan.ends_at` in Bangkok days.
- The workspace menu lists the personal tenant and organizations from `useSession().tenants`. It is disabled while the queue or an import is busy.
- The bell opens `NotificationDialog`, which uses the existing notifications data hooks.

- [ ] **Step 1: Failing tests**, keeping and moving the earlier ones:
  - `home shows the scan entry and pending files` (056-05);
  - `three files, one too large: two pending, one error` (057-01);
  - `member without upload_ocr sees no scan entry` (057-02);
  - `quota banner and recent tasks` (109-01): "Starter · 4,880 / 5,000", 10 rows, a VERIFYING row opens `/scan/jobs/:id/result`;
  - `expiring and expired banners` (109-02);
  - `cancel one and cancel all` (110-01; Review Focus 5):
    - hold the second PUT on a promise and cancel it: the abort signal fires and DELETE `/files/u2` is sent;
    - cancel all: u3 and u4 are never created; the summary reads "1 uploaded · 3 cancelled";
  - `retry failed only for retryable` (110-02);
  - `import from URL` (110-03): the input appears, a POST `/file-imports` body `{url}` is sent, the file shows in pending, and an error text is shown for `import_address_not_allowed`;
  - `multi-select process and delete` (111-01): select 2 → "Delete (2)" → confirm → 2 DELETEs; Cancel → none; "Process (2)" navigates to `/scan/confirm?ids=a,b`;
  - `workspace switch reloads pending and recent`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Port** `ScanHomePage.vue`, the template and the `<style scoped>` block, into TSX and the CSS module. Replace main's store calls with the hooks above and main's `navigate` with react-router routes.
- [ ] **Step 4: Run** test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[ocr-ui-parity] mini app: scan home copied from main`.

### Task 8: Confirm page, original preview and viewer (FR-SYS-058, 112, 113)

**Files:**
- Create: `features/scan/components/{OriginalPreview,ImageViewer}.tsx` with their `.module.css` (ports of main's), replacing `components/OriginalPreview`. Rewrite `features/scan/ConfirmPage.tsx` and add its `.module.css`.
- Test: `features/scan/confirm.test.tsx`, which replaces the confirm tests of `scan.test.tsx`.

**Interfaces:**
- `ImageViewer({sources: string[], index, alt, onIndex, onClose})`:
  - pinch, double-tap, drag;
  - zoom in, zoom out and reset buttons;
  - prev/next buttons and swipe;
  - page label `"n / m"`; "Load failed" on an image error.
- Sources are object URLs from `usePageUrl` (kept from `ocr-scan-flow`).
- The confirm page keeps `useCreateJobs` and its per-file idempotency keys. It remembers which files have started, so a second press starts only the rest. It shows the unavailable notice when a file's GET returns 404 or the tenant id changed since the page opened.

- [ ] **Step 1: Failing tests:**
  - `start creates jobs in order and clears pending` (058-01);
  - `quota exceeded shows remaining` (058-02);
  - `retry after network loss sends the same key once` (058-03);
  - `file by file with prev and next` (112): "File 2 of 3";
  - `partial start continues with the rest` (112-01);
  - `tenant changed shows the notice and disables start` (112-02);
  - `viewer zoom and next page` (113-01): "2 / 3" after next.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Port** `ConfirmPage.vue`, `OriginalPreview.vue` and `ImageViewer.vue`.
- [ ] **Step 4: Run** test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[ocr-ui-parity] mini app: confirm page and original viewer copied from main`.

### Task 9: Processing page (FR-SYS-059, 116 progress part)

**Files:** rewrite `features/scan/ProcessingPage.tsx` and add its `.module.css` (port of `ProcessingPage.vue`). Test: `features/scan/processing.test.tsx`, which replaces the progress tests of `result.test.tsx`.

**Interfaces:**
- Keeps the 2 s polling and the 90 s rule from `ocr-scan-flow`.
- Steps: main's `processing.step.*`.
- "Back home" navigates to `/`.
- The cancel dialog has the buttons "Cancel task" and "Keep processing".

- [ ] **Step 1: Failing tests:**
  - `progress steps then result` (059-01);
  - `90 s of matching goes to the result page`;
  - `failure shows reason and rerun` (059-02);
  - `cancel while processing after confirm`;
  - `leave the page` (116-01): "Back home" → `/`; polling stops.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Port** the page.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `[ocr-ui-parity] mini app: processing page copied from main`.

### Task 10: Result page, structured editor and template panel (FR-SYS-105, 106, 114, 115; FR-OCR-013/016/024 display)

**Files:**
- Rewrite: `features/scan/ResultPage.tsx`, `features/scan/structured.ts`.
- Create: `features/scan/components/{StructuredDataView,TemplatePanel}.tsx` with their `.module.css` (ports of `ResultPage.vue`, `StructuredDataView.vue`, `structured.ts`).
- Delete: `StructuredEditor.tsx`, `TemplatePicker.tsx`.
- Keep `confirm.ts`.
- Test: `features/scan/result.test.tsx` (rewritten).

**Interfaces:**
- Tabs: `table | original | json`. The JSON tab shows `JSON.stringify(structured, null, 2)` and has a Copy button using `navigator.clipboard.writeText`, with "Copied" or "Copy failed".
- Meta line: file name, pages, engine, `updated_at` in Bangkok time.
- Marks:
  - amount issues on the cell (class `amountIssue`, title "computed {computed}");
  - warnings on the cell;
  - the low-score notice when `result.match?.low_score`;
  - free-form shown with no error when `result.mapping` is null and `result.template` is null.
- The editor:
  - while a conversion runs, it is read-only (kept from the final review);
  - in a generic result, the field-name checks show "Field name required" and "Field name already used".
- "Reset" (main's `resetDraft`): enabled only when dirty; behind main's confirm dialog; restores the last saved structured result locally, with no request.
- `TemplatePanel`:
  - options sorted with score badges and "Recommended";
  - "Preview fields" (`templateVersion`) then "Apply";
  - "Save and switch" when dirty;
  - matching and applying states;
  - the failed notice only for a non-null `result.mapping` with FAILED;
  - after 10 minutes pending, "Still processing" with "Check again" and "Use generic result";
  - "No templates" text; the version-conflict notice.

- [ ] **Step 1: Failing tests**, keeping the earlier ones:
  - `labels in Chinese, decimal kept, required marked` (105-01);
  - `switch to generic saves the draft first` (105-02);
  - `conflict reloads latest` (105-03);
  - `guest confirm after login keeps the edit` (106-01);
  - `missing required scrolls and marks` (106-02);
  - `no editing while a conversion runs`;
  - `json tab and copy` (114-01);
  - `field name checks` (114-02);
  - `reset discards unsaved edits` (114-03; Review Focus 4): edit a field and delete a row, Reset → confirm → the saved values and row are back, no request was sent, the version is unchanged; with no edits, Reset is disabled;
  - `free form without error` (019-02): `mapping: null, template: null` → no alert role in the page;
  - `amount issue and warning marks`;
  - `low score notice` (024-02);
  - `preview then apply` (115-01);
  - `still processing after 10 minutes` (115-02, fake timers).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Port.**
- [ ] **Step 4: Run** test, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[ocr-ui-parity] mini app: result page, editor and template panel copied from main`.

### Task 11: Final result and history (FR-SYS-107, 108, 116 final part, 117)

**Files:**
- Rewrite `features/scan/FinalResultPage.tsx` and add its `.module.css`.
- Move `pages/HistoryPage.tsx` to `features/scan/HistoryPage.tsx` and add its `.module.css` (ports); update `App.tsx`.
- Test: `features/scan/final.test.tsx`, `features/scan/history.test.tsx` (moved from `pages/`).

**Interfaces:**
- Export states: "Preparing Excel…" while creating, "Excel export ready" after; in LINE, also "Opening your phone browser…". The download logic is kept from `download.ts`.
- "New scan" goes to `/`.
- History search uses `q`, debounced 300 ms, together with the stage. The footer reads "Loading more…" or "No more records". The `IntersectionObserver` and the button fallback are kept.

- [ ] **Step 1: Failing tests:**
  - `export in LINE opens a ticket externally` (107-01);
  - `no export permission hides button` (107-02);
  - `export states and new scan`;
  - `history filter and open` (108-01);
  - `history loads 45 in pages` (108-02);
  - `history resets on tenant switch`;
  - `search with stage` (117-01, fake timers for the debounce): the request has `q=inv&stage=VERIFYING`; only `inv-001.pdf` is listed.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Port.**
- [ ] **Step 4: Run** the whole mini app suite, lint and build. Expected: PASS.
- [ ] **Step 5: Commit** `[ocr-ui-parity] mini app: final result and history copied from main`.

### Task 12: Docs sync

**Files:**
- `docs/10-product/PRD-SaiFlow.md` §3.2 "模板匹配失败处理" and §4.2 item 4: no fit means free-form shown at once (D4), with a version row.
- `docs/30-design/OCR-Pipeline.md` §5.2, §5.3: the as-built rules (roles, tolerance, no auto-correct), with a version row.
- `docs/30-design/API-Spec.md`: the new endpoints.
- `docs/30-design/Data-Model.md`: template field roles; the B-3/B-4 note updated.
- `docs/20-requirements/Requirements-Index.md`:
  - rows FR-UPLOAD-014, FR-OCR-024, FR-SYS-109…118;
  - FR-OCR-013 and 016 point to `openspec/specs/recognition/spec.md`.
- `docs/20-requirements/functional/EPIC-01*.md` and `EPIC-02*.md`: mark FR-OCR-013 and 016 migrated; note on FR-OCR-002…005 that free-form covers them (D4).
- [ ] **Step 1: Edit, then run** `openspec validate ocr-ui-parity` and `bash scripts/check-no-secrets.sh`. Expected: pass.
- [ ] **Step 2: Commit** `[ocr-ui-parity] doc sync`.

### Task 13: Verification

- [ ] **Step 1:** Run all suites: backend pytest and ruff, `pnpm -r test|lint|build`, the contract check and `scripts/tests/*.test.sh`. Expected: all green.
- [ ] **Step 2:** Final whole-branch review (Opus) with this plan's Review Focus; one fix pass for Critical and Important findings, each RED→GREEN.
- [ ] **Step 3:** Push; CI green. No new one-time settings: URL import needs none, and migration 0011 re-seeds. Deploy only after the owner says "确认部署".
- [ ] **Step 4:** The owner tests on a phone in LINE.
  - The ocr-scan-flow list of 8 items again.
  - Plus:
    - URL import;
    - cancel one and cancel all;
    - multi-select;
    - file-by-file confirm;
    - viewer zoom;
    - JSON tab;
    - reset of unsaved edits;
    - template preview and apply;
    - history search.
  - Then the side-by-side check of the six pages against main (AC-118-01).
  - Then write `verification.md`. Archive `ocr-scan-flow` first, then this change. Its delta modifies `recognition` FR-OCR-019 and 023 and adds to `documents`, `recognition` and `line-mini`.
