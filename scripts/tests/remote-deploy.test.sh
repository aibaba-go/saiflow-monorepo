#!/usr/bin/env bash
# Tests for scripts/deploy/remote-deploy.sh with a fake docker (FR-PLAT-005, AC-005-05).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
script="$here/../deploy/remote-deploy.sh"

setup() {
  work="$(mktemp -d)"
  printf 'POSTGRES_USER=u\nIMAGE_TAG=oldsha\nAPP_HOST=a\n' >"$work/.env"
  export DEPLOY_DIR="$work" FAKE_LOG="$work/calls.log" PATH="$here/fakes:$PATH"
  unset FAKE_MIGRATE_FAIL
  : >"$FAKE_LOG"
}
order_of() { grep -n -- "$1" "$FAKE_LOG" | head -n1 | cut -d: -f1; }

setup
printf 'bot\ntoken-123\n' | bash "$script" newsha >/dev/null 2>&1; code=$?
check "normal deploy exits 0" test "$code" -eq 0
check "IMAGE_TAG updated" grep -qx 'IMAGE_TAG=newsha' "$work/.env"
check "other .env lines kept" grep -qx 'APP_HOST=a' "$work/.env"
l=$(order_of 'login ghcr.io'); p=$(order_of 'compose.* pull'); pg=$(order_of 'up -d .*postgres$')
m=$(order_of 'alembic upgrade head'); u=$(order_of 'up -d --remove-orphans'); o=$(order_of 'logout ghcr.io')
check "order login<pull<postgres<migrate<up<logout" \
  test -n "$o" -a "$l" -lt "$p" -a "$p" -lt "$pg" -a "$pg" -lt "$m" -a "$m" -lt "$u" -a "$u" -lt "$o"
check "token not in call log" bash -c "! grep -q token-123 '$FAKE_LOG'"
rm -rf "$work"

setup
printf 'bot\ntoken-123\n' | FAKE_MIGRATE_FAIL=1 bash "$script" newsha >/dev/null 2>&1; code=$?
check "migration failure exits non-zero" test "$code" -ne 0
check "migration failure skips final up" bash -c "! grep -q 'up -d --remove-orphans' '$FAKE_LOG'"
check "migration failure still logs out" grep -q 'logout ghcr.io' "$FAKE_LOG"
rm -rf "$work"

setup
bash "$script" >/dev/null 2>&1; code=$?
check "missing image tag exits non-zero" test "$code" -ne 0
check "missing image tag does nothing" test ! -s "$FAKE_LOG"
rm -rf "$work"
finish
