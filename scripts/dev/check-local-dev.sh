#!/usr/bin/env bash
# Local development preflight (NFR-DEV-001/002), read-only: the database target is the
# isolated local one, the API is bound to loopback only, and (if running) answers health.
# Never prints credentials. Usage: scripts/dev/check-local-dev.sh
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/dev/local-env.sh
source "$here/local-env.sh" || exit 1

failed=0
ok() { echo "ok:   $*"; }
bad() { echo "FAIL: $*" >&2; failed=1; }

# 1. Database target and dev login settings, with the backend's own rules (app.config).
if (cd "$SAIFLOW_ROOT/services/api" && "$SAIFLOW_PY" -c '
import sys
from app.config import ConfigError, dev_login_active, is_isolated_dev_target, load_settings
try:
    s = load_settings()
except ConfigError as exc:
    print(exc, file=sys.stderr)
    sys.exit(1)
if not is_isolated_dev_target(s.db_host, s.db_name):
    print("database target is not an isolated local dev database", file=sys.stderr)
    sys.exit(1)
print(f"db target {s.db_host}:{s.db_port}/{s.db_name}; dev login active: {dev_login_active(s)}")
'); then
  ok "database target is isolated (loopback, saiflow_dev*)"
else
  bad "database target or dev login configuration refused"
fi

# 2. The API bind address is loopback.
case "$SAIFLOW_API_HOST" in
  127.0.0.1 | localhost | ::1) ok "API bind host $SAIFLOW_API_HOST is loopback" ;;
  *) bad "API bind host $SAIFLOW_API_HOST is not loopback" ;;
esac

# 3. Nothing listens on the API port beyond loopback (best effort: netstat).
if command -v netstat >/dev/null 2>&1; then
  listeners="$(netstat -an 2>/dev/null | grep -Ei "listen" | grep -E "[:.]${SAIFLOW_API_PORT}[[:space:]]" || true)"
  if [ -z "$listeners" ]; then
    echo "info: nothing listens on port $SAIFLOW_API_PORT yet"
  elif echo "$listeners" | awk '{print $2}' | grep -Ev "^(127\.0\.0\.1|\[::1\]|::1)[:.]" >/dev/null; then
    bad "port $SAIFLOW_API_PORT listens beyond loopback"
  else
    ok "port $SAIFLOW_API_PORT listens on loopback only"
  fi
fi

# 4. Health, if the API is up.
if command -v curl >/dev/null 2>&1; then
  if body="$(curl -fsS --max-time 3 "http://127.0.0.1:${SAIFLOW_API_PORT}/api/v1/health" 2>/dev/null)"; then
    ok "API health: $body"
  else
    echo "info: API not answering on 127.0.0.1:$SAIFLOW_API_PORT"
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "check-local-dev: FAILED" >&2
  exit 1
fi
echo "check-local-dev: OK"
