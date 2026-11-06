# ocr-scan-flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring main's working scan flow onto this branch: upload → OCR (TextIn / Google Vision with switching) → LLM template match and conversion (or the generic result) → edit and confirm → XLSX export. Build it as the FastAPI backend plus the LINE mini app pages.

**Architecture:**
- **Backend (`services/api`), following ADR-009:**
  - **A-class modules** are moved with their tests into `app/ocr/` and made env-configured (`textin/`, `doc_templates/{schema,normalize,matcher,converter,llm}`, `deepseek.py`). They stay synchronous; async code calls them through `asyncio.to_thread`.
  - **B-class rules** (uploads, jobs, worker, results, templates, exports) are rewritten in the existing router → service → model style. The eight business tables keep main's names and columns, with the T1–T9 adjustments.
  - **Storage:** objects go to private GCS behind a small `ObjectStore` interface; tests use an in-memory fake.
  - **Worker:** recognition and template conversion run in a separate compose service (`python -m app.cli ocr-worker-loop`), like the reminders service.
- **LINE mini app (`apps/line-mini`):** main's Vue pages (`temp/main-api/apps/line-mini/src/views/*.vue`) rewritten in React + antd-mobile, on the existing API layer, session, tenants and i18n.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy 2 async, Alembic, pytest + local Docker PostgreSQL 18. New dependencies:
  - `google-cloud-storage`;
  - `pymupdf` (PDF page count and page render);
  - `openpyxl` (XLSX).
  TextIn, Google Vision and the LLM are called over `httpx` against their REST APIs.
- Mini app: React 18, antd-mobile 5, React Query 5, react-router-dom 7, Vitest + RTL.

**Spec:**
- `openspec/changes/ocr-scan-flow/specs/{documents,recognition,results,exports,line-mini}/spec.md`;
- `proposal.md` (D1–D6, A1–A11).

Reference code (read-only): `temp/main-api/` (exported with `git archive origin/main services/api apps/line-mini/src`). Re-export it if missing. Never read or copy `sf-cookies.txt`, `config.py` defaults or other credentials from it.

## Global Constraints

- **Tables:**
  - `files`, `ocr_jobs`, `ocr_raw_results`, `result_versions`, `document_templates`, `document_template_versions`, `template_mappings` and `exports` keep main's columns (`temp/main-api/services/api/models.py`). Only these adjustments are allowed:
    - **T1:** `timestamptz` and `app.clock.utcnow()`;
    - **T2:** NULL, never `''`, for "none";
    - **T3:** CHECK constraints on status columns, with the values from one constants module, `app/ocr/states.py`;
    - **T4:** `jsonb`;
    - **T5:** foreign keys, `DEFERRABLE INITIALLY DEFERRED` for the cyclic ones;
    - **T6:** an index on every foreign-key column;
    - **T7:** a trigger forbidding UPDATE and DELETE on `ocr_raw_results`, and app-role grants of SELECT and INSERT only;
    - **T8:** `storage_path` holds a GCS object name;
    - **T9:** no `page_results` table.
  - IDs are 36-character UUID text for files, jobs, versions, exports and mappings; bigint for users, tenants and templates.
  - Every table with a `tenant_id` declares `info={"tenant_scoped": True}`, so B-2a's `claim_guest_tenant` moves it.
  - Columns are added beyond main only where this plan names them.
- **Tenant and permission:**
  - every customer endpoint uses `get_tenant_context` (X-Tenant-Id) and `require(ctx, Permission.X)`;
  - job visibility uses `submitter_scope(ctx)` (FR-SYS-017);
  - an invisible job, file or export answers **404**;
  - permissions:
    - `UPLOAD_OCR`: uploads and job creation;
    - `VERIFY_OWN` / `VERIFY_OTHERS`: save and confirm;
    - `EXPORT`: exports.
  - Guests have their own tenant and pass every permission check except confirm (needs registration).
- **Limits (A1):**
  - 20 MB per file;
  - PDF 1–50 pages;
  - 10 files per selection (mini app);
  - an upload session expires after 24 h;
  - 5 template attempts per job (A7);
  - an export lives 24 h;
  - a download ticket lives 60 s.
- **Object names:**
  - `originals/<tenant_id>/<file_id>.<ext>`;
  - `previews/<file_id>/page_<n>.png`;
  - `exports/<export_id>.xlsx`.
  Bytes are always proxied by the backend; no signed or public URLs (T8).
- **Errors** (`AppError`, `message_key error.<code>`):

  | Status | Code | Fields |
  |---|---|---|
  | 400 | `unsupported_format`, `file_too_large`, `too_many_pages`, `file_corrupt` | `file` |
  | 400 | `validation_error` | named |
  | 402 | `quota_exceeded` (details.available) / `plan_expired` | |
  | 401 / 403 | `unauthenticated` / `registration_required` | |
  | 404 | `not_found` | |
  | 409 | `upload_not_ready`, `file_in_use`, `job_not_terminal`, `job_terminal`, `version_conflict`, `result_confirmed`, `result_not_confirmed`, `mapping_limit`, `mapping_in_progress` | |
  | 422 | `required_missing` | `structured.<path>` |
  | 503 | `storage_unavailable` | |

- **Job states (T3):** `QUEUED`, `PREPROCESSING`, `PROCESSING`, `POSTPROCESSING`, `SUCCEEDED`, `PARTIAL_SUCCESS`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`.
  - Stages (FR-VERIFY-017): `OCR_PROCESSING`, `OCR_FAILED`, `TEMPLATE_MATCHING`, `VERIFYING`, `CONFIRMED`.
  - Mapping states: `PENDING`, `MATCHING`, `CONVERTING`, `READY`, `FAILED`.
  - Job error codes:
    - `VENDOR_TIMEOUT`, `VENDOR_TRANSPORT`, `OCR_UNAVAILABLE`, `OCR_CONTENT_FAILED`, `VENDOR_UNCERTAIN`;
    - `FILE_MISSING`, `FILE_NOT_READY`;
    - `TEXTIN_ERROR_<code>`, `VISION_ERROR_<code>`.
- **Numbers and dates:**
  - LLM JSON is parsed with `parse_float=str`; amounts and quantities stay decimal strings end to end (backend, export, mini app);
  - dates are `YYYY-MM-DD`; Buddhist-era years convert to Gregorian (FR-OCR-016, `doc_templates/normalize.py`);
  - times are shown in Asia/Bangkok.
- **Audit (`audit_service`):**
  - `file.upload`, `file.delete`;
  - `job.create`, `job.cancel`, `job.rerun`, `job.delete_results`;
  - `template.apply`, `template.generic`;
  - `result.save`, `result.confirm`;
  - `export.create`.
  Reads write nothing.
- **Mini app:**
  - every visible string goes in `src/i18n/{en,th,zh}.ts` (en default);
  - errors show `err.<code>`;
  - buttons use `useSubmit`;
  - confirm dialogs use `confirmAction`;
  - antd-mobile dialogs are cleared between tests (`src/test/setup.ts`).
- **Commits:** start with `[ocr-scan-flow]`. Backend checks run in `services/api`: `.venv/Scripts/pytest.exe`, `ruff.exe`, with the `REQUIRE_INTEGRATION=1 TEST_DB_*` environment.

## Review Focus

1. **The worker dies between steps.** A crash after reserving and before or during the engine call must leave the job FAILED (`VENDOR_UNCERTAIN`) or re-queued, and the reservation must be released exactly once. It must never be released twice, and never kept for a failed job. Task 7 tests restart at each state and asserts the tenant's remaining scans.
2. **Concurrent writes on one job.** A save, a confirm, a template switch and a mapping that finishes in the worker can all arrive at the same moment. All of them take the job row lock. The current version stays unique, and a confirmed result is never overwritten by a late mapping. Task 9 runs these concurrently against PostgreSQL (main's SQLite tests never exercised the lock, ADR-009 §3.6).
3. **Truncated, lying or hostile files.** A PDF cut mid-upload, content bytes that do not match the declared size, an image with a PDF extension, or a PDF bomb with 10,000 pages: each gives the right 400 code and leaves no READY file and no stored object. Task 3 tests each.
4. **LLM output that is not what was asked.** Floats for money, JSON wrapped in prose, keys outside the template, a missing primary field, a date in the Buddhist era. The result keeps decimal strings, drops the extra keys with a warning, fails on a missing primary field, and converts the date. Tasks 4 and 8 test each, with a fake LLM.
5. **A guest's work across registration, and tenant switches.** A guest uploads, recognises and saves a draft, then registers. The files, jobs and versions move to the personal tenant with `created_by_user_id` set, and the draft can be confirmed. A request with another tenant's X-Tenant-Id for the same job gets 404. Task 6 tests both.

---

### Task 1: Storage, settings and file inspection

**Files:**
- Create:
  - `app/integrations/storage.py`: `ObjectStore` protocol, `GcsStore`, `MemoryStore`;
  - `app/ocr/__init__.py`;
  - `app/ocr/files.py`: format sniffing, page count, page render.
- Modify:
  - `app/config.py`;
  - `pyproject.toml` (+ `google-cloud-storage`, `pymupdf`, `openpyxl`; lock with `uv lock`);
  - `app/dependencies.py` (`get_store`).
- Test: `tests/unit/test_storage.py`, `tests/unit/test_ocr_files.py`.

**Interfaces (produces):**
- `class ObjectStore(Protocol)`:
  - `async put(name: str, data: bytes, content_type: str) -> None`;
  - `async get(name: str) -> bytes` (raises `ObjectMissing`);
  - `async exists(name) -> bool`;
  - `async delete(name) -> None`.
- `GcsStore(bucket: str, credentials_file: str | None)`: wraps the sync client in `asyncio.to_thread`.
- `get_store()`: 503 `storage_unavailable` when `gcs_bucket` is unset.
- Settings (no defaults for secrets, FR-PLAT-003): `gcs_bucket: str | None`, `gcs_credentials_file: str | None`, `ocr_worker_enabled: bool = True`, `ocr_poll_seconds: float = 2.0`.
- `sniff(data: bytes) -> Literal["jpg","png","pdf"] | None`: by magic bytes only.
- `page_count(kind, data) -> int`: 1 for images; PyMuPDF for PDF. Raises `FileCorrupt` for a damaged PDF or 0 pages.
- `render_page_png(data: bytes, page: int) -> bytes`: 1-based; raises `PageOutOfRange`.

- [ ] **Step 1:** Write the tests.
  - `sniff` accepts jpg, png and pdf by content, and rejects a ZIP named `.jpg` and a docx.
  - `page_count` is 3 for a 3-page PDF, raises for a truncated PDF, and is 1 for a PNG.
  - `render_page_png` returns PNG bytes for page 2 of 3 and raises for page 4.
  - `MemoryStore` round-trips, and `get` of a missing name raises `ObjectMissing`.
  - `get_store` without a bucket raises 503.
  - Test PDFs are built in the test with PyMuPDF.
- [ ] **Step 2:** Run: `pytest tests/unit/test_storage.py tests/unit/test_ocr_files.py`. Expected: FAIL (import errors).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same tests plus `ruff check .`. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] object storage, file sniffing and PDF pages`

### Task 2: Tables, migration 0009 and seed templates

**Files:**
- Create:
  - `app/models/document.py`: `File`, `OcrJob`, `OcrRawResult`, `ResultVersion`, `Export`;
  - `app/models/template.py`: `DocumentTemplate`, `DocumentTemplateVersion`, `TemplateMapping`;
  - `app/models/ocr_engine.py`: `OcrEngineHealth`;
  - `app/ocr/states.py`;
  - `alembic/versions/0009_ocr_scan_flow.py`;
  - `app/ocr/seed/{tax_invoice,billing_note}.json` (copied from `temp/main-api/services/api/templates_seed/`).
- Modify: `app/models/__init__.py`, `scripts/db-roles.sh` (grants for the new tables).
- Test: `tests/integration/test_ocr_schema.py`.

**Interfaces (produces):**
- Model names and columns as in main, with T1–T9 applied. Columns beyond main:
  - `files.tenant_id`, `ocr_jobs.tenant_id` (bigint FK);
  - `ocr_jobs.reservation_id` (FK `quota_reservations`, nullable);
  - `ocr_jobs.engine` (text, null until run);
  - `ocr_jobs.confirmed_at`, `confirmed_by_user_id`, `confirmed_version_id`;
  - `ocr_raw_results.engine`;
  - `files.expires_at` (upload session TTL).
- Unique constraints:
  - `UNIQUE (tenant_id, idempotency_key)` on `ocr_jobs` (A8);
  - `UNIQUE (job_id) WHERE is_current` on `result_versions`.
- `ocr_engine_health (engine text pk, consecutive_failures int, switched_at timestamptz null, last_probe_at timestamptz null)`: shared switching state (FR-OCR-021).
- `seed_templates(conn)`, inside the migration: inserts the two templates and one published version each. It is idempotent by `code` plus a sha256 of the canonical JSON; the same content adds no version.

- [ ] **Step 1:** Write the tests.
  - `test_upgrade_creates_tables_and_seed`:
    - two templates and two published versions exist;
    - running `seed_templates` again changes nothing.
  - `test_raw_result_is_immutable_for_app_role`: as `saiflow_v3_app`, UPDATE and DELETE on `ocr_raw_results` raise; INSERT and SELECT work.
  - `test_status_check_rejects_unknown`.
  - `test_one_current_version_per_job`.
  - `test_idempotency_key_unique_per_tenant_only`: the same key in two tenants is allowed.
  - `test_tenant_scoped_tables_include_files_jobs`: `claim_service.tenant_scoped_tables()` contains `files` and `ocr_jobs`.
  - `alembic downgrade -1` then `upgrade head` round-trips.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the models, migration and grants.
- [ ] **Step 4:** Run `pytest tests/integration/test_ocr_schema.py` and the whole backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] document, job, result, template and export tables; seed templates`

### Task 3: Uploads, pending records, original and page preview (documents spec)

**Files:**
- Create: `app/services/upload_service.py`, `app/routers/uploads.py`, `app/schemas/document.py`.
- Modify: `app/main.py` (router).
- Test: `tests/integration/test_uploads.py`.

**Interfaces (produces):**
- `POST /api/v1/uploads {file_name}` → `UploadOut {id, status:"UPLOADING", expires_at}`.
- `PUT /api/v1/uploads/{id}/content`: raw body, ≤ 20 MB, else 400 `file_too_large`. It sniffs the bytes and stores them under `originals/...`; status becomes `UPLOADED`.
- `POST /api/v1/uploads/{id}/complete`:
  - sniffs, counts pages and checks the limits;
  - sets `READY` with `page_count`, `sha256`, `mime_type`, `size_bytes`;
  - on a rejection, deletes the object and sets `REJECTED` with `reject_reason`;
  - repeating it answers the current state.
- `GET /api/v1/files/pending`: the caller's READY files in the current tenant with no job, newest first.
- `DELETE /api/v1/files/{id}`: creator only; locks the file row (`FOR UPDATE`, shared with job creation); 409 `file_in_use` if a job exists.
- `GET /api/v1/files/{id}/content`.
- `GET /api/v1/files/{id}/pages/{n}/preview`: images return themselves; a PDF page is rendered and cached under `previews/...`.
- `file_access(db, ctx, file_id) -> File`: visible when the caller uploaded it, or when its job is visible (`submitter_scope`); otherwise 404.

- [ ] **Step 1:** Write the tests (FR-UPLOAD-003/004/005/010/011/013, Review Focus 3).
  - `test_accepts_jpg_png_pdf`: AC-003-01, pages 1/1/3.
  - `test_rejects_disguised_and_docx`: AC-003-02, with no object left.
  - `test_too_large_and_too_many_pages`: AC-003-03; 21 MB → `file_too_large`; 51 pages → `too_many_pages`.
  - `test_batch_failure_isolated`: AC-005-01; three uploads, the second unsupported; the first and third are READY and pending, the second leaves no record.
  - `test_truncated_pdf_is_corrupt`.
  - `test_pdf_bomb_pages_rejected_without_render`: 10,000 pages → `too_many_pages`.
  - `test_complete_twice_returns_state`: AC-010-01.
  - `test_unfinished_upload_not_pending_and_expires`: AC-005-02.
  - `test_pending_per_tenant_and_delete`: AC-013-01.
  - `test_delete_with_job_is_409`: AC-013-02.
  - `test_other_user_gets_404`: AC-011-01.
  - `test_pdf_page_preview_and_out_of_range`: AC-011-02.
  - `test_guest_can_upload`.
  - `test_member_without_upload_ocr_403`.
  - `test_no_bucket_503`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and the backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] uploads, pending records and original previews`

### Task 4: A-class modules with their tests (ADR-009 §1)

**Files:**
- Create, by moving from `temp/main-api/services/api/`:
  - `app/ocr/textin/{client,adapter,config,errors,field_extractor}.py`;
  - `app/ocr/templates/{schema,normalize,matcher,converter,llm}.py`;
  - `app/ocr/deepseek.py`.
  Imports are adjusted, configuration is passed in, and no defaults carry credentials.
- Test: `tests/unit/ocr/test_textin_*.py`, `test_templates_*.py`, `test_deepseek.py`. These are the parts of main's `test_document_templates.py`, `test_template_mapping.py` and `test_textin_retries.py` that exercise these modules only.

**Interfaces (produces):**
- TextIn:
  - `TextInClient(app_id: str, secret_code: SecretStr, base_url: str, timeout: float)`;
  - `run_extraction(client, *, filename, content, params) -> dict`, returning `{structured, page_count, table_count, field_count, missing_pages, duration_ms}`;
  - `params` always includes direction correction and edge cutting (FR-UPLOAD-006).
- LLM:
  - `LlmClient(base_url, model, api_key)`: base URL and model come from `ocr_settings_service.get(db)`;
  - `matcher.match(client, raw, candidates) -> MatchResult`;
  - `converter.convert(client, raw_text, template_name, groups) -> (structured, warnings, dropped_keys)`.
- Template normalisation:
  - `normalize.fill_structure(groups, structured)`;
  - `normalize.required_missing(groups, structured) -> list[str]`;
  - `normalize.primary_missing(groups, structured) -> list[str]`. If main has no primary-field helper, write it here: `required` plus `is_primary` per field.
- Errors: `TextInAPIError(code, http_status)`, `OutputInvalid`, `MappingError`.

- [ ] **Step 1:** Copy main's tests for these modules into the paths above and adapt the imports. Add four tests:
  - `test_llm_floats_stay_strings` (Review Focus 4);
  - `test_buddhist_year_converted`: `2569-11-06` → `2026-11-06`;
  - `test_extra_keys_dropped_with_warning`;
  - `test_primary_missing_detected`.
- [ ] **Step 2:** Run `pytest tests/unit/ocr`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Move the modules. Change only imports, configuration injection and Python 3.12 typing. Record any behaviour change as a ruling.
- [ ] **Step 4:** Run the tests. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] TextIn, template matcher/converter/normalize and LLM modules from main with their tests`

### Task 5: Google Vision adapter and engine switching (FR-OCR-021)

**Files:**
- Create: `app/ocr/vision.py`, `app/ocr/engines.py`.
- Test: `tests/unit/ocr/test_vision.py`, `tests/integration/test_engine_switching.py`.

**Interfaces (produces):**
- `VisionClient(api_key: SecretStr)`:
  - `annotate(content: bytes, kind) -> dict` uses `images:annotate` with DOCUMENT_TEXT_DETECTION for images, and `files:annotate` (synchronous, up to 5 pages per call, batched) for PDF;
  - returns the raw response.
- `VisionError(code, http_status)`.
- `classify(err) -> Literal["service","content"]`: service covers timeouts, transport errors, 408, 429, 5xx, TextIn `{408,429,458,459,30203,40306,-1}` and quota or balance errors (main `_is_retryable`); everything else is content.
- `async recognise(db, *, kind, content, filename, settings: OcrSettings, now) -> EngineResult`, returning `{engine, raw, structured | None, page_count, missing_pages}`:
  - picks the engine: the primary unless `ocr_engine_health[primary].switched_at` is set, the probe interval has not passed, and a backup exists;
  - on each engine, retries service failures `retry_per_document` times with backoff `2**attempt` seconds (sleep injectable for tests), then moves to the backup;
  - updates `consecutive_failures` and `switched_at` in its own short transactions;
  - a success on the primary resets it;
  - content failures raise at once and do not count.
- An engine whose key is missing (`settings.key_status`) is skipped as unavailable. With none left it raises `EngineUnavailable` (→ `OCR_UNAVAILABLE`).

- [ ] **Step 1:** Write the tests, with fake engines injected through `recognise(..., engines={"textin": fake, "google_vision": fake})`:
  - `test_retries_then_backup`: AC-021-01, 4 TextIn calls then Vision, `engine == "google_vision"`;
  - `test_content_failure_no_retry`: AC-021-02;
  - `test_global_switch_and_probe_back`: AC-021-03, with an injected clock;
  - `test_no_backup_fails_unavailable`: AC-021-04;
  - `test_missing_key_engine_skipped`;
  - `test_vision_pdf_batches_pages`: 12 pages → 3 calls;
  - `test_classify_codes`: a table of codes → service or content.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] Google Vision and primary/backup engine switching`

### Task 6: OCR jobs API (FR-OCR-017, FR-VERIFY-017)

**Files:**
- Create: `app/services/job_service.py`, `app/routers/ocr_jobs.py`, `app/schemas/job.py`.
- Modify: `app/services/claim_service.py` (A9: on claim, set `created_by_user_id` for the moved `files`, `ocr_jobs` and `result_versions` rows where it is null).
- Test: `tests/integration/test_ocr_jobs.py`.

**Interfaces (produces):**
- `POST /api/v1/ocr/jobs {file_id, idempotency_key?}` → 201 `JobOut`, or 200 on a replay. It locks the file and reserves `page_count` pages through `metering_service.reserve(db, tenant_id, pages, reference=job.id)`; the order is reserve then audit (B-2c locking order).
- `GET /api/v1/ocr/jobs?stage=&q=&page=&page_size=` → `{items, total, page, page_size}`:
  - `page_size` ≤ 100;
  - `q` is matched literally with `like_literal`;
  - `stage` is computed in SQL, as in main's `_stage_condition`, with `CONFIRMED` replacing VERIFIED and COMPLETED.
- `GET /api/v1/ocr/jobs/{id}` → `JobOut {id, file_id, file_name, page_count, status, stage, error_code, engine, template_name, created_at, confirmed_at}`.
- `POST .../cancel`: QUEUED → CANCELLED with the reservation released; running → CANCEL_REQUESTED; terminal → 409 `job_terminal`.
- `POST .../rerun`: terminal only; a new job reserves again, with `parent_job_id` set.
- `DELETE .../results`: terminal only. It deletes versions, mappings and exports with their objects, and unlinks raw results; raw rows stay (T7).
- `job_access(db, ctx, job_id, *, for_update=False) -> OcrJob`.
- `release_once(db, job) -> None`: releases the reservation if it is not yet released, and clears `reservation_id`. Tasks 7 and 8 use it.

- [ ] **Step 1:** Write the tests:
  - `test_create_reserves_and_leaves_pending`: AC-017-01, 100 → 97;
  - `test_idempotent_replay`: AC-017-02;
  - `test_quota_exceeded_and_plan_expired`: AC-017-03, no job created;
  - `test_cancel_queued_releases`: AC-017-04;
  - `test_visibility_by_data_browse`: AC-017-05;
  - `test_list_stage_filter_and_literal_keyword`: AC-VERIFY-017-01/02;
  - `test_rerun_new_job_reserves_again`;
  - `test_delete_results_keeps_raw`;
  - `test_other_tenant_header_404` (Review Focus 5);
  - `test_guest_job_claimed_on_registration` (Review Focus 5): the guest uploads and creates a job; after registration the job is in the personal tenant with `created_by_user_id` set.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and the backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] OCR jobs: create with reservation, list by stage, cancel, rerun, delete results`

### Task 7: Recognition worker and recovery (FR-OCR-018, 022)

**Files:**
- Create: `app/ocr/worker.py`.
- Modify:
  - `app/cli.py`: `ocr-worker-loop`, `ocr-worker-run-once`;
  - `scripts/deploy/compose.yaml`: service `saiflow-be-ocr` with the same image, `command: ["python","-m","app.cli","ocr-worker-loop"]`, and the env for DB, GCS, the four OCR/LLM keys, `OCR_WORKER_ENABLED`, plus the credentials file mounted read-only;
  - `scripts/tests/compose-config.test.sh`.
- Test: `tests/integration/test_ocr_worker.py`.

**Interfaces (produces):**
- `async run_once(sessionmaker, store, settings, *, engines=None, sleep=asyncio.sleep, now=utcnow) -> bool`: true if a job was processed. It claims the oldest QUEUED job with a conditional UPDATE, then follows main's `worker.py` order:
  1. PREPROCESSING: checks the file is READY and the object exists;
  2. PROCESSING: `engines.recognise`;
  3. POSTPROCESSING: in one transaction under the job lock, writes an `OcrRawResult(engine, payload)`, a version 1 generic `ResultVersion` and the job counts and status;
  4. SUCCEEDED or PARTIAL_SUCCESS, then enqueues the auto mapping (Task 8 `start_auto_mapping`).
  - The cancel flag is checked before and after each engine call.
  - On failure or cancel: `release_once`.
  - The generic v1 `structured` is the TextIn structured output. With Vision, or when TextIn gives none, it is left null, and Task 8 builds it.
- `async recover(sessionmaker, now) -> None`: main's `_recover_stale_jobs` with a 10-minute threshold.
  - Stale PREPROCESSING → QUEUED.
  - PROCESSING and POSTPROCESSING → FAILED `VENDOR_UNCERTAIN`, with the reservation released.
  - CANCEL_REQUESTED → CANCELLED, with the reservation released.
- `async loop(...)`: recover once, then `run_once` every `ocr_poll_seconds`. `OCR_WORKER_ENABLED=false` idles.

- [ ] **Step 1:** Write the tests (fake engines, `MemoryStore`):
  - `test_success_writes_raw_and_v1`: AC-018-01; also tries an UPDATE of the raw row as the app role and expects an error;
  - `test_failure_releases_reservation_once`: AC-017-04;
  - `test_cancel_during_processing_wins`: AC-022-02;
  - `test_recover_each_state` (AC-022-01, Review Focus 1): parametrised over QUEUED, PREPROCESSING (stale), PROCESSING, POSTPROCESSING and CANCEL_REQUESTED. It asserts the final status and the tenant's remaining scans after recover plus `run_once`. Each reservation is released at most once.
  - `test_two_workers_claim_once`: two concurrent `run_once` calls; one job is processed exactly once;
  - `test_missing_object_fails_file_missing`;
  - `test_engine_unavailable_fails`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, the backend suite and `bash scripts/tests/compose-config.test.sh`. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] recognition worker, recovery and the saiflow-be-ocr compose service`

### Task 8: Template matching, conversion and the generic result (FR-TEMPLATE-006, FR-OCR-019, 020, 023)

**Files:**
- Create:
  - `app/services/mapping_service.py`: main's `doc_templates/service.py`, `repository.py` and `views.py` rules;
  - `app/ocr/mapping_worker.py`: main's `mapping_worker.py`; runs in the same `run_once` loop after recognition jobs;
  - `app/routers/templates.py`.
- Test: `tests/integration/test_template_mapping.py`.

**Interfaces (produces):**
- `start_auto_mapping(db, job, raw)`: a `TemplateMapping(source=AUTO, status=PENDING)`. The job's `pending_mapping_id` is set.
- The mapping worker step works as follows:
  - MATCHING calls `matcher.match` with the published versions;
  - no candidate, or no match:
    - the mapping becomes FAILED (`no_match`);
    - the job stays in VERIFYING with the generic v1 as current, or with v1 still to be built.
  - CONVERTING calls `converter.convert`, then `primary_missing`; a missing primary field → FAILED `primary_missing`;
  - READY: writes a new `ResultVersion(mapping_id)` as current, under the job lock;
  - it skips if the job was confirmed or its results deleted meanwhile (Review Focus 2).
- `GET /api/v1/ocr/jobs/{id}/template-options`: the published versions `[{template_version_id, template_id, name, code}]` plus `{"generic": true}`.
- `POST /api/v1/ocr/jobs/{id}/template {template_version_id}`:
  - a READY mapping for the same raw result and version is reused: it switches back with no LLM call, restoring that mapping's latest version (AC-020-03);
  - otherwise a new MANUAL mapping, 202;
  - more than 5 mappings → 409 `mapping_limit`;
  - a confirmed job → 409 `result_confirmed`;
  - a mapping in progress → 409 `mapping_in_progress`.
- `POST /api/v1/ocr/jobs/{id}/generic`: switches to the latest generic version. If v1 has no structured content, it is built first with the LLM: `deepseek.refine_json` for TextIn output, or one generic-structure prompt for a Vision raw result (A6).
- The LLM is unavailable (no key, or a failure): auto matching fails with `llm_unavailable`, and the job stays VERIFYING with the generic option.

- [ ] **Step 1:** Write the tests (fake `LlmClient`):
  - `test_seeded_options`: AC-TEMPLATE-006-01;
  - `test_auto_match_and_convert`: AC-019-01, AC-020-01, with dates and decimal strings;
  - `test_no_match_offers_options`: AC-019-02;
  - `test_wrong_template_primary_missing`: AC-020-02;
  - `test_switch_back_reuses_mapping`: AC-020-03, the LLM is called once;
  - `test_generic_result`: AC-023-01, for TextIn and for Vision raw;
  - `test_version_records_template_version`: AC-TEMPLATE-006-02;
  - `test_mapping_limit_5`;
  - `test_llm_unavailable_keeps_generic`;
  - `test_late_mapping_does_not_overwrite_confirmed` (Review Focus 2).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and the backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] template matching and conversion, template switching, generic result`

### Task 9: Results — versions, confirm gate, lock (FR-VERIFY-015, 009, 006)

**Files:**
- Create: `app/services/result_service.py`, `app/routers/results.py`.
- Test: `tests/integration/test_results.py`.

**Interfaces (produces):**
- `GET /api/v1/ocr/jobs/{id}/result` → `ResultOut`:
  - `{version, structured, template: {template_version_id, name, groups} | null, missing_required: [paths], mapping: {status, error} | null, confirmed: bool}`;
  - 409 `job_not_terminal` while recognising.
- `PATCH /api/v1/ocr/jobs/{id}/result {expected_version: int, structured?: object, confirm?: bool}`:
  - under the job lock, follows main's `routes/results.py` without the page-cell path (T9);
  - `fill_structure` runs for template results;
  - a new version is written only if the content changed;
  - `confirm` checks, in order: registered (401 guest / 403 `registration_required`), then the subscription (402 `plan_expired`, via `subscription_service`'s active check), then `required_missing` (422), then sets `confirmed_*`;
  - when confirm fails, the draft part is also not written (AC-009-01). AC-009-03 saves the draft with a separate request first; the mini app does that.
- Permissions: own job → `VERIFY_OWN`; others' → `VERIFY_OTHERS`.
- A confirmed job → 409 `result_confirmed` for PATCH and for template switching.

- [ ] **Step 1:** Write the tests:
  - `test_save_creates_new_version_keeps_old`: AC-015-01;
  - `test_conflict_409`: AC-015-02;
  - `test_rows_add_delete`: AC-015-03;
  - `test_permissions_own_vs_others`: AC-015-04;
  - `test_confirm_required_missing_422_writes_nothing`: AC-009-01;
  - `test_guest_confirm_401_draft_ok`: AC-009-02;
  - `test_plan_expired_confirm_402_draft_ok`: AC-009-03;
  - `test_confirm_ok_records_and_audits`: AC-009-04;
  - `test_confirmed_locked`: AC-006-01;
  - `test_concurrent_save_confirm_switch` (Review Focus 2): `asyncio.gather` of a save, a confirm and a template switch on one job. Exactly one current version, and an outcome consistent with some serial order.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and the backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] result versions, confirm gate and lock`

### Task 10: XLSX export and download (FR-ENTRY-015)

**Files:**
- Create: `app/ocr/xlsx.py`, `app/services/export_service.py`, `app/routers/exports.py`.
- Test: `tests/unit/ocr/test_xlsx.py`, `tests/integration/test_exports.py`.

**Interfaces (produces):**
- `build_xlsx(structured, template: (name, groups) | None, language: Literal["en","th","zh"], template_ref: (template_id, version) | None) -> bytes`:
  - one sheet;
  - header groups as `label | value` rows, with a blank row between groups;
  - then each table with its column headers and rows;
  - every cell has `data_type="s"`;
  - a hidden cell `A1000`, or a defined name `saiflow_template`, holds `template:<id>:v<version>` or `generic`;
  - follows main's `_build_xlsx_structured` and keeps its tests.
- `POST /api/v1/ocr/jobs/{id}/exports` → `ExportOut {id, expires_at}`:
  - only a confirmed job, and it exports the confirmed version; otherwise 409 `result_not_confirmed`;
  - the same version with a live export reuses it;
  - stored under `exports/<id>.xlsx`, 24 h.
- `GET /api/v1/exports/{id}/download`: session plus job access; expired → 404.
- `POST /api/v1/exports/{id}/ticket` → `{url}`: an HMAC ticket of (export_id, user_id, session_id, exp = now + 60 s) with a dedicated `download_ticket_secret` setting (required when exports are used; no default). It does not reuse the session secret.
- `GET /api/v1/export-downloads/{ticket}`: re-checks the session row, the user, job access and the export; any failure → 404.

- [ ] **Step 1:** Write the tests:
  - `test_xlsx_layout_strings_and_hidden_ref`: AC-015-01; `"007123"` stays text, labels are Thai, the ref is hidden;
  - `test_generic_xlsx_order`;
  - `test_unconfirmed_409`: AC-015-02;
  - `test_ticket_60s`: AC-015-03, with an injected clock;
  - `test_other_user_and_session_404`: AC-015-04;
  - `test_reuse_live_export`;
  - `test_member_without_export_403`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and the backend suite; regenerate the API client (`pnpm --filter @saiflow/api-client generate`, contract check). Expected: pass.
- [ ] **Step 5: Commit** `[ocr-scan-flow] XLSX export, download and download tickets`

### Task 11: Mini app — home scan entry, uploads, pending and start (FR-SYS-056, 057, 058)

**Files** (`apps/line-mini/src`):
- Create:
  - `features/scan/{upload.ts, ScanEntry.tsx, PendingList.tsx, ConfirmPage.tsx, jobs.ts}`;
  - `components/OriginalPreview/index.tsx`: page images from `/files/{id}/pages/{n}/preview` with zoom, following main's `ImageViewer.vue` and `OriginalPreview.vue`.
- Modify: `pages/HomePage.tsx` (replace the coming-soon scan card), `App.tsx` (routes `/scan/confirm`), i18n.
- Test: `features/scan/scan.test.tsx`.

**Interfaces (produces):**
- `uploadFile(file: File, onProgress) -> Promise<FileOut>`: the three steps. On any failure it deletes the half-created upload, as in main's `ScanHomePage.vue`.
- `useCreateJob()`: POSTs with an idempotency key kept per file in `sessionStorage` until success (AC-058-03).
- On 402 `quota_exceeded` it shows `err.quota_exceeded` with the remaining count. On `plan_expired` it routes to the pending plan application, if there is one, or to `/plans`.
- Query keys: `["files","pending",tenantId]`, `["jobs",tenantId,stage]`.

- [ ] **Step 1:** Write the tests:
  - `home shows the scan entry and pending files` (AC-056-05; AC-056-01..04 stay covered by the existing `reportTab` and `shell` tests);
  - `three files, one too large: two pending, one error` (AC-057-01);
  - `member without upload_ocr sees no scan entry` (AC-057-02);
  - `start creates jobs in order and clears pending` (AC-058-01);
  - `quota exceeded shows remaining` (AC-058-02);
  - `retry after network loss sends the same key once` (AC-058-03);
  - `delete pending after confirm`.
- [ ] **Step 2–4:** RED; implement; GREEN (`pnpm --filter @saiflow/line-mini test`, lint, build).
- [ ] **Step 5: Commit** `[ocr-scan-flow] mini app: scan entry, uploads, pending and start`

### Task 12: Mini app — progress, result page, template switch (FR-SYS-059, 105)

**Files:**
- Create:
  - `features/scan/ProcessingPage.tsx`;
  - `features/scan/ResultPage.tsx`;
  - `features/scan/StructuredEditor.tsx`: main's `StructuredDataView.vue` and `structured.ts` (decimal-string helpers);
  - `features/scan/TemplatePicker.tsx`.
- Routes: `/scan/jobs/:id/progress`, `/scan/jobs/:id/result`.
- Test: `features/scan/result.test.tsx`.

**Interfaces:**
- The progress page polls `GET /ocr/jobs/{id}` every 2 s:
  - goes to the result page at VERIFYING;
  - shows the error and Rerun on OCR_FAILED;
  - goes to the result page after 90 s in TEMPLATE_MATCHING (fake timers in tests).
- The result page uses `GET/PATCH .../result`:
  - field labels come from the template `groups` in the current language, falling back to the default name;
  - required fields that are empty are marked;
  - Save draft PATCHes `{expected_version, structured}`;
  - on 409 `version_conflict` it shows `scan.conflict` and refetches.
- The template picker uses `template-options`, `POST .../template` and `POST .../generic`. It saves the draft before switching (AC-105-02).

- [ ] **Step 1:** Write the tests:
  - `progress steps then result` (AC-059-01);
  - `failure shows reason and rerun` (AC-059-02);
  - `labels in Chinese, decimal kept, required marked` (AC-105-01);
  - `switch to generic saves the draft first` (AC-105-02);
  - `conflict reloads latest` (AC-105-03);
  - `cancel while processing after confirm`.
- [ ] **Step 2–4:** RED; implement; GREEN.
- [ ] **Step 5: Commit** `[ocr-scan-flow] mini app: progress, result editing and template switching`

### Task 13: Mini app — confirm, final result and export, history (FR-SYS-106, 107, 108)

**Files:**
- Create: `features/scan/confirm.ts`, `features/scan/FinalResultPage.tsx`, `pages/HistoryPage.tsx` (replacing the placeholder), `features/scan/download.ts`.
- Route: `/scan/jobs/:id/final`.
- Test: `features/scan/final.test.tsx`, `pages/history.test.tsx`.

**Interfaces:**
- Confirm (`confirm.ts`):
  - saves the draft, then PATCHes `confirm: true`;
  - a guest uses the existing login intent with `returnTo` the result page, and the draft is already saved (AC-106-01);
  - on 402, routes as in Task 11;
  - on 422, marks the fields and scrolls to the first one (AC-106-02).
- Download (`download.ts`): in LINE (`liff.isInClient()`), POSTs the ticket and opens it with `liff.openWindow({url, external: true})`; otherwise uses an `<a download>` on `/exports/{id}/download`. An expired export → create it again.
- History:
  - `useInfiniteQuery` with `page_size=20`;
  - stage tabs: all, recognising, failed, to verify, confirmed;
  - the row target follows the stage (AC-108-01);
  - it resets when the tenant changes.

- [ ] **Step 1:** Write the tests:
  - `guest confirm after login keeps the edit` (AC-106-01);
  - `missing required scrolls and marks` (AC-106-02);
  - `export in LINE opens a ticket externally` (AC-107-01);
  - `no export permission hides button` (AC-107-02);
  - `history filter and open` (AC-108-01);
  - `history loads 45 in pages` (AC-108-02);
  - `history resets on tenant switch`.
- [ ] **Step 2–4:** RED; implement; GREEN.
- [ ] **Step 5: Commit** `[ocr-scan-flow] mini app: confirm, final result with XLSX export, history`

### Task 14: Deployment notes and doc sync

**Files:**
- `docs/deployment/README.md`, new §2.10 "Originals bucket and OCR worker":
  - create a private bucket `saiflow-docs-<env>` (uniform access, no public access);
  - create a service account with Storage Object Admin on that bucket only, and its key at `/opt/saiflow/gcs-sa.json` (600, owner deploy);
  - `.env`: `GCS_BUCKET`, `GCS_CREDENTIALS_FILE=/run/secrets/gcs-sa.json`, `DOWNLOAD_TICKET_SECRET` (`openssl rand -hex 32`), the four OCR/LLM keys;
  - the `saiflow-be-ocr` service: logs, `OCR_WORKER_ENABLED`, `ocr-worker-run-once`;
  - §4: migration 0009 rollback notes.
- Docs:
  - PRD §3.2 and §4.2: the generic result moves into V1.0 (D5); §4.9 is unchanged;
  - `Data-Model.md`: the new entities and `ocr_engine_health`;
  - `Architecture.md`: the OCR worker service and the GCS originals bucket;
  - `Requirements-Index.md`: rows for the migrated and new FR IDs → the new specs;
  - EPIC-01/02/03/04: mark the migrated requirements;
  - ADR-006 §7: B-3 is `ocr-scan-flow` with its scope, and B-4's scope shrinks to review, Confirm all and official data;
  - version history lines.
- [ ] **Step 1:** Edit. Run `openspec validate ocr-scan-flow`, `bash scripts/tests/*.test.sh`, actionlint and shellcheck. Expected: pass.
- [ ] **Step 2: Commit** `[ocr-scan-flow] deployment notes and doc sync`

### Task 15: Verification

- [ ] **Step 1:** Run the whole backend suite (pytest, ruff), `pnpm -r test`, `pnpm -r lint`, `pnpm -r build` and the contract check. Expected: all green.
- [ ] **Step 2:** Final whole-branch review (Opus) with this plan's Review Focus. Then one fix pass for Critical and Important findings, each RED→GREEN.
- [ ] **Step 3:** Push; CI must be green. Before "确认部署", list the owner's one-time settings: the bucket, the service account key, `DOWNLOAD_TICKET_SECRET`, and the TextIn, Google Vision and LLM keys.
- [ ] **Step 4:** After deployment the owner tests on a phone in LINE:
  - upload 1 image and 1 PDF;
  - a Tax Invoice that matches automatically;
  - a document that does not match → generic result;
  - edit and save;
  - confirm as a guest → register;
  - export and download XLSX;
  - history filters;
  - cancel.
  Then write `verification.md` and archive (specs documents, recognition, results, exports new; line-mini modified).
