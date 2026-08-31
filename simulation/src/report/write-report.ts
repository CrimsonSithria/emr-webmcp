import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateEvaluation, type EvaluationSummary } from './aggregate.js';

export const EVALUATION_REPORT_DIR = 'artifacts/evaluation/latest';
export const EVALUATION_RAW_SCENARIOS = 'artifacts/evaluation/raw/scenarios.json';
export const EVALUATION_RAW_K6 = 'artifacts/evaluation/raw/k6.json';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export function collectEvaluationRecords(options?: {
  scenarioPath?: string;
  k6Path?: string;
}): unknown[] {
  return [
    ...readJsonArray(options?.scenarioPath ?? EVALUATION_RAW_SCENARIOS),
    ...readJsonArray(options?.k6Path ?? EVALUATION_RAW_K6),
  ];
}

export function writeEvaluationReport(
  records: unknown[],
  options?: { runId?: string; outputDir?: string },
): { summary: EvaluationSummary; markdown: string } {
  const runId = options?.runId ?? process.env.EVALUATION_RUN_ID ?? defaultRunId();
  const outputDir = options?.outputDir ?? EVALUATION_REPORT_DIR;
  return aggregateEvaluation(records, { runId, outputDir });
}

function defaultRunId(): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `emr-webmcp-eval-${stamp}`;
}

function readJsonArray(relativePath: string): unknown[] {
  const absolute = path.join(repoRoot, relativePath);
  if (!existsSync(absolute)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const records = collectEvaluationRecords();
  if (records.length === 0) {
    console.error('no evaluation records found; run the scenario suite first');
    process.exit(1);
  }
  const { summary } = writeEvaluationReport(records);
  console.log(`wrote ${summary.records.length} records to ${EVALUATION_REPORT_DIR}`);
}
