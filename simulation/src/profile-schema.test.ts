import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CompletedRunConflictError,
  generateProfile,
  type SimulationManifest,
  type SyntheaRunner,
} from './manifest.js';
import { parseSimulationProfile } from './profile-schema.js';

const here = dirname(fileURLToPath(import.meta.url));

function readProfileJson(id: string): unknown {
  return JSON.parse(readFileSync(join(here, '..', 'profiles', `${id}.json`), 'utf8')) as unknown;
}

function validSmokeInput(): Record<string, unknown> {
  return {
    id: 'smoke',
    syntheaImage: 'docker.io/library/eclipse-temurin:17.0.15_6-jre-jammy',
    syntheaRelease: 'v3.4.0',
    seed: 2026083101,
    population: 25,
    runIdPrefix: 'emr-webmcp-smoke',
    outputDir: 'artifacts/simulation/smoke',
    fhirVersion: 'R4',
  };
}

function expectRejected(input: unknown, pattern: RegExp): void {
  expect(() => parseSimulationProfile(input)).toThrow(pattern);
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

function createMemoryStore() {
  const manifests = new Map<string, SimulationManifest>();
  return {
    readManifest(outputDir: string): Promise<SimulationManifest | undefined> {
      return Promise.resolve(manifests.get(outputDir));
    },
    writeManifest(outputDir: string, manifest: SimulationManifest): Promise<void> {
      manifests.set(outputDir, manifest);
      return Promise.resolve();
    },
  };
}

function fakeRunner(overrides: Partial<Awaited<ReturnType<SyntheaRunner>>> = {}): {
  calls: number;
  runner: SyntheaRunner;
} {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    runner: () => {
      state.calls += 1;
      return Promise.resolve({
        generatorVersion: 'v3.4.0',
        counts: { patients: 25, generated: 25 },
        files: [
          {
            relativePath: 'fhir/bundle-001.json',
            sha256: 'a'.repeat(64),
          },
        ],
        ...overrides,
      });
    },
  };
}

describe('committed profiles', () => {
  it.each([
    ['smoke', 25],
    ['demo', 500],
    ['clinic', 10_000],
  ] as const)('%s has exactly %d patients', (id, population) => {
    const profile = parseSimulationProfile(readProfileJson(id));
    expect(profile.id).toBe(id);
    expect(profile.population).toBe(population);
    expect(profile.fhirVersion).toBe('R4');
    expect(profile.outputDir).toBe(`artifacts/simulation/${id}`);
    expect(profile.syntheaImage.length).toBeGreaterThan(0);
    expect(profile.syntheaRelease.length).toBeGreaterThan(0);
    expect(profile.runIdPrefix).toMatch(new RegExp(`^emr-webmcp-${id}`));
  });
});

describe('parseSimulationProfile', () => {
  it('accepts a pinned smoke profile', () => {
    const profile = parseSimulationProfile(validSmokeInput());
    expect(profile.population).toBe(25);
    expect(profile.seed).toBe(2026083101);
  });

  it('rejects negative and zero population counts', () => {
    expectRejected({ ...validSmokeInput(), population: -1 }, /population|positive|greater/i);
    expectRejected({ ...validSmokeInput(), population: 0 }, /population|positive|greater/i);
  });

  it('rejects a population that does not match the profile id', () => {
    expectRejected({ ...validSmokeInput(), population: 24 }, /population must match the profile id/i);
    expectRejected(
      { ...validSmokeInput(), id: 'demo', population: 25, runIdPrefix: 'emr-webmcp-demo' },
      /population must match the profile id/i,
    );
    expectRejected(
      {
        ...validSmokeInput(),
        id: 'clinic',
        population: 1000,
        runIdPrefix: 'emr-webmcp-clinic',
      },
      /population must match the profile id/i,
    );
  });

  it('rejects unknown fields', () => {
    expectRejected({ ...validSmokeInput(), extra: true }, /unrecognized|additional|unexpected/i);
  });

  it('rejects mutable random seeds', () => {
    expectRejected({ ...validSmokeInput(), seed: 'random' }, /pinned integer|mutable random seed/i);
    expectRejected({ ...validSmokeInput(), seed: 'RANDOM' }, /pinned integer|mutable random seed/i);
    expectRejected({ ...validSmokeInput(), seed: 'auto' }, /pinned integer|mutable random seed/i);
    expectRejected({ ...validSmokeInput(), seed: 'now' }, /pinned integer|mutable random seed/i);
  });

  it('rejects output paths outside artifacts/simulation/', () => {
    const disallowed = [
      'artifacts/other/smoke',
      'artifacts/simulation-backup/smoke',
      '/tmp/simulation',
      'artifacts/simulation/../../secret',
      '../artifacts/simulation/smoke',
      'simulation/generated/smoke',
      'artifacts/simulation',
    ];
    for (const outputDir of disallowed) {
      expectRejected({ ...validSmokeInput(), outputDir }, /artifacts\/simulation\//);
    }
  });
});

describe('generateProfile', () => {
  const now = () => new Date('2026-08-31T02:09:00.000Z');

  it('emits a synthetic-only manifest with generator version, seed, counts, timestamps, and checksums', async () => {
    const profile = parseSimulationProfile(validSmokeInput());
    const { runner } = fakeRunner();
    const result = await generateProfile({
      profile,
      runner,
      now,
      store: createMemoryStore(),
    });

    expect(result.status).toBe('generated');
    expect(result.manifest.generatorVersion).toBe('v3.4.0');
    expect(result.manifest.seed).toBe('2026083101');
    expect(result.manifest.counts).toEqual({
      patients: 25,
      generated: 25,
      imported: 0,
      rejected: 0,
    });
    expect(result.manifest.timestamps).toEqual({
      startedAt: '2026-08-31T02:09:00.000Z',
      completedAt: '2026-08-31T02:09:00.000Z',
    });
    expect(result.manifest.checksums.profile).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest.checksums.files['fhir/bundle-001.json']).toBe('a'.repeat(64));
    expect(result.manifest.attestation).toBe('synthetic-data-only');
    expect(result.manifest.runId.startsWith(profile.runIdPrefix)).toBe(true);
    expect(result.manifest.fhirVersion).toBe('R4');

    const keys = collectKeys(result.manifest);
    expect(keys).not.toEqual(
      expect.arrayContaining(['name', 'given', 'family', 'birthDate', 'gender', 'address']),
    );
  });

  it('treats a second identical run as a no-op with identical logical counts', async () => {
    const profile = parseSimulationProfile(validSmokeInput());
    const fake = fakeRunner();
    const store = createMemoryStore();

    const first = await generateProfile({ profile, runner: fake.runner, now, store });
    const second = await generateProfile({ profile, runner: fake.runner, now, store });

    expect(fake.calls).toBe(1);
    expect(second.status).toBe('noop');
    expect(second.manifest).toEqual(first.manifest);
    expect(second.manifest.counts).toEqual(first.manifest.counts);
  });

  it('refuses to overwrite a different completed run', async () => {
    const profile = parseSimulationProfile(validSmokeInput());
    const other = parseSimulationProfile({ ...validSmokeInput(), seed: 2026083199 });
    const store = createMemoryStore();

    await generateProfile({ profile, runner: fakeRunner().runner, now, store });

    await expect(
      generateProfile({ profile: other, runner: fakeRunner().runner, now, store }),
    ).rejects.toThrow(CompletedRunConflictError);
  });

  it('re-validates the profile before running', async () => {
    const profile = parseSimulationProfile(validSmokeInput());
    const tampered = { ...profile, outputDir: '/tmp/outside' };

    await expect(
      generateProfile({
        profile: tampered,
        runner: fakeRunner().runner,
        now,
        store: createMemoryStore(),
      }),
    ).rejects.toThrow(/artifacts\/simulation\//);
  });
});
