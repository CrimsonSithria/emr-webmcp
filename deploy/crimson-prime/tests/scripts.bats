#!/usr/bin/env bats
# Stubbed docker/curl/openssl coverage for Crimson Prime ops scripts.

setup() {
  TEST_HOME="$(mktemp -d "${BATS_TEST_TMPDIR}/emr-ops.XXXXXX")"
  export TEST_HOME
  export PATH="${TEST_HOME}/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  export EMR_WEBMCP_ROOT="${BATS_TEST_DIRNAME}/../../.."
  export EMR_WEBMCP_ENV_FILE="${TEST_HOME}/.env"
  export EMR_WEBMCP_BACKUP_DIR="${TEST_HOME}/backups"
  export EMR_WEBMCP_RUNTIME_DIR="${TEST_HOME}/runtime"
  export EMR_WEBMCP_FRONTEND_DIST="${TEST_HOME}/openmrs-esm-esm.js"
  export EMR_WEBMCP_MIN_DISK_KB="1"
  export EMR_WEBMCP_HEALTH_TIMEOUT="2"
  export EMR_WEBMCP_HEALTH_POLL="0"
  export EMR_WEBMCP_BIND_ADDRESS="127.0.0.1"
  export EMR_WEBMCP_PORT="18080"
  export EMR_WEBMCP_STUB_DIR="${TEST_HOME}/stub"
  export EMR_WEBMCP_STUB_LOG="${TEST_HOME}/docker.log"
  mkdir -p "${TEST_HOME}/bin" "${EMR_WEBMCP_STUB_DIR}" "${EMR_WEBMCP_BACKUP_DIR}" "${EMR_WEBMCP_RUNTIME_DIR}"
  printf '// frontend-dist-stub\n' >"${EMR_WEBMCP_FRONTEND_DIST}"
  _install_stubs
  _write_valid_env
}

teardown() {
  if [[ -n "${PORT_LISTENER_PID:-}" ]]; then
    kill "${PORT_LISTENER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${TEST_HOME:-}" && -d "${TEST_HOME}" ]]; then
    rm -rf "${TEST_HOME}"
  fi
}

SCRIPTS_DIR="${BATS_TEST_DIRNAME}/../scripts"

_install_stubs() {
  cat >"${TEST_HOME}/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
log="${EMR_WEBMCP_STUB_LOG:-/dev/null}"
printf '%s\n' "$*" >>"${log}"
dir="${EMR_WEBMCP_STUB_DIR:-/tmp}"
if [[ "${1:-}" == "version" ]]; then
  printf '%s\n' "${STUB_DOCKER_VERSION:-29.1.0}"
  exit 0
fi
if [[ "${1:-}" == "info" ]]; then
  exit "${STUB_DOCKER_INFO_EXIT:-0}"
fi
if [[ "${1:-}" == "tag" ]]; then
  target="${*: -1}"
  if [[ "${target}" == *@* ]]; then
    printf 'refusing to create a tag with a digest reference\n' >&2
    exit 1
  fi
  exit 0
fi
if [[ "${1:-}" != "compose" ]]; then
  exit 0
fi
shift
joined="$*"
if [[ "${joined}" == *version* ]]; then
  printf '%s\n' "${STUB_COMPOSE_VERSION:-5.3.1}"
  exit 0
fi
if [[ "${joined}" == *mysqldump* ]]; then
  if [[ "${STUB_MYSQLDUMP_EXIT:-0}" != "0" ]]; then
    exit "${STUB_MYSQLDUMP_EXIT}"
  fi
  printf -- '-- MariaDB dump stub\n'
  exit 0
fi
if [[ "${joined}" == *mysql* && "${joined}" != *mysqldump* ]]; then
  printf 'restore-db\n' >>"${dir}/restore.called"
  exit "${STUB_MYSQL_RESTORE_EXIT:-0}"
fi
if [[ "${joined}" == *config* ]]; then
  exit 0
fi
if [[ "${joined}" == *images* ]]; then
  cat <<'JSON'
[{"Service":"db","Repository":"mariadb","Tag":"10.11.7","ID":"sha256:olddb"},{"Service":"backend","Repository":"openmrs/openmrs-reference-application-3-backend","Tag":"qa","ID":"sha256:oldbackend"},{"Service":"frontend","Repository":"emr-webmcp/openmrs-frontend","Tag":"local","ID":"sha256:previous-frontend"},{"Service":"gateway","Repository":"openmrs/openmrs-reference-application-3-gateway","Tag":"qa","ID":"sha256:oldgateway"}]
JSON
  exit 0
fi
if [[ "${joined}" == *" ps "* || "${joined}" == *" ps" || "${joined}" == "ps "* ]]; then
  health="${STUB_HEALTH:-healthy}"
  printf '%s\n' "db ${health}"
  printf '%s\n' "backend ${health}"
  printf '%s\n' "frontend ${health}"
  printf '%s\n' "gateway ${health}"
  exit 0
fi
if [[ "${joined}" == *pull* ]]; then
  exit "${STUB_PULL_EXIT:-0}"
fi
if [[ "${joined}" == *build* ]]; then
  exit "${STUB_BUILD_EXIT:-0}"
fi
if [[ "${joined}" == *up* ]]; then
  exit "${STUB_UP_EXIT:-0}"
fi
exit 0
EOF
  chmod +x "${TEST_HOME}/bin/docker"

  cat >"${TEST_HOME}/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out=""
write_fmt=""
dump_headers=""
method="GET"
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output) out="$2"; shift 2 ;;
    -w|--write-out) write_fmt="$2"; shift 2 ;;
    -D|--dump-header) dump_headers="$2"; shift 2 ;;
    -X|--request) method="$2"; shift 2 ;;
    -H|--header|-u|--user|-d|--data|--data-binary|--data-raw|--netrc-file) shift 2 ;;
    -s|-S|-f|-L|-k|-c|-b|--silent|--show-error|--fail|--location) shift ;;
    --data-binary|--data) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
state="${EMR_WEBMCP_STUB_DIR:-/tmp}/http.state"
count_file="${EMR_WEBMCP_STUB_DIR:-/tmp}/careplan.posts"
body=""
code="200"
headers="HTTP/1.1 200 OK\r\n"
if [[ "${url}" == *routes.registry* || "${url}" == *routes.registry.json* ]]; then
  body='{"@emr-webmcp/openmrs-esm":{"pages":[{"route":"emr-webmcp"}]}}'
elif [[ "${url}" == *'/openmrs/spa'* && "${url}" != *importmap* && "${url}" != *routes* ]]; then
  body='<!doctype html><title>Login</title>'
elif [[ "${url}" == *'/ws/rest/v1/session'* ]]; then
  if [[ "${method}" == "DELETE" ]]; then
    code="204"
    body=""
  else
    body='{"authenticated":true,"user":{"uuid":"synthetic-user"}}'
    headers="HTTP/1.1 200 OK\r\nSet-Cookie: JSESSIONID=secret-cookie-value; Path=/\r\n"
  fi
elif [[ "${url}" == *'/ws/rest/v1/patient'* ]]; then
  body='{"results":[{"uuid":"aaaaaaaa-bbbb-4ccc-8ddd-000000000001"}]}'
elif [[ "${url}" == *'/ws/fhir2/R4/Patient'* ]]; then
  body='{"resourceType":"Bundle","type":"searchset","entry":[{"resource":{"resourceType":"Patient","id":"aaaaaaaa-bbbb-4ccc-8ddd-000000000001"}}]}'
elif [[ "${url}" == *'/ws/fhir2/R4/metadata'* ]]; then
  body='{"resourceType":"CapabilityStatement","status":"active"}'
elif [[ "${url}" == *importmap* ]]; then
  body='{"imports":{"@emr-webmcp/openmrs-esm":"/openmrs/spa/emr-webmcp.js","@openmrs/esm-patient-task-list-app":"/openmrs/spa/tasks.js"}}'
elif [[ "${url}" == *'/ws/rest/v1/tasks/careplan'* || "${url}" == *'/ws/fhir2/R4/CarePlan'* ]]; then
  posts=0
  if [[ -f "${count_file}" ]]; then
    posts="$(cat "${count_file}")"
  fi
  if [[ "${method}" == "POST" ]]; then
    posts=$((posts + 1))
    printf '%s' "${posts}" >"${count_file}"
    if [[ "${posts}" -gt 1 ]]; then
      code="409"
      body='{"error":"duplicate-active"}'
    else
      code="201"
      body='{"uuid":"synthetic-careplan-1"}'
    fi
  else
    if [[ "${posts}" -gt 0 ]]; then
      body='{"results":[{"uuid":"synthetic-careplan-1"}]}'
    else
      body='{"results":[]}'
    fi
  fi
else
  body='{"ok":true}'
fi
if [[ -n "${out}" ]]; then
  printf '%s' "${body}" >"${out}"
fi
if [[ -n "${dump_headers}" ]]; then
  printf '%b' "${headers}" >"${dump_headers}"
fi
if [[ -n "${write_fmt}" ]]; then
  printf '%s' "${write_fmt}" | sed "s/%{http_code}/${code}/g" | tr -d '\n'
fi
printf '%s %s\n' "${method}" "${url}" >>"${state}"
exit 0
EOF
  chmod +x "${TEST_HOME}/bin/curl"

  cat >"${TEST_HOME}/bin/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *x509* ]]; then
  printf 'notAfter=Dec 31 23:59:59 2027 GMT\n'
  exit 0
fi
printf 'CONNECTED\n'
exit 0
EOF
  chmod +x "${TEST_HOME}/bin/openssl"
}

_write_valid_env() {
  cat >"${EMR_WEBMCP_ENV_FILE}" <<'EOF'
EMR_WEBMCP_BIND_ADDRESS=127.0.0.1
EMR_WEBMCP_PORT=18080
OMRS_DB_USER=openmrs
OMRS_DB_PASSWORD=generated-db-password-ok
MYSQL_ROOT_PASSWORD=generated-root-password-ok
OPENMRS_PUBLIC_HOSTNAME=demo.example.invalid
SYNTHETIC_DATA_ACK=synthetic-demo-only
OPENMRS_USERNAME=synthetic-admin
OPENMRS_PASSWORD=synthetic-login-secret
EOF
  chmod 0600 "${EMR_WEBMCP_ENV_FILE}"
}

_assert_redacted() {
  local blob="$1"
  [[ "${blob}" != *generated-db-password-ok* ]]
  [[ "${blob}" != *generated-root-password-ok* ]]
  [[ "${blob}" != *synthetic-login-secret* ]]
  [[ "${blob}" != *secret-cookie-value* ]]
  [[ "${blob}" != *synthetic-admin:synthetic-login-secret* ]]
  [[ "${blob}" != *https://*:*@* ]]
}

@test "preflight fails when required secrets are missing" {
  cat >"${EMR_WEBMCP_ENV_FILE}" <<'EOF'
EMR_WEBMCP_BIND_ADDRESS=127.0.0.1
EMR_WEBMCP_PORT=18080
OMRS_DB_USER=openmrs
EOF
  chmod 0600 "${EMR_WEBMCP_ENV_FILE}"
  run "${SCRIPTS_DIR}/preflight.sh"
  [ "${status}" -ne 0 ]
  _assert_redacted "${output}"
}

@test "preflight fails when the loopback port is occupied" {
  local portfile="${TEST_HOME}/port"
  python3 - "${portfile}" <<'PY' &
import socket, sys, time
path = sys.argv[1]
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("127.0.0.1", 0))
open(path, "w", encoding="utf-8").write(str(sock.getsockname()[1]))
sock.listen(1)
try:
    time.sleep(30)
finally:
    sock.close()
PY
  PORT_LISTENER_PID="$!"
  for _ in $(seq 1 50); do
    [[ -s "${portfile}" ]] && break
    sleep 0.05
  done
  export EMR_WEBMCP_PORT
  EMR_WEBMCP_PORT="$(cat "${portfile}")"
  run "${SCRIPTS_DIR}/preflight.sh"
  [ "${status}" -ne 0 ]
  _assert_redacted "${output}"
}

@test "preflight rejects host binds on 80 or 443" {
  export EMR_WEBMCP_PORT="80"
  run "${SCRIPTS_DIR}/preflight.sh"
  [ "${status}" -ne 0 ]
  export EMR_WEBMCP_PORT="443"
  run "${SCRIPTS_DIR}/preflight.sh"
  [ "${status}" -ne 0 ]
}

@test "preflight rejects placeholder passwords, hostname, and real PHI attestations" {
  cat >"${EMR_WEBMCP_ENV_FILE}" <<'EOF'
OMRS_DB_PASSWORD=change-me
MYSQL_ROOT_PASSWORD=change-me
OPENMRS_PUBLIC_HOSTNAME=example.invalid
SYNTHETIC_DATA_ACK=authorized-for-real-phi
OPENMRS_USERNAME=change-me
OPENMRS_PASSWORD=change-me
EOF
  chmod 0600 "${EMR_WEBMCP_ENV_FILE}"
  run "${SCRIPTS_DIR}/preflight.sh"
  [ "${status}" -ne 0 ]
  _assert_redacted "${output}"
}

@test "preflight rejects env files that are not mode 0600" {
  chmod 0644 "${EMR_WEBMCP_ENV_FILE}"
  run "${SCRIPTS_DIR}/preflight.sh"
  [ "${status}" -ne 0 ]
}

@test "backup failure aborts deploy before compose up" {
  export STUB_MYSQLDUMP_EXIT="1"
  mkdir -p "${EMR_WEBMCP_STUB_DIR}"
  printf 'running\n' >"${EMR_WEBMCP_STUB_DIR}/db.running"
  export STUB_HEALTH="healthy"
  # Pretend the db container is already up so backup attempts a logical dump.
  run "${SCRIPTS_DIR}/deploy.sh"
  [ "${status}" -ne 0 ]
  if [[ -f "${EMR_WEBMCP_STUB_LOG}" ]]; then
    ! grep -- '--remove-orphans' "${EMR_WEBMCP_STUB_LOG}"
  fi
  ! find "${EMR_WEBMCP_BACKUP_DIR}" -name 'db-dump.skipped' | grep -q .
  _assert_redacted "${output}"
}

@test "deploy fails when a dependency stays unhealthy" {
  export STUB_HEALTH="unhealthy"
  export STUB_MYSQLDUMP_EXIT="0"
  run "${SCRIPTS_DIR}/deploy.sh"
  [ "${status}" -ne 0 ]
  _assert_redacted "${output}"
}

@test "deploy fails when health wait times out" {
  export STUB_HEALTH="starting"
  export EMR_WEBMCP_HEALTH_TIMEOUT="1"
  run "${SCRIPTS_DIR}/deploy.sh"
  [ "${status}" -ne 0 ]
  _assert_redacted "${output}"
}

@test "rollback restores previous image manifest and compose state without database restore" {
  local previous="${EMR_WEBMCP_BACKUP_DIR}/20260831T010000Z"
  mkdir -p "${previous}"
  cat >"${previous}/image-manifest.json" <<'EOF'
{"db":{"ref":"mariadb:10.11.7@sha256:previous","id":"sha256:olddb"},"backend":{"ref":"openmrs/openmrs-reference-application-3-backend:qa@sha256:previous","id":"sha256:oldbackend"},"frontend":{"ref":"emr-webmcp/openmrs-frontend:local","id":"sha256:previous-frontend"},"gateway":{"ref":"openmrs/openmrs-reference-application-3-gateway:qa@sha256:previous","id":"sha256:oldgateway"}}
EOF
  cp "${EMR_WEBMCP_ROOT}/deploy/crimson-prime/compose.yml" "${previous}/compose.yml"
  printf '20260831T010000Z\n' >"${EMR_WEBMCP_BACKUP_DIR}/PREVIOUS"
  run "${SCRIPTS_DIR}/rollback.sh"
  [ "${status}" -eq 0 ]
  [ ! -f "${EMR_WEBMCP_STUB_DIR}/restore.called" ]
  grep -E '(^| )up( |$)' "${EMR_WEBMCP_STUB_LOG}"
  grep -E '(^| )tag sha256:previous-frontend emr-webmcp/openmrs-frontend:local( |$)' "${EMR_WEBMCP_STUB_LOG}"
  ! grep -E 'tag .*@sha256' "${EMR_WEBMCP_STUB_LOG}"
  _assert_redacted "${output}"
}

@test "rollback skips digest-pinned refs and retags only the local frontend" {
  local previous="${EMR_WEBMCP_BACKUP_DIR}/20260831T020000Z"
  mkdir -p "${previous}"
  cat >"${previous}/image-manifest.json" <<'EOF'
{"db":{"ref":"mariadb:10.11.7@sha256:deadbeefdb","id":"sha256:olddb"},"backend":{"ref":"openmrs/openmrs-reference-application-3-backend:qa@sha256:deadbeefbe","id":"sha256:oldbackend"},"frontend":{"ref":"emr-webmcp/openmrs-frontend:local","id":"sha256:previous-frontend"},"gateway":{"ref":"openmrs/openmrs-reference-application-3-gateway:qa@sha256:deadbeefgw","id":"sha256:oldgateway"}}
EOF
  cp "${EMR_WEBMCP_ROOT}/deploy/crimson-prime/compose.yml" "${previous}/compose.yml"
  printf '20260831T020000Z\n' >"${EMR_WEBMCP_BACKUP_DIR}/PREVIOUS"
  run "${SCRIPTS_DIR}/rollback.sh"
  [ "${status}" -eq 0 ]
  grep -E '(^| )up( |$)' "${EMR_WEBMCP_STUB_LOG}"
  grep -E '(^| )tag sha256:previous-frontend emr-webmcp/openmrs-frontend:local( |$)' "${EMR_WEBMCP_STUB_LOG}"
  ! grep -E 'tag .*@sha256' "${EMR_WEBMCP_STUB_LOG}"
  _assert_redacted "${output}"
}

@test "rollback dry-run resolves a target and prints allowlisted JSON only" {
  local previous="${EMR_WEBMCP_BACKUP_DIR}/20260831T010000Z"
  mkdir -p "${previous}"
  printf '{}\n' >"${previous}/image-manifest.json"
  cp "${EMR_WEBMCP_ROOT}/deploy/crimson-prime/compose.yml" "${previous}/compose.yml"
  printf '20260831T010000Z\n' >"${EMR_WEBMCP_BACKUP_DIR}/PREVIOUS"
  run "${SCRIPTS_DIR}/rollback.sh" --dry-run
  [ "${status}" -eq 0 ]
  python3 - "${output}" <<'PY'
import json, re, sys
raw = sys.argv[1]
data = json.loads(raw)
allowed = {"status", "count", "httpClass", "toolName", "moduleName", "duration"}
if isinstance(data, dict):
    records = [data]
elif isinstance(data, list):
    records = data
else:
    raise SystemExit("output must be a JSON object or array")
for rec in records:
    extra = set(rec) - allowed
    if extra:
        raise SystemExit(f"extra keys: {extra}")
    if rec.get("status") not in {"dry-run", "pass"}:
        raise SystemExit("unexpected status")
PY
  [ ! -f "${EMR_WEBMCP_STUB_DIR}/restore.called" ]
  _assert_redacted "${output}"
}

@test "verify-live prints allowlisted JSON and redacts secrets cookies and credential URLs" {
  run "${SCRIPTS_DIR}/verify-live.sh"
  [ "${status}" -eq 0 ]
  _assert_redacted "${output}"
  python3 - "${output}" <<'PY'
import json, re, sys
raw = sys.argv[1]
data = json.loads(raw)
allowed = {"status", "count", "httpClass", "toolName", "moduleName", "duration"}
if not isinstance(data, list):
    raise SystemExit("verify-live must print a JSON array")
needles = {
    "https": False,
    "login_page": False,
    "synthetic_login": False,
    "fhir_capability": False,
    "import_map": False,
    "webmcp_discovery": False,
    "stage_followup_task": False,
    "confirm_followup": False,
    "duplicate_conflict": False,
    "logout": False,
}
for rec in data:
    extra = set(rec) - allowed
    if extra:
        raise SystemExit(f"extra keys: {extra}")
    for key, value in rec.items():
        if key in {"status", "httpClass", "toolName", "moduleName"} and not isinstance(value, str):
            raise SystemExit(f"{key} must be a string")
        if key in {"count", "duration"} and not isinstance(value, (int, float)):
            raise SystemExit(f"{key} must be numeric")
        if key == "httpClass" and not re.fullmatch(r"[1-5]xx", value):
            raise SystemExit("httpClass must be an HTTP class")
        if key == "status" and not re.fullmatch(r"[a-z][a-z0-9-]{0,40}", value):
            raise SystemExit("status is not allowlisted")
        if key == "toolName" and not re.fullmatch(r"[a-z][a-z0-9_]{0,80}", value):
            raise SystemExit("toolName is not allowlisted")
    name = rec.get("toolName", "")
    if name in needles:
        needles[name] = True
        if rec.get("status") != "pass":
            raise SystemExit(f"{name} did not pass")
        if name == "webmcp_discovery":
            if rec.get("count") == 12:
                raise SystemExit("discovery count must be probed, not hardcoded 12")
            if not isinstance(rec.get("count"), int) or rec["count"] < 1:
                raise SystemExit("discovery count must be a positive probed value")
missing = [name for name, seen in needles.items() if not seen]
if missing:
    raise SystemExit(f"missing checks: {missing}")
PY
}

@test "scripts clean runtime files and never leave cookies or dumps behind" {
  run "${SCRIPTS_DIR}/verify-live.sh"
  [ "${status}" -eq 0 ]
  if [[ -d "${EMR_WEBMCP_RUNTIME_DIR}" ]]; then
    ! find "${EMR_WEBMCP_RUNTIME_DIR}" -type f | grep -q .
  fi
  if [[ -n "$(find "${TEST_HOME}" -type f \( -name '*cookie*' -o -name '*jar' -o -name '*.sql' \) -print)" ]]; then
    return 1
  fi
}

@test "deploy pulls published images only and skips the local frontend" {
  export STUB_HEALTH="healthy"
  export STUB_MYSQLDUMP_EXIT="0"
  run "${SCRIPTS_DIR}/deploy.sh"
  [ "${status}" -eq 0 ]
  grep -E 'pull --ignore-buildable( db backend gateway)?|pull db backend gateway' "${EMR_WEBMCP_STUB_LOG}"
  ! grep -E '[[:space:]]pull[[:space:]]*$' "${EMR_WEBMCP_STUB_LOG}"
  ! grep -E 'pull.*frontend' "${EMR_WEBMCP_STUB_LOG}"
  _assert_redacted "${output}"
}

@test "backup fails when the database dump is absent and does not skip" {
  export STUB_MYSQLDUMP_EXIT="1"
  run "${SCRIPTS_DIR}/backup.sh"
  [ "${status}" -ne 0 ]
  ! find "${EMR_WEBMCP_BACKUP_DIR}" -name 'db-dump.skipped' | grep -q .
  ! find "${EMR_WEBMCP_BACKUP_DIR}" -name 'mariadb.sql' | grep -q .
  _assert_redacted "${output}"
}

@test "verify-live confirm is idempotent when the first POST already conflicts" {
  printf '1' >"${EMR_WEBMCP_STUB_DIR}/careplan.posts"
  run "${SCRIPTS_DIR}/verify-live.sh"
  [ "${status}" -eq 0 ]
  python3 - "${output}" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
by_name = {rec.get("toolName"): rec for rec in data}
if by_name["confirm_followup"]["status"] != "pass":
    raise SystemExit("confirm_followup must pass on rerun 409")
if by_name["duplicate_conflict"]["status"] != "pass":
    raise SystemExit("duplicate_conflict must pass on rerun 409")
if by_name["duplicate_conflict"]["httpClass"] != "4xx":
    raise SystemExit("duplicate_conflict must record 4xx")
PY
  _assert_redacted "${output}"
}

@test "backup writes a timestamped manifest under the override directory not the git worktree" {
  export STUB_MYSQLDUMP_EXIT="0"
  run "${SCRIPTS_DIR}/backup.sh"
  [ "${status}" -eq 0 ]
  [[ "${output}" != *"${EMR_WEBMCP_ROOT}/"* ]] || [[ "${output}" != *backup* ]]
  found="$(find "${EMR_WEBMCP_BACKUP_DIR}" -name 'image-manifest.json' -o -name 'compose.yml')"
  [[ -n "${found}" ]]
  ! find "${EMR_WEBMCP_ROOT}/deploy/crimson-prime" -path '*backups*' -name 'image-manifest.json' | grep -q .
  _assert_redacted "${output}"
}
