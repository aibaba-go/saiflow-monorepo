#!/usr/bin/env bash
# Usage: check-generated-clean.sh <path>...   (run after regenerating, from the repo root)
# Fails when any listed path differs from the commit: modified, deleted, or new files
# that git does not track yet (`git diff` alone misses those). AC-FR-PLAT-004-01.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: check-generated-clean.sh <path>..." >&2; exit 2; }

changes="$(git status --porcelain --untracked-files=all -- "$@")"
if [ -n "$changes" ]; then
  echo "generated files differ from the commit:" >&2
  printf '%s\n' "$changes" >&2
  git --no-pager diff -- "$@" >&2 || true
  exit 1
fi
echo "generated files match the commit"
