import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import { boundedReadParams, loadOptions, resolveBaseUrl } from './common.js';

const invariantFailures = new Counter('invariant_failures');

export const options = loadOptions();

export default function mixedClinic() {
  const base = resolveBaseUrl();
  const params = boundedReadParams();
  const reads = http.batch([
    ['GET', `${base}/openmrs/ws/fhir2/R4/Patient?_count=20`, null, params],
    ['GET', `${base}/openmrs/ws/rest/v1/appointmentscheduling/appointment?limit=20`, null, params],
    ['GET', `${base}/openmrs/ws/fhir2/R4/Observation?_count=20&category=laboratory`, null, params],
    ['GET', `${base}/openmrs/ws/rest/v1/task?limit=20`, null, params],
  ]);

  for (const response of reads) {
    const ok = check(response, {
      'mixed clinic read finished': (res) => res.status !== 0,
      'mixed clinic read not 5xx': (res) => res.status < 500,
      'mixed clinic read is not a write': () => true,
    });
    if (response.status >= 500 || response.request.method !== 'GET' || !ok) {
      invariantFailures.add(1);
    }
  }
  sleep(1);
}
