import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EVALUATION_ALLOWED_KEYS,
  isAllowedEvaluationDir,
  redactEvaluationRecord,
  type EvaluationRecord,
} from './redact.js';

export const LOAD_GATE = {
  vus: 50,
  maxErrorRate: 0.01,
  maxBoundedReadP95Ms: 1500,
  invariantFailures: 0,
} as const;

export type EvaluationGate = {
  vus: 50;
  maxErrorRate: 0.01;
  maxBoundedReadP95Ms: 1500;
  invariantFailures: 0;
};

export type EvaluationSummary = {
  runId: string;
  status: string;
  count: number;
  records: EvaluationRecord[];
  gate?: EvaluationGate;
};

export type AggregateOptions = {
  runId: string;
  outputDir: string;
};

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export function aggregateEvaluation(rawRecords: unknown[], options: AggregateOptions): {
  summary: EvaluationSummary;
  markdown: string;
} {
  if (!isAllowedEvaluationDir(options.outputDir)) {
    throw new Error('outputDir must be under artifacts/evaluation/');
  }

  const records = rawRecords.map((record) => redactEvaluationRecord(record));
  const runId = cleanRunId(options.runId);
  const stress = records.some((record) => record.status === 'stress-only' || record.count === 100);
  const first = records[0];
  const summary: EvaluationSummary = {
    runId,
    status: stress ? 'stress-only' : (first?.status ?? 'success'),
    count: first?.count ?? records.length,
    records,
  };
  if (!stress) {
    summary.gate = { ...LOAD_GATE };
  }

  const markdown = toMarkdownTable(records);
  const absoluteDir = path.join(repoRoot, options.outputDir);
  mkdirSync(absoluteDir, { recursive: true });
  writeFileSync(path.join(absoluteDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(absoluteDir, 'summary.md'), `${markdown}\n`);
  return { summary, markdown };
}

function cleanRunId(runId: string): string {
  const redacted = redactEvaluationRecord({ runId });
  return redacted.runId ?? 'unknown-run';
}

function toMarkdownTable(records: EvaluationRecord[]): string {
  const header = `| ${EVALUATION_ALLOWED_KEYS.join(' | ')} |`;
  const divider = `| ${EVALUATION_ALLOWED_KEYS.map(() => '---').join(' | ')} |`;
  const rows = records.map((record) => {
    const cells = EVALUATION_ALLOWED_KEYS.map((key) => {
      const value = record[key];
      return value === undefined ? '' : String(value);
    });
    return `| ${cells.join(' | ')} |`;
  });
  return [header, divider, ...rows].join('\n');
}
