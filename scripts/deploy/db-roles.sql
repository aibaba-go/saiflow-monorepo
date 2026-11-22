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
-- The app's data privileges are granted in the same transaction, so the running backend
-- never loses access, even if the migration that follows fails (same grants as 0003).
BEGIN;
REASSIGN OWNED BY saiflow_v3_app TO saiflow_v3_migrator;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'saiflow_v3') THEN
    GRANT USAGE ON SCHEMA saiflow_v3 TO saiflow_v3_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA saiflow_v3 TO saiflow_v3_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA saiflow_v3 TO saiflow_v3_app;
    IF to_regclass('saiflow_v3.audit_log') IS NOT NULL THEN
      REVOKE UPDATE, DELETE, TRUNCATE ON saiflow_v3.audit_log FROM saiflow_v3_app;
    END IF;
    -- raw OCR results are written once (ocr-scan-flow, ADR-009 T7, NFR-SEC-010)
    IF to_regclass('saiflow_v3.ocr_raw_results') IS NOT NULL THEN
      REVOKE UPDATE, DELETE, TRUNCATE ON saiflow_v3.ocr_raw_results FROM saiflow_v3_app;
    END IF;
    IF to_regclass('saiflow_v3.alembic_version') IS NOT NULL THEN
      REVOKE INSERT, UPDATE, DELETE ON saiflow_v3.alembic_version FROM saiflow_v3_app;
    END IF;
  END IF;
END
$$;
COMMIT;

\getenv report_password REPORT_DB_PASSWORD
SELECT coalesce(:'report_password', '') = '' AS missing_report_password \gset
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'saiflow_v3_reporter') THEN
    CREATE ROLE saiflow_v3_reporter NOLOGIN;
  END IF;
END $$;
ALTER ROLE saiflow_v3_reporter NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE saiflow_v3_reporter SET default_transaction_read_only = on;
ALTER ROLE saiflow_v3_reporter SET statement_timeout = '10s';
ALTER ROLE saiflow_v3_reporter SET lock_timeout = '1s';
\if :missing_report_password
  ALTER ROLE saiflow_v3_reporter NOLOGIN;
\else
  ALTER ROLE saiflow_v3_reporter LOGIN PASSWORD :'report_password';
\endif
GRANT CONNECT ON DATABASE saiflow TO saiflow_v3_reporter;
REVOKE CREATE ON DATABASE saiflow FROM saiflow_v3_reporter;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'saiflow_v3') THEN
    REVOKE ALL ON SCHEMA saiflow_v3 FROM saiflow_v3_reporter;
    REVOKE ALL ON ALL TABLES IN SCHEMA saiflow_v3 FROM saiflow_v3_reporter;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA saiflow_v3 FROM saiflow_v3_reporter;
  END IF;
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'reporting') THEN
    GRANT USAGE ON SCHEMA reporting TO saiflow_v3_reporter;
    GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO saiflow_v3_reporter;
  END IF;
END $$;
