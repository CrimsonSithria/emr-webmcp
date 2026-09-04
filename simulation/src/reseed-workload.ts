import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFsManifestStore } from './manifest.js';
import {
  createOpenMrsAdminClientFromEnv,
  OpenMrsAdminError,
  type OpenMrsAdminClient,
} from './openmrs-admin-client.js';
import { loadProfile, type ProfileId } from './profile-schema.js';
import { seedWorkload } from './workload-seeder.js';
import { buildWorkloadPlan, patientIdsFromManifest } from './workload-plan.js';

export type PurgeResult = {
  deleted: number;
  scanned: number;
};

export async function purgeSyntheticObservations(client: OpenMrsAdminClient): Promise<PurgeResult> {
  return client.purgeSyntheticObservations();
}

export async function reseedDemoWorkload(options: {
  profileId: ProfileId;
  client: OpenMrsAdminClient;
  purgeFirst?: boolean;
}): Promise<{ purged: PurgeResult | null; seed: Awaited<ReturnType<typeof seedWorkload>> }> {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const profile = loadProfile(options.profileId);
  const manifest = await createFsManifestStore(repoRoot).readManifest(profile.outputDir);
  if (manifest === undefined) {
    throw new OpenMrsAdminError(0, 'missing-manifest');
  }

  let purged: PurgeResult | null = null;
  if (options.purgeFirst === true) {
    purged = await purgeSyntheticObservations(options.client);
  }

  const liveIds = await options.client.listPatientIds();
  const patientIds = liveIds.length > 0 ? liveIds : patientIdsFromManifest(manifest);
  if (patientIds.length === 0) {
    throw new OpenMrsAdminError(0, 'missing-patients');
  }

  const plan = buildWorkloadPlan({
    profileId: manifest.profileId,
    runId: manifest.runId,
    patientIds,
  });
  const seed = await seedWorkload({ plan, client: options.client });
  return { purged, seed };
}

function isProfileId(value: string | undefined): value is ProfileId {
  return value === 'smoke' || value === 'demo' || value === 'clinic';
}

async function main(argv: string[]): Promise<void> {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const profileId = args[0];
  if (!isProfileId(profileId)) {
    throw new OpenMrsAdminError(0, 'usage: reseed <smoke|demo|clinic> [--purge]');
  }
  const purgeFirst = args.includes('--purge');

  const client = createOpenMrsAdminClientFromEnv();
  const result = await reseedDemoWorkload({ profileId, client, purgeFirst });
  process.stdout.write(
    `reseed purged=${result.purged?.deleted ?? 0} created=${
      result.seed.created.appointments +
      result.seed.created.followUps +
      result.seed.created.observations +
      result.seed.created.edgeCases
    } reused=${
      result.seed.reused.appointments +
      result.seed.reused.followUps +
      result.seed.reused.observations +
      result.seed.reused.edgeCases
    } skipped=${result.seed.skipped.observations}\n`,
  );
  const observationOutcome =
    result.seed.created.observations + result.seed.reused.observations + result.seed.skipped.observations;
  if (result.seed.skipped.observations > 0 || observationOutcome < result.seed.plan.observations.length) {
    throw new OpenMrsAdminError(422, 'seed-incomplete');
  }
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  await main(process.argv.slice(2));
}
