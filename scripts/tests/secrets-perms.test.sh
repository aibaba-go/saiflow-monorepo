#!/usr/bin/env bash
# shellcheck disable=SC2016  # the fakes' $* and $FIX_LOG expand when the fakes run
# Tests for scripts/deploy/secrets-perms.sh and secrets-fix.sh: on every deploy the secrets
# folder and the backend's key belong to the container user, other keys (the backup key) to
# deploy, folder 700 and files 600 (ocr-scan-flow; Permission denied found on the dev VPS).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
fix="$here/../deploy/secrets-fix.sh"
perms="$here/../deploy/secrets-perms.sh"

# --- secrets-fix.sh (runs as root inside the backend image): fake id/chown/chmod
work="$(mktemp -d)"
mkdir -p "$work/bin" "$work/secrets"
: >"$work/secrets/gcs-sa.json"; : >"$work/secrets/gcs-backup.json"
cat >"$work/bin/id" <<'FAKE'
#!/bin/sh
[ "$1" = "-u" ] && { echo 10001; exit 0; }
[ "$1" = "-g" ] && { echo 10002; exit 0; }
exit 1
FAKE
for cmd in chown chmod; do
  printf '#!/bin/sh\necho "%s $*" >>"$FIX_LOG"\n' "$cmd" >"$work/bin/$cmd"
done
chmod +x "$work/bin/"*
export FIX_LOG="$work/fix.log"
PATH="$work/bin:$PATH" sh "$fix" "$work/secrets" app 1000:1000 gcs-sa.json >/dev/null; code=$?
check "fix exits 0" test "$code" -eq 0
check "folder owned by the container user (uid from the image)" grep -qx "chown 10001:10002 $work/secrets" "$FIX_LOG"
check "folder 700" grep -qx "chmod 700 $work/secrets" "$FIX_LOG"
check "backend key owned by the container user" grep -qx "chown 10001:10002 $work/secrets/gcs-sa.json" "$FIX_LOG"
check "backup key stays with deploy" grep -qx "chown 1000:1000 $work/secrets/gcs-backup.json" "$FIX_LOG"
check "every file 600" test "$(grep -c '^chmod 600 ' "$FIX_LOG")" -eq 2
rm -rf "$work"

# an empty folder (keys not placed yet) is fine
work="$(mktemp -d)"; mkdir -p "$work/bin" "$work/secrets"
printf '#!/bin/sh\necho 10001\n' >"$work/bin/id"
for cmd in chown chmod; do printf '#!/bin/sh\necho "%s $*" >>"$FIX_LOG"\n' "$cmd" >"$work/bin/$cmd"; done
chmod +x "$work/bin/"*; export FIX_LOG="$work/fix.log"
PATH="$work/bin:$PATH" sh "$fix" "$work/secrets" app 1000:1000 gcs-sa.json >/dev/null; code=$?
check "empty folder exits 0" test "$code" -eq 0
check "empty folder still gets owner and 700" grep -qx "chmod 700 $work/secrets" "$FIX_LOG"
rm -rf "$work"

# --- secrets-perms.sh (runs as deploy): one root container from the backend image
setup() {
  work="$(mktemp -d)"
  printf 'IMAGE_TAG=sha\nGCS_CREDENTIALS_FILE="/run/secrets/my-key.json"\n' >"$work/.env"
  export DEPLOY_DIR="$work" FAKE_LOG="$work/calls.log" PATH="$here/fakes:$PATH"
  : >"$FAKE_LOG"
}
setup
bash "$perms" >/dev/null 2>&1; code=$?
check "perms exits 0" test "$code" -eq 0
check "secrets folder created when missing" test -d "$work/secrets"
check "runs as root from the backend image without dependencies" \
  grep -q -- "run --rm --no-deps -T --user 0 --entrypoint sh .*saiflow-be-migrate" "$FAKE_LOG"
check "mounts the folder writable and the fix script read-only" \
  bash -c "grep -q -- '-v $work/secrets:/fix ' '$FAKE_LOG' && grep -q -- 'secrets-fix.sh:/secrets-fix.sh:ro' '$FAKE_LOG'"
check "key name from GCS_CREDENTIALS_FILE (quotes and path dropped)" grep -q -- " my-key.json$" "$FAKE_LOG"
check "host owner is the deploy user" grep -q -- " app $(id -u):$(id -g) " "$FAKE_LOG"
rm -rf "$work"

setup
printf 'IMAGE_TAG=sha\n' >"$work/.env"
bash "$perms" >/dev/null 2>&1
check "default key name gcs-sa.json" grep -q -- " gcs-sa.json$" "$FAKE_LOG"
rm -rf "$work"
finish
