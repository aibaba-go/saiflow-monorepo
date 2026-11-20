#!/usr/bin/env bash
# Tests for scripts/deploy/backup.sh with a fake docker (FR-PLAT-006).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
backup="$here/../deploy/backup.sh"

setup() {
  work="$(mktemp -d)"
  mkdir -p "$work/backups" "$work/secrets"
  : >"$work/secrets/gcs-backup.json"
  printf 'BACKUP_BUCKET=gs://test-bucket\n' >"$work/.env"
  export DEPLOY_DIR="$work" FAKE_LOG="$work/calls.log" PATH="$here/fakes:$PATH"
  unset BACKUP_BUCKET FAKE_DUMP_FAIL FAKE_UPLOAD_FAIL
  : >"$FAKE_LOG"
}

# 1. normal run: dump written, uploaded once, exit 0 (AC-FR-PLAT-006-01)
setup
out="$(bash "$backup" 2>&1)"; code=$?
check "normal run exits 0" test "$code" -eq 0
check "dump file written" bash -c "ls '$work'/backups/saiflow-*.dump >/dev/null 2>&1"
check "uploaded once to bucket" test "$(grep -c 'gcloud storage cp' "$FAKE_LOG")" -eq 1
check "upload targets bucket" grep -q 'gs://test-bucket/' "$FAKE_LOG"
rm -rf "$work"

# 2. retention: 8-day-old removed, 6-day-old kept (AC-FR-PLAT-006-02)
setup
touch -d '8 days ago' "$work/backups/saiflow-old8.dump"
touch -d '6 days ago' "$work/backups/saiflow-old6.dump"
bash "$backup" >/dev/null 2>&1
check "8-day-old backup deleted" test ! -e "$work/backups/saiflow-old8.dump"
check "6-day-old backup kept" test -e "$work/backups/saiflow-old6.dump"
rm -rf "$work"

# 3. upload failure: local backup kept, exit 1, logged (AC-FR-PLAT-006-03)
setup
out="$(FAKE_UPLOAD_FAIL=1 bash "$backup" 2>&1)"; code=$?
check "upload failure exits 1" test "$code" -eq 1
check "upload failure keeps local dump" bash -c "ls '$work'/backups/saiflow-*.dump >/dev/null 2>&1"
check "upload failure logged" grep -q 'backup: upload failed' <<<"$out"
rm -rf "$work"

# 4. dump failure: no partial file, exit 1, logged
setup
out="$(FAKE_DUMP_FAIL=1 bash "$backup" 2>&1)"; code=$?
check "dump failure exits 1" test "$code" -eq 1
check "dump failure leaves no partial" bash -c "! ls '$work'/backups/*.partial >/dev/null 2>&1"
check "dump failure leaves no dump" bash -c "! ls '$work'/backups/saiflow-*.dump >/dev/null 2>&1"
check "dump failure logged" grep -q 'backup: dump failed' <<<"$out"
check "dump failure does not upload" test "$(grep -c 'gcloud storage cp' "$FAKE_LOG")" -eq 0
rm -rf "$work"

finish
