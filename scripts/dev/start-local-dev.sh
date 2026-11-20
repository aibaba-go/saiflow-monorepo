#!/usr/bin/env bash
# Start the isolated local development stack (NFR-DEV-001/002):
#   API 127.0.0.1:8010 (dev login on), line-mini http://localhost:5173, web-pc http://localhost:5174
# No OCR worker and no reminder process are started. Ctrl+C stops everything.
#
# Usage: scripts/dev/start-local-dev.sh [--skip-migrate] [--api-only]
# Needs the local PostgreSQL cluster running (temp/local-postgres) and its secrets.env.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/dev/local-env.sh
source "$here/local-env.sh"

migrate=1
frontends=1
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) migrate=0 ;;
    --api-only) frontends=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

"$here/check-local-dev.sh"

logs="$SAIFLOW_ROOT/temp/local-dev"
mkdir -p "$logs"
api_dir="$SAIFLOW_ROOT/services/api"

if [ "$migrate" -eq 1 ]; then
  echo "migrating the dev database (schema owner account)"
  (
    cd "$api_dir"
    DB_USER="${DEV_DB_OWNER_USER:?DEV_DB_OWNER_USER missing}" \
      DB_PASSWORD="${DEV_DB_OWNER_PASSWORD:?DEV_DB_OWNER_PASSWORD missing}" \
      "$SAIFLOW_PY" -m alembic upgrade head
  )
fi

echo "seeding the fixed dev account"
(cd "$api_dir" && "$SAIFLOW_PY" -m app.cli dev-seed)

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

(
  cd "$api_dir"
  exec "$SAIFLOW_PY" -m uvicorn app.main:app --host "$SAIFLOW_API_HOST" \
    --port "$SAIFLOW_API_PORT" --no-proxy-headers
) >"$logs/api.log" 2>&1 &
pids+=("$!")
echo "API     http://$SAIFLOW_API_HOST:$SAIFLOW_API_PORT  (log temp/local-dev/api.log)"

if [ "$frontends" -eq 1 ]; then
  pnpm=(npx --yes pnpm@12.11.2)
  (cd "$SAIFLOW_ROOT" && exec "${pnpm[@]}" --filter @saiflow/line-mini exec vite --host 127.0.0.1 --port 5173 --strictPort) \
    >"$logs/line-mini.log" 2>&1 &
  pids+=("$!")
  (cd "$SAIFLOW_ROOT" && exec "${pnpm[@]}" --filter @saiflow/web-pc exec vite --host 127.0.0.1 --port 5174 --strictPort) \
    >"$logs/web-pc.log" 2>&1 &
  pids+=("$!")
  echo "mini    http://localhost:5173  (log temp/local-dev/line-mini.log)"
  echo "web-pc  http://localhost:5174/login  (log temp/local-dev/web-pc.log)"
fi

echo "dev login: mini 'Log in / Register', web-pc 'Local development login'. Ctrl+C stops."
wait
