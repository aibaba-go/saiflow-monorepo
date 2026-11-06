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
# line-mini-account: the LIFF app ID (public) reaches the frontend build from the GitHub variable
# shellcheck disable=SC2016  # literal workflow text
check "deploy reads the LIFF_ID variable" grep -qF 'LIFF_ID: ${{ vars.LIFF_ID }}' "$wf"
# shellcheck disable=SC2016  # literal workflow text
check "frontend builds receive VITE_LIFF_ID" grep -qF -- '--build-arg VITE_LIFF_ID="$LIFF_ID"' "$wf"
docker_file="$here/../docker/frontend.Dockerfile"
check "frontend Dockerfile accepts VITE_LIFF_ID" grep -q "^ARG VITE_LIFF_ID$" "$docker_file"
# shellcheck disable=SC2016  # literal Dockerfile text
check "frontend Dockerfile passes VITE_LIFF_ID to the build" grep -qF 'ENV VITE_LIFF_ID=$VITE_LIFF_ID' "$docker_file"
# web-pc-account: the LINE Login channel ID (public) reaches the web-pc build for the authorize URL
# shellcheck disable=SC2016  # literal workflow text
check "deploy reads the LINE_CHANNEL_ID variable" grep -qF 'LINE_CHANNEL_ID: ${{ vars.LINE_CHANNEL_ID }}' "$wf"
# shellcheck disable=SC2016  # literal workflow text
check "frontend builds receive VITE_LINE_CHANNEL_ID" grep -qF -- '--build-arg VITE_LINE_CHANNEL_ID="$LINE_CHANNEL_ID"' "$wf"
check "frontend Dockerfile accepts VITE_LINE_CHANNEL_ID" grep -q "^ARG VITE_LINE_CHANNEL_ID$" "$docker_file"
# shellcheck disable=SC2016  # literal Dockerfile text
check "frontend Dockerfile passes VITE_LINE_CHANNEL_ID to the build" grep -qF 'ENV VITE_LINE_CHANNEL_ID=$VITE_LINE_CHANNEL_ID' "$docker_file"
finish
