import type { ResultSummary } from '@emr-webmcp/core';

import { codeableDisplay, referenceId, type FhirObservation } from '../transport/fhir-types.js';
import { mapPatient, restPatient } from './patient.js';

export function mapObservation(raw: FhirObservation): ResultSummary | undefined {
  const id = raw.id;
  const patient = mapPatient(restPatient(referenceId(raw.subject?.reference), raw.subject?.display));
  const name = codeableDisplay(raw.code);
  const observedAt = toIsoDate(raw.effectiveDateTime ?? raw.issued);
  if (id === undefined || id === '' || patient === undefined || name === undefined || observedAt === undefined) {
    return undefined;
  }

  const summary: ResultSummary = {
    id,
    patient,
    name,
    observedAt,
    interpretation: mapInterpretation(raw),
    sourceReference: `Observation/${id}`,
  };

  const value = readValue(raw);
  if (value !== undefined) {
    summary.value = value;
  }
  const unit = raw.valueQuantity?.unit;
  if (unit !== undefined && unit !== '') {
    summary.unit = unit;
  }
  const referenceRange = mapReferenceRange(raw);
  if (referenceRange !== undefined) {
    summary.referenceRange = referenceRange;
  }
  return summary;
}

export function mapInterpretation(raw: FhirObservation): ResultSummary['interpretation'] {
  for (const concept of raw.interpretation ?? []) {
    for (const coding of concept.coding ?? []) {
      const mapped = mapInterpretationCode(coding.code);
      if (mapped !== undefined) {
        return mapped;
      }
    }
  }
  return 'unknown';
}

function mapInterpretationCode(code: string | undefined): ResultSummary['interpretation'] | undefined {
  if (code === undefined) {
    return undefined;
  }
  switch (code.trim().toUpperCase()) {
    case 'LL':
      return 'critical-low';
    case 'L':
      return 'low';
    case 'N':
      return 'normal';
    case 'H':
      return 'high';
    case 'HH':
      return 'critical-high';
    default:
      return undefined;
  }
}

function mapReferenceRange(raw: FhirObservation): string | undefined {
  const range = raw.referenceRange?.[0];
  if (range === undefined) {
    return undefined;
  }
  if (typeof range.text === 'string' && range.text !== '') {
    return range.text;
  }
  const low = range.low?.value;
  const high = range.high?.value;
  if (low !== undefined && high !== undefined) {
    return `${String(low)}-${String(high)}`;
  }
  if (low !== undefined) {
    return `>=${String(low)}`;
  }
  if (high !== undefined) {
    return `<=${String(high)}`;
  }
  return undefined;
}

function readValue(raw: FhirObservation): string | undefined {
  if (raw.valueQuantity?.value !== undefined) {
    return String(raw.valueQuantity.value);
  }
  if (typeof raw.valueString === 'string' && raw.valueString !== '') {
    return raw.valueString;
  }
  return codeableDisplay(raw.valueCodeableConcept);
}

function toIsoDate(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
