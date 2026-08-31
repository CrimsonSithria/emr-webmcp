#!/usr/bin/env bash
set -euo pipefail

EMR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=lib.sh disable=SC1091
source "${EMR_LIB}"

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPTS}/preflight.sh"
"${SCRIPTS}/backup.sh" || emr_die "backup failed"

emr_load_env

emr_compose pull
emr_compose build frontend
emr_compose up -d --remove-orphans
emr_wait_healthy
