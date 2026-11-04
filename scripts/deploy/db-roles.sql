-- Database accounts (harden-identity, AC-FR-SYS-003-06; NFR-SEC-003). Idempotent; run by
-- db-roles.sh as POSTGRES_USER on every deploy, before migrations. Not in postgres-init/:
-- the image would run any *.sql there on first initialisation, without the password.
--   saiflow_v3_migrator  owns the schema and every object in it; runs Alembic
--   saiflow_v3_app       the backend at runtime; only the data privileges migration 0003 grants
\set ON_ERROR_STOP on
\getenv migrate_password DB_MIGRATE_PASSWORD
SELECT coalesce(:'migrate_password', '') = '' AS missing_password \gset
\if :missing_password
  \echo 'db-roles: DB_MIGRATE_PASSWORD is empty'
  SELECT 1 / 0;
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'saiflow_v3_migrator') THEN
    CREATE ROLE saiflow_v3_migrator LOGIN;
  END IF;
END
$$;
ALTER ROLE saiflow_v3_migrator LOGIN PASSWORD :'migrate_password';
GRANT CONNECT, CREATE ON DATABASE saiflow TO saiflow_v3_migrator;

GRANT CONNECT ON DATABASE saiflow TO saiflow_v3_app;
REVOKE CREATE ON DATABASE saiflow FROM saiflow_v3_app;
-- Before this change the app role created and owned the schema; hand everything over.
REASSIGN OWNED BY saiflow_v3_app TO saiflow_v3_migrator;
