import { describe, expect, it } from 'vitest';

import {
  SYNTHETIC_LAB_PANEL,
  observationEffectiveDateTime,
  observationValue,
  syntheticLabAt,
} from './lab-catalog.js';

describe('lab-catalog', () => {
  it('rotates through distinct LOINC codes instead of stamping hemoglobin only', () => {
    const codes = new Set(Array.from({ length: 24 }, (_, ordinal) => syntheticLabAt(ordinal).loinc));
    expect(codes.size).toBe(SYNTHETIC_LAB_PANEL.length);
    expect(codes.has('718-7')).toBe(true);
    expect(codes.has('2951-2')).toBe(true);
    expect(codes.has('2345-7')).toBe(true);
    expect(codes.has('2160-0')).toBe(true);
  });

  it('spreads effectiveDateTime across the clinic week', () => {
    const windowStart = Date.parse('2026-08-31T08:00:00.000Z');
    const stamps = Array.from({ length: 40 }, (_, ordinal) => observationEffectiveDateTime(ordinal, windowStart));
    const uniqueDays = new Set(stamps.map((stamp) => stamp.slice(0, 10)));
    expect(uniqueDays.size).toBeGreaterThan(3);
    expect(new Set(stamps).size).toBeGreaterThan(10);
  });

  it('maps interpretation flags to clinically directional values', () => {
    const sodium = syntheticLabAt(1);
    expect(observationValue(sodium, 'H', 1)).toBeGreaterThan(sodium.normal);
    expect(observationValue(sodium, 'L', 1)).toBeLessThan(sodium.normal);
    expect(observationValue(sodium, 'N', 1)).toBeCloseTo(sodium.normal, 0);
  });
});
