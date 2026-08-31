import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import { boundedReadParams, loadOptions, readToolReads, resolveBaseUrl } from './common.js';

export { handleSummary } from './common.js';

const invariantFailures = new Counter('invariant_failures');

export const options = loadOptions();

export default function readTools() {
  const params = boundedReadParams();
  const responses = http.batch(readToolReads(resolveBaseUrl()).map((url) => ['GET', url, null, params]));

  for (const response of responses) {
    const ok = check(response, {
      'bounded read is 200': (res) => res.status === 200,
    });
    if (response.status !== 200 || !ok) {
      invariantFailures.add(1);
    }
  }
  sleep(1);
}
