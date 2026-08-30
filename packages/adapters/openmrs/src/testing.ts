import { getResponse, http, HttpResponse, type RequestHandler } from 'msw';

import type { OpenmrsFetch } from './openmrs-adapter.js';

export type OpenmrsMswPatient = {
  uuid: string;
  display: string;
  person: { display: string };
};

export type OpenmrsMswAppointment = {
  uuid: string;
  startDateTime: string;
  status: string;
  patient: { uuid: string; name: string };
  service?: { name: string };
};

export type OpenmrsMswStore = {
  patients: OpenmrsMswPatient[];
  appointments: OpenmrsMswAppointment[];
  observations: Record<string, unknown>[];
  conditions: Record<string, unknown>[];
  allergies: Record<string, unknown>[];
  medications: Record<string, unknown>[];
  carePlans: Record<string, unknown>[];
  providers: Array<{ uuid: string; display: string }>;
  roles: Array<{ uuid: string; display: string }>;
  activePatientId: string | null;
  nextCreatedId: number;
  observationPageSize?: number;
  forceStatus?: number;
  forceBody?: unknown;
};

const PRIORITY_EXTENSION = 'priority';

export function createOpenmrsMswStore(): OpenmrsMswStore {
  const ada = patient('patient-01', 'Ada Lovelace');
  const alan = patient('patient-02', 'Alan Turing');
  const grace = patient('patient-03', 'Grace Hopper');
  const katherine = patient('patient-04', 'Katherine Johnson');
  const dorothy = patient('patient-05', 'Dorothy Vaughan');
  const mary = patient('patient-06', 'Mary Jackson');
  const claude = patient('patient-07', 'Claude Shannon');
  const john = patient('patient-08', 'John von Neumann');
  const barbara = patient('patient-09', 'Barbara Liskov');
  const frances = patient('patient-10', 'Frances Allen');
  const donald = patient('patient-11', 'Donald Knuth');
  const edsger = patient('patient-12', 'Edsger Dijkstra');

  const drChen = { uuid: 'person-dr-chen', display: 'Dr. Chen' };
  const clinicNurse = { uuid: 'role-clinic-nurse', display: 'Clinic nurse' };
  const nurseRivera = { uuid: 'person-nurse-rivera', display: 'Nurse Rivera' };
  const labReviewer = { uuid: 'role-lab-reviewer', display: 'Lab reviewer' };

  return {
    patients: [
      ada,
      alan,
      grace,
      katherine,
      dorothy,
      mary,
      claude,
      john,
      barbara,
      frances,
      donald,
      edsger,
    ],
    activePatientId: ada.uuid,
    nextCreatedId: 1,
    providers: [drChen, nurseRivera],
    roles: [clinicNurse, labReviewer],
    appointments: [
      appointment('appt-01', ada, '2026-09-01T09:00:00.000Z', 'Scheduled', 'Diabetes clinic'),
      appointment('appt-02', alan, '2026-09-01T10:00:00.000Z', 'CheckedIn'),
      appointment('appt-03', grace, '2026-09-03T14:00:00.000Z', 'Completed'),
      appointment('appt-04', katherine, '2026-09-07T11:00:00.000Z', 'Scheduled'),
      appointment('appt-05', dorothy, '2026-08-01T09:00:00.000Z', 'Cancelled'),
      appointment('appt-06', mary, '2026-09-15T09:00:00.000Z', 'Scheduled'),
      appointment('appt-07', john, '2026-09-02T08:30:00.000Z', 'Unknown'),
    ],
    observations: [
      observation({
        id: 'obs-01',
        patient: ada,
        name: 'Potassium',
        value: 5.8,
        unit: 'mmol/L',
        observedAt: '2026-08-30T08:00:00.000Z',
        interpretation: 'H',
        referenceRange: '3.5-5.1',
        category: 'laboratory',
      }),
      observation({
        id: 'obs-02',
        patient: alan,
        name: 'Sodium',
        value: 128,
        unit: 'mmol/L',
        observedAt: '2026-08-29T11:00:00.000Z',
        interpretation: 'L',
        referenceRange: '135-145',
        category: 'laboratory',
      }),
      observation({
        id: 'obs-03',
        patient: grace,
        name: 'Glucose',
        value: 24.0,
        unit: 'mmol/L',
        observedAt: '2026-08-28T16:30:00.000Z',
        interpretation: 'HH',
        referenceRange: '3.9-6.1',
        category: 'laboratory',
      }),
      observation({
        id: 'obs-04',
        patient: katherine,
        name: 'Hemoglobin',
        value: 6.2,
        unit: 'g/dL',
        observedAt: '2026-08-27T09:15:00.000Z',
        interpretation: 'LL',
        referenceRange: '12.0-15.5',
        category: 'laboratory',
      }),
      observation({
        id: 'obs-05',
        patient: ada,
        name: 'Heart rate',
        value: 72,
        unit: '/min',
        observedAt: '2026-08-31T08:00:00.000Z',
        interpretation: 'N',
        referenceRange: '60-100',
        category: 'vital-signs',
      }),
      observation({
        id: 'obs-06',
        patient: dorothy,
        name: 'Platelets',
        observedAt: '2026-08-26T13:00:00.000Z',
        interpretation: 'ABS',
        category: 'laboratory',
      }),
      observation({
        id: 'obs-07',
        patient: mary,
        name: 'White blood cells',
        value: 6.0,
        unit: '10^9/L',
        observedAt: '2026-08-25T10:00:00.000Z',
        interpretation: 'N',
        referenceRange: '4.0-11.0',
        category: 'laboratory',
      }),
      observation({
        id: 'obs-08',
        patient: claude,
        name: 'Creatinine',
        value: 180,
        unit: 'umol/L',
        observedAt: '2026-08-24T15:45:00.000Z',
        interpretation: 'h',
        referenceRange: '45-90',
        category: 'laboratory',
      }),
    ],
    conditions: [
      {
        resourceType: 'Condition',
        id: 'cond-01',
        subject: { reference: `Patient/${ada.uuid}` },
        code: { text: 'Type 2 diabetes' },
      },
    ],
    allergies: [
      {
        resourceType: 'AllergyIntolerance',
        id: 'alg-01',
        patient: { reference: `Patient/${ada.uuid}` },
        code: { text: 'Penicillin' },
      },
    ],
    medications: [
      {
        resourceType: 'MedicationRequest',
        id: 'med-01',
        subject: { reference: `Patient/${ada.uuid}` },
        medicationCodeableConcept: { text: 'Metformin' },
      },
    ],
    carePlans: [
      carePlan({
        id: 'task-01',
        patient: ada,
        title: 'Follow up potassium',
        status: 'not-started',
        priority: 'high',
        dueAt: '2026-08-30T09:00:00.000Z',
        assignee: { id: drChen.uuid, display: drChen.display, type: 'person' },
        sourceReference: 'Observation/obs-01',
      }),
      carePlan({
        id: 'task-02',
        patient: ada,
        title: 'Review clinic prep',
        status: 'not-started',
        priority: 'medium',
        dueAt: '2026-09-02T09:00:00.000Z',
        assignee: { id: clinicNurse.uuid, display: clinicNurse.display, type: 'role' },
      }),
      carePlan({
        id: 'task-03',
        patient: alan,
        title: 'Follow up sodium',
        status: 'in-progress',
        priority: 'high',
        dueAt: '2026-09-01T09:00:00.000Z',
        assignee: { id: drChen.uuid, display: drChen.display, type: 'person' },
        sourceReference: 'Observation/obs-02',
      }),
      carePlan({
        id: 'task-04',
        patient: grace,
        title: 'Active duplicate source',
        status: 'in-progress',
        priority: 'medium',
        sourceReference: 'Observation/obs-active-dup',
      }),
      carePlan({
        id: 'task-05',
        patient: katherine,
        title: 'Completed source',
        status: 'completed',
        priority: 'low',
        dueAt: '2026-08-20T09:00:00.000Z',
        sourceReference: 'Observation/obs-completed-ok',
      }),
      carePlan({
        id: 'task-06',
        patient: dorothy,
        title: 'Cancelled source',
        status: 'cancelled',
        priority: 'low',
        sourceReference: 'Observation/obs-cancelled-ok',
      }),
      carePlan({
        id: 'task-07',
        patient: mary,
        title: 'Overdue paperwork',
        status: 'not-started',
        priority: 'low',
        dueAt: '2026-08-15T09:00:00.000Z',
      }),
      carePlan({
        id: 'task-08',
        patient: claude,
        title: 'Unknown status task',
        status: 'unknown',
        priority: 'medium',
      }),
    ],
  };
}

export function createOpenmrsMswHandlers(store: OpenmrsMswStore): RequestHandler[] {
  return [
    http.get('*/ws/rest/v1/patient', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const url = new URL(request.url);
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const limit = readLimit(url.searchParams.get('limit'), 20);
      const matches =
        query === ''
          ? store.patients
          : store.patients.filter(
              (item) =>
                item.uuid.toLowerCase().includes(query) ||
                item.display.toLowerCase().includes(query) ||
                item.person.display.toLowerCase().includes(query),
            );
      return HttpResponse.json({ results: matches.slice(0, limit) });
    }),
    http.get('*/ws/rest/v1/patient/:id', ({ params }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const id = pathParam(params.id);
      const match = store.patients.find((item) => item.uuid === id);
      if (match === undefined) {
        return HttpResponse.json({ error: 'secret-token-xyz' }, { status: 404 });
      }
      return HttpResponse.json(match);
    }),
    http.get('*/ws/rest/v1/appointment', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const url = new URL(request.url);
      const fromMs = Date.parse(url.searchParams.get('fromDate') ?? '');
      const toMs = Date.parse(url.searchParams.get('toDate') ?? '');
      const matches = store.appointments.filter((item) => {
        const at = Date.parse(item.startDateTime);
        if (!Number.isFinite(at)) {
          return false;
        }
        if (Number.isFinite(fromMs) && at < fromMs) {
          return false;
        }
        if (Number.isFinite(toMs) && at > toMs) {
          return false;
        }
        return true;
      });
      return HttpResponse.json(matches);
    }),
    http.get('*/ws/fhir2/R4/Observation', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const url = new URL(request.url);
      const patientId = normalizeRef(url.searchParams.get('patient'));
      if (patientId === '') {
        return HttpResponse.json({ error: 'patient is required' }, { status: 400 });
      }
      const category = url.searchParams.get('category');
      const matches = store.observations.filter((item) => {
        if (observationPatientId(item) !== patientId) {
          return false;
        }
        return category === null || observationCategory(item) === category;
      });
      return paginateResources(store, url, matches);
    }),
    http.get('*/ws/fhir2/R4/Observation/:id', ({ params }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const id = pathParam(params.id);
      const match = store.observations.find((item) => item.id === id);
      if (match === undefined) {
        return HttpResponse.json({ error: 'secret-token-xyz' }, { status: 404 });
      }
      return HttpResponse.json(match);
    }),
    http.get('*/ws/fhir2/R4/Condition', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      return bundleForPatient(store.conditions, new URL(request.url).searchParams.get('patient'));
    }),
    http.get('*/ws/fhir2/R4/AllergyIntolerance', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      return bundleForPatient(store.allergies, new URL(request.url).searchParams.get('patient'));
    }),
    http.get('*/ws/fhir2/R4/MedicationRequest', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      return bundleForPatient(store.medications, new URL(request.url).searchParams.get('patient'));
    }),
    http.get('*/ws/rest/v1/tasks/careplan', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const patientId = normalizeRef(new URL(request.url).searchParams.get('patient'));
      if (patientId === '') {
        return HttpResponse.json({ error: 'patient is required' }, { status: 400 });
      }
      const matches = store.carePlans.filter((item) => carePlanPatientId(item) === patientId);
      return HttpResponse.json({
        resourceType: 'Bundle',
        entry: matches.map((resource) => ({ resource })),
      });
    }),
    http.post('*/ws/rest/v1/tasks/careplan', async ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      const body = (await request.json()) as unknown;
      if (body === null || typeof body !== 'object') {
        return HttpResponse.json({ error: 'secret-token-xyz' }, { status: 400 });
      }
      const created: Record<string, unknown> = {
        ...(body as Record<string, unknown>),
        resourceType: 'CarePlan',
        id: `created-${String(store.nextCreatedId)}`,
      };
      store.nextCreatedId += 1;
      store.carePlans.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.get('*/ws/rest/v1/provider', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      return HttpResponse.json({
        results: filterNamed(store.providers, new URL(request.url)),
      });
    }),
    http.get('*/ws/rest/v1/role', ({ request }) => {
      const forced = forcedResponse(store);
      if (forced !== undefined) {
        return forced;
      }
      return HttpResponse.json({
        results: filterNamed(store.roles, new URL(request.url)),
      });
    }),
  ];
}

export function createOpenmrsMswFetch(store: OpenmrsMswStore): OpenmrsFetch {
  const handlers = createOpenmrsMswHandlers(store);
  return async (path, init) => {
    if (init?.signal?.aborted === true) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const method = init?.method ?? 'GET';
    const requestInit: RequestInit = { method };
    if (init?.signal !== undefined) {
      requestInit.signal = init.signal;
    }
    if (init?.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      requestInit.headers = { 'content-type': 'application/json' };
      requestInit.body = JSON.stringify(init.body);
    }

    const request = new Request(new URL(path, 'http://openmrs.local'), requestInit);
    const response = await getResponse(handlers, request);
    if (response === undefined) {
      throw new Error(`Unhandled OpenMRS path: ${path}`);
    }

    const text = await response.text();
    const data = text === '' ? undefined : (JSON.parse(text) as unknown);
    return { status: response.status, data };
  };
}

function patient(uuid: string, display: string): OpenmrsMswPatient {
  return { uuid, display, person: { display } };
}

function appointment(
  uuid: string,
  person: OpenmrsMswPatient,
  startDateTime: string,
  status: string,
  service?: string,
): OpenmrsMswAppointment {
  const item: OpenmrsMswAppointment = {
    uuid,
    startDateTime,
    status,
    patient: { uuid: person.uuid, name: person.display },
  };
  if (service !== undefined) {
    item.service = { name: service };
  }
  return item;
}

function observation(input: {
  id: string;
  patient: OpenmrsMswPatient;
  name: string;
  value?: number;
  unit?: string;
  observedAt: string;
  interpretation?: string;
  referenceRange?: string;
  category: 'laboratory' | 'vital-signs';
}): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: 'Observation',
    id: input.id,
    code: { text: input.name },
    subject: { reference: `Patient/${input.patient.uuid}`, display: input.patient.display },
    effectiveDateTime: input.observedAt,
    category: [{ coding: [{ code: input.category }] }],
  };
  if (input.value !== undefined) {
    const quantity: { value: number; unit?: string } = { value: input.value };
    if (input.unit !== undefined) {
      quantity.unit = input.unit;
    }
    resource.valueQuantity = quantity;
  }
  if (input.interpretation !== undefined) {
    resource.interpretation = [{ coding: [{ code: input.interpretation }] }];
  }
  if (input.referenceRange !== undefined) {
    resource.referenceRange = [{ text: input.referenceRange }];
  }
  return resource;
}

function carePlan(input: {
  id: string;
  patient: OpenmrsMswPatient;
  title: string;
  status: string;
  priority: string;
  dueAt?: string;
  assignee?: { id: string; display: string; type: 'person' | 'role' };
  sourceReference?: string;
}): Record<string, unknown> {
  const rationale =
    input.sourceReference === undefined
      ? input.title
      : `${input.title}\n[emr-webmcp:v1 source=${input.sourceReference} workflow=lablatch]`;
  const detail: Record<string, unknown> = {
    status: input.status,
    description: input.title,
    reasonCode: [{ text: rationale }],
  };
  if (input.assignee !== undefined) {
    detail.performer = [
      {
        reference: `${input.assignee.type === 'role' ? 'Role' : 'Provider'}/${input.assignee.id}`,
        display: input.assignee.display,
      },
    ];
  }

  const plan: Record<string, unknown> = {
    resourceType: 'CarePlan',
    id: input.id,
    status:
      input.status === 'completed'
        ? 'completed'
        : input.status === 'cancelled'
          ? 'revoked'
          : 'active',
    title: input.title,
    description: rationale,
    subject: { reference: `Patient/${input.patient.uuid}`, display: input.patient.display },
    activity: [{ detail }],
    extension: [{ url: PRIORITY_EXTENSION, valueCode: input.priority }],
  };
  if (input.dueAt !== undefined) {
    plan.period = { end: input.dueAt };
  }
  return plan;
}

function forcedResponse(store: OpenmrsMswStore): Response | undefined {
  if (store.forceStatus === undefined) {
    return undefined;
  }
  return HttpResponse.json(store.forceBody ?? { error: 'secret-token-xyz' }, {
    status: store.forceStatus,
  });
}

function paginateResources(
  store: OpenmrsMswStore,
  url: URL,
  resources: Record<string, unknown>[],
): Response {
  const pageSize = store.observationPageSize;
  if (pageSize === undefined) {
    return HttpResponse.json({
      resourceType: 'Bundle',
      entry: resources.map((resource) => ({ resource })),
    });
  }

  const offset = Number(url.searchParams.get('_getpagesoffset') ?? '0');
  const slice = resources.slice(offset, offset + pageSize);
  const link: Array<{ relation: string; url: string }> = [];
  if (offset + pageSize < resources.length) {
    const next = new URL(url.href);
    next.searchParams.set('_getpagesoffset', String(offset + pageSize));
    link.push({ relation: 'next', url: next.href });
  }
  return HttpResponse.json({
    resourceType: 'Bundle',
    entry: slice.map((resource) => ({ resource })),
    link,
  });
}

function bundleForPatient(resources: Record<string, unknown>[], rawPatient: string | null): Response {
  const patientId = normalizeRef(rawPatient);
  const matches =
    patientId === ''
      ? resources
      : resources.filter((item) => resourcePatientId(item) === patientId);
  return HttpResponse.json({
    resourceType: 'Bundle',
    entry: matches.map((resource) => ({ resource })),
  });
}

function filterNamed(
  items: Array<{ uuid: string; display: string }>,
  url: URL,
): Array<{ uuid: string; display: string }> {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const limit = readLimit(url.searchParams.get('limit'), 50);
  const matches =
    query === ''
      ? items
      : items.filter(
          (item) =>
            item.uuid.toLowerCase().includes(query) || item.display.toLowerCase().includes(query),
        );
  return matches.slice(0, limit);
}

function readLimit(raw: string | null, fallback: number): number {
  const parsed = Number(raw ?? '');
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

function pathParam(value: string | readonly string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function normalizeRef(value: string | null): string {
  if (value === null || value === '') {
    return '';
  }
  return value.replace(/^(Patient|Provider|Role)\//, '');
}

function observationPatientId(resource: Record<string, unknown>): string {
  return resourcePatientId(resource);
}

function observationCategory(resource: Record<string, unknown>): string {
  const category = resource.category;
  if (!Array.isArray(category)) {
    return '';
  }
  for (const item of category) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const coding = (item as { coding?: Array<{ code?: string }> }).coding;
    const code = coding?.[0]?.code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return '';
}

function carePlanPatientId(resource: Record<string, unknown>): string {
  return resourcePatientId(resource);
}

function resourcePatientId(resource: Record<string, unknown>): string {
  const subject = resource.subject;
  if (subject !== null && typeof subject === 'object' && 'reference' in subject) {
    const reference = (subject as { reference?: unknown }).reference;
    if (typeof reference === 'string') {
      return normalizeRef(reference);
    }
  }
  const patient = resource.patient;
  if (patient !== null && typeof patient === 'object' && 'reference' in patient) {
    const reference = (patient as { reference?: unknown }).reference;
    if (typeof reference === 'string') {
      return normalizeRef(reference);
    }
  }
  return '';
}
