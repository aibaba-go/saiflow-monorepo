#!/usr/bin/env bash
# Static checks on the deploy configuration that the CI stack job then exercises for real.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
deploy="$here/../deploy"

# During first initialisation the postgres image runs a temporary server on the Unix
# socket only; probing over TCP (127.0.0.1) avoids reporting "ready" too early.
check "compose healthcheck probes over TCP" grep -q 'pg_isready -h 127.0.0.1' "$deploy/compose.yaml"
check "restore-check waits over TCP" grep -q 'pg_isready -h 127.0.0.1' "$deploy/restore-check.sh"
check "postgres publishes no ports" bash -c "! awk '/^  postgres:/{p=1;next} /^  [a-z]/{p=0} p' '$deploy/compose.yaml' | grep -v '^ *#' | grep -q 'ports:'"
# B-2a: LINE and SMTP settings reach the backend from /opt/saiflow/.env (empty = feature off).
backend="$(awk '/^  saiflow-be-api:/{p=1;next} /^  [a-z]/{p=0} p' "$deploy/compose.yaml")"
for var in LINE_CHANNEL_ID LINE_CHANNEL_SECRET LINE_LOGIN_REDIRECT_URIS SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM SMTP_SECURITY; do
  check "backend receives $var" grep -q "$var: \${$var:-" <<<"$backend"
  check "env.example lists $var" grep -q "^$var=" "$deploy/env.example"
done
# harden-identity: uvicorn must trust Caddy's X-Forwarded-For, or every guest shares one
# rate-limit bucket (AC-FR-SYS-010-07). Safe because the backend publishes no port.
check "backend trusts the proxy's forwarded address" grep -q "FORWARDED_ALLOW_IPS: \"\*\"" <<<"$backend"
check "backend publishes no ports" bash -c "! grep -v '^ *#' <<<\"\$1\" | grep -q 'ports:'" _ "$backend"
# harden-identity: a separate migration account (AC-FR-SYS-003-06)
migrate="$(awk '/^  saiflow-be-migrate:/{p=1;next} /^  [a-z]/{p=0} p' "$deploy/compose.yaml")"
check "migrate service runs as the migration account" grep -q 'DB_USER: saiflow_v3_migrator' <<<"$migrate"
check "migrate service reads DB_MIGRATE_PASSWORD" grep -qF "DB_PASSWORD: \${DB_MIGRATE_PASSWORD:-}" <<<"$migrate"
check "migrate service grants to the app role" grep -q 'DB_APP_USER: saiflow_v3_app' <<<"$migrate"
check "migrate service is a tool, not started by up" grep -qF 'profiles: ["tools"]' <<<"$migrate"
check "backend still runs as the app role" grep -q 'DB_USER: saiflow_v3_app' <<<"$backend"
check "env.example lists DB_MIGRATE_PASSWORD" grep -q '^DB_MIGRATE_PASSWORD=' "$deploy/env.example"
check "bootstrap generates DB_MIGRATE_PASSWORD" grep -qF "DB_MIGRATE_PASSWORD=\$(openssl rand" "$here/../vps-bootstrap.sh"
check "restore-check creates the migration role" grep -q 'CREATE ROLE saiflow_v3_migrator' "$deploy/restore-check.sh"
check "role SQL is outside postgres-init (initdb runs *.sql)" test -f "$deploy/db-roles.sql" -a ! -e "$deploy/postgres-init/db-roles.sql"
wf="$here/../../.github/workflows"
check "deploy copies the role setup files" bash -c "grep -q 'scripts/deploy/db-roles.sh' '$wf/deploy.yml' && grep -q 'scripts/deploy/db-roles.sql' '$wf/deploy.yml'"
check "CI stack uses the role setup and migrate service" bash -c "grep -q 'db-roles.sh' '$wf/ci.yml' && grep -q 'saiflow-be-migrate' '$wf/ci.yml' && grep -q DB_MIGRATE_PASSWORD '$wf/ci.yml'"
# M4: the app role never creates objects; the migration account does
check "01-app-user.sh grants no CREATE" bash -c "! grep -q 'CREATE ON DATABASE' '$deploy/postgres-init/01-app-user.sh'"
# rebuild-notifications: the reminder process (FR-SYS-037)
reminders="$(awk '/^  saiflow-be-reminders:/{p=1;next} /^  [a-z]/{p=0} p' "$deploy/compose.yaml")"
check "reminders service exists" test -n "$reminders"
check "reminders service runs the loop" grep -qF 'command: ["python", "-m", "app.cli", "reminders-loop"]' <<<"$reminders"
check "reminders service runs as the app role" grep -q 'DB_USER: saiflow_v3_app' <<<"$reminders"
check "reminders service publishes no ports" bash -c "! grep -v '^ *#' <<<\"\$1\" | grep -q 'ports:'" _ "$reminders"
for var in SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM SMTP_SECURITY; do
  check "reminders service receives $var" grep -q "$var: \${$var:-" <<<"$reminders"
done
check "reminders service receives REMINDERS_ENABLED" grep -qF "REMINDERS_ENABLED: \${REMINDERS_ENABLED:-true}" <<<"$reminders"
check "env.example lists REMINDERS_ENABLED" grep -q '^REMINDERS_ENABLED=' "$deploy/env.example"
# web-admin-console: OCR and LLM keys reach the backend from .env (FR-SYS-005; empty = not configured)
for var in TEXTIN_APP_ID TEXTIN_SECRET_CODE GOOGLE_VISION_API_KEY LLM_API_KEY; do
  check "backend receives $var" grep -q "$var: \${$var:-" <<<"$backend"
  check "env.example lists $var" grep -q "^$var=" "$deploy/env.example"
done
# ocr-scan-flow: originals in a private GCS bucket for the backend and the OCR worker; the
# worker is its own service (ADR-009 class C) with the engine and LLM keys.
for var in GCS_BUCKET GCS_CREDENTIALS_FILE DOWNLOAD_TICKET_SECRET; do
  check "backend receives $var" grep -q "$var: \${$var:-" <<<"$backend"
  check "env.example lists $var" grep -q "^$var=" "$deploy/env.example"
done
ocr="$(awk '/^  saiflow-be-ocr:/{p=1;next} /^  [a-z]/{p=0} p' "$deploy/compose.yaml")"
check "ocr worker service exists" test -n "$ocr"
check "ocr worker runs the loop" grep -qF 'command: ["python", "-m", "app.cli", "ocr-worker-loop"]' <<<"$ocr"
check "ocr worker runs as the app role" grep -q 'DB_USER: saiflow_v3_app' <<<"$ocr"
check "ocr worker publishes no ports" bash -c "! grep -v '^ *#' <<<\"\$1\" | grep -q 'ports:'" _ "$ocr"
for var in GCS_BUCKET GCS_CREDENTIALS_FILE TEXTIN_APP_ID TEXTIN_SECRET_CODE GOOGLE_VISION_API_KEY LLM_API_KEY; do
  check "ocr worker receives $var" grep -q "$var: \${$var:-" <<<"$ocr"
done
check "ocr worker receives OCR_WORKER_ENABLED" grep -qF "OCR_WORKER_ENABLED: \${OCR_WORKER_ENABLED:-true}" <<<"$ocr"
check "env.example lists OCR_WORKER_ENABLED" grep -q '^OCR_WORKER_ENABLED=' "$deploy/env.example"
check "the secrets folder (service-account key) is mounted read-only" bash -c "grep -qF './secrets:/run/secrets:ro' <<<\"\$1\" && grep -qF './secrets:/run/secrets:ro' <<<\"\$2\"" _ "$backend" "$ocr"
finish
