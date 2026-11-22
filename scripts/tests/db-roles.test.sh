#!/usr/bin/env bash
# Static checks on the role SQL that every deploy runs (scripts/deploy/db-roles.sql): it
# re-grants data privileges on all tables, so each append-only table must be revoked again.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
sql="$here/../deploy/db-roles.sql"

check "audit_log stays append-only for the app role (AC-FR-SYS-003-06)" \
  grep -qF "REVOKE UPDATE, DELETE, TRUNCATE ON saiflow_v3.audit_log FROM saiflow_v3_app;" "$sql"
# ocr-scan-flow T7: raw OCR results are written once (NFR-SEC-010)
check "ocr_raw_results stays append-only for the app role (ADR-009 T7)" \
  grep -qF "REVOKE UPDATE, DELETE, TRUNCATE ON saiflow_v3.ocr_raw_results FROM saiflow_v3_app;" "$sql"
check "reporting account has no administrative privileges" \
  grep -qF 'ALTER ROLE saiflow_v3_reporter NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;' "$sql"
check "reporting account defaults to read-only transactions" \
  grep -qF 'ALTER ROLE saiflow_v3_reporter SET default_transaction_read_only = on;' "$sql"
check "reporting account cannot read source credentials" \
  grep -qF 'REVOKE ALL ON ALL TABLES IN SCHEMA saiflow_v3 FROM saiflow_v3_reporter;' "$sql"
finish
