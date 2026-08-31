import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import {
  boundedReadParams,
  durationFor,
  k6EvaluationRecords,
  OPENMRS_PATHS,
  openmrsUrl,
  resolveBaseUrl,
  resolveProfile,
  resolveVus,
} from './common.js';

const invariantFailures = new Counter('invariant_failures');

export const options = {
  vus: resolveVus(100),
  duration: durationFor(resolveProfile()),
  thresholds: {},
};

export function handleSummary(data) {
  return {
    'artifacts/evaluation/raw/k6.json': `${JSON.stringify(k6EvaluationRecords(data, { stress: true }), null, 2)}\n`,
  };
}

export default function stressClinic() {
  const params = boundedReadParams();
  const response = http.get(
    openmrsUrl(resolveBaseUrl(), OPENMRS_PATHS.patients, { q: '', limit: '20', v: 'default' }),
    params,
  );
  check(response, {
    'stress read is 200': (res) => res.status === 200,
  });
  if (response.status !== 200) {
    invariantFailures.add(1);
  }
  sleep(0.5);
}
