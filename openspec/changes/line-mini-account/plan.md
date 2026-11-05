# line-mini-account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/line-mini` from a health-check shell into the LINE mini app for accounts, tenants, organizations, plans (with prices), usage and notifications. Add plan prices and a customer plan catalog to the backend. Sync the docs.

**Architecture:**
- **Backend:** one small slice: `plans` gains `monthly_price` / `yearly_price`, plus `GET /api/v1/billing/plans` for any customer session. Everything else the app calls already exists.
- **Frontend:** React 18 + Ant Design Mobile.
  - `react-router-dom` hash routes (LIFF keeps the query string for its own use).
  - zustand stores for session, current tenant, language and the logout lock.
  - React Query for server data; every request goes through `@saiflow/api-client` with two middlewares (CSRF header, `X-Tenant-Id`).
  - A thin `liff` wrapper is the only place that touches `@line/liff`, so tests replace it.
  - The UI strings are three typed dictionaries (`en`, `th`, `zh`) with one `t()`.

**Tech Stack:**
- Backend: FastAPI, SQLAlchemy async, Alembic, pytest.
- Frontend: React 18, antd-mobile 5, react-router-dom 7, zustand 5, @tanstack/react-query 5, @line/liff 2, Vitest + RTL.

**Spec:**
- `openspec/changes/line-mini-account/specs/line-mini/spec.md` (FR-SYS-040–044, FR-SYS-004, FR-SYS-046–056).
- `specs/billing/spec.md` (modified FR-SYS-030).
- `proposal.md` (decisions D1–D8, assumptions A1–A12).

## Global Constraints

- **Language:**
  - Default `en`. Others are `th` and `zh`.
  - The choice is stored in `localStorage["saiflow.lang"]` and never follows the device language.
  - Every visible string comes from `src/i18n/{en,th,zh}.ts`; no literal text in components (NFR-I18N-003).
- **Time:** every date and time is shown in Bangkok time (UTC+7), `YYYY-MM-DD HH:mm` or `YYYY-MM-DD` (A7).
- **Money:** prices are THB with thousands separators (`5,990`), at most two decimals (A12). A null price shows `t("plans.contactUs")`.
- **Storage:**
  - `localStorage`:
    - `saiflow.lang`;
    - `saiflow.tenant` (current tenant id);
    - `saiflow.logout-pending` ("1").
  - `sessionStorage`:
    - `saiflow.auth-intent` (`{returnTo: string}`);
    - `saiflow.invite` (invitation token).
  - Nothing else is persisted. Never store LINE tokens, cookies or the CSRF value.
- **Requests:**
  - Same-origin `/api/v1/...` with cookies.
  - Unsafe methods carry `X-Requested-With: SaiFlow`.
  - Tenant-scoped calls carry `X-Tenant-Id: <current tenant>`, omitted for the personal or guest tenant.
- **Errors:**
  - The backend body is `{code, message_key, fields?, details?}`. Show `t("err." + code)`, falling back to `t("err.unknown")`.
  - `fields` map to form fields.
  - 401 → guest re-entry (FR-SYS-055).
- **Permissions:** the codes are exactly `upload_ocr verify_own verify_others review_l1 review_l2 export data_browse member_manage role_manage plan_apply verification_apply template_manage report_view`. The owner has all of them. Hide what the user cannot do (A8).
- **Report tab (D7):** show it when the current tenant is `organization`, `usage.active` is true, `usage.plan.code` is in `starter|intermediate|advance`, and the user is owner or holds `report_view`.
- **Timeouts:**
  - LIFF init: 20 s.
  - Logout request: 10 s.
  - Email-code resend: 60 s countdown after a successful send.
- **Brand:**
  - The splash and page loaders are a React `BrandLoading` (SaiFlow "F" plus three dots, `prefers-reduced-motion` respected), rewritten after `legacy/apps/line-mini/src/components/BrandLoading.vue`.
  - `alibaba-logo.png` is copied from `legacy/apps/line-mini/src/assets` (D8).
- **LIFF ID:** `VITE_LIFF_ID`, a public build-time value. The deploy workflow passes the GitHub variable `LIFF_ID` as a build-arg for `line-mini` only.
- **Commits:** start with `[line-mini-account]`.

## Review Focus

1. **The LIFF browser is already "logged in" inside the LINE app:** the user must still be a guest until they tap Login (AC-040-03). This also holds when an earlier `saiflow.auth-intent` exists from an aborted redirect older than this page load. Task 3 tests a stale intent with no matching redirect.
2. **A 401 arriving while the logout lock or a login redirect is in progress** must not trigger guest re-entry twice or unlock the shell. Task 3 tests 401 during the lock.
3. **A remembered tenant id that is no longer usable, including a malformed `saiflow.tenant` value** (`"abc"`, `"0"`), falls back to the personal tenant without a failing request loop. Task 5 tests both.
4. **Double taps on every submit button** (register, apply, invite, accept, mark all read) send one request. Task 2's `useSubmit` hook test, plus one page test per form.
5. **Price input on the admin side:** `599`, `599.5`, `"599.50"` are accepted; `-1`, `1.234`, `"abc"`, `true` and `1e12` are rejected with 400 and the field. Task 1 tests these.

---

### Task 1: Backend — plan prices and the customer catalog (FR-SYS-030 modified)

**Files:**
- Create: `services/api/alembic/versions/0007_plan_prices.py`
- Modify:
  - `app/models/billing.py` (`Plan.monthly_price`, `Plan.yearly_price`: `Numeric(12, 2)`, nullable);
  - `app/schemas/billing.py` (`PlanOut` gains `monthly_price: str | None`, `yearly_price: str | None`, as decimal strings like `"599.00"`; `PlanUpdateIn` gains the two fields);
  - `app/schemas/loose.py` (accept `float` as a kind: a JSON number that is not bool);
  - `app/services/plan_service.py`;
  - `app/routers/billing.py` (`GET /api/v1/billing/plans`, `operation_id="listPlans"`, `get_principal`, so a guest is allowed; anonymous → 401);
  - `tests/integration/db_fixtures.py` (re-seed with prices).
- Regenerate the contract.
- Test: `tests/integration/test_billing_prices.py`.

**Interfaces:**
- Migration seed: kinder `(NULL, 888)`, starter `(599, 5990)`, intermediate `(NULL, NULL)`, advance `(NULL, NULL)`. CHECK `>= 0` on both columns. The downgrade drops the columns.
- `update_plan(db, admin_id, code, changes)` accepts `monthly_price` / `yearly_price`.
  - The value is `int | float | str | None`. `None` means not set.
  - It is valid when `Decimal(str(v))` is finite, `>= 0`, has at most 2 decimal places and is `< 10**10`.
  - Otherwise 400 with that field.
- `PlanUpdateIn.monthly_price` and `yearly_price` are typed `str | int | float | None`.

- [ ] **Step 1: Write the failing tests.**
  - `test_seeded_prices` (030-01): the admin list shows `"888.00"` for Kinder yearly, `"599.00"` and `"5990.00"` for Starter, and nulls for the rest.
  - `test_admin_sets_and_clears_price` (030-06): `{"monthly_price": 1290}` on intermediate gives `"1290.00"`; then `null` gives `null`; the other plans are unchanged.
  - `test_price_validation` (030-07): `-1`, `1.234`, `"abc"`, `true` and `1e12` each give 400 `fields == ["monthly_price"]`; `599`, `599.5` and `"599.50"` give 200.
  - `test_customer_catalog` (030-08): guest and user sessions get 200 with 4 plans and price fields; no session gives 401.
  - `test_price_update_audited`: a `plan.update` audit row exists.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole backend suite and `alembic downgrade 0006 && alembic upgrade head`, then regenerate with `bash packages/api-client/scripts/generate.sh`. Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] plan prices and customer plan catalog (FR-SYS-030)`

### Task 2: Frontend foundation — API layer, errors, i18n, brand, test helpers

**Files** (all under `apps/line-mini`):
- `package.json`: add `react-router-dom@^7`, `zustand@^5`, `@line/liff@^2`.
- Create:
  - `src/services/api.ts`: `export const api: ApiClient`, built with `createApiClient({baseUrl: apiBaseUrl})` plus `api.use(csrfMiddleware, tenantMiddleware)`;
  - `src/services/errors.ts`;
  - `src/i18n/{index,en,th,zh}.ts`;
  - `src/stores/language.ts`;
  - `src/hooks/useSubmit.ts`;
  - `src/components/BrandLoading/index.tsx`, `src/components/ErrorText/index.tsx`;
  - `src/assets/alibaba-logo.png`;
  - `src/test/{mockApi,fakeLiff,render}.tsx`.
- Modify: `src/config.ts` (`liffId = import.meta.env.VITE_LIFF_ID ?? ""`), `.env.example` (`VITE_LIFF_ID=`).

**Interfaces:**
- `class ApiError extends Error { status: number; code: string; fields: string[]; details?: Record<string, unknown> }`.
- `async function call<T>(p: Promise<{data?: T; error?: unknown; response: Response}>): Promise<T>`: throws `ApiError`. A network failure becomes `code: "network"`.
- `function errorMessage(e: unknown, t: T): string`: `err.<code>`, else `err.unknown`.
- `type Lang = "en" | "th" | "zh"`.
- `useLanguage(): {lang: Lang; setLang(l: Lang): void}` (zustand, persisted in `saiflow.lang`, default `"en"`).
- `useT(): (key: MessageKey, vars?: Record<string, string | number>) => string`, where `MessageKey = keyof typeof en`.
- `th` and `zh` are typed `Record<MessageKey, string>`, so a missing key is a type error.
- `useSubmit<A extends unknown[], R>(fn: (...a: A) => Promise<R>): {run: (...a: A) => Promise<R | undefined>; pending: boolean}`: ignores calls while pending.
- `setTenantHeaderSource(get: () => number | null)`: registers what `tenantMiddleware` reads.
- `mockApi(routes: Record<string, (req: Request) => Response | Promise<Response>>)`: stubs global `fetch`. Keys look like `"GET /api/v1/me"`. It records every call in `.calls`.
- `fakeLiff({loggedIn?: boolean; idToken?: string; initDelayMs?: number; initError?: Error})`: implements the `Liff` interface from Task 3.
- `renderApp(ui, {route?})`: wraps in the QueryClient, router and stores.

- [ ] **Step 1: Write the failing tests.**
  - `i18n.test.ts` (004-03): `Object.keys(th)` and `Object.keys(zh)` equal `Object.keys(en)`; no value is empty; a vars placeholder `{n}` exists in all three when it exists in `en`.
  - `language.test.ts` (004-01/02): default `en`; `setLang("zh")` persists, and a re-created store reads `zh`.
  - `api.test.ts`:
    - a POST carries `X-Requested-With: SaiFlow`, a GET does not;
    - with tenant source 42 a call carries `X-Tenant-Id: 42`, with `null` none;
    - a 400 body `{code:"validation_error", fields:["name"]}` becomes `ApiError` with those fields;
    - a fetch rejection becomes `code "network"`.
  - `errors.test.ts` (055-03): an unknown code → `t("err.unknown")`.
  - `useSubmit.test.tsx` (055-01): two clicks while pending → the function is called once.
  - `BrandLoading.test.tsx`: renders its label; respects reduced motion (no animation class when `matchMedia('(prefers-reduced-motion: reduce)')` matches).
- [ ] **Step 2: Run** `pnpm --filter @saiflow/line-mini test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - The `en` dictionary covers the keys later tasks need. They add their own keys to all three files in the same commit.
  - The Thai text is a first draft for native-speaker review (D4).
- [ ] **Step 4: Run** test, lint and build. Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] foundation: api layer, errors, i18n (en default, th, zh), brand loading`

### Task 3: Session, boot, LINE login, logout (FR-SYS-040, 041, 043, 055-04)

**Files:** create `src/services/liff.ts`, `src/stores/session.ts`, `src/features/auth/{boot.ts,login.ts,logout.ts}`, `src/pages/SplashPage`, `src/pages/LockedPage`; modify `src/App.tsx`.

**Interfaces:**
- `interface Liff { init(): Promise<void>; isLoggedIn(): boolean; login(redirectUri: string): void; getIDToken(): string | null; logout(): void; isInClient(): boolean }`.
  - `realLiff(liffId)` wraps `@line/liff`.
  - `initWithTimeout(liff, ms = 20000)` rejects with `"liff_timeout"`.
- `useSession`: `{me: MeResponse | null; tenants: UsableTenant[]; status: "booting" | "ready" | "error" | "locked"; error?: string; refresh(): Promise<void>}`.
- `boot(deps): Promise<void>`:
  1. If `saiflow.logout-pending` is set, finish the logout first.
  2. `GET /me`. On 401, `POST /auth/guest`.
  3. Init LIFF with the timeout.
  4. If `saiflow.auth-intent` exists and LIFF is logged in, complete the login. Clear the intent either way.
  5. If the URL has `entry=register`, start the login.
- `startLogin(returnTo)`:
  - in the client with `isLoggedIn()` → `completeLogin()`;
  - else set `saiflow.auth-intent` and call `liff.login(location.href)`.
- `completeLogin()`: `POST /auth/line {id_token}`, then `refresh()`.
- `logout()`:
  1. Set the flag.
  2. `POST /auth/logout` with a 10 s abort.
  3. On success: clear the flag and `saiflow.tenant`, call `liff.logout()`, `POST /auth/guest`, navigate to `/`.
  4. On failure: `status = "locked"`.
- Global 401 handling (React Query `onError`): if not `locked` and not booting, call `POST /auth/guest`, reset to `/`, and show the toast `t("err.session_expired")`.

- [ ] **Step 1: Write the failing tests** (`boot.test.tsx`, `login.test.tsx`, `logout.test.tsx`).
  - `session cookie → no LIFF login call, My shows display_name` (040-01).
  - `401 on /me → POST /auth/guest → guest My` (040-02).
  - `LIFF logged in, no intent → no POST /auth/line` (040-03), plus a stale-intent case that clears without logging in.
  - `LIFF init 20 s → retry screen; retry restarts boot` (040-04, fake timers).
  - `guest creation fails with guest_too_many → localized message + retry`.
  - `tap Login in client → POST /auth/line with id_token → My shows name` (041-01).
  - `entry=register → login starts without a tap; unregistered → registration dialog opens` (041-02; the dialog itself comes in Task 5, so assert the `open` state flag).
  - `login API 500 → still guest, retry shown` (041-03).
  - `logout confirm → POST /auth/logout → guest home` (043-01).
  - `cancel → still logged in` (043-02).
  - `network error → locked page; retry succeeds → guest home; reload with flag set → logout finished first` (043-03).
  - `401 during the locked state does not create a guest or unlock`.
  - `401 on any later call → guest home + toast` (055-04).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test and lint. Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] boot, LINE login, logout lock, session expiry`

### Task 4: Shell, navigation, home, My page, language switch (FR-SYS-056, FR-SYS-004)

**Files:** create `src/routes.tsx`, `src/components/TabBar`, and pages `HomePage`, `HistoryPage`, `ReportPage`, `MyPage`, `ComingSoon`; create `src/features/billing/UsageCard`; create `src/features/tenants/useCurrentTenant.ts` (stub returning the personal tenant until Task 5).

**Interfaces:**
- Routes:
  - `/`, `/history`, `/report`, `/my`;
  - `/profile`, `/orgs/apply`, `/org`, `/org/roles`, `/org/verification`;
  - `/plans`, `/notifications`, `/invite`.
- `showReportTab(tenant, usage, perms): boolean`: the rule from Global Constraints.
- `UsageCard`: shows the plan name, period end (Bangkok), `remaining / quota`, free remaining, and the free-quota expiry (organization) or "paused" (personal).

- [ ] **Step 1: Write the failing tests.**
  - `showReportTab` table (056-01..04):
    - personal → false;
    - organization, active starter, owner → true;
    - organization, active starter, member with `report_view` → true;
    - member without it → false;
    - expired → false;
    - guest → false.
  - `TabBar renders 3 or 4 tabs in order; Report shows ComingSoon`.
  - `HomePage shows UsageCard with "4,880 / 5,000" and free 40 + expiry` (053-01).
  - `MyPage guest: identity, language, Login button; no notification entry` (054-04).
  - `language switch to zh re-renders tab labels immediately` (004-02).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] shell: tabs (home, history, report, my), usage card, language switch`

### Task 5: Registration, profile, email change, tenant switch (FR-SYS-042, 044, 046)

**Files:** create `src/features/auth/RegisterDialog`, `src/features/profile/{ProfilePage,ChangeEmailDialog,EmailCodeButton}`, `src/features/tenants/{TenantSwitcher,useCurrentTenant}`; modify `MyPage`.

**Interfaces:**
- `EmailCodeButton({email, onSent})`:
  - `POST /me/email-code {email}`;
  - 60 s countdown after success, reset when `email` changes;
  - a 429 response also shows the remaining seconds when the backend gives them, else 60.
- `useRequireRegistered(): () => boolean`: opens `RegisterDialog` and returns false when the user is unregistered.
- `useCurrentTenant(): {tenant: UsableTenant; setTenant(id: number): void}`.
  - It reads `saiflow.tenant`.
  - An invalid, malformed or no-longer-listed value → the personal tenant, plus a toast `t("tenant.gone")` when the value was a well-formed id.
  - It feeds `setTenantHeaderSource`.
- Prefill:
  - email from `me.email_suggestion`;
  - phone from `me.phone` if present (the backend has no separate LINE phone suggestion — ruling recorded at execution);
  - nickname from `me.display_name`.

- [ ] **Step 1: Write the failing tests.**
  - `register prefill + send code + submit → dialog closes, My shows email` (042-01).
  - `countdown 60→0 with fake timers` (042-02).
  - `wrong code → err.email_code_invalid, fields kept` (042-03).
  - `closed dialog reopens on "Create organization"` (042-04).
  - `double tap submit → one POST /me/registration`.
  - `profile save nickname + cleared phone → shows "Somchai" and not-set` (044-01).
  - `change email flow` (044-02).
  - `phone 400 fields:["phone"] → error under phone` (044-03, 055-02).
  - `switch to org → X-Tenant-Id on usage call; persists across remount` (046-01).
  - `stored org not in /me/tenants → personal + toast` (046-02).
  - `stored "abc" or "0" → personal, no toast, no extra request`.
  - `member without member_manage sees no invite or remove buttons` (046-03; asserted in Task 6's page, this task tests the `can(perm)` helper).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] registration, profile, email change, tenant switch`

### Task 6: Organizations (FR-SYS-047, 048, 049, 050, 051)

**Files:** create `src/features/orgs/{ApplyOrgPage,MyApplications,OrgPage,MembersList,InvitePanel,RolesPage,RoleForm,TransferDialog,VerificationPage}`; create `src/features/orgs/permissionLabels.ts` (13 codes → i18n keys).

**Interfaces:**
- `can(tenant: UsableTenant, perm: Permission): boolean`: owner → true.
- Invite sharing:
  - When `liff.isApiAvailable("shareTargetPicker")`, use `liff.shareTargetPicker([{type: "text", text: inviteUrl}])`.
  - Otherwise copy the link to the clipboard.
  - `inviteUrl = "https://liff.line.me/" + liffId + "?invite=" + token`.

- [ ] **Step 1: Write the failing tests.**
  - `apply success → "pending" listed` (047-01).
  - `empty name or phone → required errors, no request` (047-02).
  - `rejected with reason shown + form available` (047-03).
  - `approved org appears in switcher, is_owner` (047-04).
  - `OrgPage shows profile, members, "2 / 2"` (048-01).
  - `invite generates link, share called, pending invite listed and revocable` (048-02).
  - `at limit → invite disabled + reason` (048-03).
  - `remove (confirm) and role change` (048-04).
  - `edit profile hidden without member_manage` (046-03).
  - `new role with review_l1 + data_browse` (049-01).
  - `default role has no delete` (049-02).
  - `delete in-use role confirm text names 1 member` (049-03).
  - `no edit on own role or the owner's row`.
  - `transfer confirm → V owner, U default, Leave shown` (050-01).
  - `leave → personal tenant, org gone` (050-02).
  - `owner sees no Leave`.
  - `verification submit → pending, entry hidden` (051-01).
  - `rejected → reason + resubmit` (051-02).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] organizations: application, profile, members, invitations, roles, transfer, leave, verification`

### Task 7: Accept invitation (FR-SYS-052)

**Files:** create `src/features/invite/InvitePage`; modify `boot.ts` (a URL `invite=` param → `sessionStorage["saiflow.invite"]`, then navigate to `/invite`).

**Interfaces:**
- The invitation preview: the spec shows the organization name before joining. If the backend accepts only `POST /invitations/accept` (no preview endpoint), the page shows a generic "You are invited to an organization" and the name appears after joining. Record this as a ruling and add an open question for a preview endpoint.
- After a successful accept: `setTenant(new id)`, clear `saiflow.invite`, navigate to `/`.

- [ ] **Step 1: Write the failing tests.**
  - `registered user taps Join → accept called, current tenant = org` (052-01).
  - `guest taps Join → login → registration → back on /invite → accept` (052-02; uses `fakeLiff` and mockApi).
  - `invitation_gone / limit → message + Home button` (052-03).
  - `token never in localStorage`.
  - `double tap Join → one accept`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] accept invitation`

### Task 8: Plans, prices, applications (FR-SYS-053)

**Files:** create `src/features/billing/{PlansPage,PlanCard,ApplyConfirm,PendingBanner,planRules.ts,money.ts}`.

**Interfaces:**
- `formatTHB(v: string | null, t): string`: `"5990.00"` → `"5,990"`, `"599.50"` → `"599.50"`, `null` → `t("plans.contactUs")`.
- `applicableAction(plan, ctx): "renew" | "apply" | null`:
  - personal → Kinder only;
  - organization → ≥ Starter;
  - active → no lower tier, same tier is `"renew"`;
  - expired or none → any allowed tier is `"apply"`;
  - guest → null.
- Applications come from `GET /billing/applications`. A pending one drives `PendingBanner` and disables the others.

- [ ] **Step 1: Write the failing tests.**
  - `formatTHB` cases.
  - `applicableAction` table (053-03 included).
  - `PlansPage shows "888 / year", "599 / month", "5,990 / year", contact us` (053-05).
  - `apply → confirm dialog (plan + period) → success message → banner, others disabled` (053-02).
  - `guest sees offline note, no buttons; member without plan_apply sees no buttons` (053-04).
  - `double tap confirm → one POST`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] plans with prices, usage, renewal and upgrade applications`

### Task 9: Notification center (FR-SYS-054)

**Files:** create `src/features/notifications/{NotificationsPage,BellBadge,render.ts}`.

**Interfaces:**
- `renderNotification(n: NotificationOut, t, tenantName: string): {title: string; body: string}`. It covers:
  - `subscription_expiry` × d7/d3/d1/d0/after;
  - `usage` × low/month_end;
  - `free_quota_expiry` × d7/d3/d1/d0;
  - an unknown type falls back to `t("notif.generic")`.
- The list uses `useInfiniteQuery` on `GET /me/notifications?before=`.
- Tapping an item marks it read (`POST /me/notifications/read {ids:[id]}`). "Mark all" sends `{}`.
- The bell shows `unread_count` when > 0. It is hidden for guests.

- [ ] **Step 1: Write the failing tests.**
  - `render` covers every kind/stage in all three languages (no `undefined`, values substituted).
  - `badge "2"` (054-01).
  - `tap one → unread 1; mark all → badge gone` (054-02).
  - `switch to en → text changes` (054-03).
  - `guest: no bell` (054-04).
  - `infinite scroll requests before=<next_before>`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `[line-mini-account] notification center`

### Task 10: Build, deploy wiring, docs

**Files:**
- `.github/workflows/deploy.yml`: `--build-arg VITE_LIFF_ID="${{ vars.LIFF_ID }}"` for line-mini.
- `scripts/docker/frontend.Dockerfile`: `ARG VITE_LIFF_ID` / `ENV VITE_LIFF_ID=$VITE_LIFF_ID` before the build.
- `scripts/tests/workflow-config.test.sh`: check that the build-arg exists.
- `docs/deployment/README.md`: the `LIFF_ID` variable, the LIFF endpoint, and the OA `register` rich-menu URL `https://liff.line.me/<LIFF_ID>?entry=register` (OQ-B5a-2).
- Docs:
  - PRD §4.6 and §4.9: default language English, prices maintained by the admin, entry table;
  - `NFR.md` NFR-USAB-003;
  - `Architecture.md` (line-mini section);
  - `Data-Model.md` (`DM-Plan` prices);
  - EPIC-06: FR-SYS-004 marked migrated;
  - `Requirements-Index.md`: FR-SYS-004 and 040–044, 046–056 rows;
  - ADR-006 §7: the B-5 split rows B-5a–B-5d.
- Each changed doc gets a version-table row.

- [ ] **Step 1: Write the failing check:** the workflow-config test expects `VITE_LIFF_ID` for line-mini. Run it. Expected: FAIL.
- [ ] **Step 2: Implement** the build wiring and the docs.
- [ ] **Step 3: Run:**
  - the script tests and shellcheck;
  - actionlint;
  - `pnpm -r lint test build`;
  - `docker build -f scripts/docker/frontend.Dockerfile --build-arg APP=line-mini --build-arg VITE_LIFF_ID=test .` (if Docker is available);
  - `openspec validate line-mini-account`.

  Expected: pass.
- [ ] **Step 4: Commit** `[line-mini-account] deploy wiring (LIFF id) and doc sync`

### Task 11: Verification

- [ ] **Step 1:** Run the full backend suite, `pnpm -r test`, the script tests, and CI on the pushed branch. Expected: green.
- [ ] **Step 2:** Final whole-branch review (executing-plans), then the fix pass.
- [ ] **Step 3:** After the owner sets `LIFF_ID` and approves the deploy, deploy and ask the owner to check on a phone in LINE:
  - first open is a guest in English;
  - Login → registration → My shows the email;
  - switch language;
  - apply for an organization and approve it in admin (via API);
  - invite a second LINE account;
  - Plans shows prices;
  - notifications list.

  Record the results.
- [ ] **Step 4:** Write `verification.md` (each AC → test, the device checks, the review, the deferred minors), commit, then archive.
