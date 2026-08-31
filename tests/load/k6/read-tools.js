import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import { boundedReadParams, loadOptions, resolveBaseUrl } from './common.js';

const invariantFailures = new Counter('invariant_failures');

export const options = loadOptions();

export default function readTools() {
  const base = resolveBaseUrl();
  const params = boundedReadParams();
  const responses = http.batch([
    ['GET', `${base}/openmrs/ws/fhir2/R4/Patient?_count=20`, null, params],
    ['GET', `${base}/openmrs/ws/fhir2/R4/Appointment?_count=20`, null, params],
    ['GET', `${base}/openmrs/ws/fhir2/R4/Observation?_count=20`, null, params],
  ]);

  for (const response of responses) {
    const ok = check(response, {
      'bounded read finished': (res) => res.status !== 0,
      'bounded read not 5xx': (res) => res.status < 500,
    });
    if (response.status >= 500 || !ok) {
      invariantFailures.add(1);
    }
  }
  sleep(1);
}
