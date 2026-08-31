import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import { boundedReadParams, durationFor, resolveBaseUrl, resolveProfile } from './common.js';

export { handleSummary } from './common.js';

const invariantFailures = new Counter('invariant_failures');

export const options = {
  vus: Number(__ENV.VUS || 100),
  duration: durationFor(resolveProfile()),
  thresholds: {},
};

export default function stressClinic() {
  const base = resolveBaseUrl();
  const params = boundedReadParams();
  const response = http.get(`${base}/openmrs/ws/fhir2/R4/Patient?_count=20`, params);
  check(response, {
    'stress read finished': (res) => res.status !== 0,
  });
  if (response.status >= 500) {
    invariantFailures.add(1);
  }
  sleep(0.5);
}
