# web-admin-console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform admin a usable web console over the existing admin API. Add four backend pieces:
- changing the admin's own password;
- querying the operation log;
- searching users;
- the OCR and LLM settings, with a reader for B-3.

**Architecture:**
- **Backend:** four small slices in `services/api`, in the existing admin router and service style. OCR/LLM settings live as rows in `system_settings` (JSON values); key status is read from environment settings.
- **Frontend:** `apps/web-admin` is React 18 + Ant Design 5 + react-router-dom 7 (browser routes under the admin host) + React Query.
  - The same small API layer as line-mini (CSRF middleware, `call()` → `ApiError`, a global 401 handler that sends the admin to `/login?next=`).
  - A zh/en dictionary pair with antd's `ConfigProvider` locale.
  - Shared bits are copied, not moved to `packages/ui`: moving them is a refactor outside this change — ruled at execution.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy async, Alembic, pytest.
- Frontend: React 18, antd 5, react-router-dom 7, @tanstack/react-query 5, Vitest + RTL.

**Spec:**
- `openspec/changes/web-admin-console/specs/web-admin/spec.md` (FR-SYS-060–073).
- `specs/ocr-settings/spec.md` (FR-SYS-005).
- `specs/identity/spec.md` (FR-SYS-019 and FR-SYS-003 modified, FR-SYS-080).
- `proposal.md` (D1–D5, A1–A10).

## Global Constraints

- **Language:** `zh` (default) and `en`; stored in `localStorage["saiflow.admin.lang"]`. Every visible string is in `src/i18n/{zh,en}.ts`; `en` is typed as `Record<MessageKey, string>` against `zh`.
- **Time and money:** times are shown in Bangkok, `YYYY-MM-DD HH:mm`; prices in THB with separators (A10).
- **Requests:**
  - same-origin `/api/v1/admin/...` with the admin cookie;
  - unsafe methods carry `X-Requested-With: SaiFlow`;
  - a 401 from any call except login → go to `/login?next=<current path>`; after login, `navigate(next)` when it starts with `/` and not `//`.
- **Errors:**
  - `t("err." + code)` else `t("err.unknown")`;
  - `fields` show under inputs;
  - `already_decided` (409) refreshes the list (AC-073-02).
- **OCR settings keys and values (FR-SYS-005, A1–A4):**

  | key | default | allowed |
  |---|---|---|
  | `ocr_primary_engine` | `"textin"` | `textin`, `google_vision` |
  | `ocr_backup_engine` | `"google_vision"` | `textin`, `google_vision`, `none`; ≠ primary |
  | `ocr_retry_per_document` | `3` | int 1–10 |
  | `ocr_switch_threshold` | `5` | int 1–100 |
  | `ocr_probe_interval_seconds` | `300` | int 30–86400 |
  | `llm_base_url` | `"https://api.deepseek.com"` | starts with `https://`, ≤ 500 chars |
  | `llm_model` | `"deepseek-flash"` | 1–100 chars, trimmed |

  Key environment variables: `TEXTIN_APP_ID` + `TEXTIN_SECRET_CODE` (both set = configured), `GOOGLE_VISION_API_KEY`, `LLM_API_KEY`.
- **Audit:**
  - changing the own password writes `admin.change_password`;
  - each changed OCR/LLM key writes `setting.update` (target `system_setting`, id = key);
  - reading the log or searching users writes nothing.
- **Commits:** start with `[web-admin-console]`.

## Review Focus

1. **LIKE wildcards in filters and search:** an operation-type prefix `org%`, or a user search `%`/`_`, must be matched literally, never as wildcards. Tasks 2 and 2b test this.
2. **Five wrong current passwords on the change-password form** lock the account like failed logins (FR-SYS-019). Login with the right password is then refused for 15 minutes. Task 1 tests this.
3. **A session that expires while a form is open:** the next action goes to `/login?next=...`. After login the admin lands back there. An external `next` (`//evil.com`, `https://…`) is ignored. Task 4 tests this.
4. **Two admins on the same application:** the second gets `already_decided`. The UI shows the message and refreshes. Task 5 tests this.
5. **Malformed log and user query parameters** (`limit=0`, `before=abc`, `since` not ISO with an offset, `q` of 1 non-digit character) give 400 with the field, not 422 or 500. Task 2 tests this.

---

### Task 1: Backend — admin changes their own password (FR-SYS-019 modified)

**Files:** `app/services/admin_service.py`, `app/routers/admin_auth.py`, `app/schemas/admin.py`. Test: `tests/integration/test_admin_password.py`.

**Interfaces:**
- `async def change_own_password(db, account: AdminAccount, session: AdminSession, current: str | None, new: str | None) -> None`.
  - Lock the account row. If `current` does not verify → `failed_attempts += 1`, lock for 15 minutes at 5 (the same rule as login, including the `admin.lock` audit), then 400 `fields: ["current_password"]`.
  - Then `_check_password(new)` → 400 `["new_password"]`; the same as current → 400 `["new_password"]`.
  - Save the hash, reset the counter, revoke every other session of the account (`revoked_at = now`, `id != session.id`), audit `admin.change_password`, commit.
- `POST /api/v1/admin/me/password`, `operation_id="adminChangePassword"`, body `ChangePasswordIn(LooseRequest){current_password: str|None, new_password: str|None}` → 204.

- [ ] **Step 1: Write the failing tests.**
  - `test_change_password_ok` (019-09):
    - a second login session is revoked → 401;
    - the current session still works;
    - the old password fails, the new one works;
    - an audit row exists.
  - `test_change_password_validation` (019-10): wrong current, 11 characters, and same as current → 400 with the right field; the password is unchanged.
  - `test_wrong_current_counts_and_locks`: 5 wrong current passwords → a login with the correct password gives 401 `admin_login_failed`.
  - `test_change_password_needs_admin_session`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the whole backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[web-admin-console] admin changes own password (FR-SYS-019)`

### Task 2: Backend — operation log query (FR-SYS-003) and user search (FR-SYS-080)

**Files:**
- Create: `app/services/admin_query_service.py`, `app/routers/admin_query.py`, `app/schemas/admin_query.py`.
- Modify: `app/main.py`.
- Test: `tests/integration/test_admin_audit_query.py`, `tests/integration/test_admin_user_search.py`.

**Interfaces:**
- `GET /api/v1/admin/audit-log`, `operation_id="adminListAuditLog"`. Query (all strings, parsed in the endpoint → 400 with the field):
  - `limit` 1–100, default 50;
  - `before` (id);
  - `since`, `until` (ISO-8601 with an offset);
  - `actor_type` in `user|guest|admin|system`;
  - `action_prefix` (≤ 64);
  - `target_type` (≤ 64), `target_id` (≤ 128).
  - Response: `AuditPageOut {items: [AuditEntryOut{id, occurred_at, actor_type, actor_id, action, target_type, target_id, result}], next_before: int|null}`, ordered `id DESC`.
  - `action_prefix` uses `LIKE :p ESCAPE '\'` with `%`, `_` and `\` escaped.
- `GET /api/v1/admin/users?q=&page=`, `operation_id="adminSearchUsers"`:
  - `q` trimmed. An all-digit `q` (≤ 19 digits) adds `users.id = q`. A `q` of ≥ 2 characters adds `email ILIKE %q% OR display_name ILIKE %q%`, with wildcards escaped. Otherwise 400 `["q"]`.
  - `page` ≥ 1, default 1; 50 per page.
  - Response: `UserPageOut {items: [AdminUserOut{user_id, display_name, email, phone, registered, registered_at, created_at, personal_tenant_id}], has_more: bool}`, ordered by `coalesce(registered_at, created_at) DESC, id DESC`.
  - No LINE id in the output.

- [ ] **Step 1: Write the failing tests.**
  - `test_audit_paging_newest_first` (003-07): 120 rows written through `audit_service.record` → page 1 has 50, page 2 has the next 50, no overlap.
  - `test_audit_filters`: prefix `org.` → only `org.*`; actor_type; target; since/until.
  - `test_audit_prefix_wildcards_literal`: prefix `%` → no rows; prefix `org_` does not match `orgX…`.
  - `test_audit_query_writes_nothing`.
  - `test_audit_bad_params_400`: `limit=0`, `before=abc`, `since=2026-01-01`, `actor_type=x` → 400 with the field.
  - `test_audit_admin_only` (003-08).
  - `test_search_by_email_and_name` (080-01): case-insensitive; no `line_user_id` key; guests excluded (they have no user row; assert the count).
  - `test_search_by_id` (080-02): `q=7`.
  - `test_search_too_short_and_wildcards` (080-03): `q=s` → 400; `q=%%` matches literally (no rows).
  - `test_search_admin_only`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the backend suite. Expected: pass.
- [ ] **Step 5: Commit** `[web-admin-console] admin operation log query and user search (FR-SYS-003, FR-SYS-080)`

### Task 3: Backend — OCR and LLM settings (FR-SYS-005)

**Files:**
- Create: `alembic/versions/0008_ocr_settings.py` (seeds the 7 keys), `app/services/ocr_settings_service.py`, `app/routers/admin_ocr.py`, `app/schemas/ocr.py`.
- Modify:
  - `app/config.py`: optional `textin_app_id`, `textin_secret_code`, `google_vision_api_key`, `llm_api_key`, all `SecretStr | None`;
  - `app/main.py`;
  - `tests/integration/db_fixtures.py`: re-seed;
  - `scripts/deploy/compose.yaml`: pass the four variables to `saiflow-be-api` as `${VAR:-}`;
  - `scripts/deploy/env.example`;
  - `scripts/tests/compose-config.test.sh`.
- Test: `tests/integration/test_ocr_settings.py`.

**Interfaces:**
- `@dataclass(frozen=True) class OcrSettings: primary_engine: str; backup_engine: str; retry_per_document: int; switch_threshold: int; probe_interval_seconds: int; llm_base_url: str; llm_model: str`.
- `async def get(db) -> OcrSettings`: **the reader for B-3**. A missing row falls back to the default.
- `async def update(db, admin_id, changes: dict[str, object]) -> OcrSettings`:
  - validate the whole result: each value, and backup ≠ primary unless `none`;
  - 400 lists every bad field;
  - write the changed keys, auditing each, then commit.
- `def key_status(settings: Settings) -> dict[str, bool]`: `{"textin": …, "google_vision": …, "llm": …}`.
- `GET /api/v1/admin/ocr-settings` → `OcrSettingsOut{primary_engine, backup_engine, retry_per_document, switch_threshold, probe_interval_seconds, llm_base_url, llm_model, keys: {textin, google_vision, llm}}`.
- `PATCH /api/v1/admin/ocr-settings` with `OcrSettingsIn(LooseRequest)`, all fields optional → `OcrSettingsOut`.

- [ ] **Step 1: Write the failing tests.**
  - `test_defaults_and_key_status` (005-01): settings with only the TextIn variables set; the response contains no secret value.
  - `test_patch_one_field` (005-02): retry 2; one audit row with target id `ocr_retry_per_document`.
  - `test_validation` (005-03), parametrized, each → 400 with the field:
    - primary = backup;
    - `"tesseract"`;
    - retry 0, 11, `"3"`, `true`;
    - `http://x`;
    - an empty model;
    - backup `none` with primary `google_vision` is accepted.
  - `test_reader_returns_current` (005-04): `ocr_settings_service.get(db)`.
  - `test_admin_only` (005-05).
  - `test_app_role_reads_settings`.
  - Shell check: `api receives TEXTIN_APP_ID`, `GOOGLE_VISION_API_KEY`, `LLM_API_KEY`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the backend suite, the script tests, `alembic downgrade 0007 && alembic upgrade head`, and the contract regeneration. Expected: pass.
- [ ] **Step 5: Commit** `[web-admin-console] OCR and LLM settings with a reader for recognition (FR-SYS-005)`

### Task 4: Frontend foundation — API, i18n, login, layout (FR-SYS-060 login/session, 062, 073 basics)

**Files** (`apps/web-admin`):
- Add `react-router-dom@^7` and `@testing-library/user-event@^14`.
- Create:
  - `src/services/{api,errors}.ts`;
  - `src/i18n/{index,zh,en}.ts`;
  - `src/stores/language.ts`;
  - `src/hooks/useSubmit.ts`;
  - `src/components/{FieldError,ErrorText,ConfirmButton}`;
  - `src/layout/AdminLayout.tsx`;
  - `src/pages/LoginPage.tsx`;
  - `src/auth/{session.ts,RequireAdmin.tsx}`;
  - `src/test/{setup additions,mockApi,render}`.
- Modify: `src/App.tsx`, `vite.config.ts` (test env base URL).

**Interfaces:**
- `useAdmin()`: React Query on `GET /admin/me`. On 401, `RequireAdmin` redirects to `/login?next=`.
- `safeNext(next: string | null): string`: `/` unless it starts with `/` and not `//`.
- `ConfirmButton({title, onConfirm, danger?})`: antd `Popconfirm` plus `useSubmit`. Every destructive action in Tasks 5–8 uses it.
- The menu: Home, Organization applications, Organizations, Verification, Plan applications, Plans, Settings, Users, Operation log, OCR & LLM, plus Change password and Logout in the header.
- The antd `ConfigProvider` locale follows the language.

- [ ] **Step 1: Write the failing tests.**
  - `i18n.test.ts` (062-02): zh and en have the same keys, placeholders and no empty values.
  - `language.test.ts` (062-01): default `zh`, and persistence.
  - `api.test.ts`: CSRF header; ApiError; network error.
  - `login.test.tsx`:
    - wrong password → `t("err.admin_login_failed")`, still on the login page (060-02);
    - success → home with the username;
    - logout → login page (060-01).
  - `session.test.tsx` (060-03):
    - a 401 on any page → `/login?next=/organizations`;
    - after login, back to `/organizations`;
    - `next=//evil.com` → `/`.
  - `useSubmit.test.tsx`.
  - `ConfirmButton.test.tsx`: confirm calls once on a double click (073-01).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** test, lint and build. Expected: pass.
- [ ] **Step 5: Commit** `[web-admin-console] admin console foundation: login, session, layout, zh/en`

### Task 5: Home counts and the three application queues (FR-SYS-060-04, 063, 065, 067)

**Files:** `src/pages/HomePage.tsx`, `src/pages/{OrgApplicationsPage,VerificationApplicationsPage,PlanApplicationsPage}.tsx`, `src/components/RejectDialog`.

**Interfaces:**
- The lists take a `status` from the URL (`?status=pending`, default `pending`) and show status tabs.
- `RejectDialog({onSubmit(reason)})`: the reason is required (client-side `required` error).
- Plan approval has optional start and end (antd `DatePicker` with time, sent as ISO with `+07:00`).
- Home counts are the lengths of the three pending lists.

- [ ] **Step 1: Write the failing tests.**
  - `home counts 2/1/0 and the link goes to pending org applications` (060-04).
  - `approve org application → leaves pending` (063-01).
  - `reject requires a reason` (063-02).
  - `verification approve and reject with reason` (065-01).
  - `plan application approve with empty dates` (067-01), checking the request body.
  - `reject with reason` (067-02).
  - `already_decided → message + list refetched` (073-02).
  - `double click approve → one POST` (073-01).
- [ ] **Step 2–4:** RED, implement, GREEN (test, lint, build).
- [ ] **Step 5: Commit** `[web-admin-console] home counts and application queues`

### Task 6: Organizations and tenant billing (FR-SYS-064, 066)

**Files:** `src/pages/OrganizationsPage.tsx`, `src/pages/OrganizationDetailPage.tsx`, `src/pages/TenantBillingPage.tsx` (`/tenants/:id/billing?kind=organization|personal`).

**Interfaces:**
- Search filters the loaded list by name, case-insensitive. The admin list returns all organizations; this is ruled acceptable at the current scale.
- The subscription form: plan, period and optional start/end. The client does not pre-validate plan rules; the backend 400 `fields` show under the inputs (066-02).

- [ ] **Step 1: Write the failing tests.**
  - `search "siam" shows only Siam Tools; detail shows status, verification, members` (064-01).
  - `disable then enable with confirmation` (064-02).
  - `empty name → field error` (064-03).
  - `set or unset verification with confirmation`.
  - `set Starter monthly with empty dates → history shows Starter` (066-01).
  - `personal tenant + Starter → error under plan` (066-02).
  - `reservations listed with split and released time` (066-03).
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `[web-admin-console] organizations and tenant subscriptions`

### Task 7: Plans, parameters, OCR and LLM page (FR-SYS-068, 069, 072)

**Files:** `src/pages/PlansPage.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/OcrSettingsPage.tsx`.

**Interfaces:**
- Plan edit sends only the changed fields. Prices are sent as strings (`"1290"`); empty means `null`. Kinder's member limit is shown read-only.
- Settings: three numbers, with a note that free-quota changes apply only to later grants.
- OCR: selects for the engines (backup includes "none"), numbers, URL and model. Key status shows as "已配置"/"未配置" tags, with the note that keys are changed in the server env file.

- [ ] **Step 1: Write the failing tests.**
  - `edit Intermediate price 1290 and quota 12000 with confirmation → PATCH body` (068-01).
  - `Kinder member limit read-only` (068-02).
  - `negative price / zero quota → field errors` (068-03).
  - `free quota org 200 saved, note shown` (069-01).
  - `member limit 0 → field error` (069-02).
  - `OCR defaults + key status; retry 2 saved` (072-01).
  - `primary = backup or http URL → field errors` (072-02).
  - `no secret value rendered`.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `[web-admin-console] plans, parameters, OCR and LLM settings pages`

### Task 8: Users, operation log, change password (FR-SYS-070, 071, 061)

**Files:** `src/pages/UsersPage.tsx`, `src/pages/AuditLogPage.tsx`, `src/pages/ChangePasswordPage.tsx`.

**Interfaces:**
- Users: a search box, with a client-side length check (< 2 characters and not all digits → hint, no request). The table links the personal tenant to `TenantBillingPage`.
- Log: filter form plus table; "Next page" uses `next_before`. Times are shown in Bangkok.
- Password: current, new and confirm; a mismatch or fewer than 12 characters is checked on the client. Server fields show under the inputs.

- [ ] **Step 1: Write the failing tests.**
  - `search somchai → row, link to personal billing` (070-01).
  - `1 char → hint, no request` (070-02).
  - `prefix org. filter → request has action_prefix=org.` (071-01).
  - `next page uses before=next_before, no overlap` (071-02).
  - `change password ok` (061-01).
  - `mismatch / 11 chars / wrong current → errors` (061-02).
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5: Commit** `[web-admin-console] user search, operation log, change own password`

### Task 9: Docs and deployment notes

**Files:**
- PRD §4.6 (OCR parameter defaults; admin console language zh/en) and §4.9 (the admin entry list).
- `NFR.md`: admin UI language note under NFR-USAB-003.
- `Architecture.md`: the web-admin row.
- `Data-Model.md`: the `DM-SystemSetting` OCR/LLM keys.
- EPIC-06: FR-SYS-005 marked migrated.
- `Requirements-Index.md`: FR-SYS-005, 060–073, 080.
- ADR-006 §7: B-5b row status.
- `docs/deployment/README.md`: the four new env variables, and admin password change from the console.
- Version rows in each.

- [ ] **Step 1:** Edit. **Step 2:** `openspec validate web-admin-console`; the index has 16 new or changed rows. **Step 3: Commit** `[web-admin-console] doc sync and deployment notes`

### Task 10: Verification

- [ ] **Step 1:** Run the full backend suite, `pnpm -r lint test build`, the script tests, and CI on push. Expected: green.
- [ ] **Step 2:** Final whole-branch review, then the fix pass.
- [ ] **Step 3:** After the owner approves the deploy: deploy, then the owner checks in a browser:
  - login and logout;
  - zh/en;
  - approve an org application;
  - set an org subscription;
  - edit a price;
  - search a user;
  - view the log;
  - view and save the OCR settings;
  - change their own password.

  Record the results.
- [ ] **Step 4:** Write `verification.md`, commit, then archive.
