import { AdapterError, type EmrNavigationTarget } from '@emr-webmcp/core';
import { describe, expect, it, vi } from 'vitest';

import { createOpenmrsAdapter, type OpenmrsFetch } from './openmrs-adapter.js';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from './testing.js';

const APPOINTMENT_START = '2026-09-01T00:00:00.000Z';
const APPOINTMENT_END = '2026-09-08T00:00:00.000Z';
const NOW = new Date('2026-08-31T12:00:00.000Z');

describe('OpenmrsAdapter', () => {
  describe('searchPatients', () => {
    it('rejects empty queries and limits below 1', async () => {
      const adapter = makeAdapter();

      await expectAdapterError(adapter.searchPatients('', 10), 'invalid-input');
      await expectAdapterError(adapter.searchPatients('   ', 10), 'invalid-input');
      await expectAdapterError(adapter.searchPatients('patient-', 0), 'invalid-input');
      await expectAdapterError(adapter.searchPatients('patient-', -1), 'invalid-input');
    });

    it('returns mapped patients and caps at min(limit, 20)', async () => {
      const adapter = makeAdapter();
      const limited = await adapter.searchPatients('patient-', 3);
      const uncapped = await adapter.searchPatients('patient-', 100);

      expect(limited.length).toBe(3);
      expect(limited[0]).toEqual({ id: 'patient-01', display: 'Ada Lovelace' });
      expect(uncapped.length).toBeGreaterThan(limited.length);
      expect(uncapped.length).toBeLessThanOrEqual(20);
      expect(uncapped.every((patient) => !('uuid' in patient) && !('person' in patient))).toBe(true);
    });
  });

  describe('getActivePatient', () => {
    it('loads the injected session patient through REST', async () => {
      const adapter = makeAdapter();

      await expect(adapter.getActivePatient()).resolves.toEqual({
        id: 'patient-01',
        display: 'Ada Lovelace',
      });
    });

    it('returns null when no session patient is selected', async () => {
      const store = createOpenmrsMswStore();
      store.activePatientId = null;
      const adapter = makeAdapter(store);

      await expect(adapter.getActivePatient()).resolves.toBeNull();
    });
  });

  describe('listAppointments', () => {
    it('rejects missing bounds and windows longer than 7 days', async () => {
      const adapter = makeAdapter();

      await expectAdapterError(
        adapter.listAppointments({ start: APPOINTMENT_START } as { start: string; end: string }),
        'invalid-input',
      );
      await expectAdapterError(
        adapter.listAppointments({ start: APPOINTMENT_START, end: '2026-09-08T00:00:00.001Z' }),
        'invalid-input',
      );
    });

    it('maps appointment statuses and keeps results inside the window', async () => {
      const adapter = makeAdapter();
      const appointments = await adapter.listAppointments({
        start: APPOINTMENT_START,
        end: APPOINTMENT_END,
      });

      expect(appointments.length).toBeGreaterThan(0);
      expect(appointments.some((item) => item.service === 'Diabetes clinic')).toBe(true);
      expect(appointments.find((item) => item.id === 'appt-02')?.status).toBe('checked-in');
      expect(appointments.find((item) => item.id === 'appt-07')?.status).toBe('unknown');
      expect(appointments.every((item) => item.start >= APPOINTMENT_START)).toBe(true);
      expect(appointments.every((item) => item.start <= APPOINTMENT_END)).toBe(true);
      expect(appointments.some((item) => item.id === 'appt-05')).toBe(false);
    });
  });

  describe('getChartBrief', () => {
    it('aggregates patient, chart resources, vitals, lab results, and open tasks', async () => {
      const adapter = makeAdapter();
      const brief = await adapter.getChartBrief('patient-01');

      expect(brief.patient).toEqual({ id: 'patient-01', display: 'Ada Lovelace' });
      expect(brief.conditions).toEqual([{ id: 'cond-01', display: 'Type 2 diabetes' }]);
      expect(brief.allergies).toEqual([{ id: 'alg-01', display: 'Penicillin' }]);
      expect(brief.medications).toEqual([{ id: 'med-01', display: 'Metformin' }]);
      expect(brief.recentVitals.some((item) => item.id === 'obs-05')).toBe(true);
      expect(brief.recentResults.some((item) => item.id === 'obs-01')).toBe(true);
      expect(brief.openTasks.every((item) => item.patient.id === 'patient-01')).toBe(true);
      expect(
        brief.openTasks.every(
          (item) => item.status === 'not-started' || item.status === 'in-progress',
        ),
      ).toBe(true);
    });

    it('throws not-found for a missing patient', async () => {
      await expectAdapterError(makeAdapter().getChartBrief('missing-patient'), 'not-found');
    });
  });

  describe('laboratory observations', () => {
    it('maps FHIR interpretations and keeps unrecognized codes unknown', async () => {
      const adapter = makeAdapter();
      const results = await adapter.listAbnormalResults({ limit: 100 });
      const potassium = results.find((item) => item.id === 'obs-01');
      const glucose = results.find((item) => item.id === 'obs-03');
      const hemoglobin = results.find((item) => item.id === 'obs-04');
      const creatinine = results.find((item) => item.id === 'obs-08');

      expect(potassium?.interpretation).toBe('high');
      expect(potassium?.referenceRange).toBe('3.5-5.1');
      expect(potassium?.sourceReference).toBe('Observation/obs-01');
      expect(glucose?.interpretation).toBe('critical-high');
      expect(hemoglobin?.interpretation).toBe('critical-low');
      expect(creatinine?.interpretation).toBe('high');
      expect(results.every((item) => item.id !== 'obs-05' && item.id !== 'obs-06')).toBe(true);
      expect(results.every((item) => item.interpretation !== 'normal')).toBe(true);
      expect(results.every((item) => item.interpretation !== 'unknown')).toBe(true);
    });

    it('returns one result by id and throws not-found when missing', async () => {
      const adapter = makeAdapter();
      const [abnormal] = await adapter.listAbnormalResults({ limit: 1 });
      expect(abnormal).toBeDefined();
      if (abnormal === undefined) {
        throw new Error('expected an abnormal result');
      }

      await expect(adapter.getResult(abnormal.id)).resolves.toEqual(abnormal);
      await expectAdapterError(adapter.getResult('missing-result'), 'not-found');
    });

    it('caps abnormal results at min(limit, 100)', async () => {
      const adapter = makeAdapter();
      const limited = await adapter.listAbnormalResults({ limit: 1 });
      const uncapped = await adapter.listAbnormalResults({ limit: 1000 });

      expect(limited).toHaveLength(1);
      expect(uncapped.length).toBeGreaterThan(1);
      expect(uncapped.length).toBeLessThanOrEqual(100);
    });

    it('rejects a non-empty cursor until Phase 3 pagination exists', async () => {
      const adapter = makeAdapter();

      await expectAdapterError(
        adapter.listAbnormalResults({ limit: 10, cursor: 'page-2' }),
        'invalid-input',
      );
      await expect(adapter.listAbnormalResults({ limit: 1 })).resolves.toHaveLength(1);
      await expect(adapter.listAbnormalResults({ limit: 1, cursor: '' })).resolves.toHaveLength(1);
    });

    it('scopes Observation reads to a patient or to one bounded newest-first window', async () => {
      const store = createOpenmrsMswStore();
      const fetch = vi.fn(createOpenmrsMswFetch(store));
      const adapter = createOpenmrsAdapter({
        fetch,
        now: () => NOW,
        navigate: () => undefined,
        getActivePatientId: () => store.activePatientId,
      });

      const clinicWide = await adapter.listAbnormalResults({ limit: 100 });
      const clinicWideCalls = fetch.mock.calls.map(([path]) => path).filter(isObservationCollection);
      await adapter.listAbnormalResults({ limit: 100, patientId: 'patient-01' });
      const patientCalls = fetch.mock.calls
        .map(([path]) => path)
        .filter(isObservationCollection)
        .slice(clinicWideCalls.length);

      expect(clinicWide.length).toBeGreaterThan(1);
      expect(clinicWideCalls).toHaveLength(1);
      const window = new URL(clinicWideCalls[0] ?? '', 'http://openmrs.local').searchParams;
      expect(window.get('patient')).toBeNull();
      expect(window.get('_sort')).toBe('-date');
      expect(Number(window.get('_count'))).toBeLessThanOrEqual(100);
      expect(patientCalls.length).toBeGreaterThan(0);
      expect(patientCalls.every((path) => hasRequiredPatient(path))).toBe(true);
    });

    it('never lists patients with an empty REST query, which real OpenMRS answers with nothing', async () => {
      const store = createOpenmrsMswStore();
      const fetch = vi.fn(createOpenmrsMswFetch(store));
      const adapter = createOpenmrsAdapter({
        fetch,
        now: () => NOW,
        navigate: () => undefined,
        getActivePatientId: () => store.activePatientId,
      });

      const results = await adapter.listAbnormalResults({ limit: 100 });
      const followups = await adapter.listFollowups({ limit: 100 });

      expect(results.length).toBeGreaterThan(0);
      expect(followups.length).toBeGreaterThan(0);
      expect(
        fetch.mock.calls.some(([path]) => {
          const url = new URL(path, 'http://openmrs.local');
          return url.pathname === '/ws/rest/v1/patient' && (url.searchParams.get('q') ?? '') === '';
        }),
      ).toBe(false);
    });

    it('returns newest results first and keeps the follow-up join covering every returned patient', async () => {
      const store = createOpenmrsMswStore();
      const fetch = vi.fn(createOpenmrsMswFetch(store));
      const adapter = createOpenmrsAdapter({
        fetch,
        now: () => NOW,
        navigate: () => undefined,
        getActivePatientId: () => store.activePatientId,
      });

      const results = await adapter.listAbnormalResults({ limit: 100 });
      const observedAt = results.map((item) => Date.parse(item.observedAt));
      expect(observedAt).toEqual([...observedAt].sort((left, right) => right - left));

      await adapter.listFollowups({ limit: 1000 });
      const joinedPatients = new Set(
        fetch.mock.calls
          .map(([path]) => path)
          .filter(isCarePlanCollection)
          .map((path) => new URL(path, 'http://openmrs.local').searchParams.get('subject')),
      );
      for (const item of results) {
        expect(joinedPatients.has(item.patient.id)).toBe(true);
      }
    });
  });

  describe('follow-ups and assignees', () => {
    it('rejects a non-empty cursor until Phase 3 pagination exists', async () => {
      const adapter = makeAdapter();

      await expectAdapterError(adapter.listFollowups({ limit: 10, cursor: 'page-2' }), 'invalid-input');
      await expect(adapter.listFollowups({ limit: 1 })).resolves.toHaveLength(1);
      await expect(adapter.listFollowups({ limit: 1, cursor: '' })).resolves.toHaveLength(1);
    });

    it('maps CarePlan tasks and filters by patient, assignee, priority, and overdue', async () => {
      const adapter = makeAdapter();
      const all = await adapter.listFollowups({ limit: 100 });
      const byPatient = await adapter.listFollowups({ limit: 100, patientId: 'patient-01' });
      const byAssignee = await adapter.listFollowups({
        limit: 100,
        assigneeId: 'person-dr-chen',
      });
      const byPriority = await adapter.listFollowups({ limit: 100, priority: 'high' });
      const overdue = await adapter.listFollowups({ limit: 100, overdueOnly: true });

      expect(all.length).toBeGreaterThan(1);
      expect(byPatient.every((item) => item.patient.id === 'patient-01')).toBe(true);
      expect(byAssignee.every((item) => item.assignee?.id === 'person-dr-chen')).toBe(true);
      expect(byAssignee.every((item) => item.assignee?.type === 'person')).toBe(true);
      expect(byPriority.every((item) => item.priority === 'high')).toBe(true);
      expect(overdue.length).toBeGreaterThan(0);
      expect(overdue.length).toBeLessThan(all.length);
      expect(
        overdue.every(
          (item) => item.dueAt !== undefined && Date.parse(item.dueAt) < NOW.getTime(),
        ),
      ).toBe(true);
      expect(all.find((item) => item.id === 'task-01')?.sourceReference).toBe(
        'Observation/obs-01',
      );
      expect(all.find((item) => item.id === 'task-02')?.assignee).toEqual({
        id: 'role-clinic-nurse',
        display: 'Clinic nurse',
        type: 'role',
      });
    });

    it('fans out CarePlan reads per subject and never omits it', async () => {
      const store = createOpenmrsMswStore();
      const fetch = vi.fn(createOpenmrsMswFetch(store));
      const adapter = createOpenmrsAdapter({
        fetch,
        now: () => NOW,
        navigate: () => undefined,
        getActivePatientId: () => store.activePatientId,
      });

      await adapter.listFollowups({ limit: 100 });
      await adapter.listFollowups({ limit: 100, patientId: 'patient-01' });

      const collections = fetch.mock.calls
        .map(([path]) => path)
        .filter(isCarePlanCollection);
      expect(collections.length).toBeGreaterThan(1);
      expect(collections.every((path) => hasRequiredSubject(path))).toBe(true);
    });

    it('searches providers as people and roles as roles', async () => {
      const adapter = makeAdapter();
      const assignees = await adapter.listAssignees('', 20);
      const nurses = await adapter.listAssignees('nurse', 20);

      expect(assignees.some((item) => item.id === 'person-dr-chen' && item.type === 'person')).toBe(
        true,
      );
      expect(
        assignees.some((item) => item.id === 'role-clinic-nurse' && item.type === 'role'),
      ).toBe(true);
      expect(nurses.every((item) => item.display.toLowerCase().includes('nurse'))).toBe(true);
    });
  });

  describe('error mapping', () => {
    it('maps 401 and 403 to unauthorized without leaking response bodies', async () => {
      const unauthorized = createOpenmrsMswStore();
      unauthorized.forceStatus = 401;
      const forbidden = createOpenmrsMswStore();
      forbidden.forceStatus = 403;

      await expectPublicError(makeAdapter(unauthorized).searchPatients('patient-', 10), {
        code: 'unauthorized',
        leaked: 'secret-token-xyz',
      });
      await expectPublicError(makeAdapter(forbidden).listAssignees('chen', 10), {
        code: 'unauthorized',
        leaked: 'secret-token-xyz',
      });
    });

    it('maps 404 to not-found without leaking response bodies', async () => {
      await expectPublicError(makeAdapter().getResult('missing-result'), {
        code: 'not-found',
        leaked: 'secret-token-xyz',
      });
    });

    it('maps 5xx and network failures to the public upstream message', async () => {
      const failing = createOpenmrsMswStore();
      failing.forceStatus = 502;
      await expectPublicError(makeAdapter(failing).searchPatients('patient-', 10), {
        code: 'upstream',
        leaked: 'secret-token-xyz',
        message: 'Upstream request failed',
      });

      const adapter = createOpenmrsAdapter({
        fetch: () => Promise.reject(new TypeError('fetch failed')),
        now: () => NOW,
      });
      await expectPublicError(adapter.searchPatients('patient-', 10), {
        code: 'upstream',
        leaked: 'fetch failed',
        message: 'Upstream request failed',
      });
    });
  });

  describe('pagination', () => {
    it('strips /openmrs from REST next links so openmrsFetch does not double-prefix', async () => {
      const fetch = vi.fn<OpenmrsFetch>((path) => {
        if (path.startsWith('/openmrs/')) {
          return Promise.resolve({ status: 404, data: { error: 'double-prefixed' } });
        }
        if (path.includes('startIndex=5')) {
          return Promise.resolve({
            status: 200,
            data: { results: [{ uuid: 'patient-02', display: 'Second' }], links: [] },
          });
        }
        return Promise.resolve({
          status: 200,
          data: {
            results: [{ uuid: 'patient-01', display: 'First' }],
            links: [{ rel: 'next', uri: '/openmrs/ws/rest/v1/patient?q=John&limit=5&v=default&startIndex=5' }],
          },
        });
      });
      const adapter = createOpenmrsAdapter({ fetch, now: () => NOW });

      const patients = await adapter.searchPatients('John', 10);

      expect(patients.map((patient) => patient.id)).toEqual(['patient-01', 'patient-02']);
      expect(fetch.mock.calls.map(([path]) => path)).toEqual([
        '/ws/rest/v1/patient?q=John&limit=10&v=default',
        '/ws/rest/v1/patient?q=John&limit=5&v=default&startIndex=5',
      ]);
    });

    it('follows FHIR next links and still applies the local abnormal cap', async () => {
      const store = createOpenmrsMswStore();
      store.observationPageSize = 2;
      store.observations.push(
        ...['obs-page-a', 'obs-page-b', 'obs-page-c'].map((id, index) => ({
          resourceType: 'Observation',
          id,
          code: { text: `Paged potassium ${String(index)}` },
          subject: { reference: 'Patient/patient-01', display: 'Ada Lovelace' },
          effectiveDateTime: '2026-08-23T08:00:00.000Z',
          category: [{ coding: [{ code: 'laboratory' }] }],
          interpretation: [{ coding: [{ code: 'H' }] }],
          valueQuantity: { value: 6 + index, unit: 'mmol/L' },
        })),
      );
      const fetch = vi.fn(createOpenmrsMswFetch(store));
      const adapter = createOpenmrsAdapter({
        fetch,
        now: () => NOW,
        navigate: () => undefined,
        getActivePatientId: () => store.activePatientId,
      });

      const results = await adapter.listAbnormalResults({ limit: 100, patientId: 'patient-01' });
      const observationCalls = fetch.mock.calls
        .map(([path]) => path)
        .filter(isObservationCollection);

      expect(results.length).toBeGreaterThan(2);
      expect(observationCalls.length).toBeGreaterThan(1);
      expect(observationCalls.some((path) => path.includes('_getpagesoffset='))).toBe(true);
      expect(observationCalls.every((path) => hasRequiredPatient(path))).toBe(true);
      expect(
        observationCalls.every((path) => {
          const count = Number(new URL(path, 'http://openmrs.local').searchParams.get('_count'));
          return Number.isFinite(count) && count > 0 && count <= 100;
        }),
      ).toBe(true);
    });
  });

  describe('abort propagation', () => {
    it('forwards the adapter signal and surfaces AbortError', async () => {
      const controller = new AbortController();
      const fetch = vi.fn<OpenmrsFetch>((_path, init) => {
        if (init?.signal?.aborted === true) {
          return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        }
        return Promise.resolve({ status: 200, data: { results: [] } });
      });
      const adapter = createOpenmrsAdapter({
        fetch,
        signal: controller.signal,
        now: () => NOW,
      });

      controller.abort();

      await expect(adapter.searchPatients('patient-', 10)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/ws/rest/v1/patient'),
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe('navigate', () => {
    it('accepts known targets and rejects unknown or empty ids', async () => {
      const navigations: EmrNavigationTarget[] = [];
      const adapter = createOpenmrsAdapter({
        fetch: createOpenmrsMswFetch(createOpenmrsMswStore()),
        now: () => NOW,
        navigate: (target) => {
          navigations.push(target);
        },
      });

      await expect(adapter.navigate({ kind: 'review-queue' })).resolves.toBeUndefined();
      await expect(
        adapter.navigate({ kind: 'patient-chart', patientId: 'patient-01' }),
      ).resolves.toBeUndefined();
      await expectAdapterError(
        adapter.navigate({ kind: 'unknown-place' } as unknown as EmrNavigationTarget),
        'invalid-input',
      );
      await expectAdapterError(
        adapter.navigate({ kind: 'patient-chart', patientId: '' }),
        'invalid-input',
      );
      expect(navigations).toEqual([
        { kind: 'review-queue' },
        { kind: 'patient-chart', patientId: 'patient-01' },
      ]);
    });
  });
});

function isObservationCollection(path: string): boolean {
  return new URL(path, 'http://openmrs.local').pathname === '/ws/fhir2/R4/Observation';
}

function isCarePlanCollection(path: string): boolean {
  return new URL(path, 'http://openmrs.local').pathname === '/ws/rest/v1/tasks/careplan';
}

function hasRequiredPatient(path: string): boolean {
  const patient = new URL(path, 'http://openmrs.local').searchParams.get('patient');
  return typeof patient === 'string' && patient !== '';
}

function hasRequiredSubject(path: string): boolean {
  const subject = new URL(path, 'http://openmrs.local').searchParams.get('subject');
  return typeof subject === 'string' && subject !== '';
}

function makeAdapter(store = createOpenmrsMswStore()) {
  return createOpenmrsAdapter({
    fetch: createOpenmrsMswFetch(store),
    now: () => NOW,
    navigate: () => undefined,
    getActivePatientId: () => store.activePatientId,
  });
}

async function expectAdapterError(action: Promise<unknown>, code: string): Promise<void> {
  try {
    await action;
    throw new Error(`expected AdapterError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code });
  }
}

async function expectPublicError(
  action: Promise<unknown>,
  expected: { code: string; leaked: string; message?: string },
): Promise<void> {
  try {
    await action;
    throw new Error(`expected AdapterError with code ${expected.code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ code: expected.code });
    if (!(error instanceof AdapterError)) {
      throw error;
    }
    expect(error.message).not.toContain(expected.leaked);
    expect(error.message).not.toContain('http://');
    expect(error.message).not.toContain('/ws/');
    if (expected.message !== undefined) {
      expect(error.message).toBe(expected.message);
    }
  }
}
