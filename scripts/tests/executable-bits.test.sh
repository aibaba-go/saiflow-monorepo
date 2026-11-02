#!/usr/bin/env bash
# Every shell script (and the fake docker used by tests) must be executable in git:
# Linux PATH lookup skips non-executable files, and the postgres image only runs
# init scripts that are executable (it sources the others).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
cd "$here/../.." || exit 1

while read -r mode _ _ path; do
  check "$path is executable in git" test "$mode" = "100755"
done < <(git ls-files -s -- 'scripts/*.sh' 'scripts/**/*.sh' 'scripts/tests/fakes/*' 'packages/api-client/scripts/*.sh')
finish
