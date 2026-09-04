import type { LabInterpretation } from './workload-plan.js';

export type SyntheticLabDefinition = {
  loinc: string;
  display: string;
  unit: string;
  normal: number;
};

/**
 * Outpatient panel restricted to LOINC codes the OpenMRS reference dictionary
 * actually accepts on FHIR POST. Potassium / CBC / lipids 422 on this instance.
 */
export const SYNTHETIC_LAB_PANEL: readonly SyntheticLabDefinition[] = [
  { loinc: '718-7', display: 'Hemoglobin', unit: 'g/dL', normal: 14.0 },
  { loinc: '2951-2', display: 'Sodium', unit: 'mmol/L', normal: 140 },
  { loinc: '2345-7', display: 'Glucose', unit: 'mg/dL', normal: 95 },
  { loinc: '2160-0', display: 'Creatinine', unit: 'mg/dL', normal: 1.0 },
] as const;

export function syntheticLabAt(ordinal: number): SyntheticLabDefinition {
  const index = ((ordinal % SYNTHETIC_LAB_PANEL.length) + SYNTHETIC_LAB_PANEL.length) % SYNTHETIC_LAB_PANEL.length;
  const lab = SYNTHETIC_LAB_PANEL[index];
  if (lab === undefined) {
    throw new Error('synthetic lab panel is empty');
  }
  return lab;
}

export function observationEffectiveDateTime(ordinal: number, windowStartMs: number): string {
  const day = ordinal % 7;
  const slot = Math.floor(ordinal / 7) % 12;
  return new Date(windowStartMs + day * 86_400_000 + slot * 2 * 60 * 60_000).toISOString();
}

export function observationValue(lab: SyntheticLabDefinition, interpretation: LabInterpretation, ordinal: number): number {
  const jitter = ((ordinal % 7) - 3) * 0.01;
  switch (interpretation) {
    case 'HH':
      return roundLabValue(lab, lab.normal * 1.55 + jitter);
    case 'H':
      return roundLabValue(lab, lab.normal * 1.22 + jitter);
    case 'LL':
      return roundLabValue(lab, lab.normal * 0.45 + jitter);
    case 'L':
      return roundLabValue(lab, lab.normal * 0.72 + jitter);
    case 'A':
      return roundLabValue(lab, lab.normal * 1.35 + jitter);
    case 'N':
    default:
      return roundLabValue(lab, lab.normal * (1 + jitter * 0.05));
  }
}

function roundLabValue(lab: SyntheticLabDefinition, value: number): number {
  if (lab.unit === 'mmol/L' || lab.unit === 'mg/dL' || lab.unit === 'g/dL') {
    return Math.round(value * 10) / 10;
  }
  return Math.round(value);
}
