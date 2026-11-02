#!/usr/bin/env bash
# Runs once, when the postgres data volume is first initialised: create the
# least-privilege application role (NFR-SEC-003). It may create its own schema
# (saiflow_v3, via Alembic) but is not a superuser.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname saiflow \
  -v app_password="$DB_PASSWORD" <<'SQL'
CREATE ROLE saiflow_v3_app LOGIN PASSWORD :'app_password';
GRANT CONNECT, CREATE ON DATABASE saiflow TO saiflow_v3_app;
SQL
