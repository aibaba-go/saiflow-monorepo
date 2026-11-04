# rebuild-tenant-rbac Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organizations (apply → admin approval), the tenant access rule that B-3 will use, roles and permission points, one-time invitations with a member limit, member removal, leaving and owner transfer, and enterprise verification. Fix the 9 Minors left by B-2a and harden-identity. Bring the product docs in line with the new tenant model.

**Architecture:**
- Everything lives in `services/api`, on the B-2a stack: FastAPI, async SQLAlchemy, Alembic, `AppError`, cookie sessions, and the hash-chained `audit_log`.
- An organization is a `tenants` row with kind `organization`. Its profile, members, roles, invitations and applications are in their own tables; none of them is `tenant_scoped`, so guest claiming never touches them.
- All tenant and permission decisions go through one module, `app/services/tenant_access.py`. B-3 and B-4 call it through a FastAPI dependency, so the rule has a single implementation.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, PostgreSQL 18, pytest with real PostgreSQL (`saiflow-test-pg`).

**Spec:** `openspec/changes/rebuild-tenant-rbac/specs/tenancy/spec.md` (FR-SYS-017, 021, 022, 023, 002, 029, 024, 025, 026, 027, 028), together with `proposal.md` (D1–D14, A1–A9) in the same folder. ADR-009 governs reuse of main's code; main's enterprise, membership and invitation code is a reference only, and this spec wins on any conflict.

## Global Constraints

- Permission points (13, fixed codes): `upload_ocr`, `verify_own`, `verify_others`, `review_l1`, `review_l2`, `export`, `data_browse`, `member_manage`, `role_manage`, `plan_apply`, `verification_apply`, `template_manage`, `report_view`.
- Default role initial permissions: `upload_ocr`, `verify_own`, `export`.
- Owner has all 13 points; the personal-tenant user and a guest in its temporary tenant are treated as having all 13.
- Organization profile:
  - name: required, trimmed length 1–128;
  - contact phone: required, `user_service.normalize_phone` rules;
  - address: optional, ≤ 512.
- Role name: unique per organization, trimmed length 1–64. Each member has exactly one role.
- Invitation: one acceptance, valid 7 days from creation, revocable; only a SHA-256 of the token is stored; the token is `secrets.token_urlsafe(32)`.
- Member limit when no plan is active: system setting `org_member_limit_unpaid`, default 2. The count is members, including the owner, plus invitations that are not accepted, not revoked and not expired.
- Enterprise verification:
  - legal name required, ≤ 255;
  - tax ID exactly 13 ASCII digits;
  - registered address required, ≤ 512;
  - status is one of `none`, `pending`, `verified`, `rejected`.
- Unusable tenant (not a member, disabled, missing) → HTTP 404 `not_found`, the same body in every case.
- Missing permission point → 403 `permission_denied`.
- Error bodies use `ErrorResponse`. Request bodies use `LooseRequest` and `ensure_text`, so a non-string value gives 400.
- Every state-changing operation writes `audit_log` through `audit_service.record`. Invitation tokens never appear in the database (except as a hash) or in logs.
- Business data endpoints (B-3 onwards) select the tenant with the request header `X-Tenant-Id`. When it is absent, the request uses the caller's own tenant (personal, or the guest's temporary tenant).
- Organization-management endpoints take the organization ID in the path.
- Commit messages start with `[rebuild-tenant-rbac]`. `legacy/` is read-only.

## Review Focus

1. **Two requests racing to accept the last free seat**, or to transfer the owner, must never leave the organization over its limit or with zero or two owners. Tasks 6 and 7 lock the `organizations` row and have concurrency tests.
2. **A member whose role is edited, deleted or reassigned mid-session** must get the new permissions on the very next request. There is no cache, and Task 2 resolves permissions per request; Task 5 tests this.
3. **An `X-Tenant-Id` that is not a number, or is negative, or names a guest's or another user's personal tenant**, must give the same 404 as a non-member organization, never a 422 or 500. Task 2 tests this.
4. **A guest or an unregistered user calling member-only endpoints** (accept invitation, list tenants, apply) must get the documented 401/403 and leave no rows behind. Tasks 2, 3 and 6 test this.
5. **The app database role** must be able to do everything above, since the API tests now run as `saiflow_v3_app` (Minor M6). A missing grant on a new table must make the suite fail, not production. Task 9 tests this.

## Minors carried in (from `archive/2026-11-04-harden-identity/verification.md` §4)

| # | Minor | Task |
|---|---|---|
| M1 | The limiter scans every key on each hit; IPv6 is keyed per /128 | 10 |
| M2 | 550/554 5.7.1 relay and policy refusals are reported as `email_rejected` | 10 |
| M3 | 4xx at RCPT (`SMTPRecipientsRefused`) is not retried | 10 |
| M4 | `postgres-init/01-app-user.sh` comment and CREATE grant are stale | 11 |
| M5 | A quoted `DB_MIGRATE_PASSWORD` in `.env` sets a password with quotes | 11 |
| M6 | API integration tests run as the superuser | 9 |
| M7 | After a 0003 downgrade the app role has no privileges; not documented | 11 |
| M8 | Username normalisation differs between Python `strip/lower` and SQL `btrim/lower` | 10 |
| M9 | The app role keeps INSERT on `alembic_version` | 1 |

## File Structure

- `app/models/organization.py` — `Organization`, `OrganizationApplication`, `Role`, `Membership`, `Invitation`, `VerificationApplication`.
- `app/models/setting.py` — `SystemSetting`.
- `alembic/versions/0004_tenancy.py` — the new tables, the `tenants` kind check, grants, and M9.
- `app/permissions.py` — `Permission` enum, `ALL`, `DEFAULT_ROLE`.
- `app/services/tenant_access.py` — rewritten: `TenantContext`, `resolve_tenant`, `require`, `submitter_scope`, `usable_tenants`.
- `app/services/organization_service.py` — apply, approve, reject, profile update, disable and enable.
- `app/services/role_service.py` — role create, update and delete, assignment.
- `app/services/membership_service.py` — invitations, accept, member limit, remove, leave, transfer.
- `app/services/verification_service.py` — enterprise verification.
- `app/services/settings_service.py` — `get_int`, `set_int`.
- `app/routers/organizations.py` — customer endpoints.
- `app/routers/admin_organizations.py` — admin endpoints.
- `app/schemas/organization.py` — request and response models.
- `tests/integration/test_tenancy_*.py` — one file per task, named in each task.

## Endpoints

Customer endpoints, all under `/api/v1`, all requiring the CSRF header on unsafe methods:

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /me/tenants` | user (guest → 401) | usable tenants, with role and permissions |
| `POST /organization-applications` | registered | apply |
| `GET /me/organization-applications` | registered | my applications |
| `GET /organizations/{id}` | member | profile, verification status, member count |
| `PATCH /organizations/{id}` | owner or `member_manage` | profile edit |
| `GET`, `POST /organizations/{id}/roles` | member; `role_manage` to POST | list or create roles |
| `PATCH`, `DELETE /organizations/{id}/roles/{role_id}` | `role_manage` | edit or delete a role |
| `GET /organizations/{id}/members` | member | members with roles |
| `PUT /organizations/{id}/members/{user_id}/role` | `role_manage` | assign a role |
| `DELETE /organizations/{id}/members/{user_id}` | `member_manage` | remove a member |
| `POST /organizations/{id}/leave` | member | leave |
| `POST /organizations/{id}/owner-transfer` | owner | `{user_id}` |
| `GET`, `POST /organizations/{id}/invitations` | `member_manage` | list or create; create returns the token once |
| `DELETE /organizations/{id}/invitations/{inv_id}` | `member_manage` | revoke |
| `POST /invitations/accept` | registered | `{token}` |
| `GET`, `POST /organizations/{id}/verification` | member; owner or `verification_apply` to POST | status or submit |

Admin endpoints, all under `/api/v1/admin`, using `get_admin` and CSRF:

| Method + path | Purpose |
|---|---|
| `GET /organization-applications?status=` | list applications |
| `POST /organization-applications/{id}/approve` | approve |
| `POST /organization-applications/{id}/reject` | `{reason}` |
| `GET /organizations`, `GET /organizations/{id}`, `PATCH /organizations/{id}` | list, view, edit |
| `POST /organizations/{id}/disable`, `POST /organizations/{id}/enable` | disable, enable |
| `GET /verification-applications?status=` | list verification applications |
| `POST /verification-applications/{id}/approve`, `.../reject` | approve, reject |
| `PUT /organizations/{id}/verification` | `{verified: bool}` |
| `GET`, `PUT /settings/org-member-limit-unpaid` | `{value: int ≥ 1}` |

## Error codes

| Status | Code | Used for |
|---|---|---|
| 404 | `not_found` | unusable tenant, unknown role, member, invitation or application |
| 403 | `permission_denied` | missing permission point, owner or own-role protection |
| 403 | `registration_required` | unregistered caller (existing dependency) |
| 409 | `application_pending` | second pending organization or verification application |
| 409 | `already_decided` | approving or rejecting a decided application |
| 409 | `role_name_taken` | duplicate role name |
| 409 | `default_role_protected` | deleting the default role |
| 409 | `member_limit_reached` | creating or accepting an invitation over the limit |
| 409 | `already_member` | accepting while already a member |
| 409 | `owner_protected` | removing the owner, or the owner leaving |
| 410 | `invitation_gone` | accepted, revoked or expired invitation |
| 400 | `validation_error` | with `fields`; includes inviting from a personal tenant (`fields: ["tenant"]`) and a bad transfer target (`fields: ["user_id"]`) |

---

### Task 1: Schema — migration 0004 and models

**Files:**
- Create: `app/models/organization.py`, `app/models/setting.py`, `alembic/versions/0004_tenancy.py`
- Modify: `app/models/__init__.py`, `app/models/tenant.py` (kind check adds `organization`)
- Test: `tests/integration/test_tenancy_schema.py`

**Interfaces:**
- Produces these tables, all in `saiflow_v3`, all with `timestamptz` columns:
  - `organizations`:
    - `tenant_id` (PK, FK tenants), `name`, `contact_phone`, `address` (nullable);
    - `status` CHECK `active|disabled`;
    - `verification_status` CHECK `none|pending|verified|rejected`, default `none`;
    - `legal_name`, `tax_id`, `registered_address`, `verified_at` (all nullable);
    - `created_at`.
  - `organization_applications`:
    - `id`, `applicant_user_id` (FK users), `name`, `contact_phone`, `address`;
    - `status` CHECK `pending|approved|rejected`, `reject_reason`, `decided_by_admin_id` (FK admin_accounts), `decided_at`, `tenant_id` (FK tenants, set on approve), `created_at`;
    - partial unique `(applicant_user_id) WHERE status='pending'`.
  - `roles`:
    - `id`, `tenant_id` (FK tenants), `name`, `permissions` (`text[]`), `is_default` (bool), `created_at`;
    - unique `(tenant_id, name)`; partial unique `(tenant_id) WHERE is_default`.
  - `memberships`:
    - `id`, `tenant_id`, `user_id`, `role_id` (FK roles, nullable — NULL only for the owner), `is_owner` (bool), `joined_at`, `removed_at`;
    - partial unique `(tenant_id, user_id) WHERE removed_at IS NULL`;
    - partial unique `(tenant_id) WHERE is_owner AND removed_at IS NULL`;
    - CHECK `(is_owner AND role_id IS NULL) OR (NOT is_owner AND role_id IS NOT NULL)`;
    - index `(user_id)`.
  - `invitations`:
    - `id`, `tenant_id`, `token_hash` (bytea unique), `created_by_user_id`, `created_at`, `expires_at`, `revoked_at`, `accepted_by_user_id`, `accepted_at`;
    - index `(tenant_id)`.
  - `verification_applications`:
    - `id`, `tenant_id`, `submitted_by_user_id`, `legal_name`, `tax_id`, `registered_address`;
    - `status` CHECK `pending|approved|rejected`, `reject_reason`, `decided_by_admin_id`, `decided_at`, `created_at`;
    - partial unique `(tenant_id) WHERE status='pending'`.
  - `system_settings`: `key` (text PK), `value` (jsonb), `updated_at`.
  - Every FK column is indexed.
- In the migration:
  - `tenants_kind` CHECK becomes `kind in ('personal','guest','organization')`;
  - seed `system_settings('org_member_limit_unpaid', 2)`;
  - **M9:** `REVOKE INSERT, UPDATE, DELETE ON alembic_version FROM <app role>`; mirror the INSERT revoke in `scripts/deploy/db-roles.sql`;
  - no new grants are needed, because the 0003 default privileges cover the new tables.
- No new table has `info={"tenant_scoped": True}`.

- [ ] **Step 1: Write the failing tests**
  - `test_tenancy_tables_exist`: the 7 tables exist.
  - `test_one_owner_per_org_enforced`: a second active `is_owner` row for the same tenant raises `IntegrityError`.
  - `test_owner_has_no_role_and_member_has_one`: the CHECK rejects `is_owner` with a role, and a member without a role.
  - `test_one_pending_application_per_user`: enforced by the partial unique index.
  - `test_app_role_can_write_tenancy_tables`: through `app_role_db`, insert and select on `organizations` and `memberships`.
  - `test_app_role_cannot_write_alembic_version`: through `app_role_db`, an INSERT into `alembic_version` raises a permission error (M9).
  - `test_new_tables_not_tenant_scoped`: none of the new tables is in `claim_service.tenant_scoped_tables()`.
- [ ] **Step 2: Run** `uv run pytest tests/integration/test_tenancy_schema.py -q`. Expected: FAIL (the tables do not exist).
- [ ] **Step 3: Implement** the models and migration 0004 (upgrade and downgrade).
- [ ] **Step 4: Run** the file and the whole suite, then `alembic downgrade 0003 && alembic upgrade head` against the test DB. Expected: all pass; the round trip succeeds.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] schema: organizations, applications, roles, memberships, invitations, verification, settings (M9)`

### Task 2: Permission points and the tenant access rule (FR-SYS-017)

**Files:**
- Create: `app/permissions.py`
- Rewrite: `app/services/tenant_access.py`
- Modify: `app/dependencies.py` (add `get_tenant_context`); `app/routers/me.py` (add `GET /me/tenants`); `app/schemas/organization.py`
- Test: `tests/integration/test_tenancy_access.py`. It uses a test-only router mounted in the test for `/api/v1/_test/items`, which reads and creates `test_tenant_items` through `get_tenant_context`. `test_tenant_items` gains a `created_by_user_id` column in `db_fixtures.py`.

**Interfaces:**
- `class Permission(StrEnum)` has the 13 codes from Global Constraints.
- `ALL: frozenset[Permission]`; `DEFAULT_ROLE: frozenset[Permission] = {UPLOAD_OCR, VERIFY_OWN, EXPORT}`.
- `@dataclass(frozen=True) class TenantContext`:
  - fields `tenant_id: int`, `kind: Literal["personal","guest","organization"]`, `user_id: int | None`, `is_owner: bool`, `role_id: int | None`, `permissions: frozenset[Permission]`;
  - method `def has(self, p: Permission) -> bool`.
- `async def resolve_tenant(db, principal: Principal, tenant_id: int | None) -> TenantContext`:
  - `None` or the principal's own tenant gives that tenant, with `ALL`;
  - otherwise the organization must exist, have status `active`, and have an active membership for `principal.user_id`, and the context is built from the owner flag or the role;
  - anything else → `AppError(404, "not_found", "error.not_found")`;
  - guests can only resolve their own tenant.
- `def require(ctx: TenantContext, p: Permission) -> None` raises 403 `permission_denied`.
- `def submitter_scope(ctx: TenantContext) -> int | None` returns `None` when `ctx.has(DATA_BROWSE)`, else `ctx.user_id`. **This is the B-3 filter for "only what I submitted".**
- `async def usable_tenants(db, user_id: int) -> list[UsableTenant]`: the personal tenant plus active organizations with an active membership. Each entry is `{tenant_id, kind, name, is_owner, role: {id, name} | None, permissions: list[str]}`.
- Dependency `get_tenant_context(request, db, principal=Depends(get_principal)) -> TenantContext`:
  - reads header `X-Tenant-Id`;
  - a value that is not a positive integer → 404, the same body as non-membership;
  - calls `resolve_tenant`.
- `ensure_tenant_access` is removed; update its B-2a callers to `resolve_tenant`.

- [ ] **Step 1: Write the failing tests.** Organizations and memberships are created directly through the models; Task 3 adds the API.
  - `test_no_header_uses_personal_tenant` (AC-FR-SYS-017-01).
  - `test_list_usable_tenants` (AC-FR-SYS-017-02): set up O1 member, O2 owner, O3 removed, O4 disabled. Expect exactly personal, O1 and O2, with roles.
  - `test_personal_data_not_in_org` (AC-FR-SYS-017-03).
  - `test_non_member_and_unknown_tenant_same_404` (AC-FR-SYS-017-04): both bodies have equal `code` and `message_key`.
  - `test_without_data_browse_sees_own_only` (AC-FR-SYS-017-05): items are listed through `submitter_scope`.
  - `test_disabled_org_is_404` (AC-FR-SYS-017-06).
  - `test_bad_tenant_header_is_404` (Review Focus 3): `"abc"`, `"-1"`, another user's personal tenant ID and a guest tenant ID each give 404 with the same body.
  - `test_guest_list_tenants_is_401` (Review Focus 4).
- [ ] **Step 2: Run.** Expected: FAIL (ImportError, then 404 or 405 for the routes).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] tenant access rule and permission points (FR-SYS-017)`

### Task 3: Organization applications and approval (FR-SYS-021, 022-01)

**Files:**
- Create: `app/services/organization_service.py`, `app/routers/organizations.py`, `app/routers/admin_organizations.py`
- Modify: `app/main.py` (include the two routers)
- Test: `tests/integration/test_tenancy_applications.py`

**Interfaces:**
- `async def apply(db, user_id: int, name, contact_phone, address) -> OrganizationApplication`:
  - validates as in Global Constraints;
  - 409 `application_pending` on the partial unique index;
  - audits `org.apply`.
- `async def approve(db, admin_id: int, application_id: int) -> int`:
  - locks the application `FOR UPDATE`; if it is not pending → 409 `already_decided`;
  - in one transaction creates the `tenants` row (kind `organization`), the `organizations` row, the default role (`DEFAULT_ROLE`, `is_default=True`, name `"Member"`) and the owner membership;
  - sets the application to approved with its `tenant_id`;
  - audits `org.approve`;
  - returns the tenant ID.
- `async def reject(db, admin_id, application_id, reason: str | None) -> None`: an empty reason → 400 `fields: ["reason"]`; audits `org.reject`.
- `async def my_applications(db, user_id) -> list[OrganizationApplication]`.
- `async def list_applications(db, status: str | None) -> list[...]`.
- **Hook for B-2c:** `approve` emits nothing yet. B-2c will grant the free quota on approval. Leave an `on_organization_created(db, tenant_id)` no-op in `organization_service`, called inside the approve transaction.

- [ ] **Step 1: Write the failing tests.**
  - `test_apply_ok` (021-01): the application is pending, and no organization exists yet.
  - `test_apply_validation` (021-02): fields `name` and `contact_phone`, with a 129-character name.
  - `test_second_pending_is_409` (021-03).
  - `test_guest_401_unregistered_403` (021-04): no rows are created.
  - `test_approve_creates_org_owner_default_role` (021-05).
  - `test_reject_then_reapply` (021-06).
  - `test_reject_requires_reason` (021-07).
  - `test_decide_twice_409` (021-08).
  - `test_user_owns_two_orgs_isolated` (021-09).
  - `test_admin_lists_pending_only` (022-01).
  - `test_concurrent_approve_once`: two simultaneous approve calls give one 200 and one 409, and only one tenant is created.
- [ ] **Step 2: Run.** Expected: FAIL (404 routes).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] organization applications and admin approval (FR-SYS-021)`

### Task 4: Admin organization management and profile edit (FR-SYS-022, 023)

**Files:**
- Modify: `organization_service.py`, `routers/organizations.py`, `routers/admin_organizations.py`
- Test: `tests/integration/test_tenancy_admin.py`

**Interfaces:**
- `async def update_profile(db, tenant_id, fields: dict, actor: AuditActor) -> None`: shared by the owner or manager and by admin; same validation as apply; audits `org.update`.
- `async def set_status(db, admin_id, tenant_id, status: Literal["active","disabled"]) -> None`: audits `org.disable` or `org.enable`.
- `async def list_organizations(db) -> list[OrgSummary]` and `get_organization(db, tenant_id) -> OrgDetail`. Both include the member count and the verification status.
- The customer `PATCH /organizations/{id}` requires the owner, or `require(ctx, MEMBER_MANAGE)`.

- [ ] **Step 1: Write the failing tests.**
  - `test_disable_and_enable` (022-02).
  - `test_admin_edits_profile` (022-03): includes an invalid phone → 400.
  - `test_admin_endpoints_reject_customer_session` (022-04): approve, disable and patch each give 401 or 403.
  - `test_owner_edits_profile` (023-01).
  - `test_member_without_manage_cannot_edit` (023-02).
  - `test_customer_get_org` returns the profile, the member count and `verification_status`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] admin organization management and profile edit (FR-SYS-022, 023)`

### Task 5: Roles and permission points (FR-SYS-002)

**Files:**
- Create: `app/services/role_service.py`
- Modify: `routers/organizations.py`
- Test: `tests/integration/test_tenancy_roles.py`

**Interfaces:**
- `async def create_role(db, ctx, name, permissions: list[str]) -> Role`:
  - an unknown code → 400 `fields: ["permissions"]`;
  - a duplicate name → 409 `role_name_taken`.
- `async def update_role(db, ctx, role_id, name=None, permissions=None) -> Role`:
  - 403 when `role_id == ctx.role_id` (A5);
  - the default role is editable.
- `async def delete_role(db, ctx, role_id) -> None`:
  - default role → 409 `default_role_protected`;
  - holders are moved to the default role in the same transaction (A4).
- `async def assign_role(db, ctx, user_id, role_id) -> None`:
  - target is the owner, or the target is `ctx.user_id` → 403 `permission_denied`;
  - the role must belong to the same tenant.
- Every function starts with `require(ctx, ROLE_MANAGE)`; audits `role.create`, `role.update`, `role.delete` and `member.role_assign`.

- [ ] **Step 1: Write the failing tests.**
  - `test_permission_enforced` (002-01): uses a test-only endpoint that requires `export`.
  - `test_new_org_default_role` (002-02).
  - `test_custom_role_assign` (002-03).
  - `test_role_validation` (002-04).
  - `test_editing_default_role_takes_effect_next_request` (002-05, Review Focus 2).
  - `test_delete_role_moves_holders_default_protected` (002-06).
  - `test_owner_and_own_role_protected` (002-07).
  - `test_review_and_report_grantable` (002-08).
  - `test_without_role_manage_403` (002-09).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] roles and permission points (FR-SYS-002)`

### Task 6: Invitations and the member limit (FR-SYS-024, 025)

**Files:**
- Create: `app/services/membership_service.py`, `app/services/settings_service.py`
- Modify: `routers/organizations.py`, `routers/admin_organizations.py`
- Test: `tests/integration/test_tenancy_invitations.py`

**Interfaces:**
- `async def get_int(db, key: str, default: int) -> int` and `async def set_int(db, key: str, value: int, admin_id: int) -> None`. `set_int` audits `setting.update`; a value < 1 → 400.
- `async def member_limit(db, tenant_id: int) -> int | None`. `None` means unlimited. **B-2c extends this function with plan-based limits;** for now it returns `get_int("org_member_limit_unpaid", 2)`.
- `async def seats_used(db, tenant_id: int, now) -> int` counts active memberships plus open invitations (not accepted, not revoked, `expires_at > now`).
- `async def create_invitation(db, ctx) -> tuple[Invitation, str]`:
  - `ctx.kind != "organization"` → 400 `fields: ["tenant"]`;
  - `require(ctx, MEMBER_MANAGE)`;
  - `SELECT … FOR UPDATE` on `organizations`;
  - limit reached → 409 `member_limit_reached`;
  - stores the hash, returns the token;
  - audits `invitation.create`.
- `async def revoke_invitation(db, ctx, invitation_id) -> None`: audits `invitation.revoke`.
- `async def accept(db, user_id, token) -> int`:
  - looks up by hash, missing → 410;
  - locks the organization row;
  - accepted, revoked or expired → 410 `invitation_gone`;
  - an active member → 409 `already_member`;
  - `seats_used` excluding this invitation ≥ limit → 409;
  - otherwise creates a membership with the default role;
  - audits `invitation.accept`;
  - returns the tenant ID.
- `async def list_open_invitations(db, ctx)` lists invitations with `id`, `created_at` and `expires_at`, never the token.

- [ ] **Step 1: Write the failing tests.**
  - `test_invite_and_accept` (024-01).
  - `test_invitation_single_use` (024-02).
  - `test_expired_and_revoked_410` (024-03): expiry is tested through `app.clock` patched 7 days plus 1 second ahead.
  - `test_guest_401_unregistered_403_invitation_still_valid` (024-04).
  - `test_already_member_409` (024-05).
  - `test_no_manage_403_personal_400` (024-06).
  - `test_token_never_stored_or_logged` (024-07): the token string is absent from `repr` of every row in `invitations` and `audit_log`.
  - `test_limit_blocks_invite` (025-01).
  - `test_revoke_frees_seat` (025-02).
  - `test_lowering_limit_keeps_members` (025-03).
  - `test_concurrent_accept_respects_limit` (025-04, Review Focus 1): uses `asyncio.gather` of two accepts.
  - `test_admin_sets_member_limit`: PUT then GET returns the new value; a value of 0 → 400.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] invitations and member limit (FR-SYS-024, 025)`

### Task 7: Remove, leave, owner transfer (FR-SYS-026, 029)

**Files:**
- Modify: `membership_service.py`, `routers/organizations.py`
- Test: `tests/integration/test_tenancy_members.py`

**Interfaces:**
- `async def remove_member(db, ctx, user_id) -> None`:
  - `require(ctx, MEMBER_MANAGE)`;
  - target is the owner → 409 `owner_protected`;
  - sets `removed_at`;
  - audits `member.remove`.
- `async def leave(db, ctx) -> None`: the owner → 409 `owner_protected`; audits `member.leave`.
- `async def transfer_owner(db, ctx, user_id) -> None`:
  - not the owner → 403;
  - locks the organization row;
  - the target must be an active member other than self, else 400 `fields: ["user_id"]`;
  - in one transaction the old owner becomes `is_owner=False` with the default role, and the target becomes `is_owner=True` with `role_id=NULL`; flip the old owner first so the partial unique index holds;
  - audits `org.owner_transfer`.
- `async def list_members(db, ctx)` returns `user_id`, `display_name`, `is_owner`, `role {id, name}` and `joined_at`.

- [ ] **Step 1: Write the failing tests.**
  - `test_remove_member_keeps_data` (026-01).
  - `test_leave` (026-02).
  - `test_owner_cannot_be_removed_or_leave` (026-03).
  - `test_reinvite_after_removal` (026-04).
  - `test_transfer_owner` (029-01).
  - `test_old_owner_can_leave_after_transfer` (029-02).
  - `test_transfer_target_must_be_other_member` (029-03).
  - `test_only_owner_transfers` (029-04).
  - `test_concurrent_transfers_one_owner` (Review Focus 1): two transfers to different members at the same time leave exactly one owner.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] member removal, leaving and owner transfer (FR-SYS-026, 029)`

### Task 8: Enterprise verification (FR-SYS-027)

**Files:**
- Create: `app/services/verification_service.py`
- Modify: both routers
- Test: `tests/integration/test_tenancy_verification.py`

**Interfaces:**
- `async def submit(db, ctx, legal_name, tax_id, registered_address) -> VerificationApplication`:
  - requires the owner or `VERIFICATION_APPLY`;
  - the tax ID must match `^[0-9]{13}$`;
  - 409 `application_pending`;
  - sets `organizations.verification_status='pending'`;
  - audits `verification.submit`.
- `async def approve(db, admin_id, application_id)`: copies the three fields to `organizations`, sets status `verified` and `verified_at`; audits `verification.approve`.
- `async def reject(db, admin_id, application_id, reason)`: the reason is required; sets status `rejected`; audits `verification.reject`.
- `async def set_verified(db, admin_id, tenant_id, verified: bool)`: `verified` or `none`; audits `verification.set` or `verification.unset`.
- `async def status(db, ctx) -> VerificationStatus` returns `{status, legal_name, tax_id, registered_address, reject_reason}`; the reason comes from the latest decided application. It is visible to any member.

- [ ] **Step 1: Write the failing tests.**
  - `test_submit_and_approve` (027-01).
  - `test_verification_validation` (027-02): tax IDs `"123"` and `"12345678901ab"` → `fields: ["tax_id"]`.
  - `test_reject_and_resubmit` (027-03).
  - `test_second_pending_409` (027-04).
  - `test_admin_direct_set_and_unset` (027-05).
  - `test_without_permission_403` (027-06).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] enterprise verification (FR-SYS-027)`

### Task 9: Audit coverage; API tests run as the app role (FR-SYS-028, M6)

**Files:**
- Modify: `tests/integration/db_fixtures.py`
  - The `api` fixture's engine connects as `saiflow_v3_app`. `db` stays the superuser for setup and assertions.
  - `_ensure_app_role` always runs `ALTER ROLE … PASSWORD`, so an existing local role with another password still works (M6).
- Test: `tests/integration/test_tenancy_audit.py`

- [ ] **Step 1: Write the failing test** `test_org_operations_audited` (028-01). In order: apply, admin approve, invite, accept, remove. The `audit_log` actions in time order are `org.apply`, `org.approve`, `invitation.create`, `invitation.accept`, `member.remove`. Each has an actor, target and result. The token is absent.
- [ ] **Step 2: Switch the `api` fixture to the app role** and run the whole suite. Expected: any grant missing for a table used by the API makes a test fail. If nothing fails, record that in the ledger. The audit test fails until any missing action is added.
- [ ] **Step 3: Fix** missing audit actions or grants.
- [ ] **Step 4: Run** the whole suite. Expected: pass, with the API running as the app role.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] audit coverage for organization operations; API tests run as the app role (FR-SYS-028, M6)`

### Task 10: Identity Minors in code (M1, M2, M3, M8)

**Files:**
- Modify: `app/rate_limit.py`, `app/routers/auth.py` (key), `app/integrations/email.py`, `app/services/admin_service.py`
- Test: `tests/unit/test_rate_limit.py`, `tests/unit/test_smtp_sender.py`, `tests/integration/test_hardening.py`

**Interfaces:**
- **M1:**
  - `SlidingWindowLimiter.hit` drops idle keys at most once per `window`, by keeping `_next_sweep`; it never scans every key on each call.
  - `def client_key(host: str) -> str` in `rate_limit.py`: an IPv6 address becomes its `/64` network string; IPv4 and anything else are unchanged.
- **M2:** `_is_recipient_rejection` is true only when every refused recipient has code 550, 551 or 553, or an enhanced status starting with `5.1.`. Any other 5xx stays `EmailUnavailable`.
- **M3:** `_is_transient` is also true for `SMTPRecipientsRefused` when every refused code is 4xx.
- **M8:**
  - `normalize_username(raw)` returns `raw.strip(" ").lower()`, matching SQL `btrim`;
  - `create_admin` rejects names not matching `^[a-z0-9._-]{1,64}$` after normalising, so Python and SQL agree;
  - the existing server account `admin` matches.

- [ ] **Step 1: Write the failing tests.**
  - `test_sweep_at_most_once_per_window`: hitting 10,000 distinct keys inside one window performs a single sweep; count the sweeps by patching.
  - `test_ipv6_keyed_by_64`: `2001:db8::1` and `2001:db8::2` share a key; `203.0.113.1` stays itself.
  - `test_relay_denied_is_not_rejected`: 554 `5.7.1` → `EmailUnavailable`, not `EmailRejected`.
  - `test_550_511_is_rejected`: 550 `5.1.1` → `EmailRejected`.
  - `test_rcpt_4xx_retried`: 450 refused → 4 calls.
  - `test_admin_username_charset`: `"op s"`, `"ops\t"` and `"Ünï"` → `ValueError`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite. Expected: pass.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] identity minors: limiter sweep and IPv6 /64, SMTP refusal classes, RCPT 4xx retry, username charset (M1-M3, M8)`

### Task 11: Deploy Minors, doc sync, contract (M4, M5, M7)

**Files:**
- Modify:
  - `scripts/deploy/postgres-init/01-app-user.sh` (**M4:** grant CONNECT only, correct the comment);
  - `scripts/deploy/db-roles.sh` and `scripts/deploy/remote-deploy.sh` (**M5:** strip one pair of surrounding `"` or `'` from the value);
  - `scripts/tests/remote-deploy.test.sh`, `scripts/tests/compose-config.test.sh`;
  - `docs/deployment/README.md` (**M7:** in §4 Rollback, say that downgrading below 0003 needs `db-roles.sql` plus manual grants, and that rolling back the image is the supported path).
- Docs:
  - `docs/10-product/PRD-SaiFlow.md` §4.9 and its version history;
  - `docs/10-product/Glossary.md`: "团队租户" becomes "组织（Organization）"; remove "原地升级"; add organization application, organization free quota and owner transfer;
  - `docs/30-design/Data-Model.md`: `DM-Tenant` gains organization; `DM-Enterprise` becomes the organization profile and verification; `DM-Membership`, `DM-Role`, `DM-Invitation`, `DM-SystemSetting`; and the B-2b implemented note;
  - `docs/30-design/adr/ADR-006-ai-native-workflow.md` §7, the B-2b and B-2c rows;
  - `docs/30-design/adr/ADR-009-reuse-main-backend.md` §4, the multi-tenant row, which now reads "D1: personal tenant permanent; organizations separate";
  - `docs/20-requirements/functional/EPIC-06-system-base.md`: FR-SYS-002, 009 and 017 marked migrated to `openspec/specs/tenancy`;
  - `docs/20-requirements/Requirements-Index.md`: FR-SYS-021…029 rows.
- Contract: regenerate `docs/30-design/openapi.json` and `packages/api-client/src/generated`.

- [ ] **Step 1: Write the failing shell assertions.**
  - `remote-deploy.test.sh`: `.env` with `DB_MIGRATE_PASSWORD="mig-secret-9"` reaches the fake psql without quotes.
  - `compose-config.test.sh`: `01-app-user.sh` does not grant CREATE.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement** the scripts and the docs. Each doc gets a version bump and a history row that records only content changes.
- [ ] **Step 4: Run** all `scripts/tests/*.test.sh`, shellcheck, actionlint and `bash scripts/check-generated-clean.sh docs/30-design/openapi.json packages/api-client/src/generated` after regeneration. Expected: all green.
- [ ] **Step 5: Commit** `[rebuild-tenant-rbac] deploy minors (M4, M5, M7), doc sync for the organization model, contract`

### Task 12: Verification and rollout (owner checkpoints)

- [ ] **Step 1:** Run the full suite and push; CI must be green.
- [ ] **Step 2 (owner):** The owner confirms the deploy.
- [ ] **Step 3 (after deploy):** Run the following on the server:
  - `audit-verify` OK;
  - a guest calling `GET /me/tenants` → 401;
  - an admin call without a session → 401;
  - `restore-check.sh` OK.
- [ ] **Step 4:** Write `verification.md` (56 ACs → test → result; Minors M1–M9 → test) and commit it. Then run `/opsx:archive rebuild-tenant-rbac`.

## Owner checkpoints

1. Review this plan.
2. Confirm the deploy (Task 12).
3. Confirm the archive.
