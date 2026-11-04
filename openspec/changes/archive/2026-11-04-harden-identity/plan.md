# harden-identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 10 issues left by the B-2a final review: four behaviour changes from the confirmed delta spec, four defect and quality fixes, and the split between a migration database account and the application account.

**Architecture:** All work is in `services/api` and `scripts/deploy`. No new endpoints or entities. The guest rate limit is an in-process sliding window: the API runs as one uvicorn process, so in-memory state is enough. The database gets a second login role, `saiflow_v3_migrator`. It owns the schema and runs Alembic. The app role `saiflow_v3_app` keeps only the DML grants it needs and has no UPDATE or DELETE on `audit_log`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, aiosmtplib, PostgreSQL 18, Docker Compose, GitHub Actions.

**Spec:** `openspec/changes/harden-identity/specs/identity/spec.md` (delta). Read it with `proposal.md` in the same folder. The main spec is `openspec/specs/identity/spec.md`.

## Global Constraints

- Guest limit: at most 30 guest sessions per source IP in any rolling 60 s. Above that, the response is HTTP 429 and no session or tenant is created (AC-FR-SYS-010-07).
- A permanent rejection of the recipient returns HTTP 400 with code `email_rejected` and `fields: ["email"]`, after exactly one SMTP attempt. Every other failure stays 503 `email_unavailable` (AC-FR-SYS-020-06/07/09).
- Logout always returns 204 and clears the `saiflow_session` cookie (AC-FR-SYS-001-10).
- A LINE login that carries a valid **user** session revokes that session. Other devices are untouched. Guest handling is unchanged (AC-FR-SYS-001-09).
- Admin usernames are compared and stored as `raw.strip().lower()` (AC-FR-SYS-019-08).
- The app DB role cannot drop or disable the audit triggers, truncate `audit_log`, drop it, or update or delete its rows (AC-FR-SYS-003-03/06).
- Error bodies keep the `ErrorResponse` shape. Request models stay "all fields optional". A missing required field outside identity bodies stays 422, as platform-baseline requires.
- Credentials come only from environment variables (`/opt/saiflow/.env`) and GitHub Secrets. The new variable is `DB_MIGRATE_PASSWORD`.
- `legacy/` is read-only. Commit messages start with `[harden-identity]`.

## Review Focus

1. **The guest limit must see the real client IP, not Caddy's.** If uvicorn ignores `X-Forwarded-For`, every visitor shares one bucket and the 31st visitor in a minute gets 429. Task 3 sets `FORWARDED_ALLOW_IPS` in compose and asserts it in `compose-config.test.sh`. Task 9's server check makes 31 quick requests from one machine and confirms another IP still gets in.
2. **An SMTP 535 (our own account rejected) is not `email_rejected`.** Only a recipient refusal with a 5xx code is the user's fault. Task 4 has a test that 535 stays 503.
3. **A deploy with `DB_MIGRATE_PASSWORD` missing must fail before the app restarts.** The running version keeps serving. Task 8 tests that the compose interpolation fails without the variable.
4. **The nightly restore check must still restore a dump that references the new role.** Task 8 makes `restore-check.sh` create both roles. Task 9 runs it on the server.
5. **A field value that is an object or array (not only a number) must also give 400.** A body that is not a JSON object at all may stay 422. Task 1 tests the object case.

---

### Task 1: Non-string field values give 400, not 422

**Files:**
- Modify: `services/api/app/schemas/me.py`, `app/schemas/auth.py`, `app/schemas/admin.py`, `app/routers/me.py`, `app/routers/auth.py`, `app/routers/admin_auth.py`, `app/services/user_service.py` (`register`)
- Test: `services/api/tests/integration/test_hardening.py` (new)

**Interfaces:**
- Produces:
  - `class LooseRequest(BaseModel)` in `app/schemas/common.py`, the base for every identity request body. It has a `mode="before"` model validator. For each declared field whose incoming value is not `str` or `None`, the validator removes that value and adds the field name to `invalid_fields: SkipJsonSchema[list[str]] = Field(default_factory=list, exclude=True)`.
  - `def ensure_text(req: LooseRequest) -> None` raises `AppError(400, "validation_error", "error.validation", req.invalid_fields)` when the list is non-empty.
- Every identity handler calls `ensure_text(req)` first. The one exception is registration: `user_service.register` keeps its 409 `already_registered` check first, and then merges `invalid_fields` into its field errors. This keeps the earlier review fix.

- [ ] **Step 1: Write the failing tests** (`api`, `line`, `mail` fixtures; `login` helper)
  - `test_non_string_profile_field_is_400`: after `register(...)`, `PATCH /api/v1/me` with `{"display_name": 123}` gives 400, `fields == ["display_name"]`, and the profile is unchanged.
  - `test_object_value_is_400`: `POST /api/v1/me/email-code` with `{"email": {"a": 1}}` gives 400 and `fields == ["email"]`.
  - `test_admin_login_non_string_is_400`: `{"username": ["ops"], "password": "x"}` gives 400.
  - `test_registered_user_with_non_string_still_409`: `POST /api/v1/me/registration` with `{"display_name": 5}` from a registered user gives 409.
- [ ] **Step 2: Run** `uv run pytest tests/integration/test_hardening.py -q` (integration env). Expected: 4 FAIL, with 422 where 400 or 409 is wanted.
- [ ] **Step 3: Implement** as in Interfaces. `ProfileUpdate.model_dump(exclude_unset=True)` must not include `invalid_fields`.
- [ ] **Step 4: Run** the file and the whole suite. Expected: all pass. The OpenAPI test may fail only if the schema changed; regenerate in Task 8.
- [ ] **Step 5: Commit** `[harden-identity] non-string field values give 400 (AC-FR-SYS-014-03, 015-03)`

### Task 2: Logout always succeeds; re-login revokes the old session

**Files:**
- Modify: `app/routers/auth.py` (`logout`), `app/services/auth_service.py` (`login_with_line`)
- Test: `tests/integration/test_hardening.py`

**Interfaces:**
- `logout` depends on `get_optional_principal`.
  - With a principal, it revokes the session and writes the `customer.logout` audit row, as today.
  - Without one, it writes nothing.
  - Either way it returns 204 with `clear_session_cookie`.
- In `login_with_line`, `current.kind == "user"` leads to `session_service.revoke(db, current.session_id)` in the same transaction as the new session.

- [ ] **Step 1: Write the failing tests**
  - `test_relogin_revokes_carried_session` (AC-FR-SYS-001-09): log in on client A (S1) and on a second client B with the same LINE `sub` (S2). Log in again on A, getting S3. A request with S1's cookie value gives 401. S2 and S3 give 200.
  - `test_logout_with_dead_session_succeeds` (AC-FR-SYS-001-10): logout with a random cookie value, with an already logged-out session, and with no cookie. Each gives 204, and the `set-cookie` for `saiflow_session` has `Max-Age=0`.
- [ ] **Step 2: Run.** Expected: the first fails because S1 is still 200; the second fails with 401.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** the file plus `tests/integration/test_sessions.py` and `test_review_fixes.py`. Expected: pass.
- [ ] **Step 5: Commit** `[harden-identity] re-login revokes the carried session; logout always succeeds (AC-FR-SYS-001-09, 001-10)`

### Task 3: Guest session rate limit

**Files:**
- Create: `app/rate_limit.py`
- Modify: `app/main.py` (lifespan: `app.state.guest_limiter`, unless already set), `app/dependencies.py` (`get_guest_limiter`), `app/routers/auth.py` (`create_guest_session`), `scripts/deploy/compose.yaml` (api `FORWARDED_ALLOW_IPS: "*"`, with a comment that the api has no published port and Caddy overwrites incoming `X-Forwarded-For`), `scripts/deploy/compose-config.test.sh`
- Test: `tests/unit/test_rate_limit.py` (new), `tests/integration/test_hardening.py`

**Interfaces:**
- Produces: `class SlidingWindowLimiter(limit: int, window: timedelta, clock: Callable[[], datetime] = utcnow)` with `def hit(self, key: str) -> bool`.
  - It returns False without recording when `key` already has `limit` hits inside `window`. Otherwise it records the hit and returns True.
  - It drops timestamps older than `window`, and deletes keys that have no timestamps left.
- Guest values: `SlidingWindowLimiter(30, timedelta(seconds=60))`.
  - The key is `request.client.host`, or `"unknown"` when there is none.
  - The limiter is checked only when a new guest session is about to be created. A request that already carries a session is not counted.
  - Over the limit: `AppError(429, "guest_too_many", "error.guest_too_many")`.

- [ ] **Step 1: Write the failing tests**
  - Unit, with a fake clock:
    - `test_allows_limit_then_blocks`: 30 hits are True; the 31st is False.
    - `test_window_slides`: after 60 s and a tiny step, the next hit is True.
    - `test_keys_independent`: another key still gets True.
    - `test_idle_keys_are_dropped`: once a key's timestamps expire, a hit on another key removes it from the internal dict.
  - Integration, `test_guest_limit_per_ip` (AC-FR-SYS-010-07):
    - Inject `SlidingWindowLimiter(30, …, fake clock)` before the lifespan runs.
    - Build clients whose transport uses `ASGITransport(app, client=("203.0.113.1", 1))` and `("203.0.113.2", 1)`. Use a fresh client per call, so no cookie is carried.
    - 30 calls from .1 succeed; the 31st gives 429 and the tenant count does not change; .2 succeeds; after the clock moves past 60 s, .1 succeeds.
  - `compose-config.test.sh`: the rendered api service has `FORWARDED_ALLOW_IPS: '*'`.
- [ ] **Step 2: Run.** Expected: ImportError, then 31 calls succeed (no 429); the shell test FAILs.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit and integration tests and `bash scripts/deploy/compose-config.test.sh`. Expected: pass.
- [ ] **Step 5: Commit** `[harden-identity] guest sessions limited to 30 per IP per 60 s (AC-FR-SYS-010-07)`

### Task 4: Recipient rejected gives 400 `email_rejected`

**Files:**
- Modify: `app/integrations/email.py`, `app/services/email_code_service.py`
- Test: `tests/unit/test_smtp_sender.py`, `tests/integration/test_hardening.py`, `tests/integration/fake_email.py` (if it needs a way to raise `EmailRejected`)

**Interfaces:**
- Produces: `class EmailRejected(EmailUnavailable)`.
  - `SmtpSender.send` raises it when the final error is `aiosmtplib.SMTPRecipientsRefused` and every refused recipient has code ≥ 500, or when it is an `SMTPRecipientRefused` with code ≥ 500.
  - It is not retried. Its message is the same `_reason` text.
  - Every other failure stays `EmailUnavailable`, including 535 and sender refusals.
- `send_code` catches `EmailRejected` before `EmailUnavailable` and raises `AppError(400, "email_rejected", "error.email_rejected", ["email"])`. No code row is written, so the 60 s timer does not start.

- [ ] **Step 1: Write the failing tests**
  - Unit `test_recipient_refused_5xx_is_rejected_once`: `SMTPRecipientsRefused([SMTPRecipientRefused(550, "no such user", "a@example.com")])` raises `EmailRejected`, with 1 call.
  - Unit `test_auth_failure_is_not_rejected`: `SMTPAuthenticationError(535, "bad")` raises `EmailUnavailable` and not `EmailRejected`.
  - Integration `test_email_rejected_400_and_can_resend` (AC-FR-SYS-020-09): the fake mail raises `EmailRejected` for `bad@example.com`. Expect 400, code `email_rejected` and `fields == ["email"]`. No `email_codes` row exists. An immediate send to `good@example.com` gives 204.
- [ ] **Step 2: Run.** Expected: FAIL (no `EmailRejected`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/unit/test_smtp_sender.py`, `test_email_code.py`, `test_hardening.py`. Expected: pass.
- [ ] **Step 5: Commit** `[harden-identity] permanent recipient rejection gives 400 email_rejected (AC-FR-SYS-020-09)`

### Task 5: Admin usernames are case- and space-insensitive

**Files:**
- Modify: `app/services/admin_service.py`
- Test: `tests/integration/test_hardening.py`

**Interfaces:**
- Produces: `def normalize_username(raw: str) -> str` returns `raw.strip().lower()`.
- It is used at the top of `create_admin`, `disable_admin`, `reset_password` and `login`. In `login` it runs after the type check from Task 1.
- `create_admin` rejects a name that is empty after normalising, with `ValueError`. The CLI already prints that as `admin-create failed`.

- [ ] **Step 1: Write the failing test** `test_admin_username_case_insensitive` (AC-FR-SYS-019-08):
  - `create_admin(db, "Ops", PASSWORD)`.
  - Login with `" ops "` gives 200.
  - `create_admin(db, "OPS", PASSWORD)` raises `ValueError`, and the `admin_accounts` count is 1.
- [ ] **Step 2: Run.** Expected: login 401.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this test and `tests/integration/test_admin_auth.py`. Expected: pass.
- [ ] **Step 5: Commit** `[harden-identity] admin usernames normalised (AC-FR-SYS-019-08)`

### Task 6: No audit row for a no-op profile update; CLI password without echo

**Files:**
- Modify: `app/services/user_service.py` (`update_profile`), `app/cli.py` (`_admin`)
- Test: `tests/integration/test_hardening.py`, `tests/unit/test_cli_admin.py` (new, or extend an existing CLI test)

**Interfaces:**
- `update_profile` still validates and returns as today. It writes the `user.profile_update` audit row only when at least one stored value actually changed.
- `_admin` reads the password with `getpass.getpass("password: ")` when `sys.stdin.isatty()`. Otherwise it reads `sys.stdin.readline()` as today, so `$p | ssh … admin-reset-password` keeps working.

- [ ] **Step 1: Write the failing tests**
  - `test_noop_profile_update_not_audited`: a registered user sends `PATCH {}` and then `PATCH` with the current `display_name`. Both give 200, and the count of `user.profile_update` rows does not change.
  - `test_cli_reads_password_without_echo_on_tty`: monkeypatch `sys.stdin.isatty` to True and `getpass.getpass` to return the password. Monkeypatch `admin_service.create_admin` to capture the password. `cli.main(["admin-create", "ops"])` passes the `getpass` value.
- [ ] **Step 2: Run.** Expected: both FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both plus `tests/integration/test_profile.py`. Expected: pass.
- [ ] **Step 5: Commit** `[harden-identity] no audit row for unchanged profile; password prompt without echo`

### Task 7: Migration 0003: indexes, username data, app-role grants

**Files:**
- Create: `services/api/alembic/versions/0003_hardening.py`
- Modify: `tests/integration/db_fixtures.py` (before migrating, create `saiflow_v3_app` with `LOGIN PASSWORD 'local-app'` if it does not exist; expose a fixture `app_role_conn` connecting as that role), `app/models/` (index declarations, so autogenerate stays clean)
- Test: `tests/integration/test_db_roles.py` (new)

**Interfaces:**
- The migration reads the app role name from `os.environ.get("DB_APP_USER", "saiflow_v3_app")`. In `upgrade()` it does the following:
  - `CREATE INDEX ix_email_codes_user_sent ON email_codes (user_id, sent_at)` and `CREATE INDEX ix_customer_sessions_user ON customer_sessions (user_id)`.
  - `UPDATE admin_accounts SET username = lower(btrim(username))`, plus `CHECK (username = lower(btrim(username)))` named `ck_admin_accounts_username_normalized`.
  - `GRANT USAGE ON SCHEMA saiflow_v3`; `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA saiflow_v3`; `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA saiflow_v3`.
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA saiflow_v3` for the same table and sequence grants.
  - `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM <app>`.
- `downgrade()` reverses the indexes and the check constraint, revokes the grants, and drops the default privileges.

- [ ] **Step 1: Write the failing tests** (AC-FR-SYS-003-06; reuse the setup of AC-FR-SYS-003-03)
  - `test_app_role_cannot_disable_audit_protection`: as the app role, each of these raises `asyncpg` `InsufficientPrivilegeError` (or SQLAlchemy `ProgrammingError` wrapping it), each in its own transaction:
    - `ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete`
    - `DROP TRIGGER audit_log_no_update_delete ON audit_log`
    - `TRUNCATE audit_log`
    - `DROP TABLE audit_log`
    - `DELETE FROM audit_log`

    The row count is unchanged afterwards.
  - `test_app_role_can_use_identity_tables`: as the app role, insert and select `tenants` and insert `audit_log` through `audit_service.record`. Both succeed.
  - `test_indexes_exist`: `pg_indexes` contains both index names.
- [ ] **Step 2: Run.** Expected: FAIL. Without grants, the app role cannot even select.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite and `uv run alembic check` (or the existing autogenerate-clean test). Expected: all pass.
- [ ] **Step 5: Commit** `[harden-identity] migration 0003: indexes, normalised usernames, least-privilege app role (AC-FR-SYS-003-06)`

### Task 8: Deploy: migration account, role setup, restore check, docs, contract

**Files:**
- Create: `scripts/deploy/postgres-init/roles.sql`. It is idempotent and runs as `POSTGRES_USER` with the psql variable `migrate_password`. It does the following:
  - Creates `saiflow_v3_migrator LOGIN` if missing, then `ALTER ROLE … PASSWORD :'migrate_password'`.
  - `GRANT CONNECT, CREATE ON DATABASE saiflow` to the migrator.
  - `REVOKE CREATE ON DATABASE saiflow FROM saiflow_v3_app`.
  - `GRANT CONNECT` to the app.
  - `REASSIGN OWNED BY saiflow_v3_app TO saiflow_v3_migrator`.
  - It is not a `.sh` file, so the image entrypoint does not run it on first init.
- Modify `scripts/deploy/compose.yaml`:
  - Add a new service `saiflow-be-migrate` with `profiles: ["tools"]`, the same image, `DB_USER: saiflow_v3_migrator`, `DB_PASSWORD: ${DB_MIGRATE_PASSWORD:?}`, `DB_APP_USER: saiflow_v3_app`, and `command: alembic upgrade head`.
  - Update the header comment.
- Modify `scripts/deploy/remote-deploy.sh`. Before migrating, pipe `roles.sql` into `compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d saiflow -v migrate_password="$DB_MIGRATE_PASSWORD"`, reading `DB_MIGRATE_PASSWORD` from `.env`. Then `compose run --rm saiflow-be-migrate`.
- Modify `.github/workflows/ci.yml` (the compose smoke job):
  - Write `DB_MIGRATE_PASSWORD` into the throwaway `.env`.
  - Run the same roles step and the migrate service instead of `run --rm saiflow-be-api alembic upgrade head`.
- Modify `scripts/deploy/restore-check.sh`: also `CREATE ROLE saiflow_v3_migrator` before `pg_restore`.
- Modify `scripts/deploy/env.example`, `scripts/vps-bootstrap.sh` (generate `DB_MIGRATE_PASSWORD` with `openssl rand -hex 16` for new servers), `scripts/deploy/compose-config.test.sh`.
- Docs:
  - `docs/deployment/README.md`: the new variable, what the first deploy after this change does, and the owner's one manual step.
  - `docs/30-design/Data-Model.md`: database accounts and privileges.
  - `services/api/README.md`.
- Contract: regenerate `docs/30-design/openapi.json` and `packages/api-client/src/generated` (new 429, 400 `email_rejected`, logout without 401).
- Test: `scripts/deploy/compose-config.test.sh`, `scripts/tests/workflow-config.test.sh` if it asserts the migrate command, shellcheck, actionlint.

- [ ] **Step 1: Write the failing shell assertions** in `compose-config.test.sh`:
  - (a) With `DB_MIGRATE_PASSWORD` unset, `docker compose config` exits non-zero and names the variable.
  - (b) With it set, the `saiflow-be-migrate` service has `DB_USER: saiflow_v3_migrator` and profile `tools`.
  - (c) The api service still has `DB_USER: saiflow_v3_app`.
- [ ] **Step 2: Run** `bash scripts/deploy/compose-config.test.sh`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Verify locally.**
  - Run the compose test, shellcheck and actionlint (scratchpad binaries), and the CI contract check script.
  - Run a throwaway local stack, as the CI smoke job does: empty volume, roles step, migrate service, api up, `GET /api/health` 200, and `restore-check.sh` against a dump.
  - Expected: all green.
- [ ] **Step 5: Commit** `[harden-identity] deploy: separate migration account, role setup, restore check, docs, contract`

### Task 9: Verification record and server rollout (owner checkpoints)

**Files:**
- Create: `openspec/changes/harden-identity/verification.md`. It maps each of the 40 ACs in the delta to its test and result, and holds the server checks below.

- [ ] **Step 1:** Full suite with the local DB, then push, then CI green.
- [ ] **Step 2 (owner):** Add `DB_MIGRATE_PASSWORD=<openssl rand -hex 16>` to `/opt/saiflow/.env`. **Checkpoint:** the owner confirms, then I trigger Deploy.
- [ ] **Step 3 (after deploy):** Run these checks:
  - Guest: 31 rapid `POST /api/v1/auth/guest` from this machine, without cookies. The 31st gives 429, and a request from the owner's browser or phone at the same moment succeeds.
  - Logout with no cookie gives 204.
  - Owner runs `audit-verify` and gets `audit log OK`.
  - Owner runs, as root in `/opt/saiflow`:

    ```
    docker compose exec -T postgres psql -U "$POSTGRES_USER" -d saiflow -c "\dt saiflow_v3.*"
    ```

    and confirms the owner column shows `saiflow_v3_migrator`.
  - Owner runs `restore-check.sh` and gets OK.
- [ ] **Step 4:** Commit `verification.md`, then run `/opsx:archive harden-identity` (sync the delta into `openspec/specs/identity/spec.md`).

## Owner checkpoints

1. Review this plan.
2. Add `DB_MIGRATE_PASSWORD` to the server `.env` before the deploy (Task 9 Step 2).
3. Confirm the deploy.
4. Run the three server commands in Task 9 Step 3.
