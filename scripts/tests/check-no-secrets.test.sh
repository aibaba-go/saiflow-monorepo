#!/usr/bin/env bash
# Tests for scripts/check-no-secrets.sh in throwaway git repositories (AC-FR-PLAT-005-04).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
script="$here/../check-no-secrets.sh"

# Built from pieces so this test file itself never matches the scanner.
sa_type='"type": "service'"_account"'"'
pem_head='-----BEGIN OPENSSH PRIV''ATE KEY-----'

new_repo() {
  repo="$(mktemp -d)"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@example.invalid
  git -C "$repo" config user.name test
  echo "hello" >"$repo/readme.txt"
  git -C "$repo" add . && git -C "$repo" commit -qm init
}

new_repo
(cd "$repo" && bash "$script" >/dev/null 2>&1); code=$?
check "clean repo exits 0" test "$code" -eq 0
rm -rf "$repo"

new_repo
printf '{%s, "project_id": "x"}\n' "$sa_type" >"$repo/key.json"
git -C "$repo" add key.json && git -C "$repo" commit -qm key
out="$(cd "$repo" && bash "$script" 2>&1)"; code=$?
check "service account key exits 1" test "$code" -eq 1
check "service account key file named" grep -q 'key.json' <<<"$out"
rm -rf "$repo"

new_repo
printf '%s\nabc\n' "$pem_head" >"$repo/id_deploy"
git -C "$repo" add id_deploy && git -C "$repo" commit -qm pem
out="$(cd "$repo" && bash "$script" 2>&1)"; code=$?
check "private key exits 1" test "$code" -eq 1
check "private key file named" grep -q 'id_deploy' <<<"$out"
rm -rf "$repo"

finish
