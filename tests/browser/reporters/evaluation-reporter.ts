import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { SCENARIOS } from '../scenarios/manifest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const RAW_PATH = path.join(repoRoot, 'artifacts/evaluation/raw/scenarios.json');

type ScenarioRecord = {
  scenarioId: string;
  runId: string;
  status: string;
  count: number;
  duration: number;
  adapterId: 'openmrs';
};

export default class EvaluationReporter implements Reporter {
  private readonly records: ScenarioRecord[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const scenario = SCENARIOS.find((entry) => test.title.includes(entry.id));
    if (scenario === undefined) {
      return;
    }
    this.records.push({
      scenarioId: scenario.id,
      runId: process.env.EVALUATION_RUN_ID ?? 'emr-webmcp-browser-local',
      status: result.status === 'passed' ? scenario.expected : 'failed',
      count: 1,
      duration: result.duration,
      adapterId: 'openmrs',
    });
  }

  onEnd(): void {
    if (this.records.length === 0) {
      return;
    }
    mkdirSync(path.dirname(RAW_PATH), { recursive: true });
    writeFileSync(RAW_PATH, `${JSON.stringify(this.records, null, 2)}\n`);
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        path.join(repoRoot, 'simulation/scripts/register-ts-resolve.mjs'),
        path.join(repoRoot, 'simulation/src/report/write-report.ts'),
      ],
      { cwd: repoRoot, stdio: 'inherit' },
    );
    if (result.status !== 0) {
      throw new Error('evaluation report writer failed');
    }
  }
}
