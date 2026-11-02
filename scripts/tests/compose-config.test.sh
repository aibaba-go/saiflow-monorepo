#!/usr/bin/env bash
# Static checks on the deploy configuration that the CI stack job then exercises for real.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/tests/lib.sh
source "$here/lib.sh"
deploy="$here/../deploy"

# During first initialisation the postgres image runs a temporary server on the Unix
# socket only; probing over TCP (127.0.0.1) avoids reporting "ready" too early.
check "compose healthcheck probes over TCP" grep -q 'pg_isready -h 127.0.0.1' "$deploy/compose.yaml"
check "restore-check waits over TCP" grep -q 'pg_isready -h 127.0.0.1' "$deploy/restore-check.sh"
check "postgres publishes no ports" bash -c "! awk '/^  postgres:/{p=1;next} /^  [a-z]/{p=0} p' '$deploy/compose.yaml' | grep -v '^ *#' | grep -q 'ports:'"
finish
