#!/usr/bin/env bash
# One-time VPS setup (ADR-008, B-1). Run ONCE as root on the Ubuntu 24.04 server;
# re-running is safe and changes nothing that already exists.
#   scp -P 11022 scripts/vps-bootstrap.sh deploy_key.pub root@<vps>:/root/
#   ssh -p 11022 root@<vps> 'bash /root/vps-bootstrap.sh /root/deploy_key.pub [gs://<backup-bucket>]'
# Does: install Docker Engine + Compose plugin; create user `deploy` (docker group,
# SSH key only, password locked); create /opt/saiflow with .env (random passwords,
# mode 600); install the daily backup timer. Does NOT touch the firewall or sshd.
set -euo pipefail

pubkey="${1:?usage: vps-bootstrap.sh <deploy_public_key_file> [backup_bucket]}"
bucket="${2:-}"
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[ -s "$pubkey" ] || { echo "public key file $pubkey is empty or missing" >&2; exit 1; }
dir=/opt/saiflow

echo "== Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091  # system file, present on Ubuntu
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker compose version

echo "== user deploy"
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG docker deploy
passwd -l deploy >/dev/null   # no password: SSH key login only
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy "$pubkey" /home/deploy/.ssh/authorized_keys

echo "== $dir"
install -d -m 700 -o deploy -g deploy "$dir" "$dir/backups" "$dir/secrets"
if [ ! -f "$dir/.env" ]; then
  (
    umask 077
    {
      echo "POSTGRES_USER=saiflow_admin"
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
      echo "DB_PASSWORD=$(openssl rand -hex 24)"
      echo "APP_HOST=saiflow-app.aibaba.asia"
      echo "ADMIN_HOST=saiflow-admin.aibaba.asia"
      echo "LINE_HOST=saiflow-line2.aibaba.asia"
      echo "IMAGE_TAG="
      echo "BACKUP_BUCKET=$bucket"
      # filled in by the owner (docs/deployment/README.md); empty = feature off
      echo "LINE_CHANNEL_ID="
      echo "LINE_CHANNEL_SECRET="
      echo "LINE_LOGIN_REDIRECT_URIS="
      echo "SMTP_HOST="
      echo "SMTP_USERNAME="
      echo "SMTP_PASSWORD="
      echo "SMTP_FROM="
      echo "SMTP_PORT=587"
      echo "SMTP_SECURITY=starttls"
    } >"$dir/.env"
  )
  echo "created $dir/.env with random passwords"
elif [ -n "$bucket" ] && ! grep -q "^BACKUP_BUCKET=.\+" "$dir/.env"; then
  sed -i "s#^BACKUP_BUCKET=.*#BACKUP_BUCKET=$bucket#" "$dir/.env"
fi
chown deploy:deploy "$dir/.env"
chmod 600 "$dir/.env"

echo "== backup timer"
cat >/etc/systemd/system/saiflow-backup.service <<'UNIT'
[Unit]
Description=SaiFlow daily database backup (FR-PLAT-006)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=deploy
ExecStart=/usr/bin/bash /opt/saiflow/backup.sh
UNIT
cat >/etc/systemd/system/saiflow-backup.timer <<'UNIT'
[Unit]
Description=Run the SaiFlow database backup every day at 03:00 Bangkok time

[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Bangkok
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now saiflow-backup.timer

echo
echo "Done. Next: put the GCS key at $dir/secrets/gcs-backup.json (owner deploy, mode 600),"
echo "make sure BACKUP_BUCKET is set in $dir/.env, then run the Deploy workflow."
echo "Host key for the GitHub secret VPS_KNOWN_HOSTS: run on your machine"
echo "  ssh-keyscan -p 11022 <vps-ip>"
