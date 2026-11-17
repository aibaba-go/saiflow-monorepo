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
check "deploy reads the production LIFF_ID variable" grep -qF 'vars.LIFF_ID' "$wf"
# shellcheck disable=SC2016  # literal workflow text
check "frontend builds receive VITE_LIFF_ID" grep -qF -- '--build-arg VITE_LIFF_ID="$LIFF_ID"' "$wf"
docker_file="$here/../docker/frontend.Dockerfile"
check "frontend Dockerfile accepts VITE_LIFF_ID" grep -q "^ARG VITE_LIFF_ID$" "$docker_file"
# shellcheck disable=SC2016  # literal Dockerfile text
check "frontend Dockerfile passes VITE_LIFF_ID to the build" grep -qF 'ENV VITE_LIFF_ID=$VITE_LIFF_ID' "$docker_file"
# web-pc-account: the LINE Login channel ID (public) reaches the web-pc build for the authorize URL
# shellcheck disable=SC2016  # literal workflow text
check "deploy reads the production LINE_CHANNEL_ID variable" grep -qF 'vars.LINE_CHANNEL_ID' "$wf"
# shellcheck disable=SC2016  # literal workflow text
check "frontend builds receive VITE_LINE_CHANNEL_ID" grep -qF -- '--build-arg VITE_LINE_CHANNEL_ID="$LINE_CHANNEL_ID"' "$wf"
check "frontend Dockerfile accepts VITE_LINE_CHANNEL_ID" grep -q "^ARG VITE_LINE_CHANNEL_ID$" "$docker_file"
# shellcheck disable=SC2016  # literal Dockerfile text
check "frontend Dockerfile passes VITE_LINE_CHANNEL_ID to the build" grep -qF 'ENV VITE_LINE_CHANNEL_ID=$VITE_LINE_CHANNEL_ID' "$docker_file"
check "deploy input defaults to test (AC-FR-PLAT-005-08)" grep -qE '^        default: test$' "$wf"
check "target is a required choice" grep -qE '^        type: choice$' "$wf"
check "production and test are the allowed targets" grep -qF 'options: [test, production]' "$wf"
# shellcheck disable=SC2016
check "job uses the selected Environment (AC-FR-PLAT-005-07)" grep -qF 'environment: ${{ inputs.environment }}' "$wf"
# shellcheck disable=SC2016
check "deploys serialize per target" grep -qF 'group: deploy-${{ inputs.environment }}' "$wf"
# shellcheck disable=SC2016
check "image tags differ by target" grep -qF 'IMAGE_TAG: ${{ github.sha }}-${{ inputs.environment }}' "$wf"
# shellcheck disable=SC2016
check "build and push use the target-specific tag" test "$(grep -cF '$REGISTRY/saiflow-be-api:$IMAGE_TAG' "$wf")" -eq 2
# shellcheck disable=SC2016
check "server deploy receives the target-specific tag" grep -qF 'remote-deploy.sh $IMAGE_TAG' "$wf"
# shellcheck disable=SC2016
check "backend build keeps the source SHA for health checks" grep -qF -- '--build-arg APP_VERSION="$SHA"' "$wf"
# shellcheck disable=SC2016
check "test LIFF ID cannot inherit production" grep -qF "LIFF_ID: \${{ inputs.environment == 'production' && vars.LIFF_ID || vars.TEST_LIFF_ID }}" "$wf"
# shellcheck disable=SC2016
check "test LINE Login channel cannot inherit production" grep -qF "LINE_CHANNEL_ID: \${{ inputs.environment == 'production' && vars.LINE_CHANNEL_ID || vars.TEST_LINE_CHANNEL_ID }}" "$wf"
check "test deploy refuses an active production forwarding bridge" grep -qF '/opt/saiflow/production-forwarding' "$wf"
check "target host is resolved after Environment variables become available" test "$(grep -c '^          VPS_HOST:' "$wf")" -eq 2
check "job cannot freeze the repository production host before Environment selection" test "$(grep -c '^      VPS_HOST:' "$wf")" -eq 0
finish
