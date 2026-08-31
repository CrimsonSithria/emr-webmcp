#!/usr/bin/env bash
set -euo pipefail

EMR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=lib.sh disable=SC1091
source "${EMR_LIB}"

emr_load_env
emr_require_deploy_secrets

backup_root="$(emr_backup_dir)"
mkdir -p "${backup_root}"

emr_restore_db() {
  local stamp="$1"
  local dest dump
  [[ -n "${stamp}" ]] || emr_die "usage: backup.sh restore-db <timestamp>"
  dest="${backup_root}/${stamp}"
  dump="${dest}/mariadb.sql"
  [[ -f "${dump}" ]] || emr_die "database dump is missing"
  # Password expands inside the container, not on the host command line.
  # shellcheck disable=SC2016
  emr_compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' <"${dump}" \
    || emr_die "database restore failed"
}

if [[ "${1:-}" == "restore-db" ]]; then
  emr_restore_db "${2:-}"
  exit 0
fi

stamp="$(emr_timestamp)"
dest="${backup_root}/${stamp}"
mkdir -p "${dest}"
chmod 0700 "${dest}"

cp "$(emr_compose_file)" "${dest}/compose.yml"
emr_write_image_manifest "${dest}/image-manifest.json"

dump_err="${dest}/.dump.err"
# Password expands inside the container, not on the host command line.
# shellcheck disable=SC2016
if ! emr_compose exec -T db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases' >"${dest}/mariadb.sql" 2>"${dump_err}"; then
  rm -rf "${dest}"
  emr_die "backup failed"
fi
if [[ ! -s "${dest}/mariadb.sql" ]]; then
  rm -rf "${dest}"
  emr_die "backup failed"
fi
rm -f "${dump_err}"

if [[ -f "${backup_root}/CURRENT" ]]; then
  cp "${backup_root}/CURRENT" "${backup_root}/PREVIOUS"
fi
printf '%s\n' "${stamp}" >"${backup_root}/CURRENT"
