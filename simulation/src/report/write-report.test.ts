import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { LOAD_GATE } from './aggregate.js';
import { EVALUATION_OUTPUT_PREFIX } from './redact.js';
import { collectEvaluationRecords, writeEvaluationReport } from './write-report.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const evaluationDirs: string[] = [];

afterEach(async () => {
  await Promise.all(evaluationDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('evaluation report writer', () => {
  it('collects scenario records and optional k6 records then writes one scrubbed report', async () => {
    const suffix = crypto.randomUUID();
    const scenarioPath = join(EVALUATION_OUTPUT_PREFIX, `raw-${suffix}`, 'scenarios.json');
    const k6Path = join(EVALUATION_OUTPUT_PREFIX, `raw-${suffix}`, 'k6.json');
    const outputDir = join(EVALUATION_OUTPUT_PREFIX, `report-${suffix}`);
    evaluationDirs.push(join(repoRoot, EVALUATION_OUTPUT_PREFIX, `raw-${suffix}`), join(repoRoot, outputDir));

    await mkdir(dirname(join(repoRoot, scenarioPath)), { recursive: true });
    await writeFile(
      join(repoRoot, scenarioPath),
      `${JSON.stringify([
        {
          scenarioId: 'large-clinic-bounded-read',
          runId: 'emr-webmcp-eval-testrun',
          status: 'truncated-success',
          count: 100,
          duration: 210,
          adapterId: 'openmrs',
        },
      ])}\n`,
    );
    await writeFile(
      join(repoRoot, k6Path),
      `${JSON.stringify([
        {
          scenarioId: 'mixed-clinic-load',
          runId: 'emr-webmcp-eval-testrun',
          status: 'success',
          count: 10,
          duration: 400,
          percentile: 95,
          httpClass: '2xx',
          toolName: 'search_patients',
          adapterId: 'openmrs',
        },
      ])}\n`,
    );

    const records = collectEvaluationRecords({ scenarioPath, k6Path });
    expect(records).toHaveLength(2);
    const written = writeEvaluationReport(records, {
      runId: 'emr-webmcp-eval-testrun',
      outputDir,
    });
    expect(written.summary.records).toHaveLength(2);
    expect(written.summary.gate).toEqual(LOAD_GATE);
    expect(written.summary.status).not.toBe('stress-only');
  });

  it('skips a missing k6 file and still writes the scenario report', async () => {
    const suffix = crypto.randomUUID();
    const scenarioPath = join(EVALUATION_OUTPUT_PREFIX, `raw-${suffix}`, 'scenarios.json');
    const outputDir = join(EVALUATION_OUTPUT_PREFIX, `report-${suffix}`);
    evaluationDirs.push(join(repoRoot, EVALUATION_OUTPUT_PREFIX, `raw-${suffix}`), join(repoRoot, outputDir));
    await mkdir(dirname(join(repoRoot, scenarioPath)), { recursive: true });
    await writeFile(
      join(repoRoot, scenarioPath),
      `${JSON.stringify([
        {
          scenarioId: 'read-search-patients',
          runId: 'emr-webmcp-eval-testrun',
          status: 'success',
          count: 1,
          adapterId: 'openmrs',
        },
      ])}\n`,
    );

    const records = collectEvaluationRecords({
      scenarioPath,
      k6Path: join(EVALUATION_OUTPUT_PREFIX, `raw-${suffix}`, 'k6.json'),
    });
    expect(records).toHaveLength(1);
    const written = writeEvaluationReport(records, {
      runId: 'emr-webmcp-eval-testrun',
      outputDir,
    });
    expect(written.summary.gate).toEqual(LOAD_GATE);
  });
});
