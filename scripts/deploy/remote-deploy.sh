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
if ! grep -q '^DB_MIGRATE_PASSWORD=.' .env; then
  echo "remote-deploy: DB_MIGRATE_PASSWORD missing in $DEPLOY_DIR/.env (docs/deployment/README.md)" >&2
  exit 2
fi

IFS= read -r ghcr_user
IFS= read -r ghcr_token
if [ -z "$ghcr_user" ] || [ -z "$ghcr_token" ]; then
  echo "remote-deploy: GHCR user/token missing on stdin" >&2
  exit 2
fi

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$ghcr_token" | docker login ghcr.io -u "$ghcr_user" --password-stdin >/dev/null
unset ghcr_token

# Record the deployed tag in .env (compose reads IMAGE_TAG from it; rollback = old tag).
tmp="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
grep -v '^IMAGE_TAG=' .env >"$tmp" || true
echo "IMAGE_TAG=$tag" >>"$tmp"
chmod 600 "$tmp"
mv "$tmp" .env

compose=(docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml")
echo "remote-deploy: pulling $tag"
"${compose[@]}" pull
"${compose[@]}" up -d --wait postgres
bash "$DEPLOY_DIR/db-roles.sh"
echo "remote-deploy: migrating"
"${compose[@]}" run --rm saiflow-be-migrate alembic upgrade head
"${compose[@]}" up -d --remove-orphans
# The Caddyfile is bind-mounted and not watched: reload so edits take effect.
"${compose[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile
docker image prune -f >/dev/null
echo "remote-deploy: done ($tag)"
