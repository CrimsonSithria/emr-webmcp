import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CompletedRunConflictError,
  ensureSyntheaJar,
  generateProfile,
  syntheaCliArgs,
  toNamelessChecksumKey,
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

const PHI_FIELD_KEYS = ['name', 'given', 'family', 'birthDate', 'gender', 'address'] as const;
const NAMELESS_FILE_KEY = /^(?:.*\/)?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|bundle-\d+)\.json$/i;
const DISPLAY_NAME_IN_PATH = /[A-Za-z]+_[A-Za-z]+/;

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

function assertNamelessManifest(manifest: SimulationManifest): void {
  const keys = collectKeys(manifest);
  expect(keys).not.toEqual(expect.arrayContaining([...PHI_FIELD_KEYS]));
  for (const filePath of Object.keys(manifest.checksums.files)) {
    expect(filePath).toMatch(NAMELESS_FILE_KEY);
    expect(filePath).not.toMatch(DISPLAY_NAME_IN_PATH);
    for (const field of PHI_FIELD_KEYS) {
      expect(filePath.toLowerCase().includes(field.toLowerCase())).toBe(false);
    }
  }
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

    assertNamelessManifest(result.manifest);
  });

  it('rewrites Synthea display-name filenames to UUID or ordinal checksum keys', async () => {
    const profile = parseSimulationProfile(validSmokeInput());
    const namedUuid = '550e8400-e29b-41d4-a716-446655440000';
    const { runner } = fakeRunner({
      files: [
        {
          relativePath: `fhir/John_Doe_${namedUuid}.json`,
          sha256: 'b'.repeat(64),
        },
        {
          relativePath: 'fhir/Alice_Smith.json',
          sha256: 'c'.repeat(64),
        },
      ],
    });
    const result = await generateProfile({
      profile,
      runner,
      now,
      store: createMemoryStore(),
    });

    expect(result.manifest.checksums.files[`fhir/${namedUuid}.json`]).toBe('b'.repeat(64));
    expect(result.manifest.checksums.files['fhir/002.json']).toBe('c'.repeat(64));
    expect(Object.keys(result.manifest.checksums.files).some((key) => /John|Doe|Alice|Smith/.test(key))).toBe(
      false,
    );
    assertNamelessManifest(result.manifest);
  });

  it('asks Synthea for UUID filenames and keeps hospital/practitioner exports off', () => {
    const args = syntheaCliArgs(parseSimulationProfile(validSmokeInput()));
    expect(args).toContain('--exporter.use_uuid_filenames=true');
    expect(args).toContain('--exporter.hospital.fhir.export=false');
    expect(args).toContain('--exporter.practitioner.fhir.export=false');
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

describe('toNamelessChecksumKey', () => {
  it('keeps UUID and ordinal stems and strips display names', () => {
    expect(toNamelessChecksumKey('fhir/bundle-001.json', 1)).toBe('fhir/bundle-001.json');
    expect(toNamelessChecksumKey('fhir/550e8400-e29b-41d4-a716-446655440000.json', 1)).toBe(
      'fhir/550e8400-e29b-41d4-a716-446655440000.json',
    );
    expect(toNamelessChecksumKey('fhir/John_Doe_550e8400-e29b-41d4-a716-446655440000.json', 1)).toBe(
      'fhir/550e8400-e29b-41d4-a716-446655440000.json',
    );
    expect(toNamelessChecksumKey('fhir/Alice_Smith.json', 2)).toBe('fhir/002.json');
  });
});

describe('ensureSyntheaJar', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'synthea-jar-'));
    roots.push(root);
    return root;
  }

  function jarPath(repoRoot: string, release: string): string {
    return join(repoRoot, 'simulation/.cache/synthea', release, 'synthea-with-dependencies.jar');
  }

  it('verifies a pinned SHA-256 on cache hit and skips download', async () => {
    const repoRoot = await tempRoot();
    const release = 'test-hit';
    const body = 'valid-jar';
    const sha256 = createHash('sha256').update(body).digest('hex');
    const dest = jarPath(repoRoot, release);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, body);
    let fetches = 0;
    const path = await ensureSyntheaJar({
      repoRoot,
      release,
      sha256ByRelease: { [release]: sha256 },
      fetchImpl: () => {
        fetches += 1;
        return Promise.resolve(new Response('other'));
      },
    });
    expect(path).toBe(dest);
    expect(fetches).toBe(0);
    expect(await readFile(dest, 'utf8')).toBe(body);
  });

  it('downloads to a temp path, verifies, then renames into the cache', async () => {
    const repoRoot = await tempRoot();
    const release = 'test-download';
    const body = 'fresh-jar';
    const sha256 = createHash('sha256').update(body).digest('hex');
    const dest = jarPath(repoRoot, release);
    const path = await ensureSyntheaJar({
      repoRoot,
      release,
      sha256ByRelease: { [release]: sha256 },
      fetchImpl: () => Promise.resolve(new Response(body)),
    });
    expect(path).toBe(dest);
    expect(await readFile(dest, 'utf8')).toBe(body);
    const cacheDir = dirname(dest);
    const leftovers = (await readdir(cacheDir)).filter((name) => name.includes('.partial'));
    expect(leftovers).toEqual([]);
  });

  it('deletes a size>0 corrupt cache and the temp file when download fails', async () => {
    const repoRoot = await tempRoot();
    const release = 'test-fail';
    const dest = jarPath(repoRoot, release);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, 'partial-garbage');
    await expect(
      ensureSyntheaJar({
        repoRoot,
        release,
        sha256ByRelease: { [release]: 'a'.repeat(64) },
        fetchImpl: () => Promise.resolve(new Response('nope', { status: 502 })),
      }),
    ).rejects.toThrow(/download/i);
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
    const cacheDir = dirname(dest);
    const leftovers = (await readdir(cacheDir)).filter((name) => name.includes('.partial'));
    expect(leftovers).toEqual([]);
  });

  it('deletes cache and temp files when the downloaded SHA-256 does not match', async () => {
    const repoRoot = await tempRoot();
    const release = 'test-mismatch';
    const dest = jarPath(repoRoot, release);
    await expect(
      ensureSyntheaJar({
        repoRoot,
        release,
        sha256ByRelease: { [release]: 'b'.repeat(64) },
        fetchImpl: () => Promise.resolve(new Response('tampered')),
      }),
    ).rejects.toThrow(/SHA-256/i);
    await expect(readFile(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
