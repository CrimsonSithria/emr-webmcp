#!/usr/bin/env bash
set -euo pipefail

EMR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=lib.sh disable=SC1091
source "${EMR_LIB}"

emr_load_env
emr_require_deploy_secrets

backup_root="$(emr_backup_dir)"
target=""
if [[ -f "${backup_root}/PREVIOUS" ]]; then
  target="$(tr -d '[:space:]' <"${backup_root}/PREVIOUS")"
fi
[[ -n "${target}" ]] || emr_die "no rollback target"
dest="${backup_root}/${target}"
[[ -f "${dest}/compose.yml" && -f "${dest}/image-manifest.json" ]] || emr_die "rollback target is incomplete"

if [[ "${1:-}" == "--dry-run" ]]; then
  printf '%s\n' '{"status":"dry-run","toolName":"rollback","count":1}'
  exit 0
fi

while IFS=$'\t' read -r image_id ref; do
  [[ -n "${image_id}" && -n "${ref}" ]] || continue
  docker tag "${image_id}" "${ref}"
done < <(emr_apply_image_manifest "${dest}/image-manifest.json")

emr_compose_file_at "${dest}/compose.yml" up -d --no-build
emr_wait_healthy
