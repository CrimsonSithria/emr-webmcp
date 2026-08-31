import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const PROFILE_POPULATION = {
  smoke: 25,
  demo: 500,
  clinic: 10_000,
} as const;

export type ProfileId = keyof typeof PROFILE_POPULATION;

const PROFILE_IDS = ['smoke', 'demo', 'clinic'] as const;

const MUTABLE_SEEDS = new Set(['random', 'auto', 'now', 'mutable']);

const ARTIFACTS_SIMULATION_PREFIX = 'artifacts/simulation/';

function isPinnedSeed(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isInteger(value);
  }
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (MUTABLE_SEEDS.has(normalized)) {
    return false;
  }
  return /^\d+$/.test(value.trim());
}

export function isAllowedOutputDir(outputDir: string): boolean {
  if (outputDir.length === 0) {
    return false;
  }
  const posix = outputDir.replaceAll('\\', '/');
  if (path.posix.isAbsolute(posix) || path.win32.isAbsolute(outputDir)) {
    return false;
  }
  const normalized = path.posix.normalize(posix);
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
    return false;
  }
  return normalized.startsWith(ARTIFACTS_SIMULATION_PREFIX) && normalized !== ARTIFACTS_SIMULATION_PREFIX;
}

const pinnedSeed = z
  .union([z.int(), z.string().min(1)])
  .refine(isPinnedSeed, { message: 'seed must be a pinned integer, not a mutable random seed' })
  .transform((value) => (typeof value === 'number' ? value : Number.parseInt(value.trim(), 10)));

export const simulationProfileSchema = z
  .strictObject({
    id: z.enum(PROFILE_IDS),
    syntheaImage: z.string().min(1),
    syntheaRelease: z.string().min(1),
    seed: pinnedSeed,
    population: z.int().positive(),
    runIdPrefix: z.string().min(1),
    outputDir: z.string().min(1).refine(isAllowedOutputDir, {
      message: 'outputDir must be under artifacts/simulation/',
    }),
    fhirVersion: z.literal('R4'),
  })
  .refine((profile) => profile.population === PROFILE_POPULATION[profile.id], {
    message: 'population must match the profile id',
    path: ['population'],
  });

export type SimulationProfile = z.infer<typeof simulationProfileSchema>;

export function parseSimulationProfile(input: unknown): SimulationProfile {
  return simulationProfileSchema.parse(input);
}

export function loadProfile(id: ProfileId): SimulationProfile {
  const profileUrl = new URL(`../profiles/${id}.json`, import.meta.url);
  const raw = JSON.parse(readFileSync(fileURLToPath(profileUrl), 'utf8')) as unknown;
  return parseSimulationProfile(raw);
}
