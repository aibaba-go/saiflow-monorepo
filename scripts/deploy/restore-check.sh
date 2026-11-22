#!/usr/bin/env bash
# Restore drill (AC-FR-PLAT-006-04): restore a dump into a throwaway PostgreSQL and
# confirm schema saiflow_v3 and its migration version row exist.
#   restore-check.sh <dump_file>
set -euo pipefail

dump="${1:?usage: restore-check.sh <dump_file>}"
[ -s "$dump" ] || { echo "restore-check: $dump is missing or empty" >&2; exit 1; }

name="saiflow-restore-check-$$"
password="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
# shellcheck disable=SC2317,SC2329  # invoked by the EXIT trap (code differs by shellcheck version)
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=restore postgres:18 >/dev/null
for _ in $(seq 60); do
  # TCP probe: the init-time temporary server listens on the Unix socket only.
  docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -d restore >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" psql -U postgres -d restore -qc "CREATE ROLE saiflow_v3_app" >/dev/null
# grants and default privileges in the dump name the migration account too
docker exec "$name" psql -U postgres -d restore -qc "CREATE ROLE saiflow_v3_migrator" >/dev/null
docker exec "$name" psql -U postgres -d restore -qc "CREATE ROLE saiflow_v3_reporter" >/dev/null
docker exec -i "$name" pg_restore -U postgres -d restore --no-owner --exit-on-error <"$dump"

result="$(docker exec "$name" psql -U postgres -d restore -tAc \
  "select count(*) from information_schema.tables where table_schema='saiflow_v3' and table_name='alembic_version'")"
rows="$(docker exec "$name" psql -U postgres -d restore -tAc "select count(*) from saiflow_v3.alembic_version" 2>/dev/null || echo 0)"
if [ "$result" = "1" ] && [ "$rows" -ge 1 ]; then
  echo "restore-check OK: saiflow_v3.alembic_version present ($rows row)"
  exit 0
fi
echo "restore-check FAILED: saiflow_v3.alembic_version missing or empty" >&2
exit 1
