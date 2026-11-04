#!/usr/bin/env bash
# Tests for scripts/deploy/remote-deploy.sh with a fake docker (FR-PLAT-005, AC-005-05).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
script="$here/../deploy/remote-deploy.sh"

setup() {
  work="$(mktemp -d)"
  printf 'POSTGRES_USER=u\nIMAGE_TAG=oldsha\nAPP_HOST=a\nDB_MIGRATE_PASSWORD=mig-secret-9\n' >"$work/.env"
  cp "$here/../deploy/db-roles.sh" "$here/../deploy/db-roles.sql" "$work/" 2>/dev/null || true
  export DEPLOY_DIR="$work" FAKE_LOG="$work/calls.log" PATH="$here/fakes:$PATH"
  unset FAKE_MIGRATE_FAIL FAKE_ROLES_FAIL
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
r=$(order_of 'exec -T caddy caddy reload')
check "caddy config reloaded after up" test -n "$r" -a "$u" -lt "$r" -a "$r" -lt "$o"
check "token not in call log" bash -c "! grep -q token-123 '$FAKE_LOG'"
# harden-identity: roles set up, then migrations run as the migration account
roles=$(order_of 'exec -T -e DB_MIGRATE_PASSWORD postgres')
check "order postgres<roles<migrate" test -n "$roles" -a "$pg" -lt "$roles" -a "$roles" -lt "$m"
check "migrations run in the migrate service" grep -q 'run --rm saiflow-be-migrate alembic upgrade head' "$FAKE_LOG"
check "migration password not in call log" bash -c "! grep -q mig-secret-9 '$FAKE_LOG'"
rm -rf "$work"

setup
grep -v '^DB_MIGRATE_PASSWORD=' "$work/.env" >"$work/.env.new" && mv "$work/.env.new" "$work/.env"
out="$(printf 'bot\ntoken-123\n' | bash "$script" newsha 2>&1)"; code=$?
check "missing DB_MIGRATE_PASSWORD exits non-zero" test "$code" -ne 0
check "missing DB_MIGRATE_PASSWORD is named" grep -q DB_MIGRATE_PASSWORD <<<"$out"
check "missing DB_MIGRATE_PASSWORD changes nothing" test ! -s "$FAKE_LOG"
check "missing DB_MIGRATE_PASSWORD keeps IMAGE_TAG" grep -qx 'IMAGE_TAG=oldsha' "$work/.env"
rm -rf "$work"

setup
printf 'bot\ntoken-123\n' | FAKE_ROLES_FAIL=1 bash "$script" newsha >/dev/null 2>&1; code=$?
check "role setup failure exits non-zero" test "$code" -ne 0
check "role setup failure skips migrate and up" bash -c "! grep -q -e 'saiflow-be-migrate' -e 'up -d --remove-orphans' '$FAKE_LOG'"
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
