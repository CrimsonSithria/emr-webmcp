import {
  decodeCorrelation,
  encodeCorrelation,
  type AssigneeSummary,
  type ConfirmedFollowup,
  type FollowupSummary,
  type PatientRef,
} from '@emr-webmcp/core';

import { referenceId, type FhirCarePlan, type FhirReference } from '../transport/fhir-types.js';
import type { RestProvider, RestRole } from '../transport/rest-types.js';
import { mapPatient, restPatient } from './patient.js';

export const PRIORITY_EXTENSION = 'priority';

export function mapCarePlan(raw: FhirCarePlan): FollowupSummary | undefined {
  const id = raw.id;
  const patient = mapCarePlanPatient(raw);
  const detail = raw.activity?.[0]?.detail;
  const title = raw.title ?? detail?.description;
  if (id === undefined || id === '' || patient === undefined || title === undefined || title === '') {
    return undefined;
  }

  const summary: FollowupSummary = {
    id,
    patient,
    title,
    status: mapFollowupStatus(detail?.status ?? raw.status),
    priority: mapPriority(raw),
  };

  const dueAt = toIsoDate(raw.period?.end ?? detail?.scheduledPeriod?.end ?? detail?.scheduledString);
  if (dueAt !== undefined) {
    summary.dueAt = dueAt;
  }

  const assignee = mapPerformer(detail?.performer?.[0]);
  if (assignee !== undefined) {
    summary.assignee = assignee;
  }

  const sourceReference = decodeSourceReference(
    raw.description ?? detail?.reasonCode?.[0]?.text,
  );
  if (sourceReference !== undefined) {
    summary.sourceReference = sourceReference;
  }

  return summary;
}

export function toCarePlan(input: ConfirmedFollowup): FhirCarePlan {
  const description = encodeSourceReference(input.rationale, input.sourceReference);
  const detail: NonNullable<NonNullable<FhirCarePlan['activity']>[number]['detail']> = {
    status: 'not-started',
    description: input.title,
    reasonCode: [{ text: description }],
  };
  if (input.assignee !== undefined) {
    detail.performer = [
      {
        reference: `${input.assignee.type === 'role' ? 'Role' : 'Provider'}/${input.assignee.id}`,
        display: input.assignee.display,
      },
    ];
  }

  const plan: FhirCarePlan = {
    resourceType: 'CarePlan',
    status: 'active',
    intent: 'order',
    title: input.title,
    description,
    subject: {
      reference: `Patient/${input.patient.id}`,
      display: input.patient.display,
    },
    activity: [{ detail }],
    extension: [{ url: PRIORITY_EXTENSION, valueCode: input.priority }],
  };
  if (input.dueAt !== undefined) {
    plan.period = { end: input.dueAt };
  }
  return plan;
}

export function encodeSourceReference(rationale: string, sourceReference?: string): string {
  if (sourceReference === undefined || sourceReference === '') {
    return rationale;
  }
  return encodeCorrelation(rationale, sourceReference);
}

export function decodeSourceReference(text: string | undefined): string | undefined {
  if (text === undefined || text === '') {
    return undefined;
  }
  return decodeCorrelation(text).sourceReference;
}

export function mapProvider(raw: RestProvider): AssigneeSummary | undefined {
  const id = raw.uuid;
  if (id === undefined || id === '') {
    return undefined;
  }
  return {
    id,
    display: raw.person?.display ?? raw.display ?? id,
    type: 'person',
  };
}

export function mapRole(raw: RestRole): AssigneeSummary | undefined {
  const id = raw.uuid;
  if (id === undefined || id === '') {
    return undefined;
  }
  return {
    id,
    display: raw.display ?? raw.name ?? id,
    type: 'role',
  };
}

function mapCarePlanPatient(raw: FhirCarePlan): PatientRef | undefined {
  return mapPatient(restPatient(referenceId(raw.subject?.reference), raw.subject?.display));
}

function mapFollowupStatus(status: string | undefined): FollowupSummary['status'] {
  switch ((status ?? '').trim().toLowerCase().replace(/_/gu, '-')) {
    case 'not-started':
    case 'scheduled':
    case 'draft':
    case 'requested':
      return 'not-started';
    case 'in-progress':
    case 'inprogress':
    case 'active':
    case 'accepted':
      return 'in-progress';
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'canceled':
    case 'revoked':
    case 'rejected':
    case 'stopped':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function mapPriority(raw: FhirCarePlan): FollowupSummary['priority'] {
  const extension = raw.extension?.find(
    (item) => item.url === PRIORITY_EXTENSION || item.url?.endsWith('request-priority') === true,
  );
  switch ((extension?.valueCode ?? extension?.valueString ?? '').trim().toLowerCase()) {
    case 'high':
    case 'stat':
    case 'urgent':
    case 'asap':
      return 'high';
    case 'low':
    case 'routine':
      return 'low';
    default:
      return 'medium';
  }
}

function mapPerformer(reference: FhirReference | undefined): AssigneeSummary | undefined {
  if (reference?.reference === undefined || reference.reference === '') {
    return undefined;
  }
  const raw = reference.reference;
  const display = reference.display ?? raw;
  if (raw.startsWith('Role/') || raw.startsWith('PractitionerRole/')) {
    return { id: referenceId(raw), display, type: 'role' };
  }
  return { id: referenceId(raw), display, type: 'person' };
}

function toIsoDate(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
