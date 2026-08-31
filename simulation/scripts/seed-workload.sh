#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <smoke|demo|clinic>" >&2
  exit 1
}

profile="${1:-}"
case "$profile" in
  smoke|demo|clinic) ;;
  *) usage ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# Credentials come from the environment only. Never print headers or response bodies.
exec npx -y corepack@0.36.0 yarn workspace @emr-webmcp/simulation seed "$profile"
