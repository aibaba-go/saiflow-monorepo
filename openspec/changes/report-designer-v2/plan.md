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
