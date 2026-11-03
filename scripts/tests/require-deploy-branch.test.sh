#!/usr/bin/env bash
# Tests for scripts/require-deploy-branch.sh: only chore/ai-workflow-v2 may be deployed
# (owner decision 2026-11-03).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
script="$here/../require-deploy-branch.sh"

code() { bash "$script" "$1" >/dev/null 2>&1; echo $?; }

check "allowed branch → 0" test "$(code refs/heads/chore/ai-workflow-v2)" -eq 0
check "main → 1" test "$(code refs/heads/main)" -eq 1
check "other branch → 1" test "$(code refs/heads/feature/x)" -eq 1
check "tag with same name → 1" test "$(code refs/tags/chore/ai-workflow-v2)" -eq 1
check "prefix match is not enough → 1" test "$(code refs/heads/chore/ai-workflow-v2-old)" -eq 1
check "empty → 1" test "$(code '')" -eq 1
check "message names the ref" grep -q 'refs/heads/main' <<<"$(bash "$script" refs/heads/main 2>&1)"
finish
