import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { aggregateEvaluation } from './aggregate.js';
import {
  EVALUATION_ALLOWED_KEYS,
  EVALUATION_OUTPUT_PREFIX,
  isAllowedEvaluationDir,
  redactEvaluationRecord,
} from './redact.js';

const PHI_FIXTURE = {
  scenarioId: 'stale-draft',
  runId: 'emr-webmcp-smoke-testrun',
  status: 'blocked-stale',
  count: 1,
  duration: 142,
  percentile: 95,
  httpClass: '2xx',
  toolName: 'stage_followup_task',
  adapterId: 'openmrs',
  patientName: 'Ada Lovelace',
  name: 'Ada Lovelace',
  given: 'Ada',
  family: 'Lovelace',
  mrn: 'MRN-443921',
  analyte: 'Potassium',
  value: '6.1',
  unit: 'mmol/L',
  rationale: 'Repeat the BMP after the high potassium result.',
  cookie: 'Set-Cookie: JSESSIONID=secret-session',
  authorization: 'Bearer sk-clinic-credential',
  password: 'hunter2',
  credential: 'admin:admin',
  display: 'Ada Lovelace',
  data: {
    patient: { id: 'patient-1', display: 'Ada Lovelace', mrn: 'MRN-443921' },
    result: { name: 'Potassium', value: '6.1' },
  },
};

const FORBIDDEN_PATTERNS = [
  /Ada Lovelace/i,
  /MRN-443921/i,
  /Potassium/i,
  /6\.1/,
  /Repeat the BMP/i,
  /Set-Cookie/i,
  /JSESSIONID/i,
  /Bearer /i,
  /hunter2/i,
  /admin:admin/i,
];

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const tempDirs: string[] = [];
const evaluationDirs: string[] = [];

afterEach(async () => {
  await Promise.all([
    ...tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    ...evaluationDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  ]);
});

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function expectScrubbed(value: unknown): void {
  const text = serialized(value);
  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
  const keys = collectKeys(value);
  expect(keys).not.toEqual(
    expect.arrayContaining([
      'patientName',
      'name',
      'given',
      'family',
      'mrn',
      'analyte',
      'value',
      'unit',
      'rationale',
      'cookie',
      'authorization',
      'password',
      'credential',
      'display',
      'data',
    ]),
  );
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

describe('evaluation redaction allowlist', () => {
  it('keeps only the published metric keys', () => {
    expect([...EVALUATION_ALLOWED_KEYS]).toEqual([
      'scenarioId',
      'runId',
      'status',
      'count',
      'duration',
      'percentile',
      'httpClass',
      'toolName',
      'adapterId',
    ]);
  });

  it('strips synthetic PHI-like fields and secrets from a raw record', () => {
    const redacted = redactEvaluationRecord(PHI_FIXTURE);
    expect(redacted).toEqual({
      scenarioId: 'stale-draft',
      runId: 'emr-webmcp-smoke-testrun',
      status: 'blocked-stale',
      count: 1,
      duration: 142,
      percentile: 95,
      httpClass: '2xx',
      toolName: 'stage_followup_task',
      adapterId: 'openmrs',
    });
    expectScrubbed(redacted);
  });

  it('drops PHI values even when they are placed on allowlisted keys', () => {
    const redacted = redactEvaluationRecord({
      scenarioId: 'Ada Lovelace',
      runId: 'MRN-443921',
      status: 'Bearer leaked',
      toolName: 'Potassium',
      adapterId: 'admin:admin',
      count: 1,
    });
    expect(redacted.scenarioId).toBeUndefined();
    expect(redacted.runId).toBeUndefined();
    expect(redacted.status).toBeUndefined();
    expect(redacted.toolName).toBeUndefined();
    expect(redacted.adapterId).toBeUndefined();
    expect(redacted.count).toBe(1);
    expectScrubbed(redacted);
  });
});

describe('evaluation aggregation', () => {
  it('writes only scrubbed summary.json and a Markdown table', async () => {
    const outputDir = join(EVALUATION_OUTPUT_PREFIX, `vitest-${crypto.randomUUID()}`);
    evaluationDirs.push(join(repoRoot, outputDir));
    const result = aggregateEvaluation([PHI_FIXTURE], {
      runId: 'emr-webmcp-smoke-testrun',
      outputDir,
    });

    expectScrubbed(result.summary);
    expectScrubbed(result.markdown);
    expect(result.summary.runId).toBe('emr-webmcp-smoke-testrun');
    expect(result.summary.status).toBe('blocked-stale');
    expect(result.summary.count).toBe(1);
    expect(result.markdown).toContain('| scenarioId | runId | status | count |');
    expect(result.markdown).not.toContain('rationale');
    expect(result.markdown).not.toContain('cookie');

    const json = JSON.parse(await readFile(join(repoRoot, outputDir, 'summary.json'), 'utf8')) as unknown;
    const markdown = await readFile(join(repoRoot, outputDir, 'summary.md'), 'utf8');
    expectScrubbed(json);
    expectScrubbed(markdown);
  });

  it('refuses to write evaluation artifacts outside artifacts/evaluation/', async () => {
    const escaped = await mkdtemp(join(tmpdir(), 'emr-eval-'));
    tempDirs.push(escaped);
    expect(isAllowedEvaluationDir(escaped)).toBe(false);
    expect(isAllowedEvaluationDir('../secrets')).toBe(false);
    expect(isAllowedEvaluationDir('artifacts/simulation/smoke')).toBe(false);
    expect(() =>
      aggregateEvaluation([PHI_FIXTURE], {
        runId: 'emr-webmcp-smoke-testrun',
        outputDir: escaped,
      }),
    ).toThrow(/artifacts\/evaluation/);
  });

  it('records the 50-VU gate and marks 100 VUs as stress-only', () => {
    const gateDir = join(EVALUATION_OUTPUT_PREFIX, `gate-${crypto.randomUUID()}`);
    const stressDir = join(EVALUATION_OUTPUT_PREFIX, `stress-${crypto.randomUUID()}`);
    evaluationDirs.push(join(repoRoot, gateDir), join(repoRoot, stressDir));
    const gated = aggregateEvaluation(
      [
        {
          scenarioId: 'read-search-patients',
          runId: 'emr-webmcp-demo-load',
          status: 'success',
          count: 50,
          duration: 900,
          percentile: 95,
          httpClass: '2xx',
          toolName: 'search_patients',
          adapterId: 'openmrs',
        },
      ],
      { runId: 'emr-webmcp-demo-load', outputDir: gateDir },
    );
    expect(gated.summary.gate).toEqual({
      vus: 50,
      maxErrorRate: 0.01,
      maxBoundedReadP95Ms: 1500,
      invariantFailures: 0,
    });

    const stress = aggregateEvaluation(
      [
        {
          scenarioId: 'stress-mixed-clinic',
          runId: 'emr-webmcp-demo-stress',
          status: 'stress-only',
          count: 100,
          duration: 2100,
          percentile: 95,
          httpClass: '2xx',
          toolName: 'search_patients',
          adapterId: 'openmrs',
        },
      ],
      { runId: 'emr-webmcp-demo-stress', outputDir: stressDir },
    );
    expect(stress.summary.gate).toBeUndefined();
    expect(stress.summary.status).toBe('stress-only');
  });
});
