#!/usr/bin/env bash
# Runs on the VPS as `deploy`, from remote-deploy.sh right after the images are pulled.
# Puts /opt/saiflow/secrets in order on every deploy (and on a new server): the backend and
# OCR worker read their GCS key as the image's user `app`, which a folder owned by deploy
# refuses (Permission denied). deploy may use Docker but not chown, so a short-lived root
# container from the backend image does it (secrets-fix.sh). Nothing in it is printed.
set -euo pipefail
export DEPLOY_DIR="${DEPLOY_DIR:-/opt/saiflow}"
cd "$DEPLOY_DIR"

# The backend's key file is the one GCS_CREDENTIALS_FILE names (default gcs-sa.json).
key="$(sed -n 's/^GCS_CREDENTIALS_FILE=//p' .env | tail -n1 | tr -d "\"'\r")"
key="${key##*/}"
key="${key:-gcs-sa.json}"

mkdir -p "$DEPLOY_DIR/secrets"
docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" \
  run --rm --no-deps -T --user 0 --entrypoint sh \
  -v "$DEPLOY_DIR/secrets:/fix" -v "$DEPLOY_DIR/secrets-fix.sh:/secrets-fix.sh:ro" \
  saiflow-be-migrate /secrets-fix.sh /fix app "$(id -u):$(id -g)" "$key"
