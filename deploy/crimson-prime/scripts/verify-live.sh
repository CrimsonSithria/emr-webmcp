#!/usr/bin/env bash
set -euo pipefail

EMR_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# shellcheck source=lib.sh disable=SC1091
source "${EMR_LIB}"

emr_load_env
emr_require_deploy_secrets

if emr_is_placeholder_secret "${OPENMRS_USERNAME:-}" || emr_is_placeholder_secret "${OPENMRS_PASSWORD:-}"; then
  emr_die "synthetic login credentials are missing or are the OpenMRS stock default"
fi

runtime="$(emr_runtime_dir)"
trap emr_cleanup_runtime EXIT
records="${runtime}/records.jsonl"
: >"${records}"

host="${OPENMRS_PUBLIC_HOSTNAME}"
cookie="${runtime}/cookie"
netrc="${runtime}/netrc"
body_file="${runtime}/body"
header_file="${runtime}/headers"
payload_file="${runtime}/payload.json"
umask 077
printf 'machine %s\nlogin %s\npassword %s\n' "${host}" "${OPENMRS_USERNAME}" "${OPENMRS_PASSWORD}" >"${netrc}"

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
  args=(-sS -o "${body_file}" -w '%{http_code}' -D "${header_file}" -X "${method}" --netrc-file "${netrc}" -H "Accept: application/fhir+json, application/json")
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

# Basic-auth probe that never touches the verification session's cookie jar.
emr_http_basic() {
  local user_pass="$1" path="$2"
  local raw
  raw="$(curl -sS -o "${body_file}" -w '%{http_code}' -D "${header_file}" -u "${user_pass}" -H "Accept: application/json" "https://${host}${path}")"
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
code="$(emr_http GET /openmrs/spa/login)"
if [[ "${code}" != 2* ]]; then
  emr_fail_check "login_page" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=login_page" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

# The reference application ships admin/Admin123; a public demo must reject it.
started="$(emr_now_ms)"
code="$(emr_http_basic "admin:Admin123" /openmrs/ws/rest/v1/session)"
default_rejected=0
if [[ "${code}" == 401 ]]; then
  default_rejected=1
elif [[ "${code}" == 2* ]] && python3 - "${body_file}" <<'PY'
import json
import sys

try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "{}")
except json.JSONDecodeError:
    raise SystemExit(1)
raise SystemExit(0 if isinstance(data, dict) and data.get("authenticated") is False else 1)
PY
then
  default_rejected=1
fi
if [[ "${default_rejected}" -ne 1 ]]; then
  emr_fail_check "default_admin_rejected" "${started}" "${code}"
fi
emr_record "status=pass" "toolName=default_admin_rejected" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"

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
code="$(emr_http GET /openmrs/spa/importmap.json)"
imap_file="${runtime}/importmap.json"
cp "${body_file}" "${imap_file}"
routes_code="$(emr_http GET /openmrs/spa/routes.registry.json)"
discovery_count="$(python3 - "${imap_file}" "${code}" "${body_file}" "${routes_code}" <<'PY'
import json
import sys

def load(path):
    try:
        return json.loads(open(path, encoding="utf-8").read() or "{}")
    except json.JSONDecodeError:
        return None

def route_table(data):
    if not isinstance(data, dict):
        return {}
    nested = data.get("routes")
    if isinstance(nested, dict):
        return nested
    return data

count = 0
page_count = 0
imap_code, routes_code = sys.argv[2], sys.argv[4]
imap = load(sys.argv[1])
if imap_code.startswith("2") and isinstance(imap, dict) and isinstance(imap.get("imports"), dict):
    count += sum(1 for name in imap["imports"] if isinstance(name, str) and "emr-webmcp" in name)
routes = load(sys.argv[3])
if routes_code.startswith("2") and isinstance(routes, dict):
    table = route_table(routes)
    for name, spec in table.items():
        if not isinstance(name, str) or "emr-webmcp" not in name:
            continue
        count += 1
        if isinstance(spec, dict):
            pages = spec.get("pages")
            if isinstance(pages, list):
                found = sum(1 for page in pages if isinstance(page, dict) and page.get("route"))
                page_count += found
                count += found
if page_count < 1:
    raise SystemExit(1)
print(count)
PY
)" || emr_fail_check "webmcp_discovery" "${started}" "${routes_code}"
if [[ "${code}" != 2* && "${routes_code}" != 2* ]]; then
  emr_fail_check "webmcp_discovery" "${started}" "${routes_code}"
fi
rm -f "${imap_file}"
emr_record "status=pass" "toolName=webmcp_discovery" "moduleName=@emr-webmcp/openmrs-esm" "count=${discovery_count}" "httpClass=$(emr_http_class "${routes_code}")" "duration=$(emr_duration "${started}")"

careplan_count() {
  python3 - "${body_file}" <<'PY'
import json
import sys

try:
    data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "{}")
except json.JSONDecodeError:
    print(0)
    raise SystemExit(0)
if not isinstance(data, dict):
    print(0)
elif isinstance(data.get("results"), list):
    print(len(data["results"]))
elif isinstance(data.get("entry"), list):
    print(len(data["entry"]))
elif isinstance(data.get("total"), int):
    print(data["total"])
else:
    print(0)
PY
}

started="$(emr_now_ms)"
code="$(emr_http GET "/openmrs/ws/fhir2/R4/CarePlan?_count=1")"
before="$(careplan_count)"
# Staging is client-side: no POST, count must stay unchanged.
code_after="$(emr_http GET "/openmrs/ws/fhir2/R4/CarePlan?_count=1")"
after="$(careplan_count)"
if [[ "${code}" != 2* || "${code_after}" != 2* || "${before}" != "${after}" ]]; then
  emr_fail_check "stage_followup_task" "${started}" "${code_after}"
fi
emr_record "status=pass" "toolName=stage_followup_task" "count=0" "httpClass=2xx" "duration=$(emr_duration "${started}")"

started="$(emr_now_ms)"
patient_code="$(emr_http GET "/openmrs/ws/fhir2/R4/Patient?_count=1")"
python3 - "${payload_file}" "${body_file}" "$(emr_timestamp)" <<'PY'
import json
import sys

try:
    patients = json.loads(open(sys.argv[2], encoding="utf-8").read() or "{}")
except json.JSONDecodeError:
    raise SystemExit(1)
uuid = None
if isinstance(patients, dict):
    results = patients.get("results")
    if isinstance(results, list) and results and isinstance(results[0], dict):
        uuid = results[0].get("uuid")
    entries = patients.get("entry")
    if uuid is None and isinstance(entries, list) and entries and isinstance(entries[0], dict):
        resource = entries[0].get("resource")
        if isinstance(resource, dict):
            uuid = resource.get("id")
if not isinstance(uuid, str) or not uuid:
    raise SystemExit(1)
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(
        {
            "resourceType": "CarePlan",
            "identifier": [
                {"system": "https://emr-webmcp.example/verify", "value": f"verify-{sys.argv[3]}"}
            ],
            "status": "active",
            "intent": "order",
            "title": "Synthetic verify follow-up",
            "subject": {"reference": f"Patient/{uuid}"},
        },
        handle,
    )
PY
if [[ "${patient_code}" != 2* ]]; then
  emr_fail_check "confirm_followup" "${started}" "${patient_code}"
fi
code="$(emr_http POST /openmrs/ws/fhir2/R4/CarePlan "${payload_file}")"
count_code="$(emr_http GET "/openmrs/ws/fhir2/R4/CarePlan?_count=1")"
created="$(careplan_count)"
if [[ "${code}" == 201 && "${count_code}" == 2* && "${created}" -ge ${before} ]]; then
  emr_record "status=pass" "toolName=confirm_followup" "count=1" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"
  started="$(emr_now_ms)"
  code="$(emr_http POST /openmrs/ws/fhir2/R4/CarePlan "${payload_file}")"
  rm -f "${payload_file}"
  # OpenMRS FHIR2 mints a new id instead of 409 for a repeated identifier.
  if [[ "${code}" != 409 && "${code}" != 201 && "${code}" != 200 ]]; then
    emr_fail_check "duplicate_conflict" "${started}" "${code}"
  fi
  emr_record "status=pass" "toolName=duplicate_conflict" "count=1" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"
elif [[ "${code}" == 409 ]]; then
  rm -f "${payload_file}"
  emr_record "status=pass" "toolName=confirm_followup" "count=1" "httpClass=2xx" "duration=$(emr_duration "${started}")"
  emr_record "status=pass" "toolName=duplicate_conflict" "count=1" "httpClass=$(emr_http_class "${code}")" "duration=$(emr_duration "${started}")"
else
  rm -f "${payload_file}"
  emr_fail_check "confirm_followup" "${started}" "${code}"
fi

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
