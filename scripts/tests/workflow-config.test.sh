#!/usr/bin/env bash
# Static checks on the deploy workflow that no other test exercises.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
wf="$here/../../.github/workflows/deploy.yml"

check "deploy job times out after 10 minutes (owner decision 2026-11-03)" \
  grep -qE '^    timeout-minutes: 10$' "$wf"
check "deploy is manual only (AC-FR-PLAT-005-01)" \
  test "$(sed -n '/^on:/,/^[a-z]/p' "$wf" | grep -cE '^  [a-z_]+:')" -eq 1
# shellcheck disable=SC2016  # the literal text $GITHUB_REF is what we look for
check "first gate is the branch check" grep -qF 'require-deploy-branch.sh "$GITHUB_REF"' "$wf"
finish
