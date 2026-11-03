#!/usr/bin/env bash
# Tests for scripts/check-generated-clean.sh (AC-FR-PLAT-004-01): generated files must
# match the commit, including files the generator added that git does not track yet.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
script="$here/../check-generated-clean.sh"

repo="$(mktemp -d)"
git -C "$repo" init -q
git -C "$repo" config user.email t@example.invalid
git -C "$repo" config user.name t
mkdir -p "$repo/gen"
echo a >"$repo/gen/schema.ts"
echo b >"$repo/other.txt"
git -C "$repo" add . && git -C "$repo" commit -qm init

run() { (cd "$repo" && bash "$script" gen >/dev/null 2>&1); echo $?; }

check "clean → 0" test "$(run)" -eq 0
echo changed >"$repo/gen/schema.ts"
check "modified generated file → 1" test "$(run)" -eq 1
git -C "$repo" checkout -q -- gen/schema.ts
echo new >"$repo/gen/extra.ts"
check "new untracked generated file → 1" test "$(run)" -eq 1
rm "$repo/gen/extra.ts"
rm "$repo/gen/schema.ts"
check "deleted generated file → 1" test "$(run)" -eq 1
git -C "$repo" checkout -q -- gen/schema.ts
echo changed >"$repo/other.txt"
check "changes outside the checked paths are ignored → 0" test "$(run)" -eq 0
echo new >"$repo/gen/extra.ts"
check "message names the file" grep -q 'gen/extra.ts' <<<"$(cd "$repo" && bash "$script" gen 2>&1)"
rm -rf "$repo"
finish
