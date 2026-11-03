#!/usr/bin/env bash
# One-time GCP setup for database backups (FR-PLAT-006, ADR-008). Run in Cloud Shell
# by someone with project admin rights; re-running is safe.
#   GCP_PROJECT_ID=saiflow-509205 BACKUP_BUCKET=saiflow-db-backup bash scripts/gcp-backup-bootstrap.sh
# Creates: the backup bucket (private, 30-day delete rule) and service account
# saiflow-v3-backup with object-create permission on that bucket only; writes a key
# file to the current directory for you to copy to the VPS.
set -euo pipefail

: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${BACKUP_BUCKET:?set BACKUP_BUCKET (name without gs://)}"
location="${BUCKET_LOCATION:-asia-southeast1}"
bucket="gs://${BACKUP_BUCKET#gs://}"
sa_name=saiflow-v3-backup
sa="$sa_name@$GCP_PROJECT_ID.iam.gserviceaccount.com"
key_file="./$sa_name-key.json"

gcloud config set project "$GCP_PROJECT_ID" >/dev/null
gcloud services enable storage.googleapis.com iam.googleapis.com

if ! gcloud storage buckets describe "$bucket" >/dev/null 2>&1; then
  gcloud storage buckets create "$bucket" --location="$location" \
    --uniform-bucket-level-access --public-access-prevention
fi
lifecycle="$(mktemp)"
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' >"$lifecycle"
gcloud storage buckets update "$bucket" --lifecycle-file="$lifecycle"
rm -f "$lifecycle"

if ! gcloud iam service-accounts describe "$sa" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$sa_name" --display-name="SaiFlow v3 database backup (write only)"
fi
# objectCreator: upload. objectViewer: `gcloud storage cp` reads the object back
# (storage.objects.get) and fails with 403 without it. Neither allows delete or
# overwrite, so a leaked key cannot destroy existing backups.
for role in roles/storage.objectCreator roles/storage.objectViewer; do
  gcloud storage buckets add-iam-policy-binding "$bucket" \
    --member="serviceAccount:$sa" --role="$role" >/dev/null
done

# -s, not -f: a failed `keys create` leaves an empty file behind, which must not count.
if [ ! -s "$key_file" ]; then
  # A just-created service account can take a few seconds to become usable (NOT_FOUND).
  for attempt in 1 2 3 4 5 6; do
    if gcloud iam service-accounts keys create "$key_file" --iam-account="$sa"; then break; fi
    rm -f "$key_file"
    [ "$attempt" -lt 6 ] || { echo "could not create the key for $sa" >&2; exit 1; }
    echo "retrying in 10s ($attempt/6)" >&2
    sleep 10
  done
fi

cat <<MSG

Done. Bucket: $bucket (delete after 30 days). Service account: $sa (create + read on this bucket only; no delete).
Next:
  1. Copy the key to the VPS, then delete it here:
       scp -P 11022 $key_file root@<vps-ip>:/opt/saiflow/secrets/gcs-backup.json
       ssh -p 11022 root@<vps-ip> 'chown deploy:deploy /opt/saiflow/secrets/gcs-backup.json && chmod 600 /opt/saiflow/secrets/gcs-backup.json'
       rm $key_file
  2. Set BACKUP_BUCKET=$bucket in /opt/saiflow/.env on the VPS.
MSG
