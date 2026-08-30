import { AdapterError } from '@emr-webmcp/core';

import {
  bundleResources,
  readNextLink,
  type FhirAllergyIntolerance,
  type FhirCarePlan,
  type FhirCondition,
  type FhirMedicationRequest,
  type FhirObservation,
} from './fhir-types.js';
import {
  restResults,
  type RestAppointment,
  type RestPatient,
  type RestProvider,
  type RestRole,
} from './rest-types.js';

export type OpenmrsFetch = (
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
) => Promise<{ status: number; data: unknown }>;

export const OPENMRS_PATHS = {
  patients: '/ws/rest/v1/patient',
  appointments: '/ws/rest/v1/appointment',
  observations: '/ws/fhir2/R4/Observation',
  conditions: '/ws/fhir2/R4/Condition',
  allergies: '/ws/fhir2/R4/AllergyIntolerance',
  medications: '/ws/fhir2/R4/MedicationRequest',
  carePlans: '/ws/rest/v1/tasks/careplan',
  providers: '/ws/rest/v1/provider',
  roles: '/ws/rest/v1/role',
} as const;

const REMOTE_PAGE_SIZE = 50;
const MAX_REMOTE_PAGES = 10;
const UPSTREAM_MESSAGE = 'Upstream request failed';

export class OpenmrsClient {
  constructor(private readonly fetch: OpenmrsFetch) {}

  searchPatients(query: string, limit: number, signal?: AbortSignal): Promise<RestPatient[]> {
    return this.collectRest<RestPatient>(
      withQuery(OPENMRS_PATHS.patients, {
        q: query,
        limit: String(limit),
        v: 'default',
      }),
      signal,
    );
  }

  getPatient(id: string, signal?: AbortSignal): Promise<RestPatient> {
    return this.request<RestPatient>(
      withQuery(`${OPENMRS_PATHS.patients}/${encodeURIComponent(id)}`, { v: 'default' }),
      fetchInit(optionalSignal(signal)),
    );
  }

  listAppointments(fromDate: string, toDate: string, signal?: AbortSignal): Promise<RestAppointment[]> {
    return this.requestList<RestAppointment>(
      withQuery(OPENMRS_PATHS.appointments, { fromDate, toDate }),
      restResults,
      signal,
    );
  }

  searchObservations(input: {
    category: string;
    patientId?: string;
    signal?: AbortSignal;
  }): Promise<FhirObservation[]> {
    const params: Record<string, string> = {
      category: input.category,
      _count: String(REMOTE_PAGE_SIZE),
    };
    if (input.patientId !== undefined) {
      params.patient = input.patientId;
    }
    return this.collectFhir<FhirObservation>(
      withQuery(OPENMRS_PATHS.observations, params),
      input.signal,
    );
  }

  getObservation(id: string, signal?: AbortSignal): Promise<FhirObservation> {
    return this.request<FhirObservation>(
      `${OPENMRS_PATHS.observations}/${encodeURIComponent(id)}`,
      fetchInit(optionalSignal(signal)),
    );
  }

  searchConditions(patientId: string, signal?: AbortSignal): Promise<FhirCondition[]> {
    return this.collectFhir<FhirCondition>(
      withQuery(OPENMRS_PATHS.conditions, { patient: patientId, _count: String(REMOTE_PAGE_SIZE) }),
      signal,
    );
  }

  searchAllergies(patientId: string, signal?: AbortSignal): Promise<FhirAllergyIntolerance[]> {
    return this.collectFhir<FhirAllergyIntolerance>(
      withQuery(OPENMRS_PATHS.allergies, { patient: patientId, _count: String(REMOTE_PAGE_SIZE) }),
      signal,
    );
  }

  searchMedications(patientId: string, signal?: AbortSignal): Promise<FhirMedicationRequest[]> {
    return this.collectFhir<FhirMedicationRequest>(
      withQuery(OPENMRS_PATHS.medications, { patient: patientId, _count: String(REMOTE_PAGE_SIZE) }),
      signal,
    );
  }

  listCarePlans(patientId?: string, signal?: AbortSignal): Promise<FhirCarePlan[]> {
    const params: Record<string, string> = {};
    if (patientId !== undefined) {
      params.patient = patientId;
    }
    return this.collectFhir<FhirCarePlan>(withQuery(OPENMRS_PATHS.carePlans, params), signal);
  }

  createCarePlan(body: FhirCarePlan, signal?: AbortSignal): Promise<FhirCarePlan> {
    return this.request<FhirCarePlan>(
      OPENMRS_PATHS.carePlans,
      fetchInit({ method: 'POST', body, ...optionalSignal(signal) }),
    );
  }

  searchProviders(query: string, limit: number, signal?: AbortSignal): Promise<RestProvider[]> {
    return this.collectRest<RestProvider>(
      withQuery(OPENMRS_PATHS.providers, {
        q: query,
        limit: String(limit),
        v: 'default',
      }),
      signal,
    );
  }

  searchRoles(query: string, limit: number, signal?: AbortSignal): Promise<RestRole[]> {
    return this.collectRest<RestRole>(
      withQuery(OPENMRS_PATHS.roles, {
        q: query,
        limit: String(limit),
        v: 'default',
      }),
      signal,
    );
  }

  private collectFhir<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    return this.collect(path, bundleResources<T>, signal);
  }

  private collectRest<T>(path: string, signal?: AbortSignal): Promise<T[]> {
    return this.collect(path, restResults<T>, signal);
  }

  private async requestList<T>(
    path: string,
    extract: (data: unknown) => T[],
    signal?: AbortSignal,
  ): Promise<T[]> {
    const data = await this.request<unknown>(path, fetchInit(optionalSignal(signal)));
    return extract(data);
  }

  private async collect<T>(
    firstPath: string,
    extract: (data: unknown) => T[],
    signal?: AbortSignal,
  ): Promise<T[]> {
    const collected: T[] = [];
    let path: string | undefined = firstPath;
    let pages = 0;
    while (path !== undefined && pages < MAX_REMOTE_PAGES) {
      const data = await this.request<unknown>(path, fetchInit(optionalSignal(signal)));
      collected.push(...extract(data));
      path = readNextLink(data);
      pages += 1;
    }
    return collected;
  }

  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<T> {
    let response: { status: number; data: unknown };
    try {
      response = await this.fetch(path, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new AdapterError('upstream', UPSTREAM_MESSAGE, true);
    }

    return interpretResponse<T>(response);
  }
}

function fetchInit(input: {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}): { method?: string; body?: unknown; signal?: AbortSignal } | undefined {
  const init: { method?: string; body?: unknown; signal?: AbortSignal } = {};
  if (input.method !== undefined) {
    init.method = input.method;
  }
  if (input.body !== undefined) {
    init.body = input.body;
  }
  if (input.signal !== undefined) {
    init.signal = input.signal;
  }
  return init.method === undefined && init.body === undefined && init.signal === undefined
    ? undefined
    : init;
}

function optionalSignal(signal?: AbortSignal): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function interpretResponse<T>(response: { status: number; data: unknown }): T {
  const { status, data } = response;
  if (status === 401 || status === 403) {
    throw new AdapterError('unauthorized', 'Not authorized.', false);
  }
  if (status === 404) {
    throw new AdapterError('not-found', 'The requested resource was not found.', false);
  }
  if (status === 409) {
    throw new AdapterError('conflict', 'The request conflicts with existing data.', false);
  }
  if (status === 400) {
    throw new AdapterError('invalid-input', 'The request was invalid.', false);
  }
  if (status >= 200 && status < 300) {
    return data as T;
  }
  throw new AdapterError('upstream', UPSTREAM_MESSAGE, true);
}

function withQuery(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  const query = search.toString();
  return query === '' ? path : `${path}?${query}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
