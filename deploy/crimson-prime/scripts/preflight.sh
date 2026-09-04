#!/usr/bin/env bash
set -euo pipefail

EMR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=lib.sh disable=SC1091
source "${EMR_LIB}"

emr_load_env

if ! command -v docker >/dev/null 2>&1; then
  emr_die "docker is required"
fi

docker_ver="$(emr_docker_server_version)"
if [[ -z "${docker_ver}" ]]; then
  emr_die "docker daemon is unavailable"
fi
if (( "$(emr_major "${docker_ver}")" < 29 )); then
  emr_die "docker 29+ is required"
fi

compose_ver="$(emr_compose_version)"
if [[ -z "${compose_ver}" ]] || (( "$(emr_major "${compose_ver}")" < 5 )); then
  emr_die "compose 5+ is required"
fi

if ! docker info >/dev/null 2>&1; then
  emr_die "docker daemon is unavailable"
fi

bind="$(emr_bind_address)"
port="$(emr_port)"
if [[ "${bind}" != "127.0.0.1" && "${bind}" != "::1" ]]; then
  emr_die "bind address must be loopback"
fi
if emr_port_forbidden "${port}"; then
  emr_die "refusing host bind on 80 or 443"
fi
if emr_port_in_use "${bind}" "${port}" && ! emr_port_owned_by_stack "${bind}" "${port}"; then
  emr_die "loopback port is occupied"
fi

avail="$(emr_disk_available_kb "$(emr_backup_dir)")"
if [[ -z "${avail}" ]] || (( avail < "$(emr_min_disk_kb)" )); then
  emr_die "insufficient disk headroom"
fi

emr_require_deploy_secrets

dist="$(emr_frontend_dist)"
if [[ ! -s "${dist}" ]]; then
  emr_die "frontend workspace build is missing"
fi
