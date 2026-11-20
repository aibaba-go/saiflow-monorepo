#!/usr/bin/env bash
# Runs once, when the postgres data volume is first initialised: create the
# least-privilege application role (NFR-SEC-003). It may only connect; the schema and its
# objects are created and owned by saiflow_v3_migrator (db-roles.sql, run on every deploy),
# and migration 0003 grants the app role its data privileges (AC-FR-SYS-003-06).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname saiflow \
  -v app_password="$DB_PASSWORD" <<'SQL'
CREATE ROLE saiflow_v3_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE saiflow TO saiflow_v3_app;
SQL
