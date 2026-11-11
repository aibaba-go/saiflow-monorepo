#!/usr/bin/env bash
# Local isolated development environment (NFR-DEV-001/002). Source it, do not run it:
#   source scripts/dev/local-env.sh
# Reads ONLY the dedicated local files below; never a production .env (/opt/saiflow/.env,
# services/api/.env). Third-party services stay unconfigured unless independent dev
# credentials are put in the optional services file.
#   SAIFLOW_LOCAL_SECRETS   default temp/local-postgres/secrets.env (local PG cluster)
#   SAIFLOW_DEV_SERVICES    default temp/local-dev/services.env (optional: own dev GCS/OCR/LLM/SMTP/LINE)

_saiflow_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAIFLOW_ROOT="$_saiflow_root"
SAIFLOW_LOCAL_SECRETS="${SAIFLOW_LOCAL_SECRETS:-$SAIFLOW_ROOT/temp/local-postgres/secrets.env}"
SAIFLOW_DEV_SERVICES="${SAIFLOW_DEV_SERVICES:-$SAIFLOW_ROOT/temp/local-dev/services.env}"

if [ ! -f "$SAIFLOW_LOCAL_SECRETS" ]; then
  echo "local-env: $SAIFLOW_LOCAL_SECRETS not found (create the local PostgreSQL cluster first)" >&2
  return 1 2>/dev/null || exit 1
fi

# Nothing inherited from this shell may point the dev backend at real services.
for _name in LINE_CHANNEL_ID LINE_CHANNEL_SECRET LINE_LOGIN_REDIRECT_URIS LINE_WEB_CHANNEL_ID \
  LINE_WEB_CHANNEL_SECRET SMTP_HOST SMTP_PORT SMTP_USERNAME SMTP_PASSWORD SMTP_FROM SMTP_SECURITY \
  TEXTIN_APP_ID TEXTIN_SECRET_CODE GOOGLE_VISION_API_KEY LLM_API_KEY GCS_BUCKET \
  GCS_CREDENTIALS_FILE DOWNLOAD_TICKET_SECRET VITE_API_BASE_URL; do
  unset "$_name"
done
unset _name

set -a
# shellcheck disable=SC1090
. "$SAIFLOW_LOCAL_SECRETS"
if [ -f "$SAIFLOW_DEV_SERVICES" ]; then
  # shellcheck disable=SC1090
  . "$SAIFLOW_DEV_SERVICES"
fi
set +a

# Backend runtime: the least-privilege role on the isolated dev database.
export DB_HOST="${DEV_DB_HOST:-${LOCAL_PG_HOST:-127.0.0.1}}"
export DB_PORT="${DEV_DB_PORT:-${LOCAL_PG_PORT:-25432}}"
export DB_NAME="${DEV_DB_NAME:-saiflow_dev}"
export DB_USER="${DEV_DB_USER:?DEV_DB_USER missing in $SAIFLOW_LOCAL_SECRETS}"
export DB_PASSWORD="${DEV_DB_PASSWORD:?DEV_DB_PASSWORD missing in $SAIFLOW_LOCAL_SECRETS}"
export DB_APP_USER="${DEV_DB_APP_USER:-${DEV_DB_USER}}"
export APP_ENV=development
export DEV_LOGIN_ENABLED=true
export APP_VERSION="${APP_VERSION:-local-dev}"
# No OCR worker or reminder process is started by scripts/dev; keep them idle if run by hand
# without independently configured services.
export OCR_WORKER_ENABLED="${OCR_WORKER_ENABLED:-false}"
export REMINDERS_ENABLED="${REMINDERS_ENABLED:-false}"

# Local ports: 8000 may be taken (printing software), so the API uses 8010.
export SAIFLOW_API_HOST=127.0.0.1
export SAIFLOW_API_PORT="${SAIFLOW_API_PORT:-8010}"
export SAIFLOW_API_PROXY="http://127.0.0.1:${SAIFLOW_API_PORT}"
export VITE_DEV_LOGIN=1
export VITE_API_BASE_URL=""  # same-origin /api through the Vite proxy
# web-pc's dev server: where the admin's "log in as this user" link opens (FR-SYS-145)
export WEB_PC_ORIGIN="${WEB_PC_ORIGIN:-http://localhost:5174}"

if [ -x "$SAIFLOW_ROOT/services/api/.venv/Scripts/python.exe" ]; then
  SAIFLOW_PY="$SAIFLOW_ROOT/services/api/.venv/Scripts/python.exe"
else
  SAIFLOW_PY="$SAIFLOW_ROOT/services/api/.venv/bin/python"
fi
export SAIFLOW_PY SAIFLOW_ROOT
