import { describe, expect, it } from 'vitest';

import { createMemoryManifestStore, type SimulationManifest } from './manifest.js';
import {
  createHttpAdminClient,
  importGeneratedDocuments,
  PURGE_OBSERVATION_PAGE_LIMIT,
} from './openmrs-admin-client.js';
import {
  APPOINTMENT_LIST_FROM_DATE,
  APPOINTMENT_LIST_TO_DATE,
  resourceIdFromKey,
  WORKLOAD_IDEMPOTENCY_SYSTEM,
} from './workload-plan.js';

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

  it('treats FHIR identifier search HTTP 400 as a miss', async () => {
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: () => Promise.resolve(new Response('', { status: 400 })),
    });

    await expect(client.findByIdempotencyKey('emr-webmcp:run:observation:0')).resolves.toBeUndefined();
  });
});

describe('HTTP appointment create and lookup', () => {
  const appointmentKey = 'emr-webmcp:run:appointment:0';
  const plannedId = resourceIdFromKey(appointmentKey);

  function appointmentContextFetch(handler: typeof fetch): typeof fetch {
    const fetchImpl: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (url.includes('/ws/rest/v1/location') && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ results: [{ uuid: 'loc-1' }] })));
      }
      if (url.includes('/ws/rest/v1/appointmentService/all/default') && method === 'GET') {
        return Promise.resolve(
          new Response(JSON.stringify([{ uuid: 'svc-1', name: 'General Consultation' }])),
        );
      }
      return handler(input, init);
    };
    return fetchImpl;
  }

  it('posts the O3 AppointmentRequest to the same /appointments family as list', async () => {
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: appointmentContextFetch((input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? 'GET';
        expect(method).toBe('POST');
        expect(url).toBe('http://openmrs.test/ws/rest/v1/appointments');
        expect(init?.headers).toEqual(
          expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        );
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
        expect(body).toEqual({
          patientUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
          serviceUuid: 'svc-1',
          locationUuid: 'loc-1',
          startDateTime: '2026-09-01T09:00:00.000Z',
          endDateTime: '2026-09-01T09:30:00.000Z',
          status: 'Scheduled',
          appointmentKind: 'Scheduled',
          comments: appointmentKey,
        });
        return Promise.resolve(new Response(JSON.stringify({ uuid: 'created-appt' }), { status: 201 }));
      }),
    });

    await expect(
      client.createAppointment({
        idempotencyKey: appointmentKey,
        patientId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
        plannedResourceId: plannedId,
        start: '2026-09-01T09:00:00.000Z',
        status: 'scheduled',
      }),
    ).resolves.toEqual({
      kind: 'appointment',
      id: 'created-appt',
      idempotencyKey: appointmentKey,
      patientId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
    });
  });

  it('maps plan statuses onto the appointments module enum', async () => {
    const expected: Record<string, string> = {
      'checked-in': 'CheckedIn',
      completed: 'Completed',
      cancelled: 'Cancelled',
    };
    const seen: string[] = [];
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: appointmentContextFetch((input, init) => {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { status?: string };
        if (typeof body.status === 'string') {
          seen.push(body.status);
        }
        return Promise.resolve(new Response(JSON.stringify({ uuid: `appt-${seen.length}` }), { status: 200 }));
      }),
    });

    for (const status of Object.keys(expected)) {
      await client.createAppointment({
        idempotencyKey: `emr-webmcp:run:appointment:${status}`,
        patientId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
        plannedResourceId: plannedId,
        start: '2026-09-01T09:00:00.000Z',
        status,
      });
    }
    expect(seen).toEqual(Object.values(expected));
  });

  it('defines a synthetic service when the clinic has none', async () => {
    const posts: string[] = [];
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? 'GET';
        if (url.includes('/ws/rest/v1/location') && method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ results: [{ uuid: 'loc-1' }] })));
        }
        if (url.includes('/appointmentService/all/default') && method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify([])));
        }
        if (url.endsWith('/ws/rest/v1/appointmentService') && method === 'POST') {
          const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { name?: string };
          expect(body.name).toBe('General Consultation');
          posts.push('service');
          return Promise.resolve(new Response(JSON.stringify({ uuid: 'svc-new' }), { status: 200 }));
        }
        if (url.endsWith('/ws/rest/v1/appointments') && method === 'POST') {
          const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { serviceUuid?: string };
          expect(body.serviceUuid).toBe('svc-new');
          posts.push('appointment');
          return Promise.resolve(new Response(JSON.stringify({ uuid: 'appt-1' }), { status: 200 }));
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });

    await client.createAppointment({
      idempotencyKey: appointmentKey,
      patientId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
      plannedResourceId: plannedId,
      start: '2026-09-01T09:00:00.000Z',
      status: 'scheduled',
    });
    expect(posts).toEqual(['service', 'appointment']);
  });

  it('looks up a seeded appointment on GET /appointments/{uuid}', async () => {
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        expect(init?.method ?? 'GET').toBe('GET');
        expect(url).toBe(`http://openmrs.test/ws/rest/v1/appointments/${plannedId}`);
        return Promise.resolve(new Response(JSON.stringify({ uuid: plannedId, comments: appointmentKey })));
      },
    });

    await expect(client.findByIdempotencyKey(appointmentKey)).resolves.toEqual({
      kind: 'appointment',
      id: plannedId,
      idempotencyKey: appointmentKey,
      patientId: '',
    });
  });

  it('looks up a seeded appointment from the list window by comments', async () => {
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith(`/ws/rest/v1/appointments/${plannedId}`)) {
          return Promise.resolve(new Response('', { status: 404 }));
        }
        const parsed = new URL(url);
        expect(parsed.pathname).toBe('/ws/rest/v1/appointments');
        expect(parsed.searchParams.get('fromDate')).toBe(APPOINTMENT_LIST_FROM_DATE);
        expect(parsed.searchParams.get('toDate')).toBe(APPOINTMENT_LIST_TO_DATE);
        return Promise.resolve(
          new Response(JSON.stringify([{ uuid: 'live-appt', comments: appointmentKey }])),
        );
      },
    });

    await expect(client.findByIdempotencyKey(appointmentKey)).resolves.toEqual({
      kind: 'appointment',
      id: 'live-appt',
      idempotencyKey: appointmentKey,
      patientId: '',
    });
  });

  it('throws 400/404/422 from appointment create so the seeder can swallow a partial clinic', async () => {
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: appointmentContextFetch(() => Promise.resolve(new Response('', { status: 422 }))),
    });

    await expect(
      client.createAppointment({
        idempotencyKey: appointmentKey,
        patientId: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
        plannedResourceId: plannedId,
        start: '2026-09-01T09:00:00.000Z',
        status: 'scheduled',
      }),
    ).rejects.toEqual(expect.objectContaining({ name: 'OpenMrsAdminError', status: 422 }));
  });
});

describe('import Patient via idgen', () => {
  it('mints an OpenMRS ID and posts the Patient from a transaction bundle', async () => {
    const fetchImpl: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (url.includes('patientidentifiertype')) {
        return Promise.resolve(
          new Response(JSON.stringify({ results: [{ display: 'OpenMRS ID', uuid: 'type-1' }] })),
        );
      }
      if (url.includes('identifiersource') && method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ results: [{ uuid: 'src-1' }] })));
      }
      if (url.includes('/location')) {
        return Promise.resolve(new Response(JSON.stringify({ results: [{ uuid: 'loc-1' }] })));
      }
      if (url.includes('/identifier') && method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ identifier: '10000A' }), { status: 201 }));
      }
      if (url.endsWith('/ws/fhir2/R4/Patient') && method === 'POST') {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          identifier?: Array<{ value?: string; type?: { coding?: Array<{ code?: string }> } }>;
        };
        expect(body.identifier?.[0]?.value).toBe('10000A');
        expect(body.identifier?.[0]?.type?.coding?.[0]?.code).toBe('type-1');
        return Promise.resolve(
          new Response(JSON.stringify({ resourceType: 'Patient', id: 'created-1' }), { status: 201 }),
        );
      }
      throw new Error(`unexpected ${method} ${url}`);
    };

    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl,
    });

    await expect(
      client.importDocument({
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [{ resource: { resourceType: 'Patient', gender: 'male' } }],
      }),
    ).resolves.toBe('imported');
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

describe('purgeSyntheticObservations', () => {
  function syntheticBundle(ids: string[], next?: string): Record<string, unknown> {
    return {
      resourceType: 'Bundle',
      type: 'searchset',
      total: ids.length,
      entry: ids.map((id) => ({
        resource: {
          resourceType: 'Observation',
          id,
          identifier: [{ system: WORKLOAD_IDEMPOTENCY_SYSTEM, value: `emr-webmcp:run:observation:${id}` }],
        },
      })),
      ...(next === undefined ? {} : { link: [{ relation: 'next', url: next }] }),
    };
  }

  it('collects every page before deleting so offset pagination cannot skip rows', async () => {
    const deleted: string[] = [];
    const methods: string[] = [];
    const pages = [
      syntheticBundle(['obs-0', 'obs-1'], '/ws/fhir2/R4/Observation?_count=2&_getpagesoffset=2'),
      syntheticBundle(['obs-2', 'obs-3'], '/ws/fhir2/R4/Observation?_count=2&_getpagesoffset=4'),
      syntheticBundle(['obs-4']),
    ];
    let gets = 0;
    let fetchError = '';

    const fetchImpl: typeof fetch = (input, init) => {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? 'GET';
        methods.push(`${method} ${url}`);
        if (method === 'GET' && url.includes('/Observation')) {
          const body = pages[gets] ?? { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] };
          gets += 1;
          return Promise.resolve(new Response(JSON.stringify(body)));
        }
        if (method === 'DELETE' && url.includes('/Observation/')) {
          deleted.push(url.slice(url.lastIndexOf('/') + 1));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ unexpected: url }), { status: 200 }));
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
        return Promise.resolve(new Response(JSON.stringify({ fetchError }), { status: 200 }));
      }
    };

    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl,
    });

    await expect(client.purgeSyntheticObservations()).resolves.toEqual({ deleted: 5, scanned: 5 });
    expect(deleted.sort()).toEqual(['obs-0', 'obs-1', 'obs-2', 'obs-3', 'obs-4']);
    expect(methods.filter((row) => row.startsWith('GET '))).toHaveLength(3);
    expect(methods.filter((row) => row.startsWith('DELETE '))).toHaveLength(5);
    expect(fetchError).toBe('');
  });

  it('treats DELETE 404 as an idempotent success', async () => {
    const fetchImpl: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(syntheticBundle(['gone-1'])), { status: 200 }));
      }
      if (method === 'DELETE') {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      throw new Error(`unexpected ${method} ${url}`);
    };

    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl,
    });

    await expect(client.purgeSyntheticObservations()).resolves.toEqual({ deleted: 1, scanned: 1 });
  });

  it('throws when more observation pages remain after the scan cap', async () => {
    let gets = 0;
    const fetchImpl: typeof fetch = (_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        gets += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(syntheticBundle(['obs-cap'], '/ws/fhir2/R4/Observation?_getpagesoffset=1')),
          ),
        );
      }
      throw new Error(`unexpected ${method}`);
    };

    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl,
    });

    await expect(client.purgeSyntheticObservations()).rejects.toEqual(
      expect.objectContaining({ name: 'OpenMrsAdminError', status: 0, code: 'purge-truncated' }),
    );
    expect(gets).toBe(PURGE_OBSERVATION_PAGE_LIMIT);
  });

  it('does not treat a collection GET 400 as an empty purge', async () => {
    const client = createHttpAdminClient({
      baseUrl: 'http://openmrs.test',
      username: 'admin',
      password: 'secret',
      fetchImpl: () => Promise.resolve(new Response('bad sort', { status: 400 })),
    });

    await expect(client.purgeSyntheticObservations()).rejects.toEqual(
      expect.objectContaining({ name: 'OpenMrsAdminError', status: 400 }),
    );
  });
});

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
      client,
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
