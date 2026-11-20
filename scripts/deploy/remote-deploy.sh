#!/usr/bin/env bash
# Runs on the VPS as `deploy` (called over SSH by the Deploy workflow):
#   printf '%s\n%s\n' "$GHCR_USER" "$GHCR_TOKEN" | remote-deploy.sh <image_tag>
# Logs in to GHCR with the short-lived token, pulls, migrates, restarts, and always
# logs out again so no registry credential stays on the server (AC-FR-PLAT-005-05).
set -euo pipefail

tag="${1:?usage: remote-deploy.sh <image_tag>  (GHCR user and token on stdin)}"
export DEPLOY_DIR="${DEPLOY_DIR:-/opt/saiflow}"
cd "$DEPLOY_DIR"

# Checked before anything changes: migrations need the migration account (harden-identity).
bash "$DEPLOY_DIR/db-roles.sh" --check

IFS= read -r ghcr_user
IFS= read -r ghcr_token
if [ -z "$ghcr_user" ] || [ -z "$ghcr_token" ]; then
  echo "remote-deploy: GHCR user/token missing on stdin" >&2
  exit 2
fi

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$ghcr_token" | docker login ghcr.io -u "$ghcr_user" --password-stdin >/dev/null
unset ghcr_token

# Record the deployed tag in .env (compose reads IMAGE_TAG from it; rollback = old tag,
# kept as PREVIOUS_IMAGE_TAG so the images to go back to are known).
previous="$(sed -n 's/^IMAGE_TAG=//p' .env | tail -n1)"
tmp="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
grep -v -e '^IMAGE_TAG=' -e '^PREVIOUS_IMAGE_TAG=' .env >"$tmp" || true
if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
  echo "PREVIOUS_IMAGE_TAG=$previous" >>"$tmp"
else
  # same tag again: the tag to go back to stays what it was
  grep '^PREVIOUS_IMAGE_TAG=' .env | tail -n1 >>"$tmp" || true
fi
echo "IMAGE_TAG=$tag" >>"$tmp"
chmod 600 "$tmp"
mv "$tmp" .env

compose=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml")
echo "remote-deploy: pulling $tag"
"${compose[@]}" pull
# The secrets folder and the backend's GCS key must belong to the image's user (ocr-scan-flow).
bash "$DEPLOY_DIR/secrets-perms.sh"
"${compose[@]}" up -d --wait postgres
bash "$DEPLOY_DIR/db-roles.sh"
# A fresh dump (local + GCS, FR-PLAT-006) before any migration; no backup, no migration.
echo "remote-deploy: backing up the database before migrating"
bash "$DEPLOY_DIR/backup.sh"
echo "remote-deploy: migrating"
"${compose[@]}" run --rm saiflow-be-migrate alembic upgrade head
"${compose[@]}" up -d --remove-orphans
# The Caddyfile is bind-mounted and not watched: reload so edits take effect.
"${compose[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile
docker image prune -f >/dev/null
echo "remote-deploy: done ($tag)"
