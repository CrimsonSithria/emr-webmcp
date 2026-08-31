import { describe, expect, it } from 'vitest';

import { createHttpAdminClient } from './openmrs-admin-client.js';

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
