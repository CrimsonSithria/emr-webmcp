import type { PatientRef } from '@emr-webmcp/core';

import type { RestPatient } from '../transport/rest-types.js';

export function restPatient(uuid: string | undefined, display?: string): RestPatient {
  const raw: RestPatient = {};
  if (uuid !== undefined) {
    raw.uuid = uuid;
  }
  if (display !== undefined) {
    raw.display = display;
  }
  return raw;
}

export function mapPatient(raw: RestPatient): PatientRef | undefined {
  const id = raw.uuid;
  if (id === undefined || id === '') {
    return undefined;
  }

  const display = raw.person?.display ?? raw.display ?? id;
  return { id, display };
}

export function mapCodeableItem(
  id: string | undefined,
  display: string | undefined,
): { id: string; display: string } | undefined {
  if (id === undefined || id === '') {
    return undefined;
  }
  return { id, display: display === undefined || display === '' ? id : display };
}
