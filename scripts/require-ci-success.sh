#!/usr/bin/env bash
# Deploy gate (AC-FR-PLAT-005-02): succeed only if a CI run for <sha> completed successfully.
#   require-ci-success.sh <sha>     (needs gh with GH_TOKEN, and python3)
set -euo pipefail

sha="${1:?usage: require-ci-success.sh <sha>}"
runs="$(gh run list --workflow CI --commit "$sha" --json status,conclusion --limit 20)"
if printf '%s' "$runs" | "${PYTHON:-python3}" -c '
import json, sys
runs = json.load(sys.stdin)
ok = any(r.get("status") == "completed" and r.get("conclusion") == "success" for r in runs)
sys.exit(0 if ok else 1)
'; then
  echo "CI passed for $sha"
  exit 0
fi
echo "CI has not passed for $sha" >&2
echo "runs: $runs" >&2
exit 1
