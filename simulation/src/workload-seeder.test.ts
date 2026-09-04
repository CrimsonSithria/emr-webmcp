import { describe, expect, it } from 'vitest';

import type { SimulationManifest } from './manifest.js';
import { createMemoryAdminClient, OpenMrsAdminError } from './openmrs-admin-client.js';
import {
  CLINIC_WORKLOAD_COUNTS,
  SMOKE_SCALE_FACTOR,
  buildWorkloadPlan,
  patientIdsFromManifest,
  scaleWorkloadCount,
  workloadIdempotencyKey,
} from './workload-plan.js';
import { APPOINTMENT_SEED_KINDS, seedWorkload } from './workload-seeder.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^emr-webmcp:[^:]+:(appointment|followup|observation|edge):\d+$/;
const LABLATCH_MARKER = /^\[emr-webmcp:v1 source=Observation\/[A-Za-z0-9._-]+ workflow=lablatch\]$/;
const PHI_FIELD_KEYS = ['name', 'given', 'family', 'birthDate', 'gender', 'address'] as const;

function syntheticPatientIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const n = (index + 1).toString(16).padStart(12, '0');
    return `aaaaaaaa-bbbb-4ccc-8ddd-${n}`;
  });
}

function clinicPatients(): string[] {
  return syntheticPatientIds(500);
}

function fakeManifest(patientIds: readonly string[], profileId: 'smoke' | 'demo' | 'clinic'): SimulationManifest {
  const files = Object.fromEntries(
    patientIds.map((id, index) => [`fhir/${id}.json`, `${String(index).padStart(64, 'a')}`]),
  );
  return {
    generatorVersion: 'v3.4.0',
    seed: '2026083103',
    counts: {
      patients: patientIds.length,
      generated: patientIds.length,
      imported: patientIds.length,
      rejected: 0,
    },
    timestamps: {
      startedAt: '2026-08-31T02:09:00.000Z',
      completedAt: '2026-08-31T02:09:00.000Z',
    },
    checksums: {
      profile: 'b'.repeat(64),
      files,
    },
    attestation: 'synthetic-data-only',
    runId: `emr-webmcp-${profileId}-testrun`,
    profileId,
    fhirVersion: 'R4',
  };
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

function assertSyntheticIdsOnly(value: unknown): void {
  expect(collectKeys(value)).not.toEqual(expect.arrayContaining([...PHI_FIELD_KEYS]));
  const visit = (node: unknown): void => {
    if (typeof node === 'string' && node.includes('Patient/')) {
      const id = node.slice(node.lastIndexOf('/') + 1);
      expect(id).toMatch(UUID);
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (node !== null && typeof node === 'object') {
      if ('patientId' in node && typeof node.patientId === 'string') {
        expect(node.patientId).toMatch(UUID);
      }
      for (const nested of Object.values(node)) {
        visit(nested);
      }
    }
  };
  visit(value);
}

describe('clinic workload plan', () => {
  it('is deterministic with 500 appointments, 2000 follow-ups, 1000 labs, 150 unlatched, and 100 edge cases', () => {
    const patientIds = clinicPatients();
    const input = {
      profileId: 'clinic' as const,
      runId: 'emr-webmcp-clinic-testrun',
      patientIds,
    };

    const first = buildWorkloadPlan(input);
    const second = buildWorkloadPlan(input);

    expect(first).toEqual(second);
    expect(first.scaleFactor).toBe(1);
    expect(first.counts).toEqual(CLINIC_WORKLOAD_COUNTS);
    expect(first.appointments).toHaveLength(500);
    expect(first.followUps).toHaveLength(2000);
    expect(first.observations).toHaveLength(1000);
    expect(first.observations.filter((row) => row.unlatched)).toHaveLength(150);
    expect(first.edgeCases).toHaveLength(100);
  });

  it('uses varied LOINC codes and spread timestamps instead of one hemoglobin stamp', () => {
    const plan = buildWorkloadPlan({
      profileId: 'clinic',
      runId: 'emr-webmcp-clinic-testrun',
      patientIds: clinicPatients(),
    });
    const loincs = new Set(plan.observations.map((row) => row.loincCode));
    const timestamps = new Set(plan.observations.map((row) => row.effectiveDateTime));
    expect(loincs.size).toBeGreaterThanOrEqual(4);
    expect(timestamps.size).toBeGreaterThan(20);
    expect(plan.observations.every((row) => row.displayName.length > 0 && row.unit.length > 0)).toBe(true);
  });

  it('keeps every patient reference inside the imported manifest', () => {
    const manifest = fakeManifest(clinicPatients(), 'clinic');
    const patientIds = patientIdsFromManifest(manifest);
    const plan = buildWorkloadPlan({
      profileId: manifest.profileId,
      runId: manifest.runId,
      patientIds,
    });

    const allowed = new Set(patientIds);
    const refs = [
      ...plan.appointments.map((row) => row.patientId),
      ...plan.followUps.map((row) => row.patientId),
      ...plan.observations.map((row) => row.patientId),
      ...plan.edgeCases.map((row) => row.patientId),
    ];

    expect(patientIds).toHaveLength(500);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((id) => allowed.has(id))).toBe(true);
    for (const id of refs) {
      expect(id).toMatch(UUID);
    }
    assertSyntheticIdsOnly(plan);
  });
});

describe('scaled smoke plan', () => {
  it('uses the documented demo-relative scale factor and stays deterministic', () => {
    expect(SMOKE_SCALE_FACTOR).toBe(25 / 500);
    expect(scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.appointments, SMOKE_SCALE_FACTOR)).toBe(25);
    expect(scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.followUps, SMOKE_SCALE_FACTOR)).toBe(100);
    expect(scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.laboratoryObservations, SMOKE_SCALE_FACTOR)).toBe(50);
    expect(scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.unlatchedAbnormal, SMOKE_SCALE_FACTOR)).toBe(8);
    expect(scaleWorkloadCount(CLINIC_WORKLOAD_COUNTS.edgeCases, SMOKE_SCALE_FACTOR)).toBe(5);

    const patientIds = syntheticPatientIds(25);
    const first = buildWorkloadPlan({
      profileId: 'smoke',
      runId: 'emr-webmcp-smoke-testrun',
      patientIds,
    });
    const second = buildWorkloadPlan({
      profileId: 'smoke',
      runId: 'emr-webmcp-smoke-testrun',
      patientIds,
    });

    expect(first).toEqual(second);
    expect(first.scaleFactor).toBe(SMOKE_SCALE_FACTOR);
    expect(first.counts).toEqual({
      appointments: 25,
      followUps: 100,
      laboratoryObservations: 50,
      unlatchedAbnormal: 8,
      edgeCases: 5,
    });
    expect(first.appointments).toHaveLength(25);
    expect(first.followUps).toHaveLength(100);
    expect(first.observations).toHaveLength(50);
    expect(first.observations.filter((row) => row.unlatched)).toHaveLength(8);
    expect(first.edgeCases).toHaveLength(5);
    expect(first.appointments.every((row) => patientIds.includes(row.patientId))).toBe(true);
  });

  it('keeps demo and clinic on the full clinic counts', () => {
    const demo = buildWorkloadPlan({
      profileId: 'demo',
      runId: 'emr-webmcp-demo-testrun',
      patientIds: clinicPatients(),
    });
    const clinic = buildWorkloadPlan({
      profileId: 'clinic',
      runId: 'emr-webmcp-clinic-testrun',
      patientIds: clinicPatients(),
    });

    expect(demo.scaleFactor).toBe(1);
    expect(clinic.scaleFactor).toBe(1);
    expect(demo.counts).toEqual(CLINIC_WORKLOAD_COUNTS);
    expect(clinic.counts).toEqual(CLINIC_WORKLOAD_COUNTS);
  });
});

describe('idempotency and correlation', () => {
  it('stores keys as emr-webmcp:<runId>:<recordKind>:<ordinal>', () => {
    const runId = 'emr-webmcp-clinic-testrun';
    expect(workloadIdempotencyKey(runId, 'appointment', 0)).toBe(`emr-webmcp:${runId}:appointment:0`);
    expect(workloadIdempotencyKey(runId, 'followup', 12)).toBe(`emr-webmcp:${runId}:followup:12`);

    const plan = buildWorkloadPlan({
      profileId: 'clinic',
      runId,
      patientIds: clinicPatients(),
    });

    const keys = [
      ...plan.appointments.map((row) => row.idempotencyKey),
      ...plan.followUps.map((row) => row.idempotencyKey),
      ...plan.observations.map((row) => row.idempotencyKey),
      ...plan.edgeCases.map((row) => row.idempotencyKey),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(IDEMPOTENCY_KEY);
      expect(key.startsWith(`emr-webmcp:${runId}:`)).toBe(true);
    }
  });

  it('leaves unlatched abnormal results without a LabLatch follow-up', () => {
    const plan = buildWorkloadPlan({
      profileId: 'clinic',
      runId: 'emr-webmcp-clinic-testrun',
      patientIds: clinicPatients(),
    });
    const unlatchedIds = new Set(
      plan.observations.filter((row) => row.unlatched).map((row) => row.plannedResourceId),
    );
    expect(unlatchedIds.size).toBe(150);

    for (const followup of plan.followUps) {
      if (followup.sourceReference === undefined) {
        continue;
      }
      const observationId = followup.sourceReference.slice('Observation/'.length);
      expect(unlatchedIds.has(observationId)).toBe(false);
      const lastLine = followup.correlationRationale?.split('\n').at(-1) ?? '';
      expect(lastLine).toMatch(LABLATCH_MARKER);
    }
  });
});

describe('seedWorkload', () => {
  it('creates the smoke plan once and creates zero duplicates on re-seed', async () => {
    const patientIds = syntheticPatientIds(25);
    const plan = buildWorkloadPlan({
      profileId: 'smoke',
      runId: 'emr-webmcp-smoke-testrun',
      patientIds,
    });
    const client = createMemoryAdminClient();

    const first = await seedWorkload({ plan, client });
    expect(first.created).toEqual({
      appointments: 25,
      followUps: 100,
      observations: 50,
      edgeCases: 5,
    });
    expect(first.reused).toEqual({
      appointments: 0,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    expect(first.skipped).toEqual({
      appointments: 0,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    const afterFirst = client.snapshotCounts();

    const second = await seedWorkload({ plan, client });
    expect(second.created).toEqual({
      appointments: 0,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    expect(second.reused).toEqual(first.created);
    expect(client.snapshotCounts()).toEqual(afterFirst);
    expect(client.createCalls).toBe(
      first.created.appointments + first.created.followUps + first.created.observations + first.created.edgeCases,
    );
  });

  it('can seed appointments without touching labs or follow-ups', async () => {
    const patientIds = syntheticPatientIds(25);
    const plan = buildWorkloadPlan({
      profileId: 'smoke',
      runId: 'emr-webmcp-smoke-testrun',
      patientIds,
    });
    const client = createMemoryAdminClient();

    const result = await seedWorkload({ plan, client, kinds: APPOINTMENT_SEED_KINDS });
    expect(result.created).toEqual({
      appointments: 25,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    expect(result.reused).toEqual({
      appointments: 0,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    expect(result.skipped).toEqual({
      appointments: 0,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    expect(client.snapshotCounts()).toEqual({
      appointments: 25,
      followUps: 0,
      observations: 0,
      edgeCases: 0,
    });
    expect(client.createCalls).toBe(25);
  });

  it('exposes admin errors as status and code only', () => {
    const error = new OpenMrsAdminError(409, 'conflict');
    expect(error.status).toBe(409);
    expect(error.code).toBe('conflict');
    expect(error.message).toBe('409 conflict');
    expect(JSON.stringify(error)).not.toMatch(/authorization|bearer|password|identifier|subject/i);
  });
});
