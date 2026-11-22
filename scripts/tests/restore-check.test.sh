#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export FAKE_LOG="$work/calls.log" PATH="$here/fakes:$PATH" FAKE_RESTORE_NEEDS_REPORTER=1
printf 'PGDMP-fake-dump' >"$work/backup.dump"
: >"$FAKE_LOG"
bash "$here/../deploy/restore-check.sh" "$work/backup.dump" >"$work/output.log" 2>&1; code=$?
check "reporting ACL dump restores successfully (AC-FR-PLAT-006-04)" test "$code" -eq 0
reporter=$(grep -n 'CREATE ROLE saiflow_v3_reporter' "$FAKE_LOG" | cut -d: -f1)
restore=$(grep -n 'pg_restore' "$FAKE_LOG" | cut -d: -f1)
check "reporter role exists before restoring grants" test -n "$reporter" -a "$reporter" -lt "$restore"
check "restore verifies the migration version" grep -q 'restore-check OK' "$work/output.log"
: >"$FAKE_LOG"
bash "$here/../deploy/restore-check.sh" "$work/missing.dump" >/dev/null 2>&1; code=$?
check "missing dump fails before starting any container" test "$code" -ne 0 -a ! -s "$FAKE_LOG"
finish
