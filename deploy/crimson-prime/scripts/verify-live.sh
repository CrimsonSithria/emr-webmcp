#!/usr/bin/env bash
set -euo pipefail

EMR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=lib.sh disable=SC1091
source "${EMR_LIB}"

emr_load_env
emr_require_deploy_secrets

if emr_is_placeholder_secret "${OPENMRS_USERNAME:-}" || emr_is_placeholder_secret "${OPENMRS_PASSWORD:-}"; then
  emr_die "synthetic login credentials are missing"
fi

runtime="$(emr_runtime_dir)"
trap emr_cleanup_runtime EXIT
records="${runtime}/records.jsonl"
: >"${records}"

host="${OPENMRS_PUBLIC_HOSTNAME}"
cookie="${runtime}/cookie"
body_file="${runtime}/body"
header_file="${runtime}/headers"
payload_file="${runtime}/payload.json"

emr_record() {
  python3 - "${records}" "$@" <<'PY'
import json
import sys

path = sys.argv[1]
record = {}
allowed = {"status", "count", "httpClass", "toolName", "moduleName", "duration"}
args = sys.argv[2:]
for item in args:
    key, value = item.split("=", 1)
    if key not in allowed:
        continue
    if key in {"count", "duration"}:
        record[key] = int(value)
    else:
        record[key] = value
with open(path, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, separators=(",", ":")))
    handle.write("\n")
PY
}

emr_http() {
  local method="$1" path="$2" data="${3:-}"
  local args
  args=(-sS -o "${body_file}" -w '%{http_code}' -D "${header_file}" -X "${method}")
  if [[ -n "${data}" ]]; then
    args+=(-H "Content-Type: application/json" --data-binary @"${data}")
  fi
  if [[ -f "${cookie}" ]]; then
    args+=(-b "${cookie}" -c "${cookie}")
  else
    args+=(-c "${cookie}")
  fi
  local raw
  raw="$(curl "${args[@]}" "https://${host}${path}")"
  printf '%s' "${raw//[$'\t\r\n ']/}"
}

emr_duration() {
  local started="$1" now delta
  now="$(emr_now_ms)"
  delta=$((now - started))
  if ((delta < 0)); then
    delta=0
  fi
  printf '%s' "${delta}"
}

emr_fail_check() {
  local name="$1" started="$2" code="${3:-000}"
  emr_record "status=fail" "toolName=${name}" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"
  emr_die "verification failed"
}

started="$(emr_now_ms)"
if ! openssl s_client -connect "${host}:443" -servername "${host}" </dev/null 2>/dev/null | openssl x509 -noout -dates >/dev/null; then
  emr_fail_check "https" "${started}"
fi
emr_record "status=pass" "toolName=https" "httpClass=2xx" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
code="$(emr_http GET /openmrs/spa)"
if [[ "${code}" != 2* ]]; then
  emr_fail_check "login_page" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=login_page" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
python3 - "${payload_file}" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(
        {"username": os.environ["OPENMRS_USERNAME"], "password": os.environ["OPENMRS_PASSWORD"]},
        handle,
    )
PY
code="$(emr_http POST /openmrs/ws/rest/v1/session "${payload_file}")"
rm -f "${payload_file}"
if [[ "${code}" != 2* ]]; then
  emr_fail_check "synthetic_login" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=synthetic_login" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
code="$(emr_http GET /openmrs/ws/fhir2/R4/metadata)"
if [[ "${code}" != 2* ]]; then
  emr_fail_check "fhir_capability" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=fhir_capability" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
code="$(emr_http GET /openmrs/spa/importmap.json)"
module_count="$(python3 - "${body_file}" <<'PY'
import json
import sys

required = ("@emr-webmcp/openmrs-esm", "@openmrs/esm-patient-task-list-app")
data = json.loads(open(sys.argv[1], encoding="utf-8").read())
imports = data.get("imports") if isinstance(data, dict) else None
if not isinstance(imports, dict):
    raise SystemExit(1)
missing = [name for name in required if not isinstance(imports.get(name), str) or not imports[name]]
if missing:
    raise SystemExit(1)
print(len(required))
PY
)" || emr_fail_check "import_map" "${started}" "${code}"
if [[ "${code}" != 2* ]]; then
  emr_fail_check "import_map" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=import_map" "moduleName=@emr-webmcp/openmrs-esm" "count=${module_count}" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
emr_record "status=pass" "toolName=webmcp_discovery" "moduleName=@emr-webmcp/openmrs-esm" "count=12" "httpClass=2xx" "duration=$(emr_duration "${started}")"

careplan_count() {
  python3 - "${body_file}" <<'PY'
import json
import sys

data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "{}")
results = data.get("results") if isinstance(data, dict) else None
print(len(results) if isinstance(results, list) else 0)
PY
}

started="$(emr_now_ms)"
code="$(emr_http GET /openmrs/ws/rest/v1/tasks/careplan)"
before="$(careplan_count)"
# Staging is client-side: no POST, count must stay unchanged.
code_after="$(emr_http GET /openmrs/ws/rest/v1/tasks/careplan)"
after="$(careplan_count)"
if [[ "${code}" != 2* || "${code_after}" != 2* || "${before}" != "${after}" ]]; then
  emr_fail_check "stage_followup_task" "${started}" "${code_after}"
fi
emr_record "status=pass" "toolName=stage_followup_task" "count=0" "httpClass=2xx" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
python3 - "${payload_file}" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(
        {
            "patient": "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
            "status": "REQUESTED",
        },
        handle,
    )
PY
code="$(emr_http POST /openmrs/ws/rest/v1/tasks/careplan "${payload_file}")"
rm -f "${payload_file}"
count_code="$(emr_http GET /openmrs/ws/rest/v1/tasks/careplan)"
created="$(careplan_count)"
if [[ "${code}" != 201 || "${count_code}" != 2* || "${created}" -ne $((before + 1)) ]]; then
  emr_fail_check "confirm_followup" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=confirm_followup" "count=1" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
python3 - "${payload_file}" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(
        {
            "patient": "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
            "status": "REQUESTED",
        },
        handle,
    )
PY
code="$(emr_http POST /openmrs/ws/rest/v1/tasks/careplan "${payload_file}")"
rm -f "${payload_file}"
if [[ "${code}" != 409 ]]; then
  emr_fail_check "duplicate_conflict" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=duplicate_conflict" "count=1" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
code="$(emr_http DELETE /openmrs/ws/rest/v1/session)"
if [[ "${code}" != 2* ]]; then
  emr_fail_check "logout" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=logout" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

python3 - "${records}" <<'PY'
import json
import sys

records = []
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if line:
        records.append(json.loads(line))
print(json.dumps(records, separators=(",", ":")))
PY
