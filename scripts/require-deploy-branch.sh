#!/usr/bin/env bash
# Usage: require-deploy-branch.sh <git ref>   (in the deploy workflow: "$GITHUB_REF")
# Only this branch may be deployed (owner decision 2026-11-03). Exits 1 otherwise.
set -euo pipefail

ALLOWED_REF="refs/heads/chore/ai-workflow-v2"
ref="${1:-}"

if [ "$ref" != "$ALLOWED_REF" ]; then
  echo "deploy refused: '$ref' is not $ALLOWED_REF" >&2
  exit 1
fi
echo "deploy branch ok: $ref"
