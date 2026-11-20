#!/bin/sh
# Runs as root inside the backend image (called by secrets-perms.sh), so it can give files
# to the container user, which the host user `deploy` cannot:
#   secrets-fix.sh <dir> <container_user> <host_owner uid:gid> <container_key_name>
# The folder and the backend's key belong to the container user (its uid read from the
# image, not written here); every other file (the backup key) stays with deploy. Folder 700,
# files 600. A missing or empty folder is fine.
set -eu
dir="$1"; user="$2"; owner="$3"; key="$4"
ids="$(id -u "$user"):$(id -g "$user")"
chown "$ids" "$dir"
chmod 700 "$dir"
for f in "$dir"/* "$dir"/.[!.]*; do
  [ -f "$f" ] || continue
  if [ "${f##*/}" = "$key" ]; then chown "$ids" "$f"; else chown "$owner" "$f"; fi
  chmod 600 "$f"
done
echo "secrets: folder for $user ($ids) 700; $key for $user, other files for $owner; files 600"
