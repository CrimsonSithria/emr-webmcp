import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import { boundedReadParams, loadOptions, mixedClinicReads, resolveBaseUrl } from './common.js';

export { handleSummary } from './common.js';

const invariantFailures = new Counter('invariant_failures');

export const options = loadOptions();

export default function mixedClinic() {
  const params = boundedReadParams();
  const reads = http.batch(mixedClinicReads(resolveBaseUrl()).map((url) => ['GET', url, null, params]));

  for (const response of reads) {
    const ok = check(response, {
      'mixed clinic read is 200': (res) => res.status === 200,
      'mixed clinic read is not a write': () => response.request.method === 'GET',
    });
    if (response.status !== 200 || response.request.method !== 'GET' || !ok) {
      invariantFailures.add(1);
    }
  }
  sleep(1);
}
