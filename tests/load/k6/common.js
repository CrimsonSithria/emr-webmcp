export const LOAD_PROFILES = [1, 10, 25, 50, 100];

export const GATE = {
  vus: 50,
  maxErrorRate: 0.01,
  maxBoundedReadP95Ms: 1500,
};

export const OPENMRS_PATHS = {
  patients: '/ws/rest/v1/patient',
  appointments: '/ws/rest/v1/appointments',
  observations: '/ws/fhir2/R4/Observation',
  carePlans: '/ws/rest/v1/tasks/careplan',
};

const SYNTHETIC_LOAD_PATIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const LOAD_FROM_DATE = '2026-08-31T00:00:00.000Z';
const LOAD_TO_DATE = '2026-09-30T00:00:00.000Z';

function readEnv(name, fallback) {
  const env = typeof __ENV === 'undefined' ? {} : __ENV;
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function resolveVus(defaultVus) {
  const fallback = Number.isFinite(defaultVus) && defaultVus > 0 ? Math.floor(defaultVus) : 1;
  const raw = Number(readEnv('VUS', fallback));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function resolveBaseUrl() {
  return readEnv('BASE_URL', 'http://127.0.0.1:8080');
}

export function resolveProfile() {
  return readEnv('PROFILE', 'demo');
}

export function durationFor(profile) {
  return profile === 'smoke' ? '10s' : '1m';
}

export function thresholdsFor(vus) {
  if (vus >= 100) {
    return {};
  }
  if (vus >= 50) {
    return {
      http_req_failed: ['rate<0.01'],
      'http_req_duration{kind:bounded-read}': ['p(95)<1500'],
      invariant_failures: ['count==0'],
    };
  }
  return {
    http_req_failed: ['rate<1'],
  };
}

export function authHeaders() {
  const headers = {};
  const cookie = readEnv('OPENMRS_SESSION', '');
  const authorization = readEnv('OPENMRS_AUTH', '');
  if (cookie !== '') {
    headers.Cookie = cookie;
  }
  if (authorization !== '') {
    headers.Authorization = authorization;
  }
  if (Object.keys(headers).length === 0) {
    return {};
  }
  return { headers };
}

export function boundedReadParams() {
  return {
    tags: { kind: 'bounded-read' },
    ...authHeaders(),
  };
}

export function loadOptions() {
  const vus = resolveVus();
  return {
    vus,
    duration: durationFor(resolveProfile()),
    thresholds: thresholdsFor(vus),
  };
}

export function withQuery(path, query) {
  const entries = Object.entries(query ?? {});
  if (entries.length === 0) {
    return path;
  }
  const search = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${path}?${search}`;
}

export function openmrsUrl(base, resourcePath, query) {
  const origin = String(base).replace(/\/$/u, '');
  return `${origin}/openmrs${withQuery(resourcePath, query)}`;
}

function appointmentsPath() {
  return readEnv('OPENMRS_APPOINTMENTS_PATH', OPENMRS_PATHS.appointments);
}

function loadPatientId() {
  return readEnv('OPENMRS_LOAD_PATIENT', SYNTHETIC_LOAD_PATIENT);
}

// Mirrors the adapter's real read shapes: a non-empty patient search (an empty `q`
// returns nothing on OpenMRS), one newest-first clinic-wide lab window, patient-scoped
// labs, and CarePlans filtered by `subject` (the tasks module ignores `patient`).
export function mixedClinicReads(base) {
  const patient = loadPatientId();
  return [
    openmrsUrl(base, OPENMRS_PATHS.patients, { q: 'a', limit: '20', v: 'default' }),
    openmrsUrl(base, appointmentsPath(), { fromDate: LOAD_FROM_DATE, toDate: LOAD_TO_DATE }),
    openmrsUrl(base, OPENMRS_PATHS.observations, {
      category: 'laboratory',
      _sort: '-date',
      _count: '100',
    }),
    openmrsUrl(base, OPENMRS_PATHS.observations, {
      patient,
      category: 'laboratory',
      _count: '20',
    }),
    openmrsUrl(base, OPENMRS_PATHS.carePlans, { subject: patient }),
  ];
}

export function readToolReads(base) {
  return [
    openmrsUrl(base, OPENMRS_PATHS.patients, { q: 'a', limit: '20', v: 'default' }),
    openmrsUrl(base, appointmentsPath(), { fromDate: LOAD_FROM_DATE, toDate: LOAD_TO_DATE }),
    openmrsUrl(base, OPENMRS_PATHS.observations, {
      patient: loadPatientId(),
      category: 'laboratory',
      _count: '20',
    }),
  ];
}

export function thresholdsPassed(data) {
  const metrics = data && data.metrics ? data.metrics : {};
  for (const metric of Object.values(metrics)) {
    const thresholds = metric && metric.thresholds;
    if (!thresholds) {
      continue;
    }
    for (const result of Object.values(thresholds)) {
      if (result && result.ok === false) {
        return false;
      }
    }
  }
  return true;
}

export function k6EvaluationRecords(data, options) {
  const vus = resolveVus();
  const stress = Boolean(options && options.stress) || vus >= 100;
  const failed = data.metrics && data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0;
  const p95 = data.metrics && data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'] : 0;
  const count = data.metrics && data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  return [
    {
      scenarioId: stress ? 'stress-mixed-clinic' : 'mixed-clinic-load',
      runId: `emr-webmcp-${resolveProfile()}-load`,
      status: stress ? 'stress-only' : thresholdsPassed(data) ? 'success' : 'failed',
      count,
      duration: p95,
      percentile: 95,
      httpClass: failed < 0.01 ? '2xx' : '5xx',
      toolName: 'search_patients',
      adapterId: 'openmrs',
    },
  ];
}

export function handleSummary(data) {
  return {
    'artifacts/evaluation/raw/k6.json': `${JSON.stringify(k6EvaluationRecords(data), null, 2)}\n`,
  };
}
