export const LOAD_PROFILES = [1, 10, 25, 50, 100];

export const GATE = {
  vus: 50,
  maxErrorRate: 0.01,
  maxBoundedReadP95Ms: 1500,
};

export function resolveVus() {
  const raw = Number(__ENV.VUS || 1);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
}

export function resolveBaseUrl() {
  return __ENV.BASE_URL || 'http://127.0.0.1:8080';
}

export function resolveProfile() {
  return __ENV.PROFILE || 'demo';
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
  const cookie = __ENV.OPENMRS_SESSION || '';
  if (cookie === '') {
    return {};
  }
  return { headers: { Cookie: cookie } };
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

export function k6EvaluationRecords(data) {
  const vus = resolveVus();
  const failed = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate : 0;
  const p95 = data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'] : 0;
  const count = data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0;
  return [
    {
      scenarioId: vus >= 100 ? 'stress-mixed-clinic' : 'mixed-clinic-load',
      runId: `emr-webmcp-${resolveProfile()}-load`,
      status: vus >= 100 ? 'stress-only' : 'success',
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
