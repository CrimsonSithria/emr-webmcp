import { AdapterError } from './adapter-error.js';

const MARKER_LINE = /^\[emr-webmcp:v1 source=(.*) workflow=lablatch\]$/;
const VALID_SOURCE = /^Observation\/[A-Za-z0-9._-]+$/;

export type DecodedCorrelation = {
  rationale: string;
  sourceReference?: string;
};

export function encodeCorrelation(rationale: string, sourceReference: string): string {
  assertValidSource(sourceReference);
  return `${rationale.replace(/\s+$/u, '')}\n[emr-webmcp:v1 source=${sourceReference} workflow=lablatch]`;
}

export function decodeCorrelation(text: string): DecodedCorrelation {
  const lines = text.split(/\r?\n/u);
  const last = lines[lines.length - 1] ?? '';
  const match = MARKER_LINE.exec(last);
  if (match === null) {
    return { rationale: text };
  }

  const source = match[1] ?? '';
  if (!VALID_SOURCE.test(source)) {
    return { rationale: text };
  }

  const decoded: DecodedCorrelation = {
    rationale: lines.slice(0, -1).join('\n'),
    sourceReference: source,
  };
  return decoded;
}

function assertValidSource(sourceReference: string): void {
  if (!VALID_SOURCE.test(sourceReference)) {
    throw new AdapterError('invalid-input', 'Correlation source reference is invalid.', false);
  }
}
