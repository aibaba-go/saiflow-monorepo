#!/usr/bin/env bash
# Applies db-roles.sql (database accounts, idempotent) inside the postgres container.
# Called by remote-deploy.sh before migrations, and by the CI stack job.
#   DEPLOY_DIR=/opt/saiflow bash db-roles.sh           # apply
#   DEPLOY_DIR=/opt/saiflow bash db-roles.sh --check   # only check DB_MIGRATE_PASSWORD is set
# The migration password is read from $DEPLOY_DIR/.env and passed by name through the
# environment, so it never appears on a command line. One pair of surrounding quotes is
# removed, the way docker compose reads the same line (M5).
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/saiflow}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
value="$(sed -n 's/^DB_MIGRATE_PASSWORD=//p' "$DEPLOY_DIR/.env" | tail -n 1)"
case "$value" in
  \"*\") value="${value#\"}"; value="${value%\"}" ;;
  \'*\') value="${value#\'}"; value="${value%\'}" ;;
esac
if [ -z "$value" ]; then
  echo "db-roles: DB_MIGRATE_PASSWORD missing in $DEPLOY_DIR/.env (docs/deployment/README.md)" >&2
  exit 2
fi
[ "${1:-}" = "--check" ] && exit 0
export DB_MIGRATE_PASSWORD="$value"

docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" \
  exec -T -e DB_MIGRATE_PASSWORD postgres \
  sh -c 'psql -q -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d saiflow' <"$here/db-roles.sql"
echo "db-roles: accounts ready"
