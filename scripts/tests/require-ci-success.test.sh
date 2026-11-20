#!/usr/bin/env bash
# Tests for scripts/require-ci-success.sh with a fake gh (AC-FR-PLAT-005-02).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
script="$here/../require-ci-success.sh"

bin="$(mktemp -d)"
cat >"$bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\n' "$FAKE_GH_JSON"
GH
chmod +x "$bin/gh"
export PATH="$bin:$PATH"

run_with() { FAKE_GH_JSON="$1" bash "$script" abc123 >/dev/null 2>&1; echo $?; }

check "completed success → 0" test "$(run_with '[{"status":"completed","conclusion":"success"}]')" -eq 0
check "in_progress → 1" test "$(run_with '[{"status":"in_progress","conclusion":""}]')" -eq 1
check "queued → 1" test "$(run_with '[{"status":"queued","conclusion":""}]')" -eq 1
check "completed failure → 1" test "$(run_with '[{"status":"completed","conclusion":"failure"}]')" -eq 1
check "no runs → 1" test "$(run_with '[]')" -eq 1
check "message names the commit" grep -q 'CI has not passed for abc123' \
  <<<"$(FAKE_GH_JSON='[]' bash "$script" abc123 2>&1)"
rm -rf "$bin"
finish
