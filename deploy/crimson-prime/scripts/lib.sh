#!/usr/bin/env bash
# Shared helpers for Crimson Prime ops scripts. Source only.
# Never print secrets, cookies, PHI, or URLs that include credentials.

set -euo pipefail

emr_root() {
  if [[ -n "${EMR_WEBMCP_ROOT:-}" ]]; then
    printf '%s\n' "${EMR_WEBMCP_ROOT}"
    return
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  printf '%s\n' "${here}"
}

emr_compose_file() {
  printf '%s\n' "$(emr_root)/deploy/crimson-prime/compose.yml"
}

emr_project_dir() {
  printf '%s\n' "$(emr_root)/deploy/crimson-prime"
}

emr_env_file() {
  printf '%s\n' "${EMR_WEBMCP_ENV_FILE:-$(emr_project_dir)/.env}"
}

emr_backup_dir() {
  printf '%s\n' "${EMR_WEBMCP_BACKUP_DIR:-/srv/emr-webmcp/backups}"
}

emr_frontend_dist() {
  printf '%s\n' "${EMR_WEBMCP_FRONTEND_DIST:-$(emr_root)/apps/openmrs-esm/dist/openmrs-esm-esm.js}"
}

emr_bind_address() {
  printf '%s\n' "${EMR_WEBMCP_BIND_ADDRESS:-127.0.0.1}"
}

emr_port() {
  printf '%s\n' "${EMR_WEBMCP_PORT:-18080}"
}

emr_min_disk_kb() {
  printf '%s\n' "${EMR_WEBMCP_MIN_DISK_KB:-5242880}"
}

emr_die() {
  printf '%s\n' "$*" >&2
  exit 1
}

emr_var_is_set() {
  declare -p "$1" >/dev/null 2>&1
}

emr_load_env() {
  local file line key value
  file="$(emr_env_file)"
  [[ -f "${file}" ]] || emr_die "env file is missing"
  emr_assert_mode_0600 "${file}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ -n "${key}" ]] || continue
    if ! emr_var_is_set "${key}"; then
      export "${key}=${value}"
    fi
  done <"${file}"
}

emr_assert_mode_0600() {
  local mode
  if mode="$(stat -f '%OLp' "$1" 2>/dev/null)"; then
    :
  else
    mode="$(stat -c '%a' "$1")"
  fi
  if [[ "${mode}" != "600" && "${mode}" != "0600" ]]; then
    emr_die "env file must be mode 0600"
  fi
}

# Admin123 is the OpenMRS reference application's shipped admin password.
emr_is_placeholder_secret() {
  case "$1" in
    "" | change-me | password | root | openmrs | Admin123) return 0 ;;
  esac
  return 1
}

emr_is_placeholder_host() {
  case "$1" in
    "" | change-me | example.invalid | localhost | 127.0.0.1 | 0.0.0.0) return 0 ;;
  esac
  if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    return 0
  fi
  return 1
}

emr_is_real_phi_ack() {
  local ack="$1"
  if [[ "${ack}" =~ [Rr]eal|[Pp]roduction|[Pp]hi-authorized|[Aa]uthorized-for ]]; then
    return 0
  fi
  return 1
}

emr_require_deploy_secrets() {
  if emr_is_placeholder_host "${OPENMRS_PUBLIC_HOSTNAME:-}"; then
    emr_die "public hostname is missing or a placeholder"
  fi
  if emr_is_placeholder_secret "${OMRS_DB_PASSWORD:-}"; then
    emr_die "generated database password is missing"
  fi
  if emr_is_placeholder_secret "${MYSQL_ROOT_PASSWORD:-}"; then
    emr_die "generated root database password is missing"
  fi
  if emr_is_placeholder_secret "${SYNTHETIC_DATA_ACK:-}" || emr_is_real_phi_ack "${SYNTHETIC_DATA_ACK:-}"; then
    emr_die "synthetic-data acknowledgement is missing or attests real PHI"
  fi
  if [[ "${SYNTHETIC_DATA_ACK}" != "synthetic-demo-only" ]]; then
    emr_die "synthetic-data acknowledgement is missing or invalid"
  fi
}

emr_runtime_dir() {
  if [[ -z "${EMR_WEBMCP_RUNTIME_DIR:-}" ]]; then
    EMR_WEBMCP_RUNTIME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/emr-webmcp.XXXXXX")"
    EMR_WEBMCP_RUNTIME_OWNED=1
    export EMR_WEBMCP_RUNTIME_DIR EMR_WEBMCP_RUNTIME_OWNED
  fi
  mkdir -p "${EMR_WEBMCP_RUNTIME_DIR}"
  printf '%s\n' "${EMR_WEBMCP_RUNTIME_DIR}"
}

emr_cleanup_runtime() {
  local dir="${EMR_WEBMCP_RUNTIME_DIR:-}"
  [[ -n "${dir}" && -d "${dir}" ]] || return 0
  find "${dir}" -mindepth 1 -exec rm -rf {} + 2>/dev/null || true
  if [[ "${EMR_WEBMCP_RUNTIME_OWNED:-0}" == "1" ]]; then
    rmdir "${dir}" 2>/dev/null || rm -rf "${dir}"
  fi
}

emr_compose() {
  docker compose \
    --project-directory "$(emr_project_dir)" \
    -f "$(emr_compose_file)" \
    --env-file "$(emr_env_file)" \
    --project-name emr-webmcp \
    "$@"
}

emr_compose_file_at() {
  local file="$1"
  shift
  docker compose \
    --project-directory "$(emr_project_dir)" \
    -f "${file}" \
    --env-file "$(emr_env_file)" \
    --project-name emr-webmcp \
    "$@"
}

emr_port_forbidden() {
  local port="$1"
  [[ "${port}" == "80" || "${port}" == "443" ]]
}

emr_port_in_use() {
  local addr="$1" port="$2"
  python3 - "${addr}" "${port}" <<'PY'
import socket
import sys

addr = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(0.3)
try:
    sock.connect((addr, port))
except OSError:
    sys.exit(1)
else:
    sys.exit(0)
finally:
    sock.close()
PY
}

# True when this compose project's own gateway is what publishes addr:port, so a
# redeploy of a running stack is not mistaken for a foreign listener.
emr_port_owned_by_stack() {
  local addr="$1" port="$2" published
  published="$(emr_compose port gateway 80 2>/dev/null | tr -d '[:space:]' || true)"
  [[ -n "${published}" ]] || return 1
  [[ "${published}" == "${addr}:${port}" || "${published}" == "[${addr}]:${port}" ]]
}

emr_disk_available_kb() {
  local path="$1"
  mkdir -p "${path}"
  df -Pk "${path}" | awk 'NR==2 {print $4}'
}

emr_docker_server_version() {
  docker version --format '{{.Server.Version}}' 2>/dev/null || true
}

emr_compose_version() {
  docker compose version --short 2>/dev/null || true
}

emr_major() {
  local raw="${1%%.*}"
  printf '%s\n' "${raw:-0}"
}

emr_timestamp() {
  date -u +%Y%m%dT%H%M%SZ
}

emr_write_image_manifest() {
  local dest="$1"
  local images_json
  images_json="$(emr_compose images --format json 2>/dev/null || true)"
  python3 - "$(emr_compose_file)" "${dest}" "${images_json}" <<'PY'
import json
import re
import sys

compose = sys.argv[1]
dest = sys.argv[2]
raw_images = sys.argv[3] if len(sys.argv) > 3 else ""
wanted = {"db", "backend", "frontend", "gateway"}
current = None
refs = {}
for line in open(compose, encoding="utf-8"):
    svc = re.match(r"^  ([a-z0-9-]+):\s*$", line)
    if svc:
        current = svc.group(1)
        continue
    img = re.match(r"^    image:\s+(\S+)\s*$", line)
    if img and current in wanted:
        refs[current] = img.group(1)
if set(refs) != wanted:
    missing = ", ".join(sorted(wanted - set(refs)))
    raise SystemExit(f"compose image pins missing: {missing}")

ids = {}
payload = raw_images.strip()
if payload:
    try:
        parsed = json.loads(payload)
        rows = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        rows = []
        for line in payload.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    for row in rows:
        if not isinstance(row, dict):
            continue
        service = row.get("Service")
        image_id = row.get("ID") or row.get("Id")
        if service in wanted and isinstance(image_id, str) and image_id:
            ids[service] = image_id

manifest = {}
for service, ref in refs.items():
    entry = {"ref": ref}
    if service in ids:
        entry["id"] = ids[service]
    manifest[service] = entry

with open(dest, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, separators=(",", ":"))
    handle.write("\n")
PY
}

emr_apply_image_manifest() {
  local manifest="$1"
  python3 - "${manifest}" <<'PY'
import json
import sys

LOCAL_FRONTEND = "emr-webmcp/openmrs-frontend:local"
data = json.loads(open(sys.argv[1], encoding="utf-8").read())
if not isinstance(data, dict):
    raise SystemExit("image manifest must be an object")
for entry in data.values():
    if not isinstance(entry, dict):
        continue
    image_id = entry.get("id")
    ref = entry.get("ref")
    if not isinstance(image_id, str) or not image_id:
        continue
    if not isinstance(ref, str) or not ref:
        continue
    if "@" in ref:
        continue
    if ref != LOCAL_FRONTEND:
        continue
    print(f"{image_id}\t{ref}")
PY
}

emr_wait_healthy() {
  local timeout="${EMR_WEBMCP_HEALTH_TIMEOUT:-600}"
  local poll="${EMR_WEBMCP_HEALTH_POLL:-2}"
  local started="${SECONDS}"
  local lines line service health
  local -a missing
  while ((SECONDS - started < timeout)); do
    lines="$(emr_compose ps --format '{{.Service}} {{.Health}}')"
    missing=()
    while IFS= read -r line; do
      [[ -z "${line}" ]] && continue
      service="${line%% *}"
      health="${line#* }"
      if [[ "${health}" == "unhealthy" ]]; then
        emr_die "unhealthy dependency"
      fi
      if [[ "${health}" != "healthy" ]]; then
        missing+=("${service}")
      fi
    done <<<"${lines}"
    if [[ ${#missing[@]} -eq 0 && -n "${lines}" ]]; then
      return 0
    fi
    sleep "${poll}"
  done
  emr_die "deploy timeout"
}

emr_http_class() {
  local code="$1"
  case "${code}" in
    2??) printf '2xx\n' ;;
    3??) printf '3xx\n' ;;
    4??) printf '4xx\n' ;;
    5??) printf '5xx\n' ;;
    *) printf '5xx\n' ;;
  esac
}

emr_now_ms() {
  python3 -c 'import time; print(int(time.time() * 1000))'
}

emr_print_json() {
  python3 -c 'import json,sys; print(json.dumps(json.loads(sys.stdin.read()), separators=(",", ":")))'
}
