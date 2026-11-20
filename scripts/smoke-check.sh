#!/usr/bin/env bash
# Post-deploy check (FR-PLAT-005): poll <base_url> until its frontend page answers
# 200 text/html AND <base_url>/api/v1/health reports status=ok, database=ok and the
# expected version, or give up after the timeout.
#   smoke-check.sh <base_url> <expected_version> [--timeout-seconds N]   (default 60)
# SMOKE_INSECURE=1 accepts self-signed certificates (CI uses Caddy's internal CA).
set -euo pipefail

usage() { echo "usage: smoke-check.sh <base_url> <expected_version> [--timeout-seconds N]" >&2; exit 2; }
[ $# -ge 2 ] || usage
base_url="${1%/}"
expected="$2"
timeout=60
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout-seconds) timeout="${2:?}"; shift 2 ;;
    *) usage ;;
  esac
done

python="${PYTHON:-python3}"
curl_opts=(--silent --show-error --max-time 5)
[ "${SMOKE_INSECURE:-0}" = "1" ] && curl_opts+=(--insecure)

deadline=$(( $(date +%s) + timeout ))
status="none"
body=""
while :; do
  resp="$(curl "${curl_opts[@]}" --write-out $'\n%{http_code}' "$base_url/api/v1/health" 2>&1 || true)"
  status="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  page="$(curl "${curl_opts[@]}" --output /dev/null --write-out '%{http_code} %{content_type}' "$base_url/" 2>&1 || true)"
  if [[ "$page" == "200 text/html"* ]] && [ "$status" = "200" ] && printf '%s' "$body" | "$python" -c '
import json, sys
b = json.load(sys.stdin)
sys.exit(0 if b.get("status") == "ok" and b.get("database") == "ok" and b.get("version") == sys.argv[1] else 1)
' "$expected" 2>/dev/null; then
    echo "smoke-check OK: $base_url (page: $page)"
    echo "$body"
    exit 0
  fi
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 2
done
echo "smoke-check FAILED: $base_url (expected version $expected)" >&2
echo "last page: ${page:-none}" >&2
echo "last health status: $status" >&2
echo "last body: $body" >&2
exit 1
