import type { AppointmentSummary, PatientRef } from '@emr-webmcp/core';

import type { RestAppointment } from '../transport/rest-types.js';
import { mapPatient, restPatient } from './patient.js';

export function mapAppointment(raw: RestAppointment): AppointmentSummary | undefined {
  const id = raw.uuid;
  const start = toIsoDate(raw.startDateTime);
  const patient = mapAppointmentPatient(raw);
  if (id === undefined || id === '' || start === undefined || patient === undefined) {
    return undefined;
  }

  const summary: AppointmentSummary = {
    id,
    patient,
    start,
    status: mapAppointmentStatus(raw.status),
  };
  const service = raw.service?.name;
  if (service !== undefined && service !== '') {
    summary.service = service;
  }
  return summary;
}

function mapAppointmentPatient(raw: RestAppointment): PatientRef | undefined {
  const patient = raw.patient;
  if (patient === undefined) {
    return undefined;
  }
  return mapPatient(restPatient(patient.uuid, patient.name ?? patient.display ?? patient.identifier));
}

function mapAppointmentStatus(status: string | undefined): AppointmentSummary['status'] {
  const key = (status ?? '').trim().toLowerCase().replace(/[_\s]/g, '-');
  switch (key) {
    case 'scheduled':
      return 'scheduled';
    case 'checkedin':
    case 'checked-in':
    case 'waiting':
      return 'checked-in';
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function toIsoDate(value: string | number | undefined): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
