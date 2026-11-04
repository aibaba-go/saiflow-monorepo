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
finish
