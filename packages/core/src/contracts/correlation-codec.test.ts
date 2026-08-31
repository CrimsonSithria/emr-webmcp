import { describe, expect, it } from 'vitest';

import { AdapterError } from './adapter-error.js';
import { decodeCorrelation, encodeCorrelation } from './correlation-codec.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const SOURCE = `Observation/${UUID}`;
const RATIONALE = 'Follow up recorded abnormal potassium result.';
const MARKER = `[emr-webmcp:v1 source=${SOURCE} workflow=lablatch]`;

describe('correlation codec', () => {
  it('encodes the exact final-line grammar after readable rationale', () => {
    expect(encodeCorrelation(RATIONALE, SOURCE)).toBe(`${RATIONALE}\n${MARKER}`);
  });

  it('round-trips rationale and source and preserves readable rationale', () => {
    const encoded = encodeCorrelation(RATIONALE, SOURCE);
    const decoded = decodeCorrelation(encoded);

    expect(encoded.endsWith(`\n${MARKER}`)).toBe(true);
    expect(encoded.startsWith(RATIONALE)).toBe(true);
    expect(decoded.rationale).toBe(RATIONALE);
    expect(decoded.sourceReference).toBe(SOURCE);
    expect(encodeCorrelation(decoded.rationale, decoded.sourceReference ?? '')).toBe(encoded);
  });

  it('treats only the final line as metadata and rejects embedded markers', () => {
    const embedded = `${MARKER}\nclinician note continues`;
    const decodedEmbedded = decodeCorrelation(embedded);
    expect(decodedEmbedded.sourceReference).toBeUndefined();
    expect(decodedEmbedded.rationale).toBe(embedded);

    const surrounding = `seen ${MARKER} inline\n${MARKER}`;
    const decodedFinal = decodeCorrelation(surrounding);
    expect(decodedFinal.sourceReference).toBe(SOURCE);
    expect(decodedFinal.rationale).toBe(`seen ${MARKER} inline`);
    expect(decodedFinal.rationale).toContain(MARKER);
  });

  it('rejects a malformed source on encode and stays strict', () => {
    expect(() => encodeCorrelation(RATIONALE, 'Patient/abc')).toThrow(AdapterError);
    expect(() => encodeCorrelation(RATIONALE, 'Observation/')).toThrow();
    expect(() => encodeCorrelation(RATIONALE, 'Observation/not a uuid')).toThrow();
    expect(() => encodeCorrelation(RATIONALE, 'obs-01')).toThrow();
    expect(() => encodeCorrelation(RATIONALE, 'Observation/foo/bar')).toThrow();
    expect(() => encodeCorrelation(RATIONALE, '')).toThrow();
  });

  it('decodes a marker-shaped invalid final line without a sourceReference', () => {
    const invalids = [
      `${RATIONALE}\n[emr-webmcp:v1 source=Patient/${UUID} workflow=lablatch]`,
      `${RATIONALE}\n[emr-webmcp:v1 source=Observation/ workflow=lablatch]`,
      `${RATIONALE}\n[emr-webmcp:v1 source=Observation/not a uuid workflow=lablatch]`,
      `${RATIONALE}\n[emr-webmcp:v1 source=Observation/abc def workflow=lablatch]`,
      `${RATIONALE}\n[emr-webmcp:v1 source=obs-01 workflow=lablatch]`,
    ];

    for (const text of invalids) {
      const decoded = decodeCorrelation(text);
      expect(decoded.sourceReference).toBeUndefined();
      expect(decoded.rationale).toBe(text);
    }
  });

  it('keeps preceding rationale opaque including clinical punctuation', () => {
    const rationale = 'Potassium 5.8 mmol/L; recheck after replacement.\nContinue current meds.';
    const encoded = encodeCorrelation(rationale, SOURCE);
    const decoded = decodeCorrelation(encoded);

    expect(encoded).toBe(`${rationale}\n${MARKER}`);
    expect(decoded.rationale).toBe(rationale);
    expect(decoded.sourceReference).toBe(SOURCE);
  });
});
