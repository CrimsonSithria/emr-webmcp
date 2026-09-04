import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProfile, type ProfileId } from './profile-schema.js';
import { createFsManifestStore, type ManifestStore } from './manifest.js';
import {
  APPOINTMENT_LIST_FROM_DATE,
  APPOINTMENT_LIST_TO_DATE,
  resourceIdFromKey,
  WORKLOAD_IDEMPOTENCY_SYSTEM,
} from './workload-plan.js';

export const PURGE_OBSERVATION_PAGE_LIMIT = 50;

const APPOINTMENTS_PATH = '/ws/rest/v1/appointments';
const APPOINTMENT_SERVICE_PATH = '/ws/rest/v1/appointmentService';
const APPOINTMENT_SLOT_MS = 30 * 60_000;

export class OpenMrsAdminError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = 'OpenMrsAdminError';
    this.status = status;
    this.code = code;
  }
}

export type SeededKind = 'appointment' | 'followup' | 'observation' | 'edge';

export type SeededRecord = {
  kind: SeededKind;
  id: string;
  idempotencyKey: string;
  patientId: string;
};

export type CreateAppointmentInput = {
  idempotencyKey: string;
  patientId: string;
  start: string;
  status: string;
  plannedResourceId: string;
};

export type CreateObservationInput = {
  idempotencyKey: string;
  patientId: string;
  plannedResourceId: string;
  interpretation: string;
  unlatched: boolean;
  loincCode: string;
  displayName: string;
  unit: string;
  value: number;
  effectiveDateTime: string;
};

export type CreateFollowupInput = {
  idempotencyKey: string;
  patientId: string;
  plannedResourceId: string;
  status: string;
  overdue: boolean;
  sourceReference?: string;
  correlationRationale?: string;
};

export type CreateEdgeInput = {
  idempotencyKey: string;
  patientId: string;
  plannedResourceId: string;
  scenario: 'duplicate-idempotency' | 'stale-context';
  duplicateTargetKey?: string;
  sourceReference?: string;
};

export type OpenMrsAdminClient = {
  findByIdempotencyKey(key: string): Promise<SeededRecord | undefined>;
  createAppointment(input: CreateAppointmentInput): Promise<SeededRecord>;
  createObservation(input: CreateObservationInput): Promise<SeededRecord>;
  createFollowup(input: CreateFollowupInput): Promise<SeededRecord>;
  createEdgeCase(input: CreateEdgeInput): Promise<SeededRecord>;
  importDocument(document: unknown): Promise<'imported' | 'rejected'>;
  listPatientIds(): Promise<string[]>;
  purgeSyntheticObservations(): Promise<{ deleted: number; scanned: number }>;
};

export { WORKLOAD_IDEMPOTENCY_SYSTEM };

export type MemoryAdminClient = OpenMrsAdminClient & {
  readonly createCalls: number;
  snapshotCounts(): {
    appointments: number;
    followUps: number;
    observations: number;
    edgeCases: number;
  };
};

export type OpenMrsAdminEnv = {
  OPENMRS_BASE_URL?: string;
  OPENMRS_USERNAME?: string;
  OPENMRS_PASSWORD?: string;
};

type StoredRecord = SeededRecord;

export function createMemoryAdminClient(): MemoryAdminClient {
  const byKey = new Map<string, StoredRecord>();
  const state = { createCalls: 0 };

  const insert = (record: StoredRecord): StoredRecord => {
    const existing = byKey.get(record.idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }
    state.createCalls += 1;
    byKey.set(record.idempotencyKey, record);
    return record;
  };

  return {
    get createCalls() {
      return state.createCalls;
    },
    snapshotCounts() {
      const counts = { appointments: 0, followUps: 0, observations: 0, edgeCases: 0 };
      for (const record of byKey.values()) {
        if (record.kind === 'appointment') {
          counts.appointments += 1;
        } else if (record.kind === 'followup') {
          counts.followUps += 1;
        } else if (record.kind === 'observation') {
          counts.observations += 1;
        } else {
          counts.edgeCases += 1;
        }
      }
      return counts;
    },
    findByIdempotencyKey(key) {
      return Promise.resolve(byKey.get(key));
    },
    createAppointment(input) {
      return Promise.resolve(
        insert({
          kind: 'appointment',
          id: input.plannedResourceId,
          idempotencyKey: input.idempotencyKey,
          patientId: input.patientId,
        }),
      );
    },
    createObservation(input) {
      return Promise.resolve(
        insert({
          kind: 'observation',
          id: input.plannedResourceId,
          idempotencyKey: input.idempotencyKey,
          patientId: input.patientId,
        }),
      );
    },
    createFollowup(input) {
      return Promise.resolve(
        insert({
          kind: 'followup',
          id: input.plannedResourceId,
          idempotencyKey: input.idempotencyKey,
          patientId: input.patientId,
        }),
      );
    },
    createEdgeCase(input) {
      return Promise.resolve(
        insert({
          kind: 'edge',
          id: input.plannedResourceId,
          idempotencyKey: input.idempotencyKey,
          patientId: input.patientId,
        }),
      );
    },
    importDocument() {
      return Promise.resolve('imported');
    },
    listPatientIds() {
      return Promise.resolve([]);
    },
    purgeSyntheticObservations() {
      let deleted = 0;
      for (const [key, record] of byKey.entries()) {
        if (record.kind === 'observation') {
          byKey.delete(key);
          deleted += 1;
        }
      }
      return Promise.resolve({ deleted, scanned: deleted });
    },
  };
}

export function adminErrorFromStatus(status: number): OpenMrsAdminError {
  if (status === 401 || status === 403) {
    return new OpenMrsAdminError(status, 'unauthorized');
  }
  if (status === 404) {
    return new OpenMrsAdminError(status, 'not-found');
  }
  if (status === 409) {
    return new OpenMrsAdminError(status, 'conflict');
  }
  if (status === 400) {
    return new OpenMrsAdminError(status, 'invalid-input');
  }
  if (status === 0) {
    return new OpenMrsAdminError(status, 'missing-config');
  }
  return new OpenMrsAdminError(status, 'upstream');
}

export function createOpenMrsAdminClientFromEnv(
  env: OpenMrsAdminEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): OpenMrsAdminClient {
  const baseUrl = env.OPENMRS_BASE_URL?.replace(/\/$/u, '');
  const username = env.OPENMRS_USERNAME;
  const password = env.OPENMRS_PASSWORD;
  if (baseUrl === undefined || baseUrl === '' || username === undefined || username === '' || password === undefined || password === '') {
    throw new OpenMrsAdminError(0, 'missing-config');
  }
  return createHttpAdminClient({ baseUrl, username, password, fetchImpl });
}

export function createHttpAdminClient(options: {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}): OpenMrsAdminClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
  const store = new Map<string, SeededRecord>();

  const request = async (
    method: string,
    resourcePath: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> => {
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${resourcePath}`, {
        method,
        headers: {
          Authorization: authorization,
          Accept: 'application/fhir+json, application/json',
          ...(body === undefined ? {} : { 'Content-Type': contentTypeFor(resourcePath) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new OpenMrsAdminError(0, 'upstream');
    }

    if (response.status === 404) {
      if (method === 'GET' || method === 'DELETE') {
        return { status: 404, data: undefined };
      }
      await response.arrayBuffer().catch(() => undefined);
      throw adminErrorFromStatus(404);
    }
    // OpenMRS FHIR2 identifier searches return 400 for unknown systems.
    if (response.status === 400 && method === 'GET' && resourcePath.includes('identifier=')) {
      return { status: 400, data: undefined };
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = await response.text().catch(() => '');
      const error = adminErrorFromStatus(response.status);
      if (detail.trim() !== '') {
        error.message = `${error.message}: ${detail.slice(0, 400)}`;
      }
      throw error;
    }
    const data: unknown = await response.json().catch(() => undefined);
    return { status: response.status, data };
  };

  const remember = (record: SeededRecord): SeededRecord => {
    store.set(record.idempotencyKey, record);
    return record;
  };

  let importContext: ImportContext | undefined;
  const loadImportContextCached = async (): Promise<ImportContext> => {
    if (importContext !== undefined) {
      return importContext;
    }
    importContext = await loadImportContext(request);
    return importContext;
  };

  let appointmentContext: AppointmentContext | undefined;
  const loadAppointmentContextCached = async (): Promise<AppointmentContext> => {
    if (appointmentContext !== undefined) {
      return appointmentContext;
    }
    appointmentContext = await loadAppointmentContext(request);
    return appointmentContext;
  };

  return {
    async findByIdempotencyKey(key) {
      const cached = store.get(key);
      if (cached !== undefined) {
        return cached;
      }
      if (key.includes(':appointment:')) {
        const appointmentId = await findSeededAppointmentId(request, key);
        if (appointmentId !== undefined) {
          return remember({
            kind: 'appointment',
            id: appointmentId,
            idempotencyKey: key,
            patientId: '',
          });
        }
        return undefined;
      }
      const identifier = `${WORKLOAD_IDEMPOTENCY_SYSTEM}|${key}`;
      const observation = await request(
        'GET',
        `/ws/fhir2/R4/Observation?identifier=${encodeURIComponent(identifier)}&_count=1`,
      );
      const observationId = firstBundleId(observation.data);
      if (observationId !== undefined) {
        return remember({ kind: 'observation', id: observationId, idempotencyKey: key, patientId: '' });
      }
      const carePlan = await request(
        'GET',
        `/ws/fhir2/R4/CarePlan?identifier=${encodeURIComponent(identifier)}&_count=1`,
      );
      const carePlanId = firstBundleId(carePlan.data);
      if (carePlanId !== undefined) {
        const kind = key.includes(':edge:') ? 'edge' : 'followup';
        return remember({ kind, id: carePlanId, idempotencyKey: key, patientId: '' });
      }
      return undefined;
    },
    async createAppointment(input) {
      const context = await loadAppointmentContextCached();
      const created = await request('POST', APPOINTMENTS_PATH, appointmentCreateBody(input, context));
      return remember({
        kind: 'appointment',
        id: createdResourceUuid(created.data) ?? input.plannedResourceId,
        idempotencyKey: input.idempotencyKey,
        patientId: input.patientId,
      });
    },
    async createObservation(input) {
      await request('POST', '/ws/fhir2/R4/Observation', {
        resourceType: 'Observation',
        id: input.plannedResourceId,
        identifier: [{ system: WORKLOAD_IDEMPOTENCY_SYSTEM, value: input.idempotencyKey }],
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'laboratory',
              },
            ],
          },
        ],
        code: {
          coding: [{ system: 'http://loinc.org', code: input.loincCode, display: input.displayName }],
          text: input.displayName,
        },
        subject: { reference: `Patient/${input.patientId}` },
        effectiveDateTime: input.effectiveDateTime,
        valueQuantity: { value: input.value, unit: input.unit },
        interpretation: [{ coding: [{ code: input.interpretation }] }],
      });
      return remember({
        kind: 'observation',
        id: input.plannedResourceId,
        idempotencyKey: input.idempotencyKey,
        patientId: input.patientId,
      });
    },
    async createFollowup(input) {
      await request('POST', '/ws/fhir2/R4/CarePlan', {
        resourceType: 'CarePlan',
        id: input.plannedResourceId,
        identifier: [{ system: WORKLOAD_IDEMPOTENCY_SYSTEM, value: input.idempotencyKey }],
        status: input.status === 'cancelled' ? 'revoked' : input.status === 'completed' ? 'completed' : 'active',
        intent: 'order',
        title: 'Synthetic follow-up',
        description: input.correlationRationale ?? 'Synthetic follow-up',
        subject: { reference: `Patient/${input.patientId}` },
      });
      return remember({
        kind: 'followup',
        id: input.plannedResourceId,
        idempotencyKey: input.idempotencyKey,
        patientId: input.patientId,
      });
    },
    async createEdgeCase(input) {
      await request('POST', '/ws/fhir2/R4/CarePlan', {
        resourceType: 'CarePlan',
        id: input.plannedResourceId,
        identifier: [{ system: WORKLOAD_IDEMPOTENCY_SYSTEM, value: input.idempotencyKey }],
        status: 'active',
        intent: 'order',
        title: 'Synthetic edge case',
        description: input.sourceReference === undefined
          ? input.duplicateTargetKey ?? input.idempotencyKey
          : `Stale context\n[emr-webmcp:v1 source=${input.sourceReference} workflow=lablatch]`,
        subject: { reference: `Patient/${input.patientId}` },
      });
      return remember({
        kind: 'edge',
        id: input.plannedResourceId,
        idempotencyKey: input.idempotencyKey,
        patientId: input.patientId,
      });
    },
    async importDocument(document) {
      try {
        const patient = extractPatientResource(document);
        if (patient === undefined) {
          return 'rejected';
        }
        const context = await loadImportContextCached();
        const generated = await request(
          'POST',
          `/ws/rest/v1/idgen/identifiersource/${context.sourceUuid}/identifier`,
          { comment: 'emr-webmcp-import' },
        );
        const identifier = generatedIdentifier(generated.data);
        if (identifier === undefined) {
          return 'rejected';
        }
        await request('POST', '/ws/fhir2/R4/Patient', withOpenMrsIdentifier(patient, identifier, context));
        return 'imported';
      } catch (error) {
        if (error instanceof OpenMrsAdminError) {
          return 'rejected';
        }
        throw error;
      }
    },
    async listPatientIds() {
      const ids: string[] = [];
      let path: string | undefined = '/ws/fhir2/R4/Patient?_count=50';
      for (let page = 0; page < 20 && path !== undefined; page += 1) {
        const result = await request('GET', path);
        ids.push(...patientIdsFromBundle(result.data));
        path = nextSearchPath(result.data, options.baseUrl);
      }
      return [...new Set(ids)].sort();
    },
    async purgeSyntheticObservations() {
      const ids = new Set<string>();
      let scanned = 0;
      let path: string | undefined =
        `/ws/fhir2/R4/Observation?category=laboratory&_count=100&date=ge${APPOINTMENT_LIST_FROM_DATE.slice(0, 10)}&date=le${APPOINTMENT_LIST_TO_DATE.slice(0, 10)}`;
      for (let page = 0; page < PURGE_OBSERVATION_PAGE_LIMIT && path !== undefined; page += 1) {
        const result = await request('GET', path);
        const pageIds = syntheticObservationIdsFromBundle(result.data);
        scanned += pageIds.length;
        for (const id of pageIds) {
          ids.add(id);
        }
        path = nextSearchPath(result.data, options.baseUrl);
      }
      if (path !== undefined) {
        throw new OpenMrsAdminError(0, 'purge-truncated');
      }
      let deleted = 0;
      for (const id of ids) {
        await request('DELETE', `/ws/fhir2/R4/Observation/${encodeURIComponent(id)}`);
        deleted += 1;
      }
      return { deleted, scanned };
    },
  };
}

type ImportContext = {
  sourceUuid: string;
  typeUuid: string;
  locationUuid: string;
};

type AppointmentContext = {
  serviceUuid: string;
  locationUuid: string;
  serviceTypeUuid?: string;
};

type AdminRequest = (
  method: string,
  resourcePath: string,
  body?: unknown,
) => Promise<{ status: number; data: unknown }>;

function contentTypeFor(resourcePath: string): string {
  return resourcePath.includes('/ws/fhir2/') ? 'application/fhir+json' : 'application/json';
}

function asResultRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object');
  }
  if (data === null || typeof data !== 'object') {
    return [];
  }
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object');
}

function rowUuid(row: Record<string, unknown>): string | undefined {
  return typeof row.uuid === 'string' && row.uuid !== '' ? row.uuid : undefined;
}

function firstRowUuid(rows: Array<Record<string, unknown>>): string | undefined {
  const [first] = rows;
  return first === undefined ? undefined : rowUuid(first);
}

function asRecord(data: unknown): Record<string, unknown> | undefined {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}

function createdResourceUuid(data: unknown): string | undefined {
  const record = asRecord(data);
  return record === undefined ? undefined : rowUuid(record);
}

function openMrsAppointmentStatus(status: string): string {
  const key = status.trim().toLowerCase().replace(/[_\s]/g, '-');
  switch (key) {
    case 'checkedin':
    case 'checked-in':
    case 'waiting':
      return 'CheckedIn';
    case 'completed':
      return 'Completed';
    case 'cancelled':
    case 'canceled':
      return 'Cancelled';
    case 'missed':
      return 'Missed';
    default:
      return 'Scheduled';
  }
}

function appointmentEndDateTime(start: string): string {
  const startMs = Date.parse(start);
  return new Date((Number.isFinite(startMs) ? startMs : Date.now()) + APPOINTMENT_SLOT_MS).toISOString();
}

function appointmentCreateBody(
  input: CreateAppointmentInput,
  context: AppointmentContext,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    patientUuid: input.patientId,
    serviceUuid: context.serviceUuid,
    locationUuid: context.locationUuid,
    startDateTime: input.start,
    endDateTime: appointmentEndDateTime(input.start),
    status: openMrsAppointmentStatus(input.status),
    appointmentKind: 'Scheduled',
    comments: input.idempotencyKey,
  };
  if (context.serviceTypeUuid !== undefined) {
    body.serviceTypeUuid = context.serviceTypeUuid;
  }
  return body;
}

function firstServiceTypeUuid(service: Record<string, unknown>): string | undefined {
  const types = service.serviceTypes;
  if (!Array.isArray(types)) {
    return undefined;
  }
  for (const type of types) {
    if (type !== null && typeof type === 'object') {
      const uuid = rowUuid(type as Record<string, unknown>);
      if (uuid !== undefined) {
        return uuid;
      }
    }
  }
  return undefined;
}

async function loadAppointmentContext(request: AdminRequest): Promise<AppointmentContext> {
  const locations = asResultRows((await request('GET', '/ws/rest/v1/location?limit=1')).data);
  const locationUuid = firstRowUuid(locations);
  if (locationUuid === undefined) {
    throw new OpenMrsAdminError(400, 'invalid-input');
  }

  const listed = asResultRows((await request('GET', `${APPOINTMENT_SERVICE_PATH}/all/default`)).data);
  let service = listed[0];
  if (service === undefined) {
    const created = await request('POST', APPOINTMENT_SERVICE_PATH, {
      name: 'General Consultation',
      startTime: '08:00:00',
      endTime: '18:00:00',
      durationMins: 30,
      locationUuid,
      color: '#0072c3',
    });
    service = asRecord(created.data);
  }
  const serviceUuid = service === undefined ? undefined : rowUuid(service);
  if (serviceUuid === undefined) {
    throw new OpenMrsAdminError(400, 'invalid-input');
  }

  const context: AppointmentContext = { serviceUuid, locationUuid };
  const serviceTypeUuid = service === undefined ? undefined : firstServiceTypeUuid(service);
  if (serviceTypeUuid !== undefined) {
    context.serviceTypeUuid = serviceTypeUuid;
  }
  return context;
}

function appointmentComments(row: Record<string, unknown>): string | undefined {
  if (typeof row.comments === 'string' && row.comments !== '') {
    return row.comments;
  }
  return typeof row.comment === 'string' && row.comment !== '' ? row.comment : undefined;
}

function matchSeededAppointment(
  data: unknown,
  key: string,
  plannedId: string,
): string | undefined {
  for (const row of asResultRows(data)) {
    const uuid = rowUuid(row);
    if (uuid === plannedId || appointmentComments(row) === key) {
      return uuid ?? plannedId;
    }
  }
  return undefined;
}

async function findSeededAppointmentId(request: AdminRequest, key: string): Promise<string | undefined> {
  const plannedId = resourceIdFromKey(key);
  const byId = await request('GET', `${APPOINTMENTS_PATH}/${encodeURIComponent(plannedId)}`);
  const byIdUuid = createdResourceUuid(byId.data);
  if (byId.status !== 404 && byIdUuid !== undefined) {
    return byIdUuid;
  }
  const listed = await request(
    'GET',
    `${APPOINTMENTS_PATH}?fromDate=${encodeURIComponent(APPOINTMENT_LIST_FROM_DATE)}&toDate=${encodeURIComponent(APPOINTMENT_LIST_TO_DATE)}`,
  );
  return matchSeededAppointment(listed.data, key, plannedId);
}

async function loadImportContext(request: AdminRequest): Promise<ImportContext> {
  const types = asResultRows((await request('GET', '/ws/rest/v1/patientidentifiertype')).data);
  const openMrsId = types.find((row) => row.display === 'OpenMRS ID' || row.name === 'OpenMRS ID');
  const typeUuid = openMrsId !== undefined ? rowUuid(openMrsId) : undefined;
  const sources = asResultRows((await request('GET', '/ws/rest/v1/idgen/identifiersource')).data);
  const sourceUuid = firstRowUuid(sources);
  const locations = asResultRows((await request('GET', '/ws/rest/v1/location?limit=1')).data);
  const locationUuid = firstRowUuid(locations);
  if (typeUuid === undefined || sourceUuid === undefined || locationUuid === undefined) {
    throw new OpenMrsAdminError(400, 'invalid-input');
  }
  return { sourceUuid, typeUuid, locationUuid };
}

function generatedIdentifier(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const identifier = (data as { identifier?: unknown }).identifier;
  return typeof identifier === 'string' && identifier !== '' ? identifier : undefined;
}

function extractPatientResource(document: unknown): Record<string, unknown> | undefined {
  if (document === null || typeof document !== 'object') {
    return undefined;
  }
  const record = document as { resourceType?: unknown; entry?: unknown };
  if (record.resourceType === 'Patient') {
    return { ...record };
  }
  if (record.resourceType !== 'Bundle' || !Array.isArray(record.entry)) {
    return undefined;
  }
  for (const entry of record.entry) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const resource = (entry as { resource?: unknown }).resource;
    if (resource !== null && typeof resource === 'object' && (resource as { resourceType?: unknown }).resourceType === 'Patient') {
      return { ...(resource as Record<string, unknown>) };
    }
  }
  return undefined;
}

function withOpenMrsIdentifier(
  patient: Record<string, unknown>,
  identifier: string,
  context: ImportContext,
): Record<string, unknown> {
  return {
    ...patient,
    identifier: [
      {
        use: 'official',
        type: { coding: [{ code: context.typeUuid }], text: 'OpenMRS ID' },
        extension: [
          {
            url: 'http://fhir.openmrs.org/ext/patient/identifier#location',
            valueReference: { reference: `Location/${context.locationUuid}`, type: 'Location' },
          },
        ],
        value: identifier,
      },
    ],
  };
}

function patientIdsFromBundle(data: unknown): string[] {
  if (data === null || typeof data !== 'object') {
    return [];
  }
  const entry = (data as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) {
    return [];
  }
  const ids: string[] = [];
  for (const item of entry) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const resource = (item as { resource?: { resourceType?: unknown; id?: unknown } }).resource;
    if (resource?.resourceType === 'Patient' && typeof resource.id === 'string' && resource.id !== '') {
      ids.push(resource.id);
    }
  }
  return ids;
}

function nextSearchPath(data: unknown, baseUrl: string): string | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const links = (data as { link?: unknown }).link;
  if (!Array.isArray(links)) {
    return undefined;
  }
  for (const link of links) {
    if (link === null || typeof link !== 'object') {
      continue;
    }
    const rel = (link as { relation?: unknown; url?: unknown }).relation;
    const url = (link as { relation?: unknown; url?: unknown }).url;
    if (rel !== 'next' || typeof url !== 'string' || url === '') {
      continue;
    }
    if (url.startsWith('/')) {
      return url;
    }
    if (url.startsWith(baseUrl)) {
      return url.slice(baseUrl.length);
    }
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function firstBundleId(data: unknown): string | undefined {
  if (data === null || typeof data !== 'object') {
    return undefined;
  }
  const record = data as {
    total?: unknown;
    entry?: Array<{ resource?: { id?: unknown; resourceType?: unknown } }>;
  };
  if (record.total === 0) {
    return undefined;
  }
  const resource = record.entry?.[0]?.resource;
  if (
    resource !== undefined &&
    (resource.resourceType === 'Observation' || resource.resourceType === 'CarePlan') &&
    typeof resource.id === 'string' &&
    resource.id !== ''
  ) {
    return resource.id;
  }
  return undefined;
}

function syntheticObservationIdsFromBundle(data: unknown): string[] {
  if (data === null || typeof data !== 'object') {
    return [];
  }
  const entry = (data as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) {
    return [];
  }
  const ids: string[] = [];
  for (const item of entry) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const resource = (item as { resource?: Record<string, unknown> }).resource;
    if (resource?.resourceType !== 'Observation' || typeof resource.id !== 'string' || resource.id === '') {
      continue;
    }
    const identifiers = resource.identifier;
    if (!Array.isArray(identifiers)) {
      continue;
    }
    for (const identifier of identifiers) {
      if (identifier === null || typeof identifier !== 'object') {
        continue;
      }
      const system = (identifier as { system?: unknown }).system;
      if (system === WORKLOAD_IDEMPOTENCY_SYSTEM) {
        ids.push(resource.id);
        break;
      }
    }
  }
  return ids;
}

function repoRootFromModule(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

function isProfileId(value: string | undefined): value is ProfileId {
  return value === 'smoke' || value === 'demo' || value === 'clinic';
}

async function readFhirDocuments(outputDir: string): Promise<unknown[]> {
  const documents: unknown[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name === 'manifest.json' || !entry.name.endsWith('.json')) {
        continue;
      }
      documents.push(JSON.parse(await readFile(fullPath, 'utf8')) as unknown);
    }
  }

  await walk(outputDir);
  return documents;
}

async function main(argv: string[]): Promise<void> {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const profileId = args[0];
  if (!isProfileId(profileId)) {
    throw new OpenMrsAdminError(0, 'usage');
  }

  let client: OpenMrsAdminClient;
  try {
    client = createOpenMrsAdminClientFromEnv();
  } catch (error) {
    if (error instanceof OpenMrsAdminError && error.code === 'missing-config') {
      process.stdout.write('import: skip (OPENMRS_BASE_URL or credentials unset)\n');
      return;
    }
    throw error;
  }

  const repoRoot = repoRootFromModule();
  const profile = loadProfile(profileId);
  const store = createFsManifestStore(repoRoot);
  const manifest = await store.readManifest(profile.outputDir);
  if (manifest === undefined) {
    process.stdout.write('import: skip (no manifest)\n');
    return;
  }

  const outputDir = path.resolve(repoRoot, profile.outputDir);
  const documents = await readFhirDocuments(outputDir);
  const { imported, rejected } = await importGeneratedDocuments({
    client,
    store,
    outputDir: profile.outputDir,
    documents,
  });
  process.stdout.write(`import imported=${imported} rejected=${rejected}\n`);
}

export async function importGeneratedDocuments(options: {
  client: Pick<OpenMrsAdminClient, 'importDocument'>;
  store: ManifestStore;
  outputDir: string;
  documents: readonly unknown[];
}): Promise<{ imported: number; rejected: number }> {
  let imported = 0;
  let rejected = 0;
  for (const document of options.documents) {
    const result = await options.client.importDocument(document);
    if (result === 'imported') {
      imported += 1;
    } else {
      rejected += 1;
    }
  }

  const manifest = await options.store.readManifest(options.outputDir);
  if (manifest !== undefined) {
    await options.store.writeManifest(options.outputDir, {
      ...manifest,
      counts: {
        ...manifest.counts,
        imported,
        rejected,
      },
    });
  }

  return { imported, rejected };
}

const invokedAsCli =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  await main(process.argv.slice(2));
}
