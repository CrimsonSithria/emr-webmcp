import { createHash } from 'node:crypto';

import {
  observationEffectiveDateTime,
  observationValue,
  syntheticLabAt,
} from './lab-catalog.js';
import type { SimulationManifest } from './manifest.js';
import type { ProfileId } from './profile-schema.js';

export const CLINIC_WORKLOAD_COUNTS = {
  appointments: 500,
  followUps: 2_000,
  laboratoryObservations: 1_000,
  unlatchedAbnormal: 150,
  edgeCases: 100,
} as const;

/** Smoke (25 patients) is demo-relative: 25 / 500. Demo and clinic keep full counts. */
export const SMOKE_SCALE_FACTOR = 25 / 500;

const PATIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPOINTMENT_WINDOW_START_MS = Date.parse('2026-08-31T08:00:00.000Z');
const IDEMPOTENCY_SYSTEM = 'https://emr-webmcp.dev/idempotency';

/** Adapter list window covering the seeded clinic week (`fromDate` / `toDate`). */
export const APPOINTMENT_LIST_FROM_DATE = '2026-08-31T00:00:00.000Z';
export const APPOINTMENT_LIST_TO_DATE = '2026-09-07T23:59:59.999Z';

export const WORKLOAD_IDEMPOTENCY_SYSTEM = IDEMPOTENCY_SYSTEM;

export type WorkloadRecordKind = 'appointment' | 'followup' | 'observation' | 'edge';

export type WorkloadCounts = {
  appointments: number;
  followUps: number;
  laboratoryObservations: number;
  unlatchedAbnormal: number;
  edgeCases: number;
};

export type AppointmentStatus = 'scheduled' | 'checked-in' | 'completed' | 'cancelled';
export type FollowupStatus = 'not-started' | 'in-progress' | 'completed' | 'cancelled';
export type LabInterpretation = 'N' | 'H' | 'L' | 'HH' | 'LL' | 'A';
export type EdgeScenario = 'duplicate-idempotency' | 'stale-context';

export type PlannedAppointment = {
  kind: 'appointment';
  ordinal: number;
  patientId: string;
  idempotencyKey: string;
  plannedResourceId: string;
  start: string;
  status: AppointmentStatus;
};

export type PlannedObservation = {
  kind: 'observation';
  ordinal: number;
  patientId: string;
  idempotencyKey: string;
  plannedResourceId: string;
  interpretation: LabInterpretation;
  unlatched: boolean;
  loincCode: string;
  displayName: string;
  unit: string;
  value: number;
  effectiveDateTime: string;
};

export type PlannedFollowup = {
  kind: 'followup';
  ordinal: number;
  patientId: string;
  idempotencyKey: string;
  plannedResourceId: string;
  status: FollowupStatus;
  overdue: boolean;
  sourceReference?: string;
  correlationRationale?: string;
};

export type PlannedEdgeCase = {
  kind: 'edge';
  ordinal: number;
  patientId: string;
  idempotencyKey: string;
  plannedResourceId: string;
  scenario: EdgeScenario;
  duplicateTargetKey?: string;
  sourceReference?: string;
};

export type WorkloadPlan = {
  profileId: ProfileId;
  runId: string;
  scaleFactor: number;
  counts: WorkloadCounts;
  appointments: PlannedAppointment[];
  followUps: PlannedFollowup[];
  observations: PlannedObservation[];
  edgeCases: PlannedEdgeCase[];
};

export type BuildWorkloadPlanInput = {
  profileId: ProfileId;
  runId: string;
  patientIds: readonly string[];
};

export function scaleWorkloadCount(clinicCount: number, factor: number): number {
  return Math.max(0, Math.round(clinicCount * factor));
}

export function workloadScaleFactor(profileId: ProfileId): number {
  return profileId === 'smoke' ? SMOKE_SCALE_FACTOR : 1;
}

export function workloadIdempotencyKey(
  runId: string,
  kind: WorkloadRecordKind,
  ordinal: number,
): string {
  return `emr-webmcp:${runId}:${kind}:${ordinal}`;
}

export function resourceIdFromKey(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function lablatchRationale(observationId: string): string {
  return `Review synthetic laboratory result.\n[emr-webmcp:v1 source=Observation/${observationId} workflow=lablatch]`;
}

export function patientIdsFromManifest(manifest: SimulationManifest): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(manifest.checksums.files)) {
    const posix = key.replaceAll('\\', '/');
    const slash = posix.lastIndexOf('/');
    const stem = posix.slice(slash + 1).replace(/\.json$/i, '');
    if (FILE_UUID.test(stem)) {
      ids.add(stem.toLowerCase());
    }
  }
  return [...ids].sort();
}

export function buildWorkloadPlan(input: BuildWorkloadPlanInput): WorkloadPlan {
  const patientIds = assertPatientIds(input.patientIds);
  const scaleFactor = workloadScaleFactor(input.profileId);
  const counts: WorkloadCounts = {
    appointments: scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.appointments, scaleFactor),
    followUps: scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.followUps, scaleFactor),
    laboratoryObservations: scaleWorkloadCount(
      CLINIC_WORKLOAD_COUNTS.laboratoryObservations,
      scaleFactor,
    ),
    unlatchedAbnormal: scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.unlatchedAbnormal, scaleFactor),
    edgeCases: scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.edgeCases, scaleFactor),
  };

  const observations = buildObservations(input.runId, patientIds, counts);
  const appointments = buildAppointments(input.runId, patientIds, counts.appointments);
  const followUps = buildFollowups(input.runId, patientIds, counts.followUps, observations);
  const edgeCases = buildEdgeCases(input.runId, patientIds, counts, appointments);

  return {
    profileId: input.profileId,
    runId: input.runId,
    scaleFactor,
    counts,
    appointments,
    followUps,
    observations,
    edgeCases,
  };
}

function assertPatientIds(patientIds: readonly string[]): readonly string[] {
  if (patientIds.length === 0) {
    throw new Error('imported manifest has no patient ids');
  }
  for (const id of patientIds) {
    if (!PATIENT_UUID.test(id)) {
      throw new Error('patient references must be synthetic UUIDs');
    }
  }
  return patientIds;
}

function patientAt(patientIds: readonly string[], ordinal: number): string {
  const patientId = patientIds[ordinal % patientIds.length];
  if (patientId === undefined) {
    throw new Error('imported manifest has no patient ids');
  }
  return patientId;
}

function buildAppointments(
  runId: string,
  patientIds: readonly string[],
  count: number,
): PlannedAppointment[] {
  const statuses: AppointmentStatus[] = [
    'scheduled',
    'scheduled',
    'scheduled',
    'scheduled',
    'scheduled',
    'scheduled',
    'scheduled',
    'checked-in',
    'completed',
    'cancelled',
  ];
  const appointments: PlannedAppointment[] = [];
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const idempotencyKey = workloadIdempotencyKey(runId, 'appointment', ordinal);
    const status = statuses[ordinal % statuses.length];
    if (status === undefined) {
      throw new Error('appointment status table is empty');
    }
    appointments.push({
      kind: 'appointment',
      ordinal,
      patientId: patientAt(patientIds, ordinal),
      idempotencyKey,
      plannedResourceId: resourceIdFromKey(idempotencyKey),
      start: appointmentStart(ordinal),
      status,
    });
  }
  return appointments;
}

function appointmentStart(ordinal: number): string {
  const day = ordinal % 7;
  const slot = Math.floor(ordinal / 7) % 16;
  return new Date(APPOINTMENT_WINDOW_START_MS + day * 86_400_000 + slot * 30 * 60_000).toISOString();
}

function buildObservations(
  runId: string,
  patientIds: readonly string[],
  counts: WorkloadCounts,
): PlannedObservation[] {
  const observations: PlannedObservation[] = [];
  for (let ordinal = 0; ordinal < counts.laboratoryObservations; ordinal += 1) {
    const unlatched = ordinal < counts.unlatchedAbnormal;
    const idempotencyKey = workloadIdempotencyKey(runId, 'observation', ordinal);
    const lab = syntheticLabAt(ordinal);
    const interpretation = observationInterpretation(ordinal, unlatched);
    observations.push({
      kind: 'observation',
      ordinal,
      patientId: patientAt(patientIds, ordinal),
      idempotencyKey,
      plannedResourceId: resourceIdFromKey(idempotencyKey),
      interpretation,
      unlatched,
      loincCode: lab.loinc,
      displayName: lab.display,
      unit: lab.unit,
      value: observationValue(lab, interpretation, ordinal),
      effectiveDateTime: observationEffectiveDateTime(ordinal, APPOINTMENT_WINDOW_START_MS),
    });
  }
  return observations;
}

function observationInterpretation(ordinal: number, unlatched: boolean): LabInterpretation {
  if (unlatched) {
    const abnormal: LabInterpretation[] = ['H', 'L', 'HH', 'LL'];
    return abnormal[ordinal % abnormal.length] ?? 'H';
  }
  const bucket = ordinal % 5;
  if (bucket === 0) {
    return ordinal % 2 === 0 ? 'HH' : 'LL';
  }
  if (bucket === 1) {
    return 'H';
  }
  if (bucket === 2) {
    return 'L';
  }
  return 'N';
}

function buildFollowups(
  runId: string,
  patientIds: readonly string[],
  count: number,
  observations: readonly PlannedObservation[],
): PlannedFollowup[] {
  const latchable = observations.filter(
    (row) => !row.unlatched && row.interpretation !== 'N',
  );
  const followUps: PlannedFollowup[] = [];
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const idempotencyKey = workloadIdempotencyKey(runId, 'followup', ordinal);
    const latched = latchable[ordinal];
    const statusSpec = followupStatus(ordinal);
    const followup: PlannedFollowup = {
      kind: 'followup',
      ordinal,
      patientId: latched?.patientId ?? patientAt(patientIds, ordinal),
      idempotencyKey,
      plannedResourceId: resourceIdFromKey(idempotencyKey),
      status: statusSpec.status,
      overdue: statusSpec.overdue,
    };
    if (latched !== undefined) {
      followup.sourceReference = `Observation/${latched.plannedResourceId}`;
      followup.correlationRationale = lablatchRationale(latched.plannedResourceId);
    }
    followUps.push(followup);
  }
  return followUps;
}

function followupStatus(ordinal: number): { status: FollowupStatus; overdue: boolean } {
  const bucket = ordinal % 20;
  if (bucket < 8) {
    return { status: 'not-started', overdue: false };
  }
  if (bucket < 12) {
    return { status: 'in-progress', overdue: false };
  }
  if (bucket < 16) {
    return { status: 'completed', overdue: false };
  }
  if (bucket < 18) {
    return { status: 'cancelled', overdue: false };
  }
  return { status: 'not-started', overdue: true };
}

function buildEdgeCases(
  runId: string,
  patientIds: readonly string[],
  counts: WorkloadCounts,
  appointments: readonly PlannedAppointment[],
): PlannedEdgeCase[] {
  const edgeCases: PlannedEdgeCase[] = [];
  const duplicateUntil = Math.floor(counts.edgeCases / 2);
  for (let ordinal = 0; ordinal < counts.edgeCases; ordinal += 1) {
    const idempotencyKey = workloadIdempotencyKey(runId, 'edge', ordinal);
    const edge: PlannedEdgeCase = {
      kind: 'edge',
      ordinal,
      patientId: patientAt(patientIds, ordinal),
      idempotencyKey,
      plannedResourceId: resourceIdFromKey(idempotencyKey),
      scenario: ordinal < duplicateUntil ? 'duplicate-idempotency' : 'stale-context',
    };
    if (edge.scenario === 'duplicate-idempotency') {
      const target = appointments[ordinal % Math.max(appointments.length, 1)];
      if (target !== undefined) {
        edge.duplicateTargetKey = target.idempotencyKey;
      }
    } else {
      edge.sourceReference = `Observation/${resourceIdFromKey(`missing:${runId}:${ordinal}`)}`;
    }
    edgeCases.push(edge);
  }
  return edgeCases;
}
