import {
  type EmrAdapter,
  type FollowupQuery,
  type FollowupSummary,
  type ResultQuery,
  type ResultSummary,
} from '@emr-webmcp/core';
import { createFixtureAdapter } from '@emr-webmcp/contract-fixture';
import { createOpenmrsAdapter } from '@emr-webmcp/openmrs-adapter';
import { createOpenmrsMswFetch, createOpenmrsMswStore } from '@emr-webmcp/openmrs-adapter/testing';
import { describe, expect, it, vi } from 'vitest';

import { FOLLOWUP_JOIN_LIMIT, UNLATCHED_LIMIT, findUnlatched } from './find-unlatched.js';

const FIXTURE_NOW = new Date('2026-08-31T12:00:00.000Z');

type Backend = {
  name: string;
  makeAdapter: () => EmrAdapter;
};

const backends: Backend[] = [
  {
    name: 'fixture',
    makeAdapter: () => createFixtureAdapter({ now: () => FIXTURE_NOW }),
  },
  {
    name: 'openmrs',
    makeAdapter: () => {
      const store = createOpenmrsMswStore();
      return createOpenmrsAdapter({
        fetch: createOpenmrsMswFetch(store),
        now: () => FIXTURE_NOW,
        getActivePatientId: () => store.activePatientId,
      });
    },
  },
];

describe.each(backends)('findUnlatched ($name)', ({ makeAdapter }) => {
  it('returns abnormal results that have no active correlated follow-up', async () => {
    const adapter = makeAdapter();
    const writes = watchWrites(adapter);
    const result = await findUnlatched(adapter);

    expect(result.items.map((item) => item.id).sort()).toEqual(['obs-03', 'obs-04', 'obs-08']);
    expect(result.truncated).toBe(false);
    expect(writes).toEqual({ createFollowup: 0, navigate: 0 });
  });

  it('treats not-started and in-progress follow-ups as latches', async () => {
    const adapter = makeAdapter();
    const result = await findUnlatched(adapter);

    expect(result.items.map((item) => item.sourceReference)).not.toContain('Observation/obs-01');
    expect(result.items.map((item) => item.sourceReference)).not.toContain('Observation/obs-02');
  });

  it('does not treat completed, cancelled, or unknown follow-ups as latches', async () => {
    const base = makeAdapter();
    const extraFollowups: FollowupSummary[] = [
      followup({
        id: 'task-completed-obs-03',
        patientId: 'patient-03',
        display: 'Grace Hopper',
        sourceReference: 'Observation/obs-03',
        status: 'completed',
      }),
      followup({
        id: 'task-cancelled-obs-04',
        patientId: 'patient-04',
        display: 'Katherine Johnson',
        sourceReference: 'Observation/obs-04',
        status: 'cancelled',
      }),
      followup({
        id: 'task-unknown-obs-08',
        patientId: 'patient-07',
        display: 'Claude Shannon',
        sourceReference: 'Observation/obs-08',
        status: 'unknown',
      }),
    ];
    const adapter = withFollowups(base, extraFollowups);

    const result = await findUnlatched(adapter);

    expect(result.items.map((item) => item.id).sort()).toEqual(['obs-03', 'obs-04', 'obs-08']);
  });

  it('does not latch a result from a follow-up on a different patient', async () => {
    const base = makeAdapter();
    const adapter = withFollowups(base, [
      followup({
        id: 'task-wrong-patient',
        patientId: 'patient-02',
        display: 'Alan Turing',
        sourceReference: 'Observation/obs-03',
        status: 'in-progress',
      }),
    ]);

    const result = await findUnlatched(adapter);

    expect(result.items.map((item) => item.id)).toContain('obs-03');
  });

  it('caps the returned set at 100 and reports truthful truncation', async () => {
    const base = makeAdapter();
    const extras = Array.from({ length: 120 }, (_, index) =>
      abnormalResult({
        id: `obs-extra-${String(index)}`,
        patientId: 'patient-12',
        display: 'Edsger Dijkstra',
      }),
    );
    const adapter = withOverrides(base, {
      listAbnormalResults: (input) =>
        Promise.resolve(extras.slice(0, Math.max(0, Math.min(input.limit, 100)))),
    });
    const result = await findUnlatched(adapter);

    expect(result.items).toHaveLength(UNLATCHED_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it('reports truncated when the follow-up join page is full', async () => {
    const base = makeAdapter();
    const extras = Array.from({ length: FOLLOWUP_JOIN_LIMIT }, (_, index) =>
      followup({
        id: `task-join-${String(index)}`,
        patientId: 'patient-12',
        display: 'Edsger Dijkstra',
        sourceReference: `Observation/obs-join-${String(index)}`,
        status: 'not-started',
      }),
    );
    const adapter = withOverrides(base, {
      listFollowups: (input) => Promise.resolve(extras.slice(0, Math.max(0, input.limit))),
    });

    const result = await findUnlatched(adapter);

    expect(result.truncated).toBe(true);
  });

  it('reports truncated=false when the unlatched set is under the cap', async () => {
    const adapter = makeAdapter();
    const result = await findUnlatched(adapter, { patientId: 'patient-03' });

    expect(result.items.map((item) => item.id)).toEqual(['obs-03']);
    expect(result.truncated).toBe(false);
  });

  it('never passes a cursor to adapter list methods', async () => {
    const base = makeAdapter();
    const resultQueries: ResultQuery[] = [];
    const followupQueries: FollowupQuery[] = [];
    const adapter = withOverrides(base, {
      listAbnormalResults: async (input) => {
        resultQueries.push(input);
        return base.listAbnormalResults(input);
      },
      listFollowups: async (input) => {
        followupQueries.push(input);
        return base.listFollowups(input);
      },
    });

    await findUnlatched(adapter, { patientId: 'patient-01' });

    expect(resultQueries).toHaveLength(1);
    expect(followupQueries).toHaveLength(1);
    expect(resultQueries[0]).not.toHaveProperty('cursor');
    expect(followupQueries[0]).not.toHaveProperty('cursor');
    expect(resultQueries[0]?.patientId).toBe('patient-01');
    expect(followupQueries[0]?.patientId).toBe('patient-01');
  });
});

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

function withFollowups(adapter: EmrAdapter, extras: FollowupSummary[]): EmrAdapter {
  return withOverrides(adapter, {
    listFollowups: async (input) => {
      const existing = await adapter.listFollowups(input);
      const extraMatches = extras.filter((item) => {
        if (input.patientId !== undefined && item.patient.id !== input.patientId) {
          return false;
        }
        return true;
      });
      return [...existing, ...extraMatches].slice(0, Math.max(0, input.limit));
    },
  });
}

function withOverrides(
  adapter: EmrAdapter,
  overrides: Partial<Pick<EmrAdapter, 'listAbnormalResults' | 'listFollowups'>>,
): EmrAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver): unknown {
      if (property === 'listAbnormalResults' && overrides.listAbnormalResults !== undefined) {
        return overrides.listAbnormalResults;
      }
      if (property === 'listFollowups' && overrides.listFollowups !== undefined) {
        return overrides.listFollowups;
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

function followup(input: {
  id: string;
  patientId: string;
  display: string;
  sourceReference: string;
  status: FollowupSummary['status'];
}): FollowupSummary {
  return {
    id: input.id,
    patient: { id: input.patientId, display: input.display },
    title: input.id,
    status: input.status,
    priority: 'medium',
    sourceReference: input.sourceReference,
  };
}

function abnormalResult(input: { id: string; patientId: string; display: string }): ResultSummary {
  return {
    id: input.id,
    patient: { id: input.patientId, display: input.display },
    name: 'Synthetic',
    observedAt: '2026-08-20T00:00:00.000Z',
    interpretation: 'high',
    sourceReference: `Observation/${input.id}`,
  };
}
