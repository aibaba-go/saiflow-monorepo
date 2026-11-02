#!/usr/bin/env bash
# Tests for scripts/smoke-check.sh against a fake health endpoint.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
smoke="$here/../smoke-check.sh"

run_with() { # run_with <mode> -> prints smoke-check exit code
  local mode="$1" port pid out code
  out="$(mktemp)"
  "$PYTHON" "$here/fake_health_server.py" "$mode" >"$out" &
  pid=$!
  for _ in $(seq 50); do port="$(head -n1 "$out")"; [ -n "$port" ] && break; sleep 0.1; done
  bash "$smoke" "http://127.0.0.1:$port" v1 --timeout-seconds 3 >/dev/null 2>&1
  code=$?
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; rm -f "$out"
  echo "$code"
}

check "ok and matching version exits 0" test "$(run_with ok)" -eq 0
check "503 degraded exits 1" test "$(run_with degraded)" -eq 1
check "version mismatch exits 1" test "$(run_with wrongversion)" -eq 1
finish
