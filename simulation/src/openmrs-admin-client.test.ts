import { describe, expect, it } from 'vitest';

import { createMemoryManifestStore, type SimulationManifest } from './manifest.js';
import { createHttpAdminClient, importGeneratedDocuments } from './openmrs-admin-client.js';

function searchset(options: {
  id: string;
  total: number;
  resource?: { resourceType: 'Observation' | 'CarePlan'; id: string };
}): Record<string, unknown> {
  const bundle: Record<string, unknown> = {
    resourceType: 'Bundle',
    type: 'searchset',
    id: options.id,
    total: options.total,
  };
  if (options.resource !== undefined) {
    bundle.entry = [{ resource: options.resource }];
  }
  return bundle;
}

function queuedFetch(bodies: unknown[]): typeof fetch {
  const queue = [...bodies];
  const fetchImpl: typeof fetch = (_input, init) => {
    const body = queue.shift();
    expect(body, `unexpected fetch ${init?.method ?? 'GET'}`).toBeDefined();
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return fetchImpl;
}

describe('HTTP identifier search', () => {
  it('treats an empty searchset Bundle as a miss and a one-entry Bundle as a hit', async () => {
    const emptyObservation = { resourceType: 'Bundle', type: 'searchset', id: 'bundle-empty-observation' };
    const emptyCarePlan = { resourceType: 'Bundle', type: 'searchset', id: 'bundle-empty-careplan', total: 0, entry: [] };
    const observationHit = searchset({
      id: 'bundle-observation-hit',
      total: 1,
      resource: { resourceType: 'Observation', id: 'obs-1' },
    });

    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: queuedFetch([emptyObservation, emptyCarePlan, observationHit]),
    });

    const miss = await client.findByIdempotencyKey('emr-webmcp:run:observation:0');
    expect(miss).toBeUndefined();

    const hit = await client.findByIdempotencyKey('emr-webmcp:run:observation:1');
    expect(hit).toEqual({
      kind: 'observation',
      id: 'obs-1',
      idempotencyKey: 'emr-webmcp:run:observation:1',
      patientId: '',
    });
  });
});

function sampleManifest(): SimulationManifest {
  return {
    generatorVersion: 'v3.4.0',
    seed: '2026083101',
    counts: {
      patients: 25,
      generated: 25,
      imported: 0,
      rejected: 0,
    },
    timestamps: {
      startedAt: '2026-08-31T02:09:00.000Z',
      completedAt: '2026-08-31T02:09:00.000Z',
    },
    checksums: {
      profile: 'a'.repeat(64),
      files: { 'fhir/bundle-001.json': 'b'.repeat(64) },
    },
    attestation: 'synthetic-data-only',
    runId: 'emr-webmcp-smoke-testrun',
    profileId: 'smoke',
    fhirVersion: 'R4',
  };
}

describe('import generated documents', () => {
  it('writes imported and rejected counts back to the manifest', async () => {
    const store = createMemoryManifestStore();
    const outputDir = 'artifacts/simulation/smoke';
    await store.writeManifest(outputDir, sampleManifest());
    const outcomes: Array<'imported' | 'rejected'> = ['imported', 'rejected', 'imported'];
    const client = {
      importDocument() {
        const next = outcomes.shift();
        expect(next).toBeDefined();
        return Promise.resolve(next ?? 'rejected');
      },
    };

    const result = await importGeneratedDocuments({
      client: client as never,
      store,
      outputDir,
      documents: [{ resourceType: 'Bundle' }, { resourceType: 'Bundle' }, { resourceType: 'Bundle' }],
    });

    expect(result).toEqual({ imported: 2, rejected: 1 });
    const written = await store.readManifest(outputDir);
    expect(written?.counts.imported).toBe(2);
    expect(written?.counts.rejected).toBe(1);
    expect(written?.counts.patients).toBe(25);
    expect(written?.counts.generated).toBe(25);
  });
});
