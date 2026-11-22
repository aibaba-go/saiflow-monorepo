# Report Designer V2 Implementation Plan

> **For agentic workers:** Use executing-plans inline; steps follow RED → GREEN. No commits/push/deploy without a separate user request.

**Goal:** 落地已确认设计器、菜单与报表首页。
**Architecture:** Extend structural JSON config without changing snapshot lifecycle; validate typed filters into immutable slots and compile bound SQL before aggregation. Store private immutable image assets and per-user/tenant homepage preferences in PostgreSQL; storage uses existing ObjectStore. Reuse shared renderer on all report clients; PC default homes use existing authorized job/usage APIs and custom home reuses the read-only publication viewer.
**Tech Stack:** Existing React/AntD/ECharts/RGL, FastAPI/SQLAlchemy/PostgreSQL/GCS; no new packages.
**Spec:** specs/reporting/spec.md; specs/web-pc/spec.md; existing template-report-management/specs/reporting/spec.md.

## Global Constraints
- Existing org Starter+ and separate report_manage/report_view/export gates unchanged.
- No cross-template/table joins, unbound SQL, public images, executable HTML or periodic refresh.
- Null, exact decimal strings, snapshot revision and CSV semantics unchanged.
- All scratch outputs stay in temp/; Python commands run in services/api.
- Preserve the seven existing visual changes and work on feat/report-visual-upgrade.

## Review Focus
- Cross-tenant asset/preference reads and changed memberships: API tests.
- Missing/invalid numbers/dates, numeric zero and hostile operands: validation/SQL/integration tests.
- Explicit multi-template page mapping and table row scope: validation and designer tests.
- HTML malformed nesting, event/src/style URL loading, external origins: sanitizer/renderer tests.
- Publication/session/tenant changes during homepage/query loads: PC tests and browser.

## Tasks
### 1. Typed filters (FR-REPORT-019)
- [x] RED: extend tests/unit/test_report_config.py and test_report_sql.py with accepted/rejected typed conditions, page mapping, bound hostile values and same-table restrictions; run pytest and observe failures.
- [x] GREEN: new app/services/report_filters.py; report_config.py CardSpec filter groups; repositories/report_query.py filtered-items CTE. All comparison values and extraction paths bound; reuse safe exact conversions. Page filters map every rule to each selected target card; combine with card group using AND.
- [x] Verify unit tests and collect tests/integration/test_report_query.py; distinguish skipped database tests from executed checks.

### 2. Static content and style (FR-REPORT-020/021)
- [x] RED: sanitizer, config/static query, image access and horizontal option tests.
- [x] GREEN: add ReportAsset model and 0022 migration; image routes read/write with limits and tenant/publication checks; server HTML allowlist and external origin config; static specs bypass query and CSV. Extend reportTypes, model defaults, ChartRenderer, themes and ReportGrid wrappers. Static cards never read template refs.
- [x] GREEN: split new designer controls into V2Panels.tsx; typed condition editor, explicit page mappings, image upload callback, HTML/source modes, theme/page/card style controls; add all existing language translations.
- [x] Verify UI tests, available API tests and PC/admin/LINE builds.

### 3. Menu and homepage (FR-SYS-170/171)
- [x] RED: AppLayout toggle/persistence/permissions tests, home routing tests, preference API tests.
- [x] GREEN: persistent sidebar control; HomepagePreference model and same migration; /me/homepage GET/PUT (PUT null resets) using current tenant and registered principal; set requires published report_view, get rechecks gate and publication. Generate OpenAPI/client.
- [x] GREEN: keep original HomePage for guests, built-in personal/organization default dashboards from authorized existing job counts/usage/recent; reuse Viewer for custom home without redirect, add set/reset controls and ReactQuery user/tenant keys. Clear inaccessible content and offer retry for ordinary failures.
- [x] Verify PC suite and API units; collect integration tests without claiming skipped database checks passed.

### 4. Full verification
- [x] npm test/lint in packages/ui (no standalone build script); test/build in apps/web-pc, web-admin, line-mini; pytest; changed-file ruff; git diff --check.
- [x] Run normal PC dev server, browser golden paths and edge cases via test API fixture (no real writes); clearly distinguish mocked API browser checks from database integration.
- [x] Final review: author self-review because independent delegation is unavailable; update Data-Model entity index. This is not independent approval.
- [ ] Execute database integration, migration/upsert/grant checks and private object-store integration in an authorized test environment before release.
- [ ] Obtain independent review before merge.

## Execution rulings
- Ruling: reset uses PUT with report_id null, not an additional DELETE route — the approved behavior is scoped reset, with no mandated HTTP method — cost if wrong: an additional client contract would be required.
- Ruling: external embeds reject query parameters and fragments as well as credentials — conservative handling avoids token-bearing URLs; the empty origin allowlist remains deny-by-default — cost if wrong: otherwise acceptable external pages may be refused.
- Ruling: personal/organization defaults use basic authorized APIs outside the operational-report paid gate; selected reports remain gated — preserves the approved default-home behavior without granting personal report access — cost if wrong: defaults would need a separate access decision.
- Ruling: packages/ui is verified through test/lint/type-check and consuming application builds, not a nonexistent standalone build script — follows its actual package scripts — cost if wrong: independent package packaging is not validated.
- Ruling: database/migration/object-store verification and independent review remain release gates — no authorized test database or available independent reviewer — cost if skipped: SQL, migration or authorization integration defects may remain undiscovered.
- Ruling: no new verification.md is created under the current restriction on unrequested documentation files; evidence remains in temp/ and the conversation, not product documentation — cost: the change-local verification artifact remains absent.

## Deferred minor review findings
- Image-upload failure copy currently uses the generic field-loading message.
- Page-filter source selection and field-name localization can be polished separately.
- External-origin policy failures deny rendering but have no dedicated retry control.

## Approval
2026-11-20 用户明确要求开始实施已确认范围；本计划按其确认的行为执行，不新增个人运营报表权限或共享组织首页设置。

## PostgreSQL sources and dashboard extension — approved 2026-11-22
用户已确认分页明细/首页设计及 PostgreSQL 首批来源、安全权限边界，并授权连续实施、全面测试及当前测试环境部署，不再逐步确认。新增范围对应 FR-DATA-001..003、FR-REPORT-022/023、FR-SYS-172。工作分支 feat/report-data-sources；不提交或推送未经明确要求的 Git 操作，发布可使用受控源码构建。

### Interfaces
- Sources: GET/POST /api/v1/data-sources and /api/v1/admin/data-sources; /{id} GET/PUT/DELETE; /{id}/test POST; /{id}/query POST with sql, page, page_size. IDs are strings: system-pg, template:<id>, postgres:<id>. Admin operations accept tenant_id for tenant sources. Public metadata contains id/name/kind, connection fields except password, configured flag; query responses contain columns [{key,label,type}], rows [{key: string|null}], page/page_size/total.
- SQL cards: data.source_id and data.sql; existing measure/dimension bindings refer to result keys; data.display_fields [{path,label}] and data.page_size control raw table projection. Template cards retain template bindings and use the same display_fields/page_size. QueryCard.table contains columns/rows/page/page_size/total, while aggregated rows remain unchanged.
- Page requests: PreviewIn/DataIn accept optional pages: Record<cardId, positive page>; pagination is ephemeral, not saved config. Shared ChartRenderer gets onPageChange(page), shared designer onPreviewPage(cardId,page); consumers pin queries to active user/tenant/config/publication.
- Built-ins: GET /api/v1/me/dashboard returns kind, config, counts, usage, recent and generated_at. Fixed server SQL through system_report_rows(settings, sql, bound params); reporting.jobs/plans/subscriptions/free_quotas/quota_reservations views expose only required metadata, no auth or raw OCR payloads. Dashboard services own fixed SQL, never take SQL from customer requests.

### Extension Task 1 — backend sources and raw tables
- [x] RED: source tenant/admin auth, encrypted secret omission, unsafe network/TLS, read-only SQL AST and query timeout tests; 12-record 5/5/2 raw table tests, selected fields, duplicate/null preservation, CSV full-range cap, SQL publication tampering.
- [x] GREEN: new source model/service/router/schemas, Alembic 0024 source table and restricted reporting views, read-only role configuration; update report_config/query/query_service/csv/service/schemas without changing normal report gates. Server-only encryption key and reporter password settings; source references block deletion.
- [x] Verify: services/api/.venv/Scripts/python.exe -m pytest; collect and execute integration with isolated local test PG, no shared-data fixture deletion.

### Extension Task 2 — source management and shared designer
- [x] RED: source creation/test/secret retention/errors, admin-only system source; raw field selection and pagination, SQL source binding, image error/retry and HTTPS policy feedback tests.
- [x] GREEN: new PC/admin source API and pages, route/menu/i18n; reportTypes, shared SQL data panel, ChartRenderer raw table pager; wire designer/readers across PC/admin/LINE and regenerate api-client from backend OpenAPI.
- [x] Verify: UI and all three client test/lint/build commands; browser mocked and actual API golden path and error cases, distinguish them in result.

### Extension Task 3 — preinstalled real PG dashboards
- [x] RED: personal/org scope, non-data_browse own scope, no paid gate, failure/late tenant response tests; homepage-only header/tool/period removal.
- [x] GREEN: fixed server dashboard configs/SQL and /me/dashboard; two real PC default dashboard layouts using authorized PG results; guest and normal report pages unchanged.
- [x] Verify: backend/PC tests and browser default/custom home vs normal report viewer.

### Extension Task 4 — release gate
- [x] Full API suite including disposable PG integration, UI/client suites, lint/build, SQL role/view permissions and migration rerun; author security self-review and regression fixes. This is not independent approval.
- [x] Guarded dev deployment: assert APP_HOST=dev-saiflow-app.aibaba.asia and POSTGRES_VOLUME=saiflow_test_pgdata, preserve server secrets, backup, build validated source, migrate, deploy; production host 130.94.24.117 not touched.
- [x] Post-deploy health, source metadata/admin boundary, default dashboards, report pagination and uploads/OCR smoke; notify user only after evidence confirms release.
- [ ] Independent security review remains required before merge; the session denied Agent delegation.

### Extension rulings
- Credentials: PostgreSQL connection passwords may be encrypted at rest in source records; master key and built-in reporter password remain only in server environment. Never return secrets.
- Security: system PG exposes restricted metadata views, not unrestricted saiflow_v3 tables; runtime fixed Dashboard queries bind server-authorized scope. Arbitrary external SQL never uses the application write role.
- External networks: private ERP hosts require explicit server allowlisting; default public hosts require TLS certificate validation and pinned resolved target addresses.
- Workspace: use the existing dependency-populated checkout on a new feature branch, not duplicate installed dependencies; all temporary logs/scripts remain temp/.
- Scope: first driver PostgreSQL only, no MySQL/SQL Server; existing embedded-origin security not bypassed, expose allowed origins and specific errors. Real image failures must be reproduced before changing working renderer.
- Release review: author self-review was used after Agent delegation was denied; do not claim independent approval. Cost: independent security review remains a merge prerequisite.

### Extension release outcome — 2026-11-22
- Released to the authorized development environment only: data-sources-20261122-1a802b0b66a7-test. No Git commit/push, production deployment or existing report edits.
- Executed release gates: API 1,658; UI 195; PC 325; admin 103; LINE 446 tests; 2,727 total. Three client builds/lints succeeded, ruff passed and deployment scripts had 104 passing assertions. Full API integration used disposable PostgreSQL rather than shared fixtures.
- Completed backup before activation; applied migrations 0024/0025 and reran reporter grants. All three health endpoints returned the release tag and database ok. Live source/security smoke passed 11 checks.
- Authenticated browser verified the existing private image, measure-free raw table preview and empty second page, personal PG Dashboard without report header/toolbar, and preserved custom organization homepage. Synthetic upload completed OCR/template conversion and reached VERIFYING with a structured result; the marked sample remains unconfirmed, including its human-verification warning/missing field. Inspection impersonation was ended and original tenant selection restored.
- Verification boundaries: source UI connection/query golden paths used mocked APIs; no actual external ERP was configured. LINE application tests/build passed but real LINE login was not exercised; inherited LIFF/channel IDs remain blank. REPORT_EMBED_ORIGINS remains empty, so arbitrary HTTPS embeds still require administrator-approved origins. Browser screenshots were unavailable; DOM and real authenticated image-load checks were used.
- Deferred minors: three unnecessary-hook-dependency lint warnings and bundle-size warnings; generic safe source-error retry reloads the catalog, while action buttons rerun their actions. Earlier copy/localization polish findings remain deferred. Independent review remains open before merge.
- Detailed test/deployment evidence remains in temp/data-source-progress.json and the named test/runtime logs, consistent with the previously recorded no-new-document ruling.

## Static media follow-up — 2026-11-22
- Scope: user feedback on media whitespace and HTML re-selection; maps to FR-REPORT-020/021 and AC-FR-REPORT-020-03. No server, API, permission or stored-report migration changes.
- [x] RED: media frame padding tests, default-image fit test and HTML re-selection test failed before implementation; sanitized HTML margin test reproduced 16px rather than 0px.
- [x] GREEN: media frames remove outer padding with title-only inset, media fills its body without intrinsic flex sizing; sanitized HTML has no default body margin. New images default to cover; existing contain settings stay unchanged. Designer frames disable pointer/Tab interaction; viewers keep normal iframe interaction and original sandbox/CSP/origin boundaries.
- [x] Full regression: UI200, PC325, admin103, LINE446 tests passed; UI lint/type-check and three consuming app lints/builds passed. Existing three hook-dependency warnings and bundle-size warnings remain deferred.
- [x] Browser verification: local real designer with generated PNG; browser hit-testing and DOM click dispatch re-selected HTML three times after another card and reopened its editor; editing updated sanitized srcdoc. Media element/body rectangles matched and frame padding was 0. The hidden browser surface generated no events for native click calls; physical mouse/drag, screenshots and responsive resize were not verified. No real customer draft was modified.
- [ ] Deployment: this follow-up has not been deployed or committed; earlier release remains unchanged.

## Admin source/table and default-template follow-up — 2026-11-22
**Spec:** FR-SYS-170/172, AC-FR-DATA-001-02/003-02 and AC-FR-SYS-172-03; latest explicit four-item request, existing no-interruption implementation preference. No commit, deployment or existing customer report update.
**Approach:** retain existing React/AntD designer and secured PostgreSQL engine; use Superset's authorized schema/table catalog and select-star pattern and Metabase's database→table selection interaction as references, not copied code or embedded BI dependencies. Defaults remain server-owned and read-only; expose two catalog entries and synthetic previews rather than tenant report records or arbitrary system-PG publications.
**Interfaces:** GET /api/v1/{admin/}data-sources/{id}/tables → {items:[{schema,name,kind}]}; same source authorization/TLS/limits, system-pg only restricted admin views. Shared designer loadTables(id,signal) and persisted data.query_mode/relation; table mode's safely quoted SELECT is validated server-side. GET /api/v1/admin/reports/homepage-templates → two configurations, names and source_id, no customer statistics or SQL secrets.
- [x] Task 1 RED→GREEN: AdminLayout.test.tsx accessible toggle, persistent 76px collapse, intact links and edits; DataSourcesPage organization-selection help, existing external CRUD and immutable builtin tests. Update AdminLayout/app.css/i18n and page only.
- [x] Task 2 RED→GREEN: source metadata privilege filtering/foreign/builtin/no-data_browse tests, quote-safe generated table SQL validation; DataPanels/ReportDesigner table vs SQL, persistence and stale-response tests. Implement connection catalog, routes/schema/service, UI loadTables wiring and regenerate OpenAPI/client.
- [x] Task 3 RED→GREEN: dashboard configuration progress/usage/full-width-recent geometry, fixed server SQL scope preserved; admin two readonly templates with synthetic preview, PC approved progress card. Update dashboard service/schema/admin router, ReportsPage/PC dashboard/styles/translations.
- [x] Task 4: full pytest with disposable PG integration; UI and PC/admin/LINE full test/lint/build; strict OpenSpec/diff checks and local browser golden/edge paths. Record native interaction limitations accurately; no customer modifications.
**Review Focus:** identifier injection; metadata visibility/partial column privileges; late source/card/SQL responses; builtin mutation and customer publication rejection; default/custom homepage scope and synthetic-only admin preview. Pin each with tests.

### Follow-up verification ledger — 2026-11-22
- Additional RED→GREEN: field discovery was incorrectly enabled with SQL but no selected database; the new regression failed, then the source-selection guard passed. Catalog failure/retry and a late response after changing database are covered. Actual browser collapse reproduced 208px instead of 76px because the existing narrow-screen rule overrode the collapse selector; increasing selector specificity restored 76px and preserved all 13 navigation links.
- Frontend regression: API client 5, UI 203, PC 325, admin 106, LINE 446 tests passed, 1,085 total. The first combined run exposed one obsolete PC source-selection assertion; updated it for source type then database, and reran the complete PC suite. Lint/type checks and all three app builds passed; three inherited hook-dependency warnings and bundle-size warnings remain.
- Backend full regression: 1,676 passed in 579.32s with REQUIRE_INTEGRATION=1 against local disposable PostgreSQL, including all 9 source integration tests and 18 source-access unit tests. Schema USAGE, whole-table SELECT visibility and the restricted builtin catalog are covered. Together with frontend suites, 2,761 tests passed. Ruff check/format passed for 353 files; strict OpenSpec validation and git diff --check passed. Evidence: temp/followup-backend-final.log, temp/followup-ui-final.log, temp/followup-pc-final.log, temp/followup-admin-final.log and temp/followup-frontend-all.log (API client/LINE results), temp/followup-final-lint.log and temp/followup-final-build.log.
- Browser golden/edge paths: actual local admin/PC applications with synthetic API fixtures verified organization-scoped external create/read/update/delete, unchanged builtin mutation controls, table-catalog failure/retry, safely quoted selected-table SQL, field discovery, local draft persistence and manual SQL reset/discovery. Both admin default-template previews render 7 cards and request no customer statistics or query endpoints. Personal/organization homepages show 4 metrics and progress bars, 5:7/7:5 wide-screen progress/usage, full-width 5 recent records and single-column layout at 800px.
- Final review: author self-review after Agent delegation was denied; checked the Review Focus against source and tests and found no additional critical/important implementation issue. Independent review remains required before merge. Do not retry the denied delegation through another entry.
- Ruling: use NO_PROXY=* and no_proxy=* only for local test processes because httpx inherited an invalid Windows system proxy — the initial run had 5 failures, 928 passes and 737 fixture errors, before feature assertions; production proxy behavior is unchanged. The local disposable PostgreSQL is the only integration target, not a shared customer database.
- Verification limits: browser DOM events and actual computed layout were checked; the hidden surface did not dispatch native physical clicks, so mouse/drag and screenshots remain unverified. Source connection/query UI fixtures are synthetic, not a real external ERP. No customer report changes, commit, push, shared-environment migration or deployment was performed in this follow-up.
- Deferred minors: inherited hook and bundle warnings; synthetic preview sample-row localization remains basic. These are not silently folded into the feature scope.
