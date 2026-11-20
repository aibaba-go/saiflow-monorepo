#!/usr/bin/env bash
# Daily database backup (FR-PLAT-006), run by saiflow-backup.timer as `deploy`:
#   1. pg_dump (custom format) into $DEPLOY_DIR/backups/saiflow-<UTC>.dump
#   2. copy it to the GCS backup bucket at once (bucket lifecycle deletes after 30 days)
#   3. delete local dumps older than 7 days (also when the upload failed)
# A failed upload keeps the local dump and makes the run fail (visible in journalctl).
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/saiflow}"
GCS_KEY_FILE="${GCS_KEY_FILE:-$DEPLOY_DIR/secrets/gcs-backup.json}"
backups="$DEPLOY_DIR/backups"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

if [ -z "${BACKUP_BUCKET:-}" ] && [ -f "$DEPLOY_DIR/.env" ]; then
  BACKUP_BUCKET="$(sed -n 's/^BACKUP_BUCKET=//p' "$DEPLOY_DIR/.env" | tail -n1)"
fi
: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"

mkdir -p "$backups"
name="saiflow-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$backups/$name.partial"

compose=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml")
# shellcheck disable=SC2016  # $POSTGRES_USER must expand inside the container
if ! "${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc saiflow' >"$partial"; then
  rm -f "$partial"
  log "backup: dump failed"
  exit 1
fi
mv "$partial" "$backups/$name"
log "backup: dump written $name ($(wc -c <"$backups/$name") bytes)"

status=0
if docker run --rm \
  -v "$GCS_KEY_FILE:/key.json:ro" -v "$backups:/backups:ro" \
  google/cloud-sdk:slim sh -c \
  "gcloud auth activate-service-account --key-file=/key.json --quiet && gcloud storage cp /backups/$name ${BACKUP_BUCKET%/}/$name" ; then
  log "backup: uploaded $name to ${BACKUP_BUCKET%/}/"
else
  log "backup: upload failed for $name (local copy kept)"
  status=1
fi

find "$backups" -maxdepth 1 -name 'saiflow-*.dump' -mtime +7 -print -delete | while read -r old; do
  log "backup: removed old local backup $(basename "$old")"
done
exit "$status"
