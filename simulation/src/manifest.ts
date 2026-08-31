import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';

import { z } from 'zod';

import {
  loadProfile,
  parseSimulationProfile,
  type ProfileId,
  type SimulationProfile,
} from './profile-schema.js';

const execFileAsync = promisify(execFile);
const REFERENCE_DATE = '20260831';
const SHA256 = /^[a-f0-9]{64}$/;

const sha256HexString = z.string().regex(SHA256);

export const simulationManifestSchema = z.strictObject({
  generatorVersion: z.string().min(1),
  seed: z.string().min(1),
  counts: z.strictObject({
    patients: z.int().nonnegative(),
    generated: z.int().nonnegative(),
    imported: z.int().nonnegative(),
    rejected: z.int().nonnegative(),
  }),
  timestamps: z.strictObject({
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  }),
  checksums: z.strictObject({
    profile: sha256HexString,
    files: z.record(z.string(), sha256HexString),
  }),
  attestation: z.literal('synthetic-data-only'),
  runId: z.string().min(1),
  profileId: z.enum(['smoke', 'demo', 'clinic']),
  fhirVersion: z.literal('R4'),
});

export type SimulationManifest = z.infer<typeof simulationManifestSchema>;

export type SyntheaRunOutput = {
  generatorVersion: string;
  counts: {
    patients: number;
    generated: number;
  };
  files: ReadonlyArray<{ relativePath: string; sha256: string }>;
};

export type SyntheaRunner = (request: {
  profile: SimulationProfile;
  outputDir: string;
}) => Promise<SyntheaRunOutput>;

export type ManifestStore = {
  readManifest(outputDir: string): Promise<SimulationManifest | undefined>;
  writeManifest(outputDir: string, manifest: SimulationManifest): Promise<void>;
};

export type GenerateProfileResult = {
  status: 'generated' | 'noop';
  manifest: SimulationManifest;
};

export type GenerateProfileOptions = {
  profile: SimulationProfile;
  runner: SyntheaRunner;
  now?: () => Date;
  store?: ManifestStore;
};

export class CompletedRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompletedRunConflictError';
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashProfile(profile: SimulationProfile): string {
  return createHash('sha256').update(canonicalJson(profile)).digest('hex');
}

export function createMemoryManifestStore(): ManifestStore {
  const manifests = new Map<string, SimulationManifest>();
  return {
    readManifest(outputDir) {
      return Promise.resolve(manifests.get(outputDir));
    },
    writeManifest(outputDir, manifest) {
      manifests.set(outputDir, manifest);
      return Promise.resolve();
    },
  };
}

export function createFsManifestStore(repoRoot: string): ManifestStore {
  return {
    async readManifest(outputDir) {
      const manifestPath = path.join(resolveSimulationOutputDir(repoRoot, outputDir), 'manifest.json');
      try {
        const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
        return simulationManifestSchema.parse(raw);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
    async writeManifest(outputDir, manifest) {
      const directory = resolveSimulationOutputDir(repoRoot, outputDir);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
    },
  };
}

export function resolveSimulationOutputDir(repoRoot: string, outputDir: string): string {
  const resolved = path.resolve(repoRoot, outputDir);
  const allowedRoot = path.resolve(repoRoot, 'artifacts/simulation');
  const relativeToAllowed = path.relative(allowedRoot, resolved);
  if (relativeToAllowed.startsWith('..') || path.isAbsolute(relativeToAllowed) || relativeToAllowed.length === 0) {
    throw new Error('outputDir must be under artifacts/simulation/');
  }
  return resolved;
}

export async function generateProfile(options: GenerateProfileOptions): Promise<GenerateProfileResult> {
  const profile = parseSimulationProfile(options.profile);
  const store = options.store ?? createMemoryManifestStore();
  const now = options.now ?? (() => new Date());
  const profileHash = hashProfile(profile);
  const existing = await store.readManifest(profile.outputDir);

  if (existing) {
    if (existing.checksums.profile === profileHash && existing.timestamps.completedAt) {
      return { status: 'noop', manifest: existing };
    }
    throw new CompletedRunConflictError(
      `Refusing to overwrite a different completed run at ${profile.outputDir}`,
    );
  }

  const startedAt = now().toISOString();
  const generated = await options.runner({ profile, outputDir: profile.outputDir });
  const completedAt = now().toISOString();
  const files = Object.fromEntries(generated.files.map((file) => [file.relativePath, file.sha256]));

  const manifest = simulationManifestSchema.parse({
    generatorVersion: generated.generatorVersion,
    seed: String(profile.seed),
    counts: {
      patients: generated.counts.patients,
      generated: generated.counts.generated,
      imported: 0,
      rejected: 0,
    },
    timestamps: { startedAt, completedAt },
    checksums: {
      profile: profileHash,
      files,
    },
    attestation: 'synthetic-data-only',
    runId: `${profile.runIdPrefix}-${profileHash.slice(0, 12)}`,
    profileId: profile.id,
    fhirVersion: 'R4',
  });

  await store.writeManifest(profile.outputDir, manifest);
  return { status: 'generated', manifest };
}

export function createDockerRunner(options: {
  repoRoot: string;
  execFile?: typeof execFileAsync;
  fetchImpl?: typeof fetch;
}): SyntheaRunner {
  const run = options.execFile ?? execFileAsync;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async ({ profile }) => {
    const outputDir = resolveSimulationOutputDir(options.repoRoot, profile.outputDir);
    await mkdir(outputDir, { recursive: true });
    const jarPath = await ensureSyntheaJar({
      repoRoot: options.repoRoot,
      release: profile.syntheaRelease,
      fetchImpl,
    });
    const timeout = profile.population <= 25 ? 15 * 60_000 : 3 * 60 * 60_000;
    const user = process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : undefined;
    const dockerArgs = [
      'run',
      '--rm',
      ...(user ? ['--user', user] : []),
      '-v',
      `${jarPath}:/synthea/synthea-with-dependencies.jar:ro`,
      '-v',
      `${outputDir}:/output`,
      profile.syntheaImage,
      'java',
      '-jar',
      '/synthea/synthea-with-dependencies.jar',
      '-s',
      String(profile.seed),
      '-cs',
      String(profile.seed),
      '-r',
      REFERENCE_DATE,
      '-p',
      String(profile.population),
      '--exporter.baseDirectory=/output',
      '--exporter.fhir.export=true',
      '--exporter.hospital.fhir.export=false',
      '--exporter.practitioner.fhir.export=false',
      'Massachusetts',
    ];

    try {
      await run('docker', dockerArgs, { timeout, maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Synthea container run failed: ${message}`, { cause: error });
    }

    const files = await hashOutputFiles(outputDir);
    const patients = countPatientBundles(files);
    return {
      generatorVersion: profile.syntheaRelease,
      counts: { patients, generated: patients },
      files,
    };
  };
}

export function countPatientBundles(files: ReadonlyArray<{ relativePath: string }>): number {
  return files.filter((file) => {
    const relativePath = file.relativePath.replaceAll('\\', '/');
    const isFhirJson =
      relativePath.endsWith('.json') &&
      (relativePath.startsWith('fhir/') || relativePath.includes('/fhir/'));
    return (
      isFhirJson &&
      !/hospitalInformation|practitionerInformation/i.test(relativePath)
    );
  }).length;
}

async function ensureSyntheaJar(options: {
  repoRoot: string;
  release: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const jarPath = path.join(
    options.repoRoot,
    'simulation/.cache/synthea',
    options.release,
    'synthea-with-dependencies.jar',
  );
  try {
    const info = await stat(jarPath);
    if (info.isFile() && info.size > 0) {
      return jarPath;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await mkdir(path.dirname(jarPath), { recursive: true });
  const url = `https://github.com/synthetichealth/synthea/releases/download/${options.release}/synthea-with-dependencies.jar`;
  const response = await options.fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Synthea ${options.release}: ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(jarPath));
  return jarPath;
}

async function hashOutputFiles(root: string): Promise<Array<{ relativePath: string; sha256: string }>> {
  const files: Array<{ relativePath: string; sha256: string }> = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name === 'manifest.json') {
        continue;
      }
      const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
      const sha256 = createHash('sha256').update(await readFile(fullPath)).digest('hex');
      files.push({ relativePath, sha256 });
    }
  }

  await walk(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

function repoRootFromModule(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

async function main(argv: string[]): Promise<void> {
  const id = argv[0];
  if (id !== 'smoke' && id !== 'demo' && id !== 'clinic') {
    throw new Error('usage: generate <smoke|demo|clinic>');
  }
  const repoRoot = repoRootFromModule();
  const result = await generateProfile({
    profile: loadProfile(id satisfies ProfileId),
    runner: createDockerRunner({ repoRoot }),
    store: createFsManifestStore(repoRoot),
  });
  process.stdout.write(`${result.status} ${result.manifest.runId} patients=${result.manifest.counts.patients}\n`);
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  await main(process.argv.slice(2));
}
