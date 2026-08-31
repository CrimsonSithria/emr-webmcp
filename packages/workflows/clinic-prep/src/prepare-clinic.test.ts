import { AdapterError, type AppointmentSummary, type EmrAdapter } from '@emr-webmcp/core';
import { createFixtureAdapter } from '@emr-webmcp/contract-fixture';
import { createOpenmrsAdapter } from '@emr-webmcp/openmrs-adapter';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from '@emr-webmcp/openmrs-adapter/testing';
import { describe, expect, it, vi } from 'vitest';

import { CLINIC_PREP_CONCURRENCY_CEILING, prepareClinic } from './prepare-clinic.js';

const FIXTURE_NOW = new Date('2026-08-31T12:00:00.000Z');
const CLINIC_START = '2026-09-01T00:00:00.000Z';
const CLINIC_END = '2026-09-08T00:00:00.000Z';
const EMPTY_START = '2026-07-01T00:00:00.000Z';
const EMPTY_END = '2026-07-02T00:00:00.000Z';

type Backend = {
  name: string;
  makeAdapter: (now?: () => Date) => EmrAdapter;
};

const backends: Backend[] = [
  {
    name: 'fixture',
    makeAdapter: (now = () => FIXTURE_NOW) => createFixtureAdapter({ now }),
  },
  {
    name: 'openmrs',
    makeAdapter: (now = () => FIXTURE_NOW) => {
      const store = createOpenmrsMswStore();
      return createOpenmrsAdapter({
        fetch: createOpenmrsMswFetch(store),
        now,
        getActivePatientId: () => store.activePatientId,
      });
    },
  },
];

describe.each(backends)('prepareClinic ($name)', ({ makeAdapter }) => {
  it('returns an empty clinic when the window has no appointments', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);
    const result = await prepareClinic(adapter, { start: EMPTY_START, end: EMPTY_END });

    expect(result.items).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(writes).toEqual({ createFollowup: 0, navigate: 0 });
  });

  it('rejects a window longer than seven days', async () => {
    const adapter = makeAdapter();

    await expectAdapterError(
      prepareClinic(adapter, {
        start: CLINIC_START,
        end: '2026-09-08T00:00:00.001Z',
      }),
      'invalid-input',
    );
  });

  it('returns per-patient briefs in stable appointment order', async () => {
    const adapter = makeAdapter();
    const appointments = await adapter.listAppointments({ start: CLINIC_START, end: CLINIC_END });
    const result = await prepareClinic(adapter, { start: CLINIC_START, end: CLINIC_END });

    expect(appointments.length).toBeGreaterThan(1);
    expect(result.items.map((item) => item.appointment.id)).toEqual(
      appointments.map((appointment) => appointment.id),
    );
    expect(result.items.every((item) => item.brief !== null)).toBe(true);
    expect(result.items.map((item) => item.brief?.patient.id)).toEqual(
      appointments.map((appointment) => appointment.patient.id),
    );
    expect(result.failures).toEqual([]);
  });

  it('caps concurrent chart-brief fetches at five', async () => {
    const base = makeAdapter();
    const appointments = expandAppointments(
      await base.listAppointments({
        start: CLINIC_START,
        end: CLINIC_END,
      }),
    );
    expect(appointments.length).toBeGreaterThan(CLINIC_PREP_CONCURRENCY_CEILING);

    let inFlight = 0;
    let maxInFlight = 0;
    const adapter = withOverrides(base, {
      listAppointments: () => Promise.resolve(appointments),
      getChartBrief: async (patientId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await delay(15);
          return await base.getChartBrief(patientId);
        } finally {
          inFlight -= 1;
        }
      },
    });

    await prepareClinic(adapter, {
      start: CLINIC_START,
      end: CLINIC_END,
      concurrency: 20,
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(CLINIC_PREP_CONCURRENCY_CEILING);
  });

  it('honors a requested concurrency below the ceiling', async () => {
    const base = makeAdapter();
    const appointments = expandAppointments(
      await base.listAppointments({
        start: CLINIC_START,
        end: CLINIC_END,
      }),
    );

    let inFlight = 0;
    let maxInFlight = 0;
    const adapter = withOverrides(base, {
      listAppointments: () => Promise.resolve(appointments),
      getChartBrief: async (patientId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await delay(15);
          return await base.getChartBrief(patientId);
        } finally {
          inFlight -= 1;
        }
      },
    });

    await prepareClinic(adapter, { start: CLINIC_START, end: CLINIC_END, concurrency: 2 });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('keeps appointment order when one chart brief fails upstream', async () => {
    const base = makeAdapter();
    const appointments = await base.listAppointments({ start: CLINIC_START, end: CLINIC_END });
    const failedPatientId = appointments[1]?.patient.id;
    expect(failedPatientId).toBeDefined();

    const writes = watchWrites(base);
    const adapter = withOverrides(base, {
      getChartBrief: async (patientId) => {
        if (patientId === failedPatientId) {
          throw new AdapterError('upstream', 'Upstream request failed', true);
        }
        return base.getChartBrief(patientId);
      },
    });

    const result = await prepareClinic(adapter, { start: CLINIC_START, end: CLINIC_END });

    expect(result.items.map((item) => item.appointment.id)).toEqual(
      appointments.map((appointment) => appointment.id),
    );
    expect(result.items[1]?.brief).toBeNull();
    expect(result.items.filter((item) => item.brief !== null)).toHaveLength(appointments.length - 1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.patientId).toBe(failedPatientId);
    expect(result.failures[0]?.error).toBeInstanceOf(AdapterError);
    expect(result.failures[0]?.error.code).toBe('upstream');
    expect(writes).toEqual({ createFollowup: 0, navigate: 0 });
  });
});

function expandAppointments(seed: AppointmentSummary[]): AppointmentSummary[] {
  const extras: AppointmentSummary[] = [
    {
      id: 'appt-extra-08',
      patient: { id: 'patient-08', display: 'John von Neumann' },
      start: '2026-09-02T11:00:00.000Z',
      status: 'scheduled',
    },
    {
      id: 'appt-extra-09',
      patient: { id: 'patient-09', display: 'Barbara Liskov' },
      start: '2026-09-02T12:00:00.000Z',
      status: 'scheduled',
    },
    {
      id: 'appt-extra-10',
      patient: { id: 'patient-10', display: 'Frances Allen' },
      start: '2026-09-02T13:00:00.000Z',
      status: 'scheduled',
    },
  ];
  return [...seed, ...extras];
}

function watchWrites(adapter: EmrAdapter): { createFollowup: number; navigate: number } {
  const counts = { createFollowup: 0, navigate: 0 };
  vi.spyOn(adapter, 'createFollowup').mockImplementation(() => {
    counts.createFollowup += 1;
    return Promise.reject(new Error('createFollowup must not be called'));
  });
  vi.spyOn(adapter, 'navigate').mockImplementation(() => {
    counts.navigate += 1;
    return Promise.reject(new Error('navigate must not be called'));
  });
  return counts;
}

function withOverrides(
  adapter: EmrAdapter,
  overrides: Partial<Pick<EmrAdapter, 'listAppointments' | 'getChartBrief'>>,
): EmrAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver): unknown {
      if (property === 'listAppointments' && overrides.listAppointments !== undefined) {
        return overrides.listAppointments;
      }
      if (property === 'getChartBrief' && overrides.getChartBrief !== undefined) {
        return overrides.getChartBrief;
      }
      return bindIfFunction(Reflect.get(target, property, receiver), target);
    },
  });
}

function bindIfFunction(value: unknown, target: object): unknown {
  if (typeof value !== 'function') {
    return value;
  }
  const bound: unknown = Function.prototype.bind.call(value, target);
  return bound;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
