#!/usr/bin/env bash
# Regenerate the API contract and the typed client from the backend (FR-PLAT-004).
# Run from anywhere: `pnpm generate:api-client`. Needs uv (backend) and pnpm (frontend).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

(cd "$root/services/api" && uv run python -m app.export_openapi ../../docs/30-design/openapi.json)
pnpm --dir "$root/packages/api-client" exec openapi-typescript \
  "$root/docs/30-design/openapi.json" -o "$root/packages/api-client/src/generated/schema.ts"
