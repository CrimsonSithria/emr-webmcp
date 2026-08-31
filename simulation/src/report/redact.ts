import path from 'node:path';

export const EVALUATION_ALLOWED_KEYS = [
  'scenarioId',
  'runId',
  'status',
  'count',
  'duration',
  'percentile',
  'httpClass',
  'toolName',
  'adapterId',
] as const;

export type EvaluationAllowedKey = (typeof EVALUATION_ALLOWED_KEYS)[number];

export type EvaluationRecord = {
  scenarioId?: string;
  runId?: string;
  status?: string;
  count?: number;
  duration?: number;
  percentile?: number;
  httpClass?: string;
  toolName?: string;
  adapterId?: string;
};

export const EVALUATION_OUTPUT_PREFIX = 'artifacts/evaluation/';

const STRING_PATTERNS: { readonly [Key in EvaluationAllowedKey]?: RegExp } = {
  scenarioId: /^[a-z][a-z0-9-]{0,80}$/,
  runId: /^[a-z0-9][a-z0-9-]{0,80}$/,
  status: /^[a-z][a-z0-9-]{0,40}$/,
  httpClass: /^[1-5]xx$/,
  toolName: /^[a-z][a-z0-9_]{0,80}$/,
  adapterId: /^[a-z][a-z0-9-]{0,40}$/,
};

export function isAllowedEvaluationDir(outputDir: string): boolean {
  if (outputDir.length === 0) {
    return false;
  }
  const posix = outputDir.replaceAll('\\', '/');
  if (path.posix.isAbsolute(posix) || path.win32.isAbsolute(outputDir)) {
    return false;
  }
  const normalized = path.posix.normalize(posix);
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
    return false;
  }
  return normalized.startsWith(EVALUATION_OUTPUT_PREFIX) && normalized !== EVALUATION_OUTPUT_PREFIX;
}

export function redactEvaluationRecord(input: unknown): EvaluationRecord {
  if (input === null || typeof input !== 'object') {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const redacted: EvaluationRecord = {};
  for (const key of EVALUATION_ALLOWED_KEYS) {
    if (!Object.hasOwn(raw, key)) {
      continue;
    }
    assignIfClean(redacted, key, raw[key]);
  }
  return redacted;
}

function assignIfClean(target: EvaluationRecord, key: EvaluationAllowedKey, value: unknown): void {
  if (key === 'count' || key === 'duration' || key === 'percentile') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return;
    }
    if (key === 'percentile' && value > 100) {
      return;
    }
    if (key === 'count') {
      target.count = value;
      return;
    }
    if (key === 'duration') {
      target.duration = value;
      return;
    }
    target.percentile = value;
    return;
  }
  if (typeof value !== 'string') {
    return;
  }
  const pattern = STRING_PATTERNS[key];
  if (pattern === undefined || !pattern.test(value)) {
    return;
  }
  if (key === 'scenarioId') {
    target.scenarioId = value;
    return;
  }
  if (key === 'runId') {
    target.runId = value;
    return;
  }
  if (key === 'status') {
    target.status = value;
    return;
  }
  if (key === 'httpClass') {
    target.httpClass = value;
    return;
  }
  if (key === 'toolName') {
    target.toolName = value;
    return;
  }
  target.adapterId = value;
}
