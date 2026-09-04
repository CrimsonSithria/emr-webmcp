#!/usr/bin/env bash
set -euo pipefail

# Purges old synthetic labs (same Hgb stamp bug) and re-seeds with varied panel data.
# Requires OPENMRS_BASE_URL, OPENMRS_USERNAME, OPENMRS_PASSWORD in the environment.

profile="${1:-demo}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

exec npx -y corepack@0.36.0 yarn workspace @emr-webmcp/simulation reseed "$profile" --purge
