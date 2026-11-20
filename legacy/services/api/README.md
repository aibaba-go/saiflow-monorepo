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
```

## Endpoint groups

| Group | Path prefix | Notes |
| --- | --- | --- |
| Auth | `/api/v1/auth/*` | LINE id_token login; dev fallback gated by `AUTH_DEV_MODE` |
| Me | `/api/v1/me/*` | Profile, language, memberships, applications |
| Uploads | `/api/v1/uploads`, `/api/v1/files` | 3-stage upload + page previews |
| OCR | `/api/v1/ocr/jobs` | Job lifecycle, cancel/rerun/delete, idempotent create |
| Results | `/api/v1/ocr/jobs/<id>/results` | Review tabs payload; optimistic concurrency |
| Exports | `/api/v1/ocr/jobs/<id>/exports` | XLSX / CSV / TXT, session re-checked on download |
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
├── worker.py         # background job runner (thread)
├── fileaccess.py     # shared file ACL
└── tests/            # API + TextIn unit tests
```
