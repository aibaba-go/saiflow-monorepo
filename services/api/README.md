# saiflow-ocr backend

Flask 3 backend for the saiflow LINE MINI App (PRD v1.2). All business APIs
live under `/api/v1` and require the HttpOnly cookie session `saiflow_session`
plus the `X-CSRF-Token` header on writes. The only anonymous-whitelisted
endpoint is `POST /api/v1/auth/line`.

## Quick start

```bash
pip install -r requirements-dev.txt
python app.py            # dev server on :5000
```

Tests:

```bash
pytest -q
```

## Configuration (`.env`)

```dotenv
# TextIn OCR (sole vendor, PRD §12)
TEXTIN_APP_ID=...
TEXTIN_SECRET_CODE=...
TEXTIN_ENDPOINT=https://api.textin.ai/api/v1/xparse/parse/sync
TEXTIN_EXTRACT_ENDPOINT=https://api.textin.ai/api/v1/xparse/extract/sync
OCR_STORAGE_DIR=./temp/extractions
OCR_UPLOADS_DIR=./temp/uploads
TEXTIN_TIMEOUT_SECONDS=60
TEXTIN_CONNECT_TIMEOUT_SECONDS=10

# DeepSeek (template matching / conversion; generic tidy-up when mapping is off)
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_SECONDS=120

# Template mapping (EPIC-08). Default off.
TEMPLATE_MAPPING_ENABLED=false
TEMPLATE_LOW_SCORE_THRESHOLD=0.7
TEMPLATE_MAX_MAPPINGS_PER_JOB=5
```

> **Keep `TEMPLATE_MAPPING_ENABLED=false` locally.** Local dev shares the
> production database; with the flag on, the local MappingWorker would pick up
> and process production mapping jobs.

## Document templates (CLI)

Templates have no admin UI yet; maintain them with `manage_templates.py`
(writes go to the configured database — confirm the target before `--yes`):

```bash
python manage_templates.py validate --file templates_seed/tax_invoice.json  # offline check
python manage_templates.py seed --dry-run         # preview system seeds (templates_seed/*.json)
python manage_templates.py seed --yes             # import / bump system templates (idempotent)
python manage_templates.py import --file my.json --tenant-id 12 --yes   # tenant template
python manage_templates.py list [--system | --tenant-id 12] [--include-deleted]
python manage_templates.py show --id 3 [--version 2]
python manage_templates.py export --id 3
python manage_templates.py enable|disable|delete --id 3 --yes
```

Built-in system templates: `system.billing_note` (Billing Note / ใบวางบิล) and
`system.tax_invoice` (Tax Invoice / ใบกำกับภาษี). Both definitions are business-approved
and pass offline validation; importing them into the shared database requires
separate authorization. `validate` does not connect to the database; `--dry-run`
may connect and is not an offline check.

## Subscription plans (CLI)

The plan catalog (names/price text/features in en+th, monthly pages, seats, theme,
tier order, enable/disable, default plan, `trial_months`, `approved_period_months`)
lives in the `plans` table (FR-SYS-019). There is no admin REST API or PC admin UI yet;
maintain it with `manage_plans.py`. Changes apply to every tenant, including existing
subscriptions, within the 60-second per-process cache window (no snapshots). On startup
an empty `plans` table is seeded from `plans_seed.json`; a non-empty table is never
overwritten. Writes go to the configured database — confirm the target before `--yes`.

```bash
python manage_plans.py validate --file plans_seed.json   # offline check, no DB
python manage_plans.py list                              # all plans incl. disabled
python manage_plans.py export > plans.json               # current catalog as a config file
python manage_plans.py import --file plans.json --dry-run
python manage_plans.py import --file plans.json --yes    # upsert by code; others untouched
python manage_plans.py set --code KINDER --pages 2000 --price-th "฿888 / ปี" --yes
python manage_plans.py disable --code INTERMEDIATE --yes # hidden, not applicable; existing subs keep working
python manage_plans.py set-default --code KINDER --yes   # affects newly provisioned tenants only
python manage_plans.py seed --yes                        # only when the table is empty
```

Every write validates the whole merged catalog first (exactly one enabled default,
unique code/sort_order, en+th text with matching feature counts) and records an
audit entry `plan_config.*`.

## Endpoint groups

| Group | Path prefix | Notes |
| --- | --- | --- |
| Auth | `/api/v1/auth/*` | LINE id_token login; dev fallback gated by `AUTH_DEV_MODE` |
| Me | `/api/v1/me/*` | Profile, language, memberships, applications |
| Uploads | `/api/v1/uploads`, `/api/v1/files` | 3-stage upload + page previews |
| OCR | `/api/v1/ocr/jobs` | Job lifecycle, cancel/rerun/delete, idempotent create |
| Results | `/api/v1/ocr/jobs/<id>/results` | Review tabs payload; optimistic concurrency |
| Templates | `/api/v1/templates/versions/<id>`, `/api/v1/ocr/jobs/<id>/{template-options,apply-template,use-generic}` | Template snapshot, per-job template choice and switching |
| Exports | `/api/v1/ocr/jobs/<id>/exports` | XLSX / CSV / TXT / JSON; binds the current result version; template XLSX/CSV follow template order, JSON preserves structured data, session re-checked on download |
| Enterprise | `/api/v1/enterprises` | Applications + invitations (session required) |

Success envelope: `{code:"OK", data}`; errors: `{code, message_key,
request_id, retryable, field_errors}`.

Full contract: [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3, open in Swagger
Editor / Swagger UI). Keep it in sync when routes change.

Table/column descriptions live in `models.py` as `comment=` and are written to
PostgreSQL as `COMMENT ON` (new tables get them via `create_all`; existing
tables need the statements re-applied).

## Project layout

```
.
├── app.py            # create_app factory + middleware wiring
├── config.py         # Config (env-driven)
├── auth.py           # session + CSRF + audit
├── models.py         # SQLAlchemy models (PRD §13) + DB comments
├── openapi.yaml      # OpenAPI 3.0.3 contract (Swagger)
├── routes/           # auth / me / uploads / ocr / results / exports / enterprises
├── textin/           # TextIn provider (client, adapter, field extractor)
├── doc_templates/    # template schema, repository, LLM matcher/converter, mapping service
├── templates_seed/   # built-in system template files
├── manage_templates.py  # template maintenance CLI
├── plans.py          # plan catalog repository (plans table, TTL cache, seed fallback)
├── plans_seed.json   # built-in plan seed (used when the table is empty)
├── manage_plans.py   # plan configuration CLI
├── worker.py         # background OCR job runner (thread)
├── mapping_worker.py # background template mapping runner (thread)
├── fileaccess.py     # shared file ACL
└── tests/            # API + TextIn unit tests
```
