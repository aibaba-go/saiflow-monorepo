#!/usr/bin/env bash
# Shared helpers for scripts/tests/*.test.sh (sourced, not executed).

# A working Python: CI has python3; on Windows dev machines python3 may be a store stub.
if python3 -c '' >/dev/null 2>&1; then PYTHON=python3; else PYTHON=py; fi
export PYTHON

pass=0
fail=0
check() { # check <description> <command...>
  local name="$1"; shift
  if "$@"; then pass=$((pass + 1)); echo "PASS $name"; else fail=$((fail + 1)); echo "FAIL $name"; fi
}
finish() {
  echo "$pass passed, $fail failed"
  [ "$fail" -eq 0 ]
}
