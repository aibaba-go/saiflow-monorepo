# web-pc-account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/web-pc` from a health page into the enterprise web console: LINE web login, guidance for unregistered users, and the same account and organization management as the LINE mini app (FR-SYS-090–104). No backend change.

**Architecture:**
- `apps/web-pc` uses React 18 + Ant Design 5 + react-router-dom 7 (browser routes) + React Query 5 + zustand.
- The API layer is the line-mini one:
  - `call()` → `ApiError`;
  - CSRF header on unsafe methods;
  - `X-Tenant-Id` from the current tenant;
  - a global 401 handler.
  The difference: a 401 here goes to `/login?next=`. web-pc has no guest.
- LINE web login uses the authorization code flow. web-pc builds the LINE authorize URL with a random `state` kept in `sessionStorage`. LINE returns to `/login?code&state` (the same route as the login page), and web-pc posts `{code, redirect_uri}` to `POST /api/v1/auth/line` (FR-SYS-001, already implemented).
- Pure logic shared with line-mini is **copied**, not moved to a package, each file with a `ported from apps/line-mini/...` header:
  - error mapping;
  - permissions;
  - plan rules;
  - money format;
  - notification rendering;
  - permission labels;
  - the tenant choice and its reconcile step.

  Moving them would refactor a deployed app outside this change. If wrong, a later change extracts `packages/account-core`.
- The QR code is antd's built-in `QRCode`; copying uses `navigator.clipboard`. No new UI library.

**Tech Stack:** React 18, antd 5 (`QRCode`, `Layout`, `Menu`, `Popconfirm`), react-router-dom 7, @tanstack/react-query 5, zustand 5, dayjs, Vitest + React Testing Library + user-event.

**Spec:**
- `openspec/changes/web-pc-account/specs/web-pc/spec.md` (FR-SYS-090–104, 44 ACs);
- `proposal.md` (D1–D5, A1–A8).

Backend rules come from `openspec/specs/{identity,tenancy,billing,notifications}`; the shared page rules come from `openspec/specs/line-mini` (FR-SYS-046, 048, 049, 053).

## Global Constraints

- **Language:**
  - `en` (default), `th`, `zh`, stored in `localStorage["saiflow.pc.lang"]`;
  - every visible string lives in `src/i18n/{en,th,zh}.ts`; `th` and `zh` are typed `Record<MessageKey, string>` against `en`;
  - antd `ConfigProvider` locale follows the language, with `button={{ autoInsertSpace: false }}` (lesson from B-5b: antd spaces CJK button text and breaks accessible names).
- **Build-time public settings** (`src/config.ts`):
  - `liffId = import.meta.env.VITE_LIFF_ID ?? ""`;
  - `lineChannelId = import.meta.env.VITE_LINE_CHANNEL_ID ?? ""`;
  - `redirectUri = window.location.origin + "/login"` (A1).
- **LINE authorize URL:** `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=<lineChannelId>&redirect_uri=<encoded redirectUri>&state=<state>&scope=profile%20openid`.
- **Login state** (A2):
  - `sessionStorage["saiflow.pc.login"] = JSON.stringify({state, next, at})`;
  - `state` is 32 hex characters from `crypto.getRandomValues`;
  - it is valid for 10 minutes and removed on first read, whether it matched or not.
- **Links** (A3):
  - register: `https://liff.line.me/<liffId>?entry=register`;
  - invite: `https://liff.line.me/<liffId>?invite=<encodeURIComponent(token)>`.
- **Current tenant:**
  - stored in `localStorage["saiflow.pc.tenant"]` (organization id; absent = personal);
  - logout and session expiry clear it, together with all React Query data (A8).
- **`next`:** used only when it starts with `/` and not `//`, and is not `/login`; otherwise `/`.
- **Time and money:** Asia/Bangkok `YYYY-MM-DD HH:mm`; THB as `฿5,990` (A6).
- **Layout:** min width 1280 px; no mobile layout (A7).
- **Errors:**
  - text is `t("err." + code)` when the key exists, else `t("err.unknown")`;
  - `fields` show under the matching inputs;
  - `network` → `t("err.network")` with retry.
- **Commits:** start with `[web-pc-account]`.

## Review Focus

1. **The LINE callback is opened a second time** (Back button, reload, a bookmarked `/login?code=…`). The state was consumed on first use, so web-pc must not post the code again or loop. It shows the login page with "please log in again". Task 2 tests this.
2. **An outside `next`** (`//evil.com`, `https://evil.com`, `/login`) carried through the login state is ignored, and the user lands on `/`. Task 2 tests this.
3. **Another user logs in on the same browser** after a logout or expiry. The previous user's stored organization id must not be applied to the new user, and no cached page data from the previous user may show. Task 2 tests this.
4. **The current organization disappears mid-session** (removed or disabled), so an org endpoint answers 404. The page re-reads the tenants, falls back to the personal tenant with "you are no longer in this organization", and does not show a raw error. Task 4 tests this.
5. **Clipboard unavailable** (`navigator.clipboard` missing or rejecting). The invite link stays visible as selectable text with a "copy failed, copy it manually" hint, and the invitation is not lost. Task 4 tests this.

---

### Task 1: Foundation — API, errors, i18n, language, submit helpers, test kit (FR-SYS-093, 104 basics)

**Files** (`apps/web-pc`):
- `package.json`: add `react-router-dom@^7.18.5`, `zustand@^5.0.16`, `dayjs` (the version web-admin uses), and dev `@testing-library/user-event@^14.6.8`.
- Create:
  - `src/config.ts` (extend);
  - `src/services/{api,errors}.ts` (ported);
  - `src/i18n/{index,en,th,zh}.ts`;
  - `src/stores/language.ts`;
  - `src/hooks/useSubmit.ts`;
  - `src/components/{ErrorText,FieldError,ConfirmButton,ComingSoon}.tsx`;
  - `src/format.ts` (time, THB);
  - `src/test/{mockApi.ts,render.tsx,fixtures.ts}`, and an update to `src/test/setup.ts`.
- Tests: `src/i18n/i18n.test.ts`, `src/stores/language.test.ts`, `src/services/api.test.ts`, `src/components/ConfirmButton.test.tsx`.

**Interfaces (produces):**
- `api`, `call<T>(req, {own401?})`, `setUnauthenticatedHandler(fn)`, `setTenantHeaderSource(fn)`: same signatures as `apps/line-mini/src/services/api.ts`.
- `ApiError(status, code, fields, details?)` and `errorText(error, t): string`.
- `useT(): T` and `translate(lang, key, vars?)`; `type Lang = "en" | "th" | "zh"`; `useLanguage` with `{lang, setLang}`.
- `useSubmit(fn)` returns `{run, pending}` and ignores calls while pending.
- `ConfirmButton({label, title, onConfirm, danger?, disabled?, ...buttonProps})`: antd `Popconfirm`, OK button loading while `onConfirm` runs, and a second OK click while pending does nothing (AC-104-02).
- `fieldErrorText(error, field, t)` and `formLevel(error)` (error without a known field). These mirror web-admin `components/FieldError.tsx`.
- Test kit:
  - `mockApi(routes)` returns `{calls, count(route), bodies(route)}`, keyed `"METHOD /path"`;
  - `renderAt(path, {me?, tenants?})` renders `<App/>` in a `MemoryRouter`;
  - fixtures `USER`, `UNREGISTERED`, `PERSONAL`, `ORG` (id 5, "Siam Tools").
- `src/test/setup.ts` calls `configure({ asyncUtilTimeout: 5000 })` (lesson from B-5b).

- [ ] **Step 1: Write the failing tests.**
  - `i18n.test.ts` (093-03):
    - `en`, `th` and `zh` have the same keys;
    - no empty value;
    - the `{placeholders}` in each key are identical across languages.
  - `language.test.ts` (093-01, 093-02): the default is `en`; `setLang("th")` persists to `saiflow.pc.lang`; an unknown stored value falls back to `en`.
  - `api.test.ts`:
    - `X-Requested-With: SaiFlow` on POST, absent on GET;
    - `X-Tenant-Id` comes from the source;
    - a 401 calls the handler unless `own401`;
    - fetch rejecting gives `ApiError(0, "network")`;
    - an unknown code renders `t("err.unknown")` in the current language (104-04).
  - `ConfirmButton.test.tsx`: a double click on OK while pending calls `onConfirm` once (104-02).
- [ ] **Step 2: Run** `pnpm --filter @saiflow/web-pc test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - Port the line-mini `api.ts` and `errors.ts` unchanged.
  - Start the dictionaries from the line-mini keys that web-pc uses (`err.*`, `perm.*`, plan, usage, notification and org texts), plus the new keys of Tasks 2–5. Add keys as each task needs them; every task keeps the `i18n.test` green.
- [ ] **Step 4: Run** test, `pnpm --filter @saiflow/web-pc lint` and `build`. Expected: all pass.
- [ ] **Step 5: Commit** `[web-pc-account] foundation: API layer, en/th/zh, submit and confirm helpers`

### Task 2: LINE web login, session, register guidance, logout (FR-SYS-090, 091, 092)

**Files:**
- Create:
  - `src/auth/lineLogin.ts`;
  - `src/auth/session.ts`;
  - `src/auth/RequireUser.tsx`;
  - `src/pages/LoginPage.tsx`;
  - `src/pages/RegisterGuidePage.tsx`;
  - `src/layout/AppLayout.tsx` (a shell only: header with the user menu and logout, a menu stub; Task 3 fills it).
- Modify: `src/App.tsx` (router, QueryClient, ConfigProvider, `SessionWatcher`).
- Test: `src/auth/auth.test.tsx`.

**Interfaces (produces):**
- `startLineLogin(next: string): void` saves the login state and does `window.location.assign(authorizeUrl)`. The navigation goes through an injectable `navigateExternal` so tests can capture the URL.
- `takeLoginState(state: string | null): { ok: true; next: string } | { ok: false }` reads and removes the saved state. It checks match, age ≤ 10 min and `safeNext`.
- `safeNext(next: string | null | undefined): string`.
- `useMe()`: React Query key `["me"]` on `GET /api/v1/me` with `own401`; `null` when there is no session.
- `useMyTenants()`: key `["me","tenants"]`, used by Task 3.
- `useSessionNotice` (zustand, `{expired, setExpired}`) is used by the login page notice.
- `forgetSession(queryClient)` does three things:
  - removes all queries except `["me"]`, which is set to `null`;
  - clears `saiflow.pc.tenant`;
  - resets the tenant choice store.
- `logout()`: `POST /api/v1/auth/logout`, then `forgetSession`, whatever the result.
- Routes:
  - `/login` (button, or a callback when `code`/`error` is present);
  - `/register` (guidance);
  - everything else is inside `RequireUser`, which:
    - sends a missing session to `/login?next=<path+search>`;
    - sends `registered === false` to `/register?next=…`.

- [ ] **Step 1: Write the failing tests** (`auth.test.tsx`).
  - `opening /plans without a session shows the login page; Log in with LINE goes to the authorize URL with client_id, redirect_uri=<origin>/login, a 32-hex state` (090-01, part 1).
  - `the callback with the saved state posts {code, redirect_uri} once and lands on /plans with the nickname` (090-01, part 2).
  - `?error=access_denied returns to the login page with err.line_cancelled and Retry; a 400 from /auth/line shows its text and Retry` (090-02).
  - `a callback whose state differs, is missing, or is older than 10 minutes posts nothing and asks to log in again` (090-03).
  - `opening the same callback twice posts once; the second shows the login page` (Review Focus 1).
  - `next=//evil.com, https://evil.com and /login all land on /` (Review Focus 2).
  - `a 401 on any page clears the page data and goes to /login?next=… with err.unauthenticated; after login it returns there` (090-04).
  - `an unregistered user sees only the guide with the register link https://liff.line.me/<liffId>?entry=register and a QR code, without the menu` (091-01).
  - `I have registered: re-reads /me and enters / when registered` (091-02); `still unregistered stays with a hint` (091-03).
  - `logout asks first; Cancel keeps the session` (092-02); `Confirm posts /auth/logout and shows the login page, even when the POST fails` (092-01).
  - `after logout another user logs in: the stored organization of the first user is not used and the first user's data is not shown` (Review Focus 3).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The callback handling runs once per URL: guard with a ref, and remove `code` and `state` from the address bar with `replace` before posting.
- [ ] **Step 4: Run** test, lint, build. Expected: pass.
- [ ] **Step 5: Commit** `[web-pc-account] LINE web login, session, register guidance, logout`

### Task 3: Layout, tenant switching, home, profile (FR-SYS-093 switch UI, 094, 095, 096)

**Files:**
- Create:
  - `src/tenants/{useCurrentTenant.ts,permissions.ts,TenantSwitcher.tsx}` (ported, keys as in Global Constraints);
  - `src/billing/{UsageCard.tsx,useUsage.ts,money.ts}`;
  - `src/layout/LanguageSwitch.tsx`;
  - `src/notifications/BellBadge.tsx` (count only; Task 5 adds the page);
  - `src/pages/{HomePage,ProfilePage,DataBrowsePage}.tsx`;
  - `src/profile/EmailCodeButton.tsx` (ported, 60 s countdown).
- Modify: `src/layout/AppLayout.tsx`.
- Test: `src/pages/shell.test.tsx`.

**Interfaces:**
- Consumes `useMe`, `useMyTenants` and `forgetSession` (Task 2).
- Produces:
  - `useCurrentTenant(): { tenant: CurrentTenant | null; setTenant(id: number | null): void }`;
  - `can(tenant, permission): boolean`;
  - `refreshTenants(queryClient): Promise<void>`, which re-reads `/me/tenants`, keeps the old list on failure and calls `reconcileTenantChoice`;
  - `MENU` keys: `home`, `org`, `roles`, `plans`, `notifications`, `profile`, `data`.
- Routes: `/`, `/org`, `/org/apply`, `/roles`, `/plans`, `/notifications`, `/profile`, `/data`.
- "Roles" is hidden in the menu unless `can(tenant, "role_manage")`.

- [ ] **Step 1: Write the failing tests** (`shell.test.tsx`).
  - `home shows Starter, the period, 4,880 of 5,000 left, free 40 and its expiry` (094-01): usage fixture `{plan_code:"starter", monthly_quota:5000, used:120, free_remaining:40, ...}`.
  - `personal tenant: /org says switch to an organization first and the menu has no Roles` (094-02).
  - `Data browse shows Coming soon` (094-03).
  - `switching to Siam Tools sends X-Tenant-Id 5 and persists; a reload keeps it` (096-01).
  - `opening the switcher re-reads /me/tenants; a newly approved org appears; a failed re-read keeps the list` (096-02).
  - `a stored org no longer in /me/tenants falls back to personal with tenant.gone` (096-03).
  - `selecting ไทย switches the menu and the page at once and persists` (093-02).
  - `profile: nickname Somchai and a cleared phone save; the header nickname updates; the phone shows Not set` (095-01).
  - `change email: send code → 60 s countdown disabled; confirm with the code → the new email shows` (095-02).
  - `a 400 with fields ["phone"] shows under the phone input and keeps the values` (095-03).
- [ ] **Step 2–4:** RED; implement; GREEN (test, lint, build).
- [ ] **Step 5: Commit** `[web-pc-account] layout, tenant switching, home usage, profile`

### Task 4: Organizations — apply, profile and members, invites, roles, transfer and leave, verification (FR-SYS-097–101, 104)

**Files:**
- Create:
  - `src/orgs/{orgData.ts,permissionLabels.ts}` (ported);
  - `src/pages/{ApplyOrgPage,OrgPage,RolesPage}.tsx`;
  - `src/orgs/{InviteDialog,VerificationCard,MembersTable}.tsx`.
- Test: `src/pages/orgs.test.tsx`.

**Interfaces:**
- Consumes `useCurrentTenant`, `can`, `refreshTenants` (Task 3) and `ConfirmButton` (Task 1).
- `InviteDialog` shows three things after `POST /organizations/{id}/invitations`:
  - the link, as `Typography.Paragraph` with selectable text;
  - a "Copy" button that calls `navigator.clipboard.writeText`;
  - antd `<QRCode value={link}/>`.
- An org endpoint that answers 404 calls `refreshTenants` and shows `tenant.gone` (Review Focus 4).
- Destructive actions use `ConfirmButton`: remove member, revoke invite, delete role, transfer owner, leave organization.

- [ ] **Step 1: Write the failing tests** (`orgs.test.tsx`).
  - `apply with name and phone shows submitted, the list shows Pending and the form is gone` (097-01).
  - `empty name or phone shows required under it and posts nothing` (097-02).
  - `a rejected application shows the reason and the form again` (097-03).
  - `org page shows profile, members and 2 / 2` (098-01).
  - `invite shows the link https://liff.line.me/<liffId>?invite=<token>, Copy and a QR code; the pending invite is listed and revocable after confirming` (098-02).
  - `clipboard rejects: the link stays visible with the copy-failed hint` (Review Focus 5).
  - `at the limit Invite is disabled with the reason` (098-03).
  - `remove M after confirming; set N to Reviewer` (098-04).
  - `a member without member_manage sees no Invite and no Remove` (096-04).
  - `new role Reviewer with level-1 review and data browse` (099-01).
  - `default role has no Delete; deleting Reviewer says 1 member moves to the default role` (099-02).
  - `transfer to V after confirming: V shows owner, U the default role, U sees Leave` (100-01).
  - `V leaves after confirming: the current tenant becomes personal and the switcher has no Siam Tools` (100-02).
  - `submit verification → Pending, no form` (101-01); `rejected → reason and the form` (101-02).
  - `a double click on Submit in apply sends one POST` (104-01); `a double click on OK in remove sends one DELETE` (104-02).
  - `a 400 with fields ["contact_phone"] on the org profile shows under the phone input` (104-03).
  - `the current org answers 404: falls back to personal with tenant.gone` (Review Focus 4).
- [ ] **Step 2–4:** RED; implement; GREEN (test, lint, build).
- [ ] **Step 5: Commit** `[web-pc-account] organizations: apply, members, invites with link and QR, roles, transfer, verification`

### Task 5: Plans and notifications (FR-SYS-102, 103)

**Files:**
- Create:
  - `src/billing/planRules.ts` (ported);
  - `src/pages/PlansPage.tsx`;
  - `src/notifications/{data.ts,render.ts}` (ported);
  - `src/pages/NotificationsPage.tsx`.
- Modify: `src/notifications/BellBadge.tsx` (click goes to `/notifications`).
- Test: `src/pages/billing.test.tsx`, `src/pages/notifications.test.tsx`.

**Interfaces:**
- `PlansPage` uses `GET /billing/plans`, `GET /billing/usage`, the pending application and `POST` apply.
- The confirmation is a `ConfirmButton` titled with the target plan and the period.
- Notifications page:
  - uses `GET /notifications?before=` for more, `POST /notifications/read {ids}` and `{all:true}`;
  - after a mark, it invalidates the unread count.

- [ ] **Step 1: Write the failing tests.**
  - `prices: Kinder ฿888 / year; Starter ฿599 / month and ฿5,990 / year; Intermediate and Advance Contact us` (102-01).
  - `active Intermediate: Starter and Kinder have no Apply; Renew Intermediate monthly after confirming shows the received message, the pending banner and disables the other buttons` (102-02).
  - `a member without plan_apply sees plans and usage but no Apply or Renew` (102-03).
  - `two unread expiry reminders: the header shows 2; the page lists both in the current language; clicking one makes it read and the count 1; Mark all read hides the count` (103-01).
  - `switching to 中文 re-renders a usage reminder in Chinese` (103-02).
- [ ] **Step 2–4:** RED; implement; GREEN (test, lint, build).
- [ ] **Step 5: Commit** `[web-pc-account] plans with prices and renewal, notification center`

### Task 6: Build settings, deployment and doc sync

**Files:**
- `scripts/docker/frontend.Dockerfile`: add `ARG VITE_LINE_CHANNEL_ID` and `ENV VITE_LINE_CHANNEL_ID=$VITE_LINE_CHANNEL_ID`; update the comment ("line-mini and web-pc use these").
- `.github/workflows/deploy.yml`: `LINE_CHANNEL_ID: ${{ vars.LINE_CHANNEL_ID }}`, passed as `--build-arg VITE_LINE_CHANNEL_ID="$LINE_CHANNEL_ID"`.
- `docs/deployment/README.md` §2.6:
  - register the callback `https://saiflow-app.aibaba.asia/login` in the LINE Login channel `2012285576`;
  - `.env` `LINE_LOGIN_REDIRECT_URIS=https://saiflow-app.aibaba.asia/login`;
  - the new GitHub variable `LINE_CHANNEL_ID` (public; same value as `.env` `LINE_CHANNEL_ID`);
  - web-pc also needs `LIFF_ID`.
- `scripts/tests/`: if a script test checks the Dockerfile build args, extend it to cover `VITE_LINE_CHANNEL_ID`.
- Docs:
  - PRD §4.9: web-pc offers no registration; unregistered users are guided to the mini app (D2);
  - `Architecture.md`: the web-pc pages and the login flow;
  - `Requirements-Index.md`: FR-SYS-090–104 → `openspec/specs/web-pc/spec.md`;
  - ADR-006 §7: the B-5c row becomes `web-pc-account` with its scope;
  - each doc gets a version-history line.

- [ ] **Step 1:** Edit the files. Run `bash scripts/tests/*.test.sh`, actionlint and shellcheck (lint binaries as in B-5b). Run `openspec validate web-pc-account`. Expected: all pass.
- [ ] **Step 2: Commit** `[web-pc-account] build-time LINE channel id, deployment notes, doc sync`

### Task 7: Verification

- [ ] **Step 1:** Run `pnpm -r test`, `pnpm -r lint` and `pnpm -r build`. Expected: all green; web-pc has 1 test or more per AC in the spec.
- [ ] **Step 2:** Final whole-branch review (Opus) on the package from `review-package`, with this plan's Review Focus. Run one fix pass for Critical and Important findings, each RED→GREEN.
- [ ] **Step 3:** Push; CI green. Before the owner says "确认部署", list the one-time settings they must make:
  - the LINE callback;
  - `.env` `LINE_LOGIN_REDIRECT_URIS`, then recreate `saiflow-be-api`;
  - the GitHub variable `LINE_CHANNEL_ID`.
- [ ] **Step 4:** After deployment, the owner checks in a browser:
  - login and logout;
  - an unregistered account sees the guide;
  - language;
  - switching tenants;
  - profile;
  - an org application;
  - invite link and QR, opened in LINE;
  - roles;
  - plans;
  - notifications.

  Then write `verification.md` and archive.
