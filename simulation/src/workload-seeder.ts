import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFsManifestStore } from './manifest.js';
import {
  createOpenMrsAdminClientFromEnv,
  OpenMrsAdminError,
  type OpenMrsAdminClient,
  type SeededKind,
} from './openmrs-admin-client.js';

/** Seed only the clinic list. Use this after a full seed so FHIR identifier 400s do not duplicate labs. */
export const APPOINTMENT_SEED_KINDS: readonly SeededKind[] = ['appointment'];
import { loadProfile, type ProfileId } from './profile-schema.js';
import {
  buildWorkloadPlan,
  patientIdsFromManifest,
  type PlannedEdgeCase,
  type PlannedFollowup,
  type WorkloadPlan,
} from './workload-plan.js';

export type SeedCounts = {
  appointments: number;
  followUps: number;
  observations: number;
  edgeCases: number;
};

export type SeedResult = {
  created: SeedCounts;
  reused: SeedCounts;
  skipped: SeedCounts;
  plan: WorkloadPlan;
};

export async function seedWorkload(options: {
  plan: WorkloadPlan;
  client: OpenMrsAdminClient;
  kinds?: readonly SeededKind[];
}): Promise<SeedResult> {
  const created = emptyCounts();
  const reused = emptyCounts();
  const skipped = emptyCounts();
  const kinds = options.kinds;

  if (includesKind(kinds, 'observation')) {
    for (const row of options.plan.observations) {
      if ((await options.client.findByIdempotencyKey(row.idempotencyKey)) !== undefined) {
        reused.observations += 1;
        continue;
      }
      try {
        await options.client.createObservation({
          idempotencyKey: row.idempotencyKey,
          patientId: row.patientId,
          plannedResourceId: row.plannedResourceId,
          interpretation: row.interpretation,
          unlatched: row.unlatched,
          loincCode: row.loincCode,
          displayName: row.displayName,
          unit: row.unit,
          value: row.value,
          effectiveDateTime: row.effectiveDateTime,
        });
        created.observations += 1;
      } catch (error) {
        if (!(error instanceof OpenMrsAdminError) || (error.status !== 400 && error.status !== 422)) {
          throw error;
        }
        skipped.observations += 1;
      }
    }
  }

  if (includesKind(kinds, 'appointment')) {
    for (const row of options.plan.appointments) {
      if ((await options.client.findByIdempotencyKey(row.idempotencyKey)) !== undefined) {
        reused.appointments += 1;
        continue;
      }
      try {
        await options.client.createAppointment({
          idempotencyKey: row.idempotencyKey,
          patientId: row.patientId,
          plannedResourceId: row.plannedResourceId,
          start: row.start,
          status: row.status,
        });
        created.appointments += 1;
      } catch (error) {
        if (!(error instanceof OpenMrsAdminError) || (error.status !== 400 && error.status !== 404 && error.status !== 422)) {
          throw error;
        }
      }
    }
  }

  if (includesKind(kinds, 'followup')) {
    for (const row of options.plan.followUps) {
      if ((await options.client.findByIdempotencyKey(row.idempotencyKey)) !== undefined) {
        reused.followUps += 1;
        continue;
      }
      await options.client.createFollowup(followupInput(row));
      created.followUps += 1;
    }
  }

  if (includesKind(kinds, 'edge')) {
    for (const row of options.plan.edgeCases) {
      if ((await options.client.findByIdempotencyKey(row.idempotencyKey)) !== undefined) {
        reused.edgeCases += 1;
        continue;
      }
      await options.client.createEdgeCase(edgeInput(row));
      created.edgeCases += 1;
    }
  }

  return { created, reused, skipped, plan: options.plan };
}

function emptyCounts(): SeedCounts {
  return { appointments: 0, followUps: 0, observations: 0, edgeCases: 0 };
}

function includesKind(kinds: readonly SeededKind[] | undefined, kind: SeededKind): boolean {
  return kinds === undefined || kinds.includes(kind);
}

function followupInput(row: PlannedFollowup): {
  idempotencyKey: string;
  patientId: string;
  plannedResourceId: string;
  status: string;
  overdue: boolean;
  sourceReference?: string;
  correlationRationale?: string;
} {
  const input: {
    idempotencyKey: string;
    patientId: string;
    plannedResourceId: string;
    status: string;
    overdue: boolean;
    sourceReference?: string;
    correlationRationale?: string;
  } = {
    idempotencyKey: row.idempotencyKey,
    patientId: row.patientId,
    plannedResourceId: row.plannedResourceId,
    status: row.status,
    overdue: row.overdue,
  };
  if (row.sourceReference !== undefined) {
    input.sourceReference = row.sourceReference;
  }
  if (row.correlationRationale !== undefined) {
    input.correlationRationale = row.correlationRationale;
  }
  return input;
}

function edgeInput(row: PlannedEdgeCase): {
  idempotencyKey: string;
  patientId: string;
  plannedResourceId: string;
  scenario: PlannedEdgeCase['scenario'];
  duplicateTargetKey?: string;
  sourceReference?: string;
} {
  const input: {
    idempotencyKey: string;
    patientId: string;
    plannedResourceId: string;
    scenario: PlannedEdgeCase['scenario'];
    duplicateTargetKey?: string;
    sourceReference?: string;
  } = {
    idempotencyKey: row.idempotencyKey,
    patientId: row.patientId,
    plannedResourceId: row.plannedResourceId,
    scenario: row.scenario,
  };
  if (row.duplicateTargetKey !== undefined) {
    input.duplicateTargetKey = row.duplicateTargetKey;
  }
  if (row.sourceReference !== undefined) {
    input.sourceReference = row.sourceReference;
  }
  return input;
}

function isProfileId(value: string | undefined): value is ProfileId {
  return value === 'smoke' || value === 'demo' || value === 'clinic';
}

function repoRootFromModule(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

async function main(argv: string[]): Promise<void> {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const profileId = args[0];
  if (!isProfileId(profileId)) {
    throw new OpenMrsAdminError(0, 'usage');
  }
  const appointmentsOnly = args.slice(1).includes('--appointments-only');

  let client: OpenMrsAdminClient;
  try {
    client = createOpenMrsAdminClientFromEnv();
  } catch (error) {
    if (error instanceof OpenMrsAdminError && error.code === 'missing-config') {
      process.stdout.write('seed: skip (OPENMRS_BASE_URL or credentials unset)\n');
      return;
    }
    throw error;
  }

  const repoRoot = repoRootFromModule();
  const profile = loadProfile(profileId);
  const manifest = await createFsManifestStore(repoRoot).readManifest(profile.outputDir);
  if (manifest === undefined) {
    process.stdout.write('seed: skip (no manifest)\n');
    return;
  }

  const liveIds = await client.listPatientIds();
  const patientIds = liveIds.length > 0 ? liveIds : patientIdsFromManifest(manifest);
  if (patientIds.length === 0) {
    process.stdout.write('seed: skip (no synthetic patient ids)\n');
    return;
  }

  const plan = buildWorkloadPlan({
    profileId: manifest.profileId,
    runId: manifest.runId,
    patientIds,
  });
  const result = await seedWorkload({
    plan,
    client,
    ...(appointmentsOnly ? { kinds: APPOINTMENT_SEED_KINDS } : {}),
  });
  process.stdout.write(
    `seed created=${result.created.appointments + result.created.followUps + result.created.observations + result.created.edgeCases} reused=${result.reused.appointments + result.reused.followUps + result.reused.observations + result.reused.edgeCases}\n`,
  );
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  await main(process.argv.slice(2));
}
