#!/usr/bin/env bash
# Fail if any tracked file holds a service-account key or a private key
# (AC-FR-PLAT-005-04). Run from the repository root (or any git work tree).
set -euo pipefail

# Patterns are assembled from pieces so this script does not match itself.
patterns=(
  '"type"[[:space:]]*:[[:space:]]*"service''_account"'
  '"private''_key"[[:space:]]*:'
  '-----BEGIN [A-Z ]*PRIV''ATE KEY-----'
)
args=()
for p in "${patterns[@]}"; do args+=(-e "$p"); done

if hits="$(git grep -l -I -E "${args[@]}" -- .)"; then
  echo "check-no-secrets: credentials found in tracked files:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "check-no-secrets: no credentials in tracked files"
