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
