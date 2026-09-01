import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const k6Dir = join(dirname(fileURLToPath(import.meta.url)), '../../tests/load/k6');

type K6Common = {
  OPENMRS_PATHS: {
    patients: string;
    appointments: string;
    observations: string;
    carePlans: string;
  };
  mixedClinicReads: (base: string) => string[];
  readToolReads: (base: string) => string[];
  resolveVus: (defaultVus?: number) => number;
  k6EvaluationRecords: (
    data: unknown,
    options?: { stress?: boolean },
  ) => Array<{ status?: string; scenarioId?: string }>;
};

async function loadCommon(): Promise<K6Common> {
  return import(new URL('../../tests/load/k6/common.js', import.meta.url).href) as Promise<K6Common>;
}

function metricData(options: {
  failedRate?: number;
  p95?: number;
  count?: number;
  thresholds?: Record<string, Record<string, { ok: boolean }>>;
}) {
  return {
    metrics: {
      http_req_failed: {
        values: { rate: options.failedRate ?? 0 },
        thresholds: options.thresholds?.http_req_failed,
      },
      http_req_duration: {
        values: { 'p(95)': options.p95 ?? 400 },
        thresholds: options.thresholds?.http_req_duration,
      },
      http_reqs: {
        values: { count: options.count ?? 10 },
      },
    },
  };
}

describe('k6 adapter paths', () => {
  beforeEach(() => {
    (globalThis as { __ENV?: Record<string, string> }).__ENV = { VUS: '1' };
  });

  afterEach(() => {
    delete (globalThis as { __ENV?: Record<string, string> }).__ENV;
  });

  it('centralizes the OpenMRS adapter paths used by the product', async () => {
    const { OPENMRS_PATHS, mixedClinicReads, readToolReads } = await loadCommon();
    expect(OPENMRS_PATHS).toEqual({
      patients: '/ws/rest/v1/patient',
      appointments: '/ws/rest/v1/appointments',
      observations: '/ws/fhir2/R4/Observation',
      carePlans: '/ws/rest/v1/tasks/careplan',
    });

    const mixed = mixedClinicReads('http://127.0.0.1:8080');
    const reads = readToolReads('http://127.0.0.1:8080');
    const all = [...mixed, ...reads];
    expect(all.some((url) => url.includes('appointmentscheduling'))).toBe(false);
    expect(all.some((url) => /\/ws\/rest\/v1\/task(?:\?|$)/.test(url))).toBe(false);
    expect(all.some((url) => url.includes('/fhir2/R4/Appointment'))).toBe(false);
    expect(mixed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/ws/rest/v1/patient'),
        expect.stringContaining('/ws/rest/v1/appointments'),
        expect.stringContaining('/ws/fhir2/R4/Observation'),
        expect.stringContaining('/ws/rest/v1/tasks/careplan'),
      ]),
    );
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/ws/rest/v1/patient'),
        expect.stringContaining('/ws/rest/v1/appointments'),
        expect.stringContaining('/ws/fhir2/R4/Observation'),
      ]),
    );
    expect(mixed.some((url) => url.includes('patient='))).toBe(true);
  });

  it('overrides the live appointments path without changing the product table', async () => {
    (globalThis as { __ENV?: Record<string, string> }).__ENV = {
      VUS: '1',
      OPENMRS_APPOINTMENTS_PATH: '/ws/rest/v1/appointment',
    };
    const { OPENMRS_PATHS, mixedClinicReads } = await loadCommon();
    expect(OPENMRS_PATHS.appointments).toBe('/ws/rest/v1/appointments');
    const mixed = mixedClinicReads('http://127.0.0.1:8080');
    expect(mixed.some((url) => url.includes('/ws/rest/v1/appointment?'))).toBe(true);
    expect(mixed.some((url) => url.includes('/ws/rest/v1/appointments?'))).toBe(false);
  });

  it('keeps script checks at HTTP 200 and uses the shared path table', () => {
    const mixed = readFileSync(join(k6Dir, 'mixed-clinic.js'), 'utf8');
    const reads = readFileSync(join(k6Dir, 'read-tools.js'), 'utf8');
    const stress = readFileSync(join(k6Dir, 'stress.js'), 'utf8');
    expect(mixed).toContain('mixedClinicReads');
    expect(reads).toContain('readToolReads');
    expect(mixed).toContain('res.status === 200');
    expect(reads).toContain('res.status === 200');
    expect(mixed).not.toContain('appointmentscheduling');
    expect(mixed).not.toContain('/ws/rest/v1/task?');
    expect(reads).not.toContain('/fhir2/R4/Appointment');
    expect(stress).toContain('resolveVus(100)');
    expect(stress).toContain('stress: true');
  });
});

describe('k6 evaluation records', () => {
  afterEach(() => {
    delete (globalThis as { __ENV?: Record<string, string> }).__ENV;
  });

  it('records success only when declared thresholds passed', async () => {
    (globalThis as { __ENV?: Record<string, string> }).__ENV = { VUS: '50' };
    const { k6EvaluationRecords } = await loadCommon();
    const passed = k6EvaluationRecords(
      metricData({
        thresholds: {
          http_req_failed: { 'rate<0.01': { ok: true } },
          http_req_duration: { 'p(95)<1500': { ok: true } },
        },
      }),
    );
    expect(passed[0]?.status).toBe('success');

    const failed = k6EvaluationRecords(
      metricData({
        failedRate: 0.05,
        thresholds: {
          http_req_failed: { 'rate<0.01': { ok: false } },
        },
      }),
    );
    expect(failed[0]?.status).toBe('failed');
  });

  it('labels stress-only from the script even when VUS is unset', async () => {
    (globalThis as { __ENV?: Record<string, string> }).__ENV = {};
    const { k6EvaluationRecords, resolveVus } = await loadCommon();
    expect(resolveVus()).toBe(1);
    expect(resolveVus(100)).toBe(100);
    const records = k6EvaluationRecords(metricData({}), { stress: true });
    expect(records[0]?.status).toBe('stress-only');
    expect(records[0]?.scenarioId).toBe('stress-mixed-clinic');
  });
});
